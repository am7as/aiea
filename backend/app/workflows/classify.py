"""ARQ job — classify a question (chapter / bloom / category / difficulty)."""
from __future__ import annotations

import logging
import uuid

from app.db.base import SessionLocal
from app.db.models import Question
from app.generate.classify import classify_question

log = logging.getLogger(__name__)


async def classify_question_job(ctx: dict, question_id: str) -> dict:
    """ARQ task. Tags one question with chapter_id / bloom / category / difficulty.
    Stale jobs (question deleted before the worker drained the queue) are a
    silent no-op."""
    async with SessionLocal() as session:
        try:
            qid = uuid.UUID(question_id)
        except ValueError:
            log.info("classify_question_job: ignoring malformed id %r", question_id)
            return {"status": "skipped", "reason": "bad-id"}
        if await session.get(Question, qid) is None:
            log.info("classify_question_job: question %s missing — stale job, skipping", qid)
            return {"status": "skipped", "reason": "missing"}
        try:
            await classify_question(session, qid)
            return {"status": "done"}
        except Exception as exc:  # noqa: BLE001
            log.exception("classify_question_job failed for %s", question_id)
            return {"status": "error", "error": str(exc)}
