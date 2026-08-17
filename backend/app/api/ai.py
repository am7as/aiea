from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.ai.events import ChatMessage, GenParams
from app.ai.factory import SHIM_URL, build_provider
from app.ai.orchestrator import build_system_prompt
from app.ai.router import AI_TASKS, TASK_SPECS, primary_model, resolve
from app.schemas.orchestrator import OrchestratorReply, OrchestratorTurn
from app.config import get_settings
from app.db.base import get_db
from app.db.models import Provider, TaskRoute, TaskRouteModel
from app.memory import index as mem_index
from app.memory import store as mem_store
from app.memory.tags import slugify
from app.schemas.provider import (
    ConsoleChatReply,
    ConsoleChatRequest,
    ProviderCreate,
    ProviderRead,
    ProviderUpdate,
    TestConfigRequest,
    TestResult,
    is_masked_key,
    mask_config,
)
from app.schemas.route import (
    RouteModelRead,
    RouteTestResult,
    TaskRouteRead,
    TaskRouteUpdate,
)

router = APIRouter(prefix="/ai", tags=["ai"])


def _to_read(p: Provider) -> ProviderRead:
    return ProviderRead(
        id=p.id,
        name=p.name,
        type=p.type,
        config=mask_config(p.config or {}),
        status=p.status,
        status_detail=p.status_detail,
        models=list(p.models or []),
        connected=p.connected,
        last_checked_at=p.last_checked_at,
        created_at=p.created_at,
    )


async def _get(db: AsyncSession, pid: uuid.UUID) -> Provider:
    p = await db.get(Provider, pid)
    if p is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Provider not found")
    return p


@router.get("/shim/health")
async def shim_health():
    """Reachability of the host AI shim — the bridge for subscription providers."""
    base = SHIM_URL.removesuffix("/v1")
    try:
        async with httpx.AsyncClient(timeout=3.0) as c:
            r = await c.get(f"{base}/health")
            r.raise_for_status()
            data = r.json()
        return {"running": True, "url": base, "models": data.get("models", [])}
    except Exception as e:  # noqa: BLE001
        return {"running": False, "url": base, "models": [], "detail": str(e)[:160]}


@router.get("/providers", response_model=list[ProviderRead])
async def list_providers(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Provider).order_by(Provider.created_at))).scalars().all()
    return [_to_read(p) for p in rows]


@router.post("/providers", response_model=ProviderRead, status_code=status.HTTP_201_CREATED)
async def create_provider(payload: ProviderCreate, db: AsyncSession = Depends(get_db)):
    try:
        build_provider(payload.name, payload.type, payload.config)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    p = Provider(name=payload.name, type=payload.type, config=payload.config)
    db.add(p)
    await db.flush()
    await db.refresh(p)
    return _to_read(p)


@router.get("/providers/{pid}", response_model=ProviderRead)
async def get_provider(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    return _to_read(await _get(db, pid))


@router.patch("/providers/{pid}", response_model=ProviderRead)
async def update_provider(
    pid: uuid.UUID, payload: ProviderUpdate, db: AsyncSession = Depends(get_db)
):
    p = await _get(db, pid)
    if payload.name is not None:
        p.name = payload.name
    if payload.config is not None:
        new_cfg = dict(payload.config)
        old_key = (p.config or {}).get("api_key")
        if is_masked_key(new_cfg.get("api_key")) and old_key:
            new_cfg["api_key"] = old_key
        try:
            build_provider(p.name, p.type, new_cfg)
        except ValueError as e:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
        p.config = new_cfg
        p.status = "unknown"
        p.status_detail = ""
        p.models = []
        p.connected = False
        p.last_checked_at = None
    await db.flush()
    await db.refresh(p)
    return _to_read(p)


@router.delete("/providers/{pid}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    await db.delete(await _get(db, pid))


async def _verify_models(provider, models: list[str]) -> list[str]:
    """Probe each model with a tiny call; keep only the ones that actually respond.

    The /models catalog over-reports (deprecated, non-chat, unauthorised models) —
    a real call is the only way to know a model works for this key, right now.
    """
    sem = asyncio.Semaphore(6)

    async def probe(model: str) -> str | None:
        async with sem:
            try:
                await provider.complete(
                    [ChatMessage(role="user", content="hi")],
                    model=model,
                    system=None,
                    params=GenParams(max_tokens=8),
                )
                return model
            except Exception:  # noqa: BLE001
                return None

    results = await asyncio.gather(*(probe(m) for m in models))
    return [m for m in results if m]


@router.post("/providers/{pid}/test", response_model=ProviderRead)
async def test_provider(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    p = await _get(db, pid)
    try:
        provider = build_provider(p.name, p.type, p.config or {})
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    health = await provider.healthcheck()
    models = list(health.models)
    detail = health.detail

    # Token catalogs over-report — verify each model with a real call.
    if p.type == "token" and health.status != "error" and models:
        models = await _verify_models(provider, models)
        detail = (
            f"connected · {len(models)} usable model(s)"
            if models
            else "connected, but no model passed a test call"
        )

    p.status = health.status
    p.status_detail = detail
    p.models = models
    p.last_checked_at = datetime.now(timezone.utc)
    if health.status == "error":
        p.connected = False
    await db.flush()
    await db.refresh(p)
    return _to_read(p)


@router.post("/providers/test-config", response_model=TestResult)
async def test_config(payload: TestConfigRequest):
    try:
        provider = build_provider("preview", payload.type, payload.config)
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    health = await provider.healthcheck()
    return TestResult(status=health.status, detail=health.detail, models=health.models)


@router.post("/providers/{pid}/connect", response_model=ProviderRead)
async def connect_provider(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    p = await _get(db, pid)
    if p.status not in ("healthy", "warning"):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Test the connection first — provider is not healthy."
        )
    p.connected = True
    await db.flush()
    await db.refresh(p)
    return _to_read(p)


@router.post("/providers/{pid}/disconnect", response_model=ProviderRead)
async def disconnect_provider(pid: uuid.UUID, db: AsyncSession = Depends(get_db)):
    p = await _get(db, pid)
    p.connected = False
    await db.flush()
    await db.refresh(p)
    return _to_read(p)


@router.post("/providers/{pid}/chat", response_model=ConsoleChatReply)
async def provider_chat(
    pid: uuid.UUID, payload: ConsoleChatRequest, db: AsyncSession = Depends(get_db)
):
    p = await _get(db, pid)
    try:
        provider = build_provider(p.name, p.type, p.config or {})
    except ValueError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))
    messages = [ChatMessage(role=t.role, content=t.content) for t in payload.history]
    messages.append(ChatMessage(role="user", content=payload.message))
    try:
        result = await provider.complete(
            messages,
            model=payload.model,
            system=None,
            params=GenParams(),
        )
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"{type(e).__name__}: {e}")

    # Log the exchange to memory — best-effort; never let it break the chat.
    try:
        root = get_settings().vault_path / "aiea-memory"
        now = datetime.now(timezone.utc)
        prov_slug = slugify(p.name)
        session_name = slugify(payload.session) if payload.session else f"console-{prov_slug}"
        mem_store.append_exchange(
            root,
            session_name,
            payload.message,
            result.text,
            [
                "task/console-chat",
                f"provider/{prov_slug}",
                f"model/{p.type}/{slugify(payload.model)}",
                f"date/{now:%Y/%m/%d}",
            ],
        )
        mem_index.reindex(root)
    except Exception:  # noqa: BLE001, S110
        pass

    return ConsoleChatReply(
        reply=result.text,
        model=result.model,
        tokens_in=result.tokens_in,
        tokens_out=result.tokens_out,
    )


# ── Task routing ────────────────────────────────────────────────────────────


async def _ensure_routes(db: AsyncSession) -> None:
    existing = set((await db.execute(select(TaskRoute.task))).scalars().all())
    for spec in AI_TASKS:
        if spec.task not in existing:
            db.add(TaskRoute(task=spec.task))
    await db.flush()


def _route_status(route: TaskRoute, providers: dict[uuid.UUID, Provider]) -> str:
    primary = primary_model(route)
    if primary is None:
        return "unrouted"
    p = providers.get(primary.provider_id)
    if p is None or not p.connected or p.status == "error":
        return "broken"
    return "routed"


def _route_read(route: TaskRoute, providers: dict[uuid.UUID, Provider]) -> TaskRouteRead:
    spec = TASK_SPECS[route.task]
    models: list[RouteModelRead] = []
    for m in sorted(route.models, key=lambda x: x.position):
        p = providers.get(m.provider_id)
        models.append(
            RouteModelRead(
                provider_id=m.provider_id,
                provider_name=p.name if p else "(deleted provider)",
                provider_type=p.type if p else "",
                provider_connected=p.connected if p else False,
                provider_status=p.status if p else "unknown",
                model=m.model,
                role=m.role,
                position=m.position,
            )
        )
    return TaskRouteRead(
        task=route.task,
        group=spec.group,
        description=spec.description,
        temperature=route.temperature,
        max_tokens=route.max_tokens,
        context_length=route.context_length,
        context_mode=route.context_mode,
        share_key=route.share_key,
        system_prompt=route.system_prompt,
        active_skills=list(route.active_skills or []),
        models=models,
        status=_route_status(route, providers),
    )


async def _providers_by_id(db: AsyncSession) -> dict[uuid.UUID, Provider]:
    rows = (await db.execute(select(Provider))).scalars().all()
    return {p.id: p for p in rows}


@router.get("/task-routes", response_model=list[TaskRouteRead])
async def list_task_routes(db: AsyncSession = Depends(get_db)):
    await _ensure_routes(db)
    res = await db.execute(select(TaskRoute).options(selectinload(TaskRoute.models)))
    routes = {r.task: r for r in res.scalars().all()}
    providers = await _providers_by_id(db)
    return [_route_read(routes[s.task], providers) for s in AI_TASKS if s.task in routes]


@router.put("/task-routes/{task}", response_model=TaskRouteRead)
async def update_task_route(
    task: str, payload: TaskRouteUpdate, db: AsyncSession = Depends(get_db)
):
    if task not in TASK_SPECS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown task '{task}'")
    await _ensure_routes(db)
    res = await db.execute(
        select(TaskRoute).options(selectinload(TaskRoute.models)).where(TaskRoute.task == task)
    )
    route = res.scalar_one()

    if payload.temperature is not None:
        route.temperature = payload.temperature
    if payload.max_tokens is not None:
        route.max_tokens = payload.max_tokens
    if payload.context_length is not None:
        route.context_length = payload.context_length or None
    if payload.context_mode is not None:
        route.context_mode = payload.context_mode
    if payload.share_key is not None:
        route.share_key = payload.share_key or None
    if payload.system_prompt is not None:
        route.system_prompt = payload.system_prompt or None
    if payload.active_skills is not None:
        route.active_skills = payload.active_skills
    if payload.models is not None:
        primaries = [m for m in payload.models if m.role == "primary"]
        if len(primaries) > 1:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, "a route can have only one primary model"
            )
        route.models.clear()
        for i, m in enumerate(payload.models):
            if await db.get(Provider, m.provider_id) is None:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_ENTITY, f"provider {m.provider_id} not found"
                )
            route.models.append(
                TaskRouteModel(
                    provider_id=m.provider_id, model=m.model, role=m.role, position=i
                )
            )

    await db.flush()
    await db.refresh(route, ["models"])
    return _route_read(route, await _providers_by_id(db))


@router.post("/task-routes/{task}/test", response_model=RouteTestResult)
async def test_task_route(task: str, db: AsyncSession = Depends(get_db)):
    if task not in TASK_SPECS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"unknown task '{task}'")
    resolution = await resolve(db, task)
    if resolution is None:
        return RouteTestResult(ok=False, detail="no model assigned, and no default route to fall back to")
    try:
        result = await resolution.provider.complete(
            [ChatMessage(role="user", content="Reply with the single word: ok")],
            model=resolution.model,
            system=None,
            params=GenParams(max_tokens=16),
        )
    except Exception as e:  # noqa: BLE001
        return RouteTestResult(ok=False, detail=f"{type(e).__name__}: {e}")
    snippet = result.text.strip().replace("\n", " ")[:60]
    return RouteTestResult(
        ok=True, detail=f"{resolution.provider_row.name} · {resolution.model} → \"{snippet}\""
    )


@router.post("/orchestrator", response_model=OrchestratorReply)
async def orchestrator_chat(
    payload: OrchestratorTurn, db: AsyncSession = Depends(get_db)
) -> OrchestratorReply:
    """One turn with the in-app Orchestrator — the model routed at `orchestration`."""
    resolution = await resolve(db, "orchestration")
    if resolution is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Route the 'orchestration' task to a provider in Task Routing first.",
        )
    messages = [ChatMessage(role=m.role, content=m.content) for m in payload.history]
    messages.append(ChatMessage(role="user", content=payload.message))
    system = build_system_prompt(
        str(payload.course_id) if payload.course_id else None, payload.page
    )
    try:
        result = await resolution.provider.complete(
            messages, model=resolution.model, system=system, params=resolution.params
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"orchestrator failed: {type(exc).__name__}: {exc}"
        ) from exc
    return OrchestratorReply(
        reply=result.text.strip(),
        provider=resolution.provider_row.name,
        model=resolution.model,
    )
