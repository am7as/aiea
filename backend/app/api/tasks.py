"""AI tasks panel — live view of ARQ queue state.

Reads queued + in-progress jobs from Redis via the ARQ pool, returns a compact
list the frontend can render in a sticky panel. No DB writes — this is a peek
at live state. `cancel` calls ARQ's abort.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from arq import create_pool
from arq.connections import RedisSettings
from arq.jobs import Job, JobStatus
from fastapi import APIRouter, HTTPException, status

from app.config import get_settings

router = APIRouter(prefix="/tasks", tags=["tasks"])
log = logging.getLogger(__name__)

_QUEUE = "arq:queue"
_IN_PROGRESS = "arq:in-progress"


def _serialise_args(args: tuple, kwargs: dict[str, Any]) -> str:
    """Compact representation of the job's args for the UI."""
    try:
        pieces: list[str] = []
        for a in args:
            s = str(a)
            pieces.append(s if len(s) < 80 else s[:77] + "...")
        for k, v in kwargs.items():
            s = str(v)
            pieces.append(f"{k}={s if len(s) < 60 else s[:57] + '...'}")
        return ", ".join(pieces)
    except Exception:
        return ""


@router.get("/")
async def list_tasks() -> dict[str, Any]:
    """Return queued + in-progress ARQ jobs, plus recent completed jobs."""
    settings = get_settings()
    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        # Queued jobs (still waiting to be picked up).
        queued_raw = await pool.queued_jobs(queue_name=_QUEUE)
        queued: list[dict[str, Any]] = []
        for q in queued_raw:
            queued.append(
                {
                    "id": q.job_id,
                    "name": q.function,
                    "args": _serialise_args(q.args, q.kwargs),
                    "enqueue_time": q.enqueue_time.isoformat() if q.enqueue_time else None,
                    "status": "queued",
                }
            )

        # In-progress jobs are tracked in a Redis set keyed by ARQ.
        in_prog_ids: list[str] = []
        try:
            raw = await pool.smembers(_IN_PROGRESS)
            in_prog_ids = [b.decode() if isinstance(b, bytes) else str(b) for b in raw]
        except Exception:  # noqa: BLE001
            in_prog_ids = []

        in_progress: list[dict[str, Any]] = []
        for jid in in_prog_ids:
            try:
                j = Job(jid, redis=pool)
                info = await j.info()
                if info is None:
                    continue
                in_progress.append(
                    {
                        "id": jid,
                        "name": info.function,
                        "args": _serialise_args(info.args, info.kwargs),
                        "enqueue_time": info.enqueue_time.isoformat() if info.enqueue_time else None,
                        "start_time": info.start_time.isoformat() if info.start_time else None,
                        "status": "running",
                    }
                )
            except Exception:  # noqa: BLE001
                continue

        # Recent completed results — ARQ stores them at `arq:result:<id>`.
        recent: list[dict[str, Any]] = []
        try:
            # Scan keys matching arq:result:* — keep it bounded so we don't blow up.
            cursor = 0
            keys: list[str] = []
            while True:
                cursor, batch = await pool.scan(cursor=cursor, match="arq:result:*", count=200)
                for b in batch:
                    keys.append(b.decode() if isinstance(b, bytes) else str(b))
                if cursor == 0 or len(keys) > 200:
                    break
            for key in keys[:60]:
                jid = key.split(":", 2)[-1]
                try:
                    j = Job(jid, redis=pool)
                    result_obj = await j.result_info()
                    if result_obj is None:
                        continue
                    recent.append(
                        {
                            "id": jid,
                            "name": result_obj.function,
                            "args": _serialise_args(result_obj.args, result_obj.kwargs),
                            "enqueue_time": result_obj.enqueue_time.isoformat()
                            if result_obj.enqueue_time
                            else None,
                            "start_time": result_obj.start_time.isoformat()
                            if result_obj.start_time
                            else None,
                            "finish_time": result_obj.finish_time.isoformat()
                            if result_obj.finish_time
                            else None,
                            "status": "ok" if result_obj.success else "error",
                            "result": _truncate_repr(result_obj.result),
                        }
                    )
                except Exception:  # noqa: BLE001
                    continue
            # Sort newest-first.
            recent.sort(key=lambda r: r.get("finish_time") or "", reverse=True)
        except Exception:  # noqa: BLE001
            pass

        return {
            "queued": queued,
            "in_progress": in_progress,
            "recent": recent[:30],
            "counts": {
                "queued": len(queued),
                "in_progress": len(in_progress),
                "recent": len(recent),
            },
        }
    finally:
        await pool.aclose()


def _truncate_repr(value: Any, cap: int = 240) -> str:
    try:
        s = json.dumps(value, default=str) if not isinstance(value, str) else value
    except Exception:
        s = str(value)
    return s if len(s) < cap else s[: cap - 1] + "…"


@router.post("/{job_id}/cancel")
async def cancel_task(job_id: str) -> dict[str, Any]:
    """Request abort of a queued or running ARQ job."""
    settings = get_settings()
    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        job = Job(job_id, redis=pool)
        try:
            ok = await job.abort(timeout=2)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR, f"abort failed: {exc}"
            ) from exc
        return {"job_id": job_id, "aborted": bool(ok)}
    finally:
        await pool.aclose()


@router.post("/{job_id}/retry")
async def retry_task(job_id: str) -> dict[str, Any]:
    """Re-enqueue a finished (or failed) job with the same function + args."""
    settings = get_settings()
    pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))
    try:
        job = Job(job_id, redis=pool)
        info = await job.result_info() or await job.info()
        if info is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "job not found")
        new = await pool.enqueue_job(info.function, *info.args, **info.kwargs)
        return {"queued_job_id": new.job_id if new else None}
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR, f"retry failed: {exc}"
        ) from exc
    finally:
        await pool.aclose()
