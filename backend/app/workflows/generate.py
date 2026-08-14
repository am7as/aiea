"""ARQ job — generate questions for a course."""
from __future__ import annotations

import asyncio
import logging
import uuid

from app.db.base import SessionLocal
from app.generate.generator import GenSpec, run_generation

log = logging.getLogger(__name__)

#: Generation is the one job that must not run concurrently with itself. The worker
#: allows two jobs in flight, and the subscription providers are reached through a
#: single host CLI that rate-limits under load — so two generation jobs racing means
#: one wins and the other starves until its 1800 s budget expires. Observed exactly
#: that: two jobs launched together, one finished in 277 s, the other died at 1800 s
#: with "agent run timed out". Serialising them costs wall-clock and saves the run.
_LOCK_KEY = "aiea:lock:generate_questions"
_LOCK_TTL = 7_200
_WAIT_POLL = 5
_WAIT_MAX = 3_600


async def _acquire(redis, token: str) -> bool:
    """SET key token NX EX ttl — `ArqRedis` wraps redis-py asyncio, so it is `nx=`/`ex=`,
    not the aioredis 1.x `exist=`/`expire=` spelling."""
    return bool(await redis.set(_LOCK_KEY, token, ex=_LOCK_TTL, nx=True))


async def _release(redis, token: str) -> None:
    try:
        current = await redis.get(_LOCK_KEY)
        if isinstance(current, bytes):
            current = current.decode()
        if current == token:
            await redis.delete(_LOCK_KEY)
    except Exception:  # noqa: BLE001 — a stale lock expires on its own
        log.warning("could not release the generation lock; it will expire in %ds", _LOCK_TTL)


async def generate_questions(ctx: dict, payload: dict) -> dict:
    """ARQ task. Generates draft Question rows + markdown from selected materials."""
    spec = GenSpec(
        course_id=uuid.UUID(payload["course_id"]),
        material_ids=[uuid.UUID(x) for x in payload["material_ids"]],
        kind=str(payload["kind"]),
        count=int(payload["count"]),
        difficulty=payload.get("difficulty"),
        bloom=payload.get("bloom"),
        topics=payload.get("topics"),
        chapter_id=payload.get("chapter_id"),
        category=payload.get("category"),
        with_diagrams=payload.get("with_diagrams", True),
    )

    redis = ctx.get("redis") if isinstance(ctx, dict) else None
    token = uuid.uuid4().hex
    held = False
    if redis is not None:
        waited = 0
        while not (held := await _acquire(redis, token)):
            if waited >= _WAIT_MAX:
                return {
                    "status": "error",
                    "error": "another generation job held the lock for over an hour",
                }
            if waited == 0:
                log.info("generation: waiting for the in-flight generation job to finish")
            await asyncio.sleep(_WAIT_POLL)
            waited += _WAIT_POLL

    try:
        async with SessionLocal() as session:
            try:
                created = await run_generation(session, spec)
                return {"status": "done", "created": len(created)}
            except Exception as exc:  # noqa: BLE001
                log.exception("generate_questions failed for course %s", payload.get("course_id"))
                return {"status": "error", "error": str(exc)}
    finally:
        if held and redis is not None:
            await _release(redis, token)
