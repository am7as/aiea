"""ARQ job — harvest questions out of an extracted exam / exercise sheet."""
from __future__ import annotations

import logging
import uuid

from app.db.base import SessionLocal
from app.generate.harvest import harvest_questions

log = logging.getLogger(__name__)


async def harvest_questions_job(ctx: dict, material_id: str) -> dict:
    """ARQ task. Extracts individual Question rows from one material."""
    async with SessionLocal() as session:
        try:
            created = await harvest_questions(session, uuid.UUID(material_id))
            return {"status": "done", "created": len(created)}
        except Exception as exc:  # noqa: BLE001
            log.exception("harvest_questions_job failed for material %s", material_id)
            return {"status": "error", "error": str(exc)}
