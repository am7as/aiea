"""ARQ job — find the worked solution + answer key for a question."""
from __future__ import annotations

import logging
import uuid

from app.db.base import SessionLocal
from app.db.models import Question
from app.generate.answer import find_answer

log = logging.getLogger(__name__)


async def find_answer_job(ctx: dict, question_id: str) -> dict:
    """ARQ task. Produces / refines the worked solution + answer key of one question.
    Skips silently when the question row no longer exists (stale queue entry)."""
    async with SessionLocal() as session:
        try:
            qid = uuid.UUID(question_id)
        except ValueError:
            log.info("find_answer_job: ignoring malformed id %r", question_id)
            return {"status": "skipped", "reason": "bad-id"}
        if await session.get(Question, qid) is None:
            log.info("find_answer_job: question %s missing — stale job, skipping", qid)
            return {"status": "skipped", "reason": "missing"}
        try:
            await find_answer(session, qid)
            return {"status": "done"}
        except Exception as exc:  # noqa: BLE001
            log.exception("find_answer_job failed for %s", question_id)
            return {"status": "error", "error": str(exc)}
