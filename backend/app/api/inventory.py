"""Inventory — the full catalogue of tools exposed by AIEA.

Powers the Skills page in the UI. Returns:

- Runtime skills under backend/skills/ (name, description, scope)
- AI tasks registered in app/ai/router.py (with their routing assignment)
- Worker jobs (ARQ functions registered in app/workers/main.py)
- API routes (FastAPI router map)
- Per-course brain overrides (if a course is given)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.router import AI_TASKS
from app.db.base import get_db
from app.db.models import Course, Provider, TaskRoute, TaskRouteModel
from app.skills.loader import list_skills

router = APIRouter(prefix="/inventory", tags=["inventory"])


def _ai_task_list() -> list[dict[str, Any]]:
    return [
        {"task": t.task, "group": t.group, "description": t.description}
        for t in AI_TASKS
    ]


def _worker_function_list() -> list[dict[str, str]]:
    """Read the ARQ WorkerSettings.functions list — fail soft if import fails
    (e.g. inside the api container where worker-only deps may not be installed)."""
    try:
        from app.workers.main import WorkerSettings

        return [
            {"name": getattr(f, "__name__", str(f)), "module": getattr(f, "__module__", "")}
            for f in getattr(WorkerSettings, "functions", [])
        ]
    except Exception as exc:  # noqa: BLE001
        return [{"name": "(unavailable)", "module": str(exc)}]


def _api_route_list() -> list[dict[str, str]]:
    """Introspect the FastAPI app for registered routes."""
    try:
        from app.main import app  # local import — avoids circular at module load

        items: list[dict[str, str]] = []
        for r in app.routes:
            methods = sorted(getattr(r, "methods", []) - {"HEAD", "OPTIONS"}) if hasattr(r, "methods") else []
            if not methods:
                continue
            path = getattr(r, "path", "")
            if path.startswith("/docs") or path.startswith("/openapi") or path == "/":
                continue
            items.append({"methods": ",".join(methods), "path": path, "name": getattr(r, "name", "")})
        items.sort(key=lambda x: x["path"])
        return items
    except Exception as exc:  # noqa: BLE001
        return [{"methods": "", "path": "(unavailable)", "name": str(exc)}]


@router.get("/")
async def get_inventory(
    course_id: str | None = None,
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    brain: Path | None = None
    if course_id:
        import uuid as _uuid

        try:
            cid = _uuid.UUID(course_id)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "bad course_id") from None
        course = await db.get(Course, cid)
        if course and course.brain_path:
            brain = Path(course.brain_path)

    skills = list_skills(brain)

    # Routing: which provider+model each task points at.
    routes_rows = list(
        (await db.execute(select(TaskRoute, TaskRouteModel, Provider).
                          outerjoin(TaskRouteModel, TaskRouteModel.route_id == TaskRoute.id).
                          outerjoin(Provider, Provider.id == TaskRouteModel.provider_id))).all()
    )
    routing: dict[str, list[dict[str, str]]] = {}
    for r, rm, p in routes_rows:
        bucket = routing.setdefault(r.task, [])
        if rm is not None:
            bucket.append(
                {
                    "role": rm.role or "primary",
                    "provider": p.name if p else "—",
                    "model": rm.model or "—",
                }
            )

    return {
        "skills": [
            {
                "name": s["name"],
                "description": s["description"],
                "source": s.get("source", "global"),
            }
            for s in skills
        ],
        "ai_tasks": [
            {**t, "routes": routing.get(t["task"], [])}
            for t in _ai_task_list()
        ],
        "worker_jobs": _worker_function_list(),
        "api_routes": _api_route_list(),
    }
