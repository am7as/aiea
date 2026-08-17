"""ARQ job — discover per-chapter categories for a course's syllabus."""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from app.db.base import SessionLocal
from app.db.models import Course
from app.generate.category_discovery import discover_categories
from app.vault.syllabus import write_status

log = logging.getLogger(__name__)


async def discover_categories_job(ctx: dict, course_id: str) -> dict:
    """ARQ task. Calls the category-discovery AI task and rewrites
    syllabus.md's chapter categories lists. Always restores the syllabus
    status pill to `ready` (success) or `error` so the UI stops spinning."""
    async with SessionLocal() as session:
        try:
            cid = uuid.UUID(course_id)
        except ValueError:
            log.info(
                "discover_categories_job: ignoring malformed course id %r", course_id
            )
            return {"status": "skipped", "reason": "bad-id"}
        course = await session.get(Course, cid)
        brain = (
            Path(course.brain_path) if course is not None and course.brain_path else None
        )
        try:
            await discover_categories(session, cid)
            if brain is not None:
                write_status(brain, "ready")
            return {"status": "done"}
        except Exception as exc:  # noqa: BLE001
            log.exception("discover_categories_job failed for course %s", course_id)
            if brain is not None:
                try:
                    write_status(brain, "error", f"category-discovery: {exc}")
                except Exception:  # noqa: BLE001
                    pass
            return {"status": "error", "error": str(exc)}
