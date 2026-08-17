"""ARQ job — build brain/syllabus.md from a course's extracted materials.

Runs an AI pass (the `material-analysis` task) over the course description,
textbook, slides, exercises and past exams, and writes a chapter + ELO syllabus.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from sqlalchemy import select

from app.ai.events import ChatMessage, GenParams
from app.ai.router import resolve
from app.db.base import SessionLocal
from app.db.models import Course, Material
from app.vault.syllabus import parse_syllabus, write_status, write_syllabus

log = logging.getLogger(__name__)

_COLLECTION_LABEL = {
    "other": "Course description / other",
    "book": "Textbook",
    "lectures": "Lecture slides",
    "exercises": "Exercise sheet",
    "exams": "Past exam",
}
_COLLECTION_ORDER = ["other", "book", "lectures", "exercises", "exams"]
_PER_FILE_CAP = {"other": 14000, "book": 12000, "lectures": 3000, "exercises": 2500, "exams": 4000}
_TOTAL_CAP = 60_000

_SYSTEM = """You are a curriculum analyst. From a course's materials you build a single \
**syllabus** that an exam-authoring tool uses to track coverage.

You receive extracted text: the course description, textbook, lecture slides, \
exercise sheets and past exams. Produce ONE Markdown file with YAML frontmatter.

Frontmatter shape (use exactly these keys):
---
course: <course code>
chapters:
  - id: ch1
    title: <chapter / major topic title>
    materials: [book, lectures]
    emphasis: high
    elos: [elo1, elo2]
elos:
  - id: elo1
    text: <one expected learning outcome, phrased with an action verb>
    bloom: understand
    chapters: [ch1]
---

Body, after the frontmatter:
# <Course title> — Syllabus
## Chapters
One short paragraph per chapter.
## Expected Learning Outcomes
The ELOs, grouped by chapter.
## Coverage notes
Where each topic is covered and what past exams emphasise.

Rules:
- Derive chapters from the course description and the textbook table of contents.
- Derive ELOs primarily from the course description; sharpen wording with lecture content.
- Infer `emphasis` (high|medium|low) from how often a topic recurs in exercises and past exams.
- `bloom` is one of: remember, understand, apply, analyze, evaluate, create.
- Use stable sequential ids: ch1, ch2, ...; elo1, elo2, ....
- Every chapter lists at least one ELO id; every ELO lists at least one chapter id.
- Output ONLY the file content. No commentary, no code fences."""


def _truncate(text: str | None, cap: int) -> str:
    text = (text or "").strip()
    if len(text) <= cap:
        return text
    return text[:cap].rstrip() + "\n…[truncated]"


def _assemble_corpus(course: Course, materials: list[Material]) -> str:
    parts: list[str] = []
    if course.description_md and course.description_md.strip():
        parts.append("## Course description (examiner-provided)\n\n" + course.description_md.strip())

    by_collection: dict[str, list[Material]] = {}
    for m in materials:
        by_collection.setdefault(m.collection, []).append(m)

    total = 0
    for collection in _COLLECTION_ORDER:
        cap = _PER_FILE_CAP.get(collection, 3000)
        label = _COLLECTION_LABEL.get(collection, collection)
        for m in by_collection.get(collection, []):
            if total >= _TOTAL_CAP:
                return "\n\n---\n\n".join(parts)
            body = _truncate(m.extracted_text, cap)
            if not body:
                continue
            section = f"## {label}: {m.title or m.original_filename}\n\n{body}"
            parts.append(section)
            total += len(section)
    return "\n\n---\n\n".join(parts)


def _strip_fences(text: str) -> str:
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


async def build_syllabus(ctx: dict, course_id: str) -> dict:
    """ARQ task. AI-builds brain/syllabus.md for a course."""
    cid = uuid.UUID(course_id)
    async with SessionLocal() as session:
        course = await session.get(Course, cid)
        if course is None:
            return {"status": "error", "error": "course not found"}
        if not course.brain_path:
            return {"status": "error", "error": "brain_path not configured"}
        brain = Path(course.brain_path)
        write_status(brain, "building")
        try:
            res = await session.execute(
                select(Material).where(
                    Material.course_id == cid,
                    Material.extraction_status == "done",
                )
            )
            materials = list(res.scalars().all())
            if not materials and not (course.description_md or "").strip():
                write_status(brain, "error", "no extracted materials and no course description yet")
                return {"status": "error", "error": "no input"}

            resolution = await resolve(session, "material-analysis")
            if resolution is None:
                write_status(brain, "error", "no AI route for material-analysis and no default route")
                return {"status": "error", "error": "no AI route"}

            corpus = _assemble_corpus(course, materials)
            user_msg = (
                f"Course code: {course.code}\nCourse title: {course.title}\n\n"
                f"Materials follow.\n\n{corpus}"
            )
            result = await resolution.provider.complete(
                [ChatMessage(role="user", content=user_msg)],
                model=resolution.model,
                system=_SYSTEM,
                params=GenParams(temperature=0.2, max_tokens=8000),
            )
            content = _strip_fences(result.text.strip())
            write_syllabus(brain, content)
            parsed = parse_syllabus(content)
            if parsed["ok"]:
                write_status(brain, "ready")
                log.info(
                    "syllabus built for course %s: %d chapters, %d ELOs",
                    course_id, len(parsed["chapters"]), len(parsed["elos"]),
                )
                return {
                    "status": "done",
                    "chapters": len(parsed["chapters"]),
                    "elos": len(parsed["elos"]),
                }
            write_status(brain, "error", f"AI output is not a valid syllabus: {parsed['error']}")
            return {"status": "error", "error": parsed["error"]}
        except Exception as exc:  # noqa: BLE001
            log.exception("syllabus build failed for course %s", course_id)
            write_status(brain, "error", f"{type(exc).__name__}: {exc}")
            return {"status": "error", "error": str(exc)}
