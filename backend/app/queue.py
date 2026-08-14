from __future__ import annotations

from arq import create_pool
from arq.connections import RedisSettings

from app.config import get_settings


async def enqueue(job_name: str, *args, **kwargs) -> str | None:
    """Enqueue an ARQ job; return its job id (for later abort), or None."""
    pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    try:
        job = await pool.enqueue_job(job_name, *args, **kwargs)
        return job.job_id if job else None
    finally:
        await pool.aclose()


async def abort_job(job_id: str) -> bool:
    """Request abort of a queued/running ARQ job. Returns True if acknowledged."""
    from arq.jobs import Job

    pool = await create_pool(RedisSettings.from_dsn(get_settings().redis_url))
    try:
        job = Job(job_id, redis=pool)
        try:
            return await job.abort(timeout=2)
        except Exception:  # noqa: BLE001
            return False
    finally:
        await pool.aclose()
