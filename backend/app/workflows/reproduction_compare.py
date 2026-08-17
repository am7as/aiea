"""ARQ job — score how identical a reference exam's reproduction is."""
from __future__ import annotations

import logging
import uuid

from app.db.base import SessionLocal
from app.db.models import Exam
from app.generate.reproduction_compare import compare_reproduction

log = logging.getLogger(__name__)


async def compare_reproduction_job(ctx: dict, exam_id: str) -> dict:
    async with SessionLocal() as session:
        try:
            eid = uuid.UUID(exam_id)
        except ValueError:
            return {"status": "skipped", "reason": "bad-id"}
        if await session.get(Exam, eid) is None:
            return {"status": "skipped", "reason": "missing"}
        try:
            await compare_reproduction(session, eid)
            return {"status": "done"}
        except Exception as exc:  # noqa: BLE001
            log.exception("compare_reproduction_job failed for %s", exam_id)
            return {"status": "error", "error": str(exc)}
