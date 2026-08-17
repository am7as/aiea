"""AI-judged comparison between a reference exam PDF and its reproduced PDF.

Rasterises both PDFs to PNGs (one image per page, capped), sends both pages to
a vision-capable model alongside a structured prompt, and parses a 0-10
similarity score plus a short critique. Stores results on Exam.

Worker-side — depends on pymupdf, which is worker-only.
"""
from __future__ import annotations

import base64
import logging
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.events import ChatMessage, GenParams
from app.ai.factory import SHIM_URL
from app.ai.jsonparse import extract_object
from app.ai.providers.agent import AgentProvider
from app.ai.providers.openai_compat import OpenAICompatProvider
from app.ai.router import resolve
from app.db.models import Exam
from app.skills.loader import build_skill_prompt

log = logging.getLogger(__name__)

_MAX_PAGES = 4   # cap per side; vision model context is finite
_DPI = 110


def _rasterise(pdf_path: Path, max_pages: int = _MAX_PAGES) -> list[str]:
    """Return base64-encoded PNGs of the first `max_pages` of a PDF."""
    import fitz  # pymupdf

    out: list[str] = []
    doc = fitz.open(str(pdf_path))
    try:
        for i, page in enumerate(doc):
            if i >= max_pages:
                break
            pix = page.get_pixmap(dpi=_DPI)
            png = pix.tobytes("png")
            out.append(base64.b64encode(png).decode("ascii"))
    finally:
        doc.close()
    return out


_PROMPT = """You are comparing two exam PDFs:

- The ORIGINAL (reference) — the past exam the examiner published.
- The REPRODUCED — AIEA's rebuild of that same exam from harvested questions.

Both are PDFs of the same exam, but the reproduction may differ in layout, font,
question order, equation typography, figure rendering, and bilingual SE/EN
placement. Your job is to judge HOW IDENTICAL they are when read as exam papers
by a student.

Score on a 0-10 scale:
- 10 = visually indistinguishable to a student (same layout, same wording, same
  figures, same point allocations, same SE/EN parallel format).
- 8-9 = same content but minor cosmetic differences (font, spacing, figure
  size).
- 5-7 = same questions but visibly different layout (e.g. EN block missing,
  figures redrawn, question order swapped).
- 1-4 = some questions present but content has drifted (different numbers,
  missing parts, different prompts).
- 0 = unrelated.

Return ONLY this JSON:
{
  "score": 0-10,
  "notes": "two or three sentences: what matches, what differs, one concrete
            fix the examiner could make."
}
"""


async def compare_reproduction(
    db: AsyncSession, exam_id: uuid.UUID
) -> Exam:
    """Score how identical Exam.pdf_path is to Exam.source_pdf_path."""
    exam = await db.get(Exam, exam_id)
    if exam is None:
        raise ValueError("exam not found")
    if not exam.source_pdf_path or not exam.pdf_path:
        raise ValueError(
            "exam needs both source_pdf_path (original) and pdf_path (reproduction)"
        )
    src = Path(exam.source_pdf_path)
    rep = Path(exam.pdf_path)
    if not src.is_file() or not rep.is_file():
        raise ValueError("one of the PDFs is missing on disk")

    resolution = await resolve(db, "exam-reproduction-compare")
    if resolution is None:
        raise ValueError("no AI route for exam-reproduction-compare and no default route")
    if isinstance(resolution.provider, AgentProvider):
        raise ValueError(
            "exam-reproduction-compare needs a vision-capable provider; agent providers are blind to images"
        )
    _shim_host = SHIM_URL.split("/v1")[0]
    if (
        isinstance(resolution.provider, OpenAICompatProvider)
        and _shim_host in resolution.provider.base_url
    ):
        raise ValueError(
            "exam-reproduction-compare needs a vision-capable provider; "
            "subscription (shim) providers are text-only CLI wrappers and cannot process images"
        )

    src_imgs = _rasterise(src)
    rep_imgs = _rasterise(rep)
    if not src_imgs or not rep_imgs:
        raise ValueError("could not rasterise one of the PDFs")

    user = (
        "## Original (reference) — first pages\n"
        f"(showing up to {len(src_imgs)} page(s) of the published exam)\n\n"
        "## Reproduced — first pages\n"
        f"(showing up to {len(rep_imgs)} page(s) of AIEA's rebuild)\n\n"
        "Compare them and return the JSON object specified."
    )
    images = src_imgs + rep_imgs

    system = _PROMPT
    extra = build_skill_prompt(["anti-ai-tone"], None)
    if extra:
        system += "\n\n---\n\n" + extra

    result = await resolution.provider.complete(
        [ChatMessage(role="user", content=user, images=images)],
        model=resolution.model,
        system=system,
        params=GenParams(
            temperature=min(resolution.params.temperature, 0.1),
            max_tokens=max(resolution.params.max_tokens, 1024),
        ),
    )
    data = extract_object(result.text)

    try:
        score = max(0.0, min(10.0, float(data.get("score"))))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        score = None  # noqa: E501  (mypy: assigned to optional)
        score = None

    exam.reproduction_score = score
    exam.reproduction_notes = str(data.get("notes") or "").strip() or None
    await db.commit()
    log.info(
        "reproduction compare for exam %s — score=%s",
        exam_id, exam.reproduction_score,
    )
    return exam
