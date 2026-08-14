"""Monitor — AI usage, token counts, recent activity.

Aggregates the `ai_messages` table by provider / model. Worker-side AI calls
(generate_questions, classify, …) currently write conversation logs to disk
under <vault>/aiea-memory/, not to the DB — those don't carry token counts.
The chat / orchestrator paths DO write AIMessage rows with token + cost data.
This endpoint exposes both.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db
from app.db.models import AIConversation, AIMessage, Provider

router = APIRouter(prefix="/monitor", tags=["monitor"])


@router.get("/usage")
async def usage(db: AsyncSession = Depends(get_db)) -> dict:
    """Token / message counts + per-provider table + recent activity."""
    totals_row = (
        await db.execute(
            select(
                func.count(AIMessage.id),
                func.coalesce(func.sum(AIMessage.tokens_in), 0),
                func.coalesce(func.sum(AIMessage.tokens_out), 0),
                func.coalesce(func.sum(AIMessage.cost_usd), 0.0),
            )
        )
    ).one()
    n_messages, tokens_in, tokens_out, cost_usd = totals_row

    convs = (
        await db.execute(select(func.count(AIConversation.id)))
    ).scalar() or 0

    # Per-conversation provider/model attribution (AIMessage doesn't carry
    # provider/model directly — it lives on the parent AIConversation).
    by_provider_rows = (
        await db.execute(
            select(
                AIConversation.current_provider,
                AIConversation.current_model,
                func.count(AIMessage.id),
                func.coalesce(func.sum(AIMessage.tokens_in), 0),
                func.coalesce(func.sum(AIMessage.tokens_out), 0),
                func.coalesce(func.sum(AIMessage.cost_usd), 0.0),
            )
            .join(AIMessage, AIMessage.conversation_id == AIConversation.id)
            .group_by(AIConversation.current_provider, AIConversation.current_model)
            .order_by(desc(func.count(AIMessage.id)))
        )
    ).all()

    by_provider = [
        {
            "provider": p or "—",
            "model": m or "—",
            "messages": int(n),
            "tokens_in": int(ti),
            "tokens_out": int(to),
            "cost_usd": float(c),
        }
        for (p, m, n, ti, to, c) in by_provider_rows
    ]

    # 24-hour recent activity.
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    recent_rows = (
        await db.execute(
            select(
                func.date_trunc("hour", AIMessage.created_at).label("hour"),
                func.count(AIMessage.id),
                func.coalesce(func.sum(AIMessage.tokens_in + AIMessage.tokens_out), 0),
            )
            .where(AIMessage.created_at >= since)
            .group_by("hour")
            .order_by("hour")
        )
    ).all()
    recent_24h = [
        {
            "hour": h.isoformat() if h else None,
            "messages": int(n),
            "tokens": int(t),
        }
        for (h, n, t) in recent_rows
    ]

    providers = (
        await db.execute(select(Provider.name, Provider.type))
    ).all()

    return {
        "totals": {
            "conversations": int(convs),
            "messages": int(n_messages or 0),
            "tokens_in": int(tokens_in or 0),
            "tokens_out": int(tokens_out or 0),
            "tokens_total": int((tokens_in or 0) + (tokens_out or 0)),
            "cost_usd": float(cost_usd or 0.0),
        },
        "by_provider": by_provider,
        "recent_24h": recent_24h,
        "providers_configured": [
            {"name": n, "type": t} for (n, t) in providers
        ],
    }
