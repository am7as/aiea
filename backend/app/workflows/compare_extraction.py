"""ARQ job — compare a material's python vs ai extraction (py.md <-> ai.md).

Pits the two extractions of the same source against each other and records
which is better and where they differ. Verdict on material.meta["comparison"],
full report at extracted/comparison/<id>/comparison.md.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.ai.events import ChatMessage
from app.ai.router import resolve
from app.db.base import SessionLocal
from app.db.models import Course, Material
from app.vault.extraction import list_versions
from app.vault.writer import write_report

log = logging.getLogger(__name__)

_PER_VERSION_CAP = 18_000

_SYSTEM = """You compare two extractions of the SAME source document — one by
python (mechanical parsers), one by ai (a vision/language model).

Judge them head to head: completeness, tables, formulas, figures, structure,
and anything garbled, duplicated or dropped. Discrepancies between the two
reveal what one method missed.

Return ONLY JSON — no prose, no code fences:
{
  "recommend": "python" | "ai",
  "reason": "one sentence — why this one wins",
  "python": "what the python extraction does well / badly",
  "ai": "what the ai extraction does well / badly"
}"""


def _strip_json(text: str) -> str:
    raw = text.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        raw = "\n".join(lines).strip()
    start, end = raw.find("{"), raw.rfind("}")
    return raw[start : end + 1] if start != -1 and end > start else raw


def _report(filename: str, data: dict) -> str:
    return "\n".join(
        [
            "---",
            f"file: {filename}",
            f"compared_at: {datetime.now(timezone.utc).isoformat()}",
            f"recommend: {data.get('recommend') or 'n/a'}",
            "---",
            "",
            f"# Python vs AI extraction — {filename}",
            "",
            "## Python",
            "",
            str(data.get("python") or "_(no notes)_"),
            "",
            "## AI",
            "",
            str(data.get("ai") or "_(no notes)_"),
            "",
            "## Verdict",
            "",
            f"Use **{data.get('recommend') or '?'}** — {data.get('reason') or ''}".strip(),
        ]
    )


async def compare_extraction(ctx: dict, material_id: str) -> dict:
    """ARQ task. Compares the python and ai extractions of one material."""
    mid = uuid.UUID(material_id)
    async with SessionLocal() as session:
        material = await session.get(Material, mid)
        if material is None:
            return {"status": "error", "error": "material not found"}

        versions = {
            v.method: v
            for v in await list_versions(session, mid)
            if v.status == "done" and v.vault_path and Path(v.vault_path).exists()
        }
        if "python" not in versions or "ai" not in versions:
            return {"status": "error", "error": "need both a python and an ai extraction to compare"}

        resolution = await resolve(session, "extraction-validation")
        if resolution is None:
            return {"status": "error", "error": "no AI route for extraction-validation"}

        user = (
            f"Source document: {material.original_filename}\n\n"
            f"### PYTHON EXTRACTION\n\n"
            f"{Path(versions['python'].vault_path).read_text(encoding='utf-8')[:_PER_VERSION_CAP]}\n\n"
            f"### AI EXTRACTION\n\n"
            f"{Path(versions['ai'].vault_path).read_text(encoding='utf-8')[:_PER_VERSION_CAP]}"
        )
        try:
            result = await resolution.provider.complete(
                [ChatMessage(role="user", content=user)],
                model=resolution.model,
                system=_SYSTEM,
                params=resolution.params,
            )
            data = json.loads(_strip_json(result.text))
        except Exception as exc:  # noqa: BLE001
            log.exception("compare_extraction failed for %s", material_id)
            return {"status": "error", "error": f"{type(exc).__name__}: {exc}"}

        if not isinstance(data, dict):
            return {"status": "error", "error": "comparison output was not JSON"}

        material.meta = {
            **(material.meta or {}),
            "comparison": {
                "recommend": data.get("recommend"),
                "reason": data.get("reason"),
                "python": data.get("python"),
                "ai": data.get("ai"),
                "compared_at": datetime.now(timezone.utc).isoformat(),
            },
        }
        course = await session.get(Course, material.course_id)
        if course is not None and course.workshop_path:
            write_report(
                Path(course.workshop_path), mid, "comparison.md",
                _report(material.original_filename, data),
            )
        await session.commit()
        log.info("compared extraction for material %s", material_id)
        return {"status": "done", "recommend": data.get("recommend")}
