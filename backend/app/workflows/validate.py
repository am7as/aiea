"""ARQ jobs for exam validation."""

from __future__ import annotations

import logging
import uuid

from app.db.base import SessionLocal
from app.db.models.exam import Exam
from app.validate.runner import validate_exam

log = logging.getLogger(__name__)


async def validate_exam_job(ctx: dict, exam_id: str, deep: bool = False) -> dict:
    async with SessionLocal() as session:
        try:
            eid = uuid.UUID(exam_id)
        except ValueError:
            return {"status": "skipped", "reason": "bad-id"}
        if await session.get(Exam, eid) is None:
            return {"status": "skipped", "reason": "missing"}
        try:
            result = await validate_exam(session, eid, deep=deep)
            return {"status": "done", **result}
        except Exception as exc:  # noqa: BLE001
            log.exception("validate_exam_job failed for %s", exam_id)
            return {"status": "error", "error": str(exc)}
