"""ARQ job — score how far one question deviates from the course's reference
(harvested) set on the same topic."""
from __future__ import annotations

import logging
import uuid

from app.db.base import SessionLocal
from app.db.models import Question
from app.generate.similarity import compare_to_references

log = logging.getLogger(__name__)


async def similarity_question_job(ctx: dict, question_id: str) -> dict:
    """ARQ task. Writes closest_reference_id / reference_deviation /
    reference_match_note for one question. Stale jobs are a silent no-op."""
    async with SessionLocal() as session:
        try:
            qid = uuid.UUID(question_id)
        except ValueError:
            log.info("similarity_question_job: ignoring malformed id %r", question_id)
            return {"status": "skipped", "reason": "bad-id"}
        if await session.get(Question, qid) is None:
            log.info("similarity_question_job: question %s missing — stale job", qid)
            return {"status": "skipped", "reason": "missing"}
        try:
            await compare_to_references(session, qid)
            return {"status": "done"}
        except Exception as exc:  # noqa: BLE001
            log.exception("similarity_question_job failed for %s", question_id)
            return {"status": "error", "error": str(exc)}
