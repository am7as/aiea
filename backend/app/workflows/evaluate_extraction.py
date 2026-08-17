"""ARQ job — evaluate each extraction version against the SOURCE document.

Unlike compare (py vs ai), this checks faithfulness against the real source:
the source is rendered to page images (or read as text) and the model scores
how completely each extraction .md captures it. Scores land on the
ExtractionVersion rows; report at extracted/comparison/<id>/evaluation.md.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.ai.events import ChatMessage
from app.ai.providers.agent import AgentProvider
from app.ai.router import resolve
from app.db.base import SessionLocal
from app.db.models import Course, Material
from app.extract.render import RENDERABLE, render_pages
from app.vault.extraction import list_versions
from app.vault.writer import write_report

log = logging.getLogger(__name__)

_TEXT_SUFFIXES = {".md", ".markdown", ".txt", ".html", ".htm", ".tex", ".rst", ".py", ".csv"}
_MAX_SOURCE_IMAGES = 12
_EXTRACTION_CAP = 16_000
_SOURCE_TEXT_CAP = 16_000

_SYSTEM_IMG = """You verify a document extraction against its source.

You are given a Markdown EXTRACTION and then the SOURCE document as page images.
Score 0-100 how faithfully the extraction captures the source — text
completeness, tables, formulas, figures, structure. State specifically what is
missing, garbled or hallucinated.

Return ONLY JSON — no prose, no code fences:
{"score": 0-100, "notes": "concise — what is faithful / missing / wrong"}"""

_SYSTEM_TEXT = """You verify a document extraction against its source.

You are given the SOURCE file text and a Markdown EXTRACTION of it. Score 0-100
how faithfully the extraction captures the source. State what is missing or wrong.

Return ONLY JSON — no prose, no code fences:
{"score": 0-100, "notes": "concise — what is faithful / missing / wrong"}"""


def _strip_json(text: str) -> str:
    raw = text.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    start, end = raw.find("{"), raw.rfind("}")
    return raw[start : end + 1] if start != -1 and end > start else raw


def _as_score(value: object) -> int | None:
    try:
        return max(0, min(100, int(value)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _report(filename: str, versions: list) -> str:
    lines = [
        "---",
        f"file: {filename}",
        f"evaluated_at: {datetime.now(timezone.utc).isoformat()}",
        "---",
        "",
        f"# Extraction faithfulness vs source — {filename}",
        "",
    ]
    for v in versions:
        score = v.eval_score if v.eval_score is not None else "—"
        lines += [f"## {v.method} — {score}/100", "", v.eval_notes or "_(no notes)_", ""]
    return "\n".join(lines)


async def evaluate_extraction(ctx: dict, material_id: str) -> dict:
    """ARQ task. Scores each extraction version against the rendered source."""
    mid = uuid.UUID(material_id)
    async with SessionLocal() as session:
        material = await session.get(Material, mid)
        if material is None:
            return {"status": "error", "error": "material not found"}
        course = await session.get(Course, material.course_id)
        if course is None or not course.materials_path or not course.workshop_path:
            return {"status": "error", "error": "course paths not configured"}

        versions = [
            v
            for v in await list_versions(session, mid)
            if v.status == "done" and v.vault_path and Path(v.vault_path).exists()
        ]
        if not versions:
            return {"status": "error", "error": "no completed extraction versions to evaluate"}

        resolution = await resolve(session, "extraction-validation")
        if resolution is None:
            return {"status": "error", "error": "no AI route for extraction-validation"}

        src = Path(course.materials_path) / material.subpath
        if not src.exists():
            return {"status": "error", "error": f"source file missing: {material.subpath}"}
        suffix = src.suffix.lower()

        try:
            source_images: list[str] = []
            source_text = ""
            if suffix in RENDERABLE:
                imgs = await asyncio.to_thread(render_pages, src)
                source_images = [
                    base64.b64encode(p).decode("ascii") for p in imgs[:_MAX_SOURCE_IMAGES]
                ]
            elif suffix in _TEXT_SUFFIXES:
                source_text = src.read_text(encoding="utf-8", errors="replace")[:_SOURCE_TEXT_CAP]
            else:
                return {"status": "error", "error": f"cannot evaluate {suffix} files"}

            if source_images and isinstance(resolution.provider, AgentProvider):
                raise RuntimeError(
                    "agent-mode providers can't see the source images — route "
                    "'extraction-validation' to a vision-capable token / LM Studio / "
                    "Ollama provider"
                )

            for v in versions:
                extraction = Path(v.vault_path).read_text(encoding="utf-8")[:_EXTRACTION_CAP]
                if source_images:
                    msg = ChatMessage(
                        role="user",
                        content=(
                            f"EXTRACTION ({v.method}) of {material.original_filename}:\n\n"
                            f"{extraction}\n\nThe source document pages follow as images."
                        ),
                        images=source_images,
                    )
                    system = _SYSTEM_IMG
                else:
                    msg = ChatMessage(
                        role="user",
                        content=(
                            f"SOURCE file ({material.original_filename}):\n\n{source_text}\n\n"
                            f"=== EXTRACTION ({v.method}) ===\n\n{extraction}"
                        ),
                    )
                    system = _SYSTEM_TEXT
                result = await resolution.provider.complete(
                    [msg],
                    model=resolution.model,
                    system=system,
                    params=resolution.params,
                )
                data = json.loads(_strip_json(result.text))
                v.eval_score = _as_score(data.get("score") if isinstance(data, dict) else None)
                notes = data.get("notes") if isinstance(data, dict) else None
                v.eval_notes = str(notes) if notes else None
        except Exception as exc:  # noqa: BLE001
            log.exception("evaluate_extraction failed for %s", material_id)
            return {"status": "error", "error": f"{type(exc).__name__}: {exc}"}

        write_report(
            Path(course.workshop_path), mid, "evaluation.md",
            _report(material.original_filename, versions),
        )
        await session.commit()
        log.info("evaluated extraction for material %s (%d versions)", material_id, len(versions))
        return {"status": "done", "evaluated": len(versions)}
