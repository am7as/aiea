"""ARQ job — produce a short critique of one question."""
from __future__ import annotations

import logging
import uuid

from app.db.base import SessionLocal
from app.db.models import Question
from app.generate.feedback import submit_feedback

log = logging.getLogger(__name__)


async def feedback_question_job(ctx: dict, question_id: str) -> dict:
    """ARQ task. Writes Question.feedback_md for one question.
    Skips silently when the question row no longer exists (stale queue entry)."""
    async with SessionLocal() as session:
        try:
            qid = uuid.UUID(question_id)
        except ValueError:
            log.info("feedback_question_job: ignoring malformed id %r", question_id)
            return {"status": "skipped", "reason": "bad-id"}
        if await session.get(Question, qid) is None:
            log.info("feedback_question_job: question %s missing — stale job, skipping", qid)
            return {"status": "skipped", "reason": "missing"}
        try:
            await submit_feedback(session, qid)
            return {"status": "done"}
        except Exception as exc:  # noqa: BLE001
            log.exception("feedback_question_job failed for %s", question_id)
            return {"status": "error", "error": str(exc)}
