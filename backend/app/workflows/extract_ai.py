"""ARQ job — AI extraction of a material into its `ai` ExtractionVersion.

Two paths by file type:
- **binary** (pdf, pptx, ppt, docx) → render each page to a PNG, then a vision
  call per page. The model marks every figure with a fractional bounding box;
  each box is cropped straight out of the PDF source into `ai/attachments/` and
  embedded in the page Markdown as an image. See the `material-extraction` skill.
- **text** (md, txt, html, tex, py, ...) → the model reads the file text
  directly, in chunks if large.
"""
from __future__ import annotations

import asyncio
import base64
import io
import itertools
import logging
import re
import uuid
from pathlib import Path

from app.ai.events import ChatMessage
from app.ai.providers.agent import AgentProvider
from app.ai.router import resolve
from app.db.base import SessionLocal
from app.db.models import Course, Material
from app.extract.base import ExtractedDoc, Page
from app.extract.figures import crop_region
from app.extract.render import RENDERABLE, ensure_pdf, render_pdf
from app.skills.loader import build_skill_prompt
from app.vault.extraction import finalize_version, upsert_version
from app.vault.writer import version_dir, write_extracted, write_meta

log = logging.getLogger(__name__)

_TEXT_SUFFIXES = {".md", ".markdown", ".txt", ".html", ".htm", ".tex", ".rst", ".py", ".csv"}
_TEXT_CHUNK = 10_000
_PAGE_DPI = 150
_CROP_DPI = 220
# the model tends to give slightly tight bboxes — pad each side a little
_BBOX_PAD = 0.012
# successive image scales tried when the provider rejects a page for context size
_IMAGE_SCALES = (1.0, 0.6, 0.4, 0.28)
# a figure marker line on its own:  [[FIGURE bbox=x0,y0,x1,y1]]
_FIGURE_RE = re.compile(r"^[ \t]*\[\[FIGURE\s+bbox=([0-9.,\s]+)\]\][ \t]*$", re.MULTILINE)

_TEXT_SYSTEM = """You clean a source file into faithful, well-structured Markdown.

Preserve all content. Use proper headings, lists, tables and fenced code
blocks; render mathematics as LaTeX. Do not summarise or drop anything.
Output only the Markdown. No preamble, no code fences around the whole output."""


def _is_context_error(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "context" in msg or "400" in msg or "too large" in msg or "exceed" in msg


def _is_transient(exc: Exception) -> bool:
    """A retryable server-side hiccup — overload, rate limit, gateway error."""
    msg = str(exc).lower()
    return any(
        s in msg
        for s in ("503", "429", "502", "unavailable", "overloaded", "high demand",
                  "rate limit", "try again later", "timeout", "timed out")
    )


def _downscale_png(png: bytes, factor: float) -> bytes:
    """Shrink a PNG so it tokenises to fewer vision tokens."""
    from PIL import Image

    img = Image.open(io.BytesIO(png))
    w, h = img.size
    img = img.resize((max(1, int(w * factor)), max(1, int(h * factor))))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _text_chunk_chars(resolution) -> int:
    """Chars per text chunk — sized to the route's context length when set."""
    cl = resolution.context_length
    if not cl:
        return _TEXT_CHUNK
    budget = cl - resolution.params.max_tokens - 500  # room for output + prompt
    return max(2000, int(budget * 3.5)) if budget > 600 else 2000


def _vision_scales(context_length: int | None) -> tuple[float, ...]:
    """Image scales to try — start smaller when the model's context is tight."""
    if not context_length:
        return _IMAGE_SCALES
    if context_length < 8000:
        return (0.4, 0.28)
    if context_length < 16000:
        return (0.6, 0.4, 0.28)
    return _IMAGE_SCALES


async def _extract_text(resolution, src: Path) -> list[Page]:
    raw = src.read_text(encoding="utf-8", errors="replace")
    chunk = _text_chunk_chars(resolution)
    chunks = [raw[i : i + chunk] for i in range(0, len(raw), chunk)] or [""]
    pages: list[Page] = []
    for i, chunk in enumerate(chunks, start=1):
        label = f"part {i} of {len(chunks)} of " if len(chunks) > 1 else ""
        result = await resolution.provider.complete(
            [ChatMessage(role="user", content=f"Source file ({label}{src.name}):\n\n{chunk}")],
            model=resolution.model,
            system=_TEXT_SYSTEM,
            params=resolution.params,
        )
        pages.append(Page(no=i, text_md=result.text.strip()))
    return pages


async def _vision_page(resolution, system: str, png: bytes, page_no: int, total: int) -> str:
    """Vision-extract one page, retrying transient provider errors (503/429/overload)
    with a back-off so one hiccup does not waste a whole multi-page job."""
    tries = 4
    for attempt in range(1, tries + 1):
        try:
            return await _vision_page_once(resolution, system, png, page_no, total)
        except RuntimeError as exc:
            if _is_transient(exc) and attempt < tries:
                delay = 8 * attempt
                log.warning(
                    "page %d: transient error (%s) — retry %d/%d in %ds",
                    page_no, exc, attempt, tries, delay,
                )
                await asyncio.sleep(delay)
                continue
            raise
    raise RuntimeError("vision extraction failed")  # unreachable


async def _vision_page_once(resolution, system: str, png: bytes, page_no: int, total: int) -> str:
    """One vision attempt; downscale and retry if the provider rejects the page
    for context size (e.g. LM Studio's 'Context size has been exceeded')."""
    last_exc: Exception | None = None
    scales = _vision_scales(resolution.context_length)
    for scale in scales:
        data = png if scale == 1.0 else await asyncio.to_thread(_downscale_png, png, scale)
        b64 = base64.b64encode(data).decode("ascii")
        try:
            result = await resolution.provider.complete(
                [
                    ChatMessage(
                        role="user",
                        content=f"This is page {page_no} of {total}. Extract it.",
                        images=[b64],
                    )
                ],
                model=resolution.model,
                system=system,
                params=resolution.params,
            )
            return result.text.strip()
        except RuntimeError as exc:
            if _is_context_error(exc) and scale != scales[-1]:
                last_exc = exc
                log.warning(
                    "page %d: context overflow at scale %.2f — retrying smaller", page_no, scale
                )
                continue
            raise
    raise last_exc or RuntimeError("vision extraction failed")


def _process_figures(page_md: str, page_no: int, pdf: Path, attachments_dir: Path) -> str:
    """Replace every `[[FIGURE bbox=...]]` marker line with a cropped image link.
    The description the model wrote below the marker is ordinary Markdown — left as is."""
    seq = itertools.count(1)

    def _sub(m: re.Match) -> str:
        raw = m.group(1).strip()
        n = next(seq)
        try:
            parts = [float(v) for v in raw.split(",") if v.strip()]
            if len(parts) != 4:
                raise ValueError(f"bbox needs 4 values, got {len(parts)}")
            bbox = (
                parts[0] - _BBOX_PAD, parts[1] - _BBOX_PAD,
                parts[2] + _BBOX_PAD, parts[3] + _BBOX_PAD,
            )  # crop_region clamps to [0,1]
            png = crop_region(pdf, page_no, bbox, _CROP_DPI)
            fname = f"page-{page_no:03d}-{n:02d}.png"
            (attachments_dir / fname).write_bytes(png)
            return f"![Figure {page_no}.{n}](attachments/{fname})"
        except Exception as exc:  # noqa: BLE001
            log.warning("page %d figure %d: crop failed (%s) — marker dropped", page_no, n, exc)
            return ""

    return _FIGURE_RE.sub(_sub, page_md)


async def _extract_rendered(resolution, system: str, src: Path, version_path: Path) -> list[Page]:
    pdf = await asyncio.to_thread(ensure_pdf, src, version_path)
    images = await asyncio.to_thread(render_pdf, pdf, _PAGE_DPI)
    if not images:
        raise RuntimeError("no pages rendered")

    pages_dir = version_path / "pages"
    attachments_dir = version_path / "attachments"
    for d in (pages_dir, attachments_dir):
        d.mkdir(parents=True, exist_ok=True)
        for stale in d.glob("page-*.png"):
            stale.unlink()
    for i, png in enumerate(images, start=1):
        (pages_dir / f"page-{i:03d}.png").write_bytes(png)

    pages: list[Page] = []
    for i, png in enumerate(images, start=1):
        raw = await _vision_page(resolution, system, png, i, len(images))
        text = await asyncio.to_thread(_process_figures, raw, i, pdf, attachments_dir)
        pages.append(Page(no=i, text_md=text))
    return pages


async def ai_extract_material(ctx: dict, material_id: str) -> dict:
    """ARQ task. AI extraction — writes the `ai` ExtractionVersion."""
    mid = uuid.UUID(material_id)
    async with SessionLocal() as session:
        material = await session.get(Material, mid)
        if material is None:
            return {"status": "error", "error": "material not found"}
        course = await session.get(Course, material.course_id)
        if course is None or not course.materials_path or not course.workshop_path:
            return {"status": "error", "error": "course paths not configured"}

        version = await upsert_version(session, mid, "ai")
        version.status = "running"
        version.error = None
        version.job_id = ctx.get("job_id")
        material.extraction_status = "running"
        await session.commit()

        src = Path(course.materials_path) / material.subpath
        workshop = Path(course.workshop_path)
        brain = Path(course.brain_path) if course.brain_path else None

        try:
            if not src.exists():
                raise FileNotFoundError(f"source file missing: {material.subpath}")
            suffix = src.suffix.lower()
            is_binary = suffix in RENDERABLE
            is_text = suffix in _TEXT_SUFFIXES
            if not is_binary and not is_text:
                raise RuntimeError(f"AI extraction does not support {suffix} files")

            resolution = await resolve(session, "material-extraction")
            if resolution is None:
                raise RuntimeError("no AI route for material-extraction and no default route")
            if is_binary and isinstance(resolution.provider, AgentProvider):
                raise RuntimeError(
                    "agent-mode providers can't do vision extraction (they drop page "
                    "images) — route 'material-extraction' to a vision-capable "
                    "token / LM Studio / Ollama provider"
                )

            if is_binary:
                skills = resolution.active_skills or ["material-extraction"]
                system = build_skill_prompt(skills, brain)
                if resolution.system_prompt:
                    system += "\n\n---\n\n" + resolution.system_prompt
                pages = await _extract_rendered(
                    resolution, system, src, version_dir(workshop, mid, "ai")
                )
                method_detail = f"ai-vision:{resolution.model}"
            else:
                pages = await _extract_text(resolution, src)
                method_detail = f"ai-text:{resolution.model}"

            doc = ExtractedDoc(
                pages=pages,
                title=material.title,
                word_count=sum(len(p.text_md.split()) for p in pages),
                extraction_method=method_detail,
            )
            write_extracted(
                workshop_path=workshop,
                course_id=course.id,
                material_id=mid,
                collection=material.collection,
                subpath=material.subpath,
                original_filename=material.original_filename,
                doc=doc,
                method="ai",
            )
            write_meta(
                workshop,
                mid,
                {
                    "word_count": doc.word_count,
                    "title": doc.title,
                    "pages": len(pages),
                    "extraction_method": method_detail,
                },
                method="ai",
            )
            version.status = "done"
            version.pages = len(pages)
            version.word_count = doc.word_count
            version.extraction_method = method_detail
            version.vault_path = str(version_dir(workshop, mid, "ai") / "extracted.md")
            version.error = None
            material.extraction_status = "done"
            # final/ is written only when the user picks a version.
            if version.is_final:
                await finalize_version(session, workshop, material, version)
            await session.commit()
            log.info("ai-extracted material %s (%s): %d pages", material_id, method_detail, len(pages))
            return {"status": "done", "pages": len(pages)}
        except Exception as exc:  # noqa: BLE001
            log.exception("ai_extract_material failed for %s", material_id)
            version.status = "error"
            version.error = f"{type(exc).__name__}: {exc}"
            material.extraction_status = "error"
            material.extraction_error = version.error
            await session.commit()
            return {"status": "error", "error": str(exc)}
