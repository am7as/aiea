"""Persist token usage for every resolved AI call.

Every provider already returns `tokens_in` / `tokens_out` on its `ChatResult`; nothing
recorded them, so `ai_messages` stayed empty and Monitoring could only ever report zeros.

Usage is written in its own session, deliberately: a job that later rolls back should still
leave the tokens it spent on record, and logging must never join the caller's transaction.
Message content is not stored — Monitoring only ever aggregates counts, and the conversation
text already lives in `<vault>/aiea-memory/`.
"""

from __future__ import annotations

import logging

from sqlalchemy import func, select

from app.db.base import SessionLocal
from app.db.models import AIConversation, AIMessage

log = logging.getLogger(__name__)


async def record_completion(task: str, provider: str, model: str, result) -> None:
    """Append one usage row for a completed call. Never raises."""
    if result is None:
        return
    tokens_in = int(getattr(result, "tokens_in", 0) or 0)
    tokens_out = int(getattr(result, "tokens_out", 0) or 0)
    try:
        async with SessionLocal() as db:
            conv = (
                await db.execute(
                    select(AIConversation)
                    .where(
                        AIConversation.task == task,
                        AIConversation.current_provider == provider,
                        AIConversation.current_model == model,
                    )
                    .limit(1)
                )
            ).scalar_one_or_none()
            if conv is None:
                conv = AIConversation(
                    task=task, title=task, current_provider=provider, current_model=model
                )
                db.add(conv)
                await db.flush()

            seq = (
                await db.execute(
                    select(func.coalesce(func.max(AIMessage.seq), 0)).where(
                        AIMessage.conversation_id == conv.id
                    )
                )
            ).scalar() or 0

            db.add(
                AIMessage(
                    conversation_id=conv.id,
                    seq=seq + 1,
                    role="assistant",
                    content="",
                    tokens_in=tokens_in,
                    tokens_out=tokens_out,
                )
            )
            await db.commit()
    except Exception:  # noqa: BLE001 — usage logging must never break an AI call
        log.warning("could not record usage for task=%s provider=%s", task, provider, exc_info=True)
