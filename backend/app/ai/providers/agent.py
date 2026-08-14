"""Agent provider — the full agent (Claude Code or Gemini CLI) via the host shim."""
from __future__ import annotations

import httpx

from app.ai.events import ChatMessage, GenParams
from app.ai.providers.base import AbstractProvider, ChatResult, ProviderHealth

AGENT_MODELS: dict[str, list[str]] = {
    "claude": ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5"],
    "gemini": ["gemini-2.5-pro", "gemini-2.5-flash"],
}


def _shim_base(shim_url: str) -> str:
    base = shim_url.rstrip("/")
    for suffix in ("/claude/v1", "/gemini/v1", "/v1"):
        if base.endswith(suffix):
            return base[: -len(suffix)].rstrip("/")
    return base


class AgentProvider(AbstractProvider):
    """Runs `claude` or `gemini` headless with tools enabled, in a chosen working directory."""

    def __init__(
        self,
        *,
        name: str,
        service: str,
        shim_url: str,
        working_dir: str,
        permission: str = "edit",
    ):
        self.name = name
        self.service = service if service in AGENT_MODELS else "claude"
        self.shim_base = _shim_base(shim_url)
        self.working_dir = working_dir or "~"
        self.permission = permission or "edit"

    async def healthcheck(self) -> ProviderHealth:
        try:
            async with httpx.AsyncClient(timeout=5.0) as c:
                r = await c.get(f"{self.shim_base}/health")
                r.raise_for_status()
        except Exception as e:  # noqa: BLE001
            return ProviderHealth(
                status="error", detail=f"agent shim unreachable: {str(e)[:160]}"
            )
        return ProviderHealth(
            status="healthy",
            detail=f"{self.service} agent · {self.permission} · working dir {self.working_dir}",
            models=list(AGENT_MODELS[self.service]),
        )

    async def list_models(self) -> list[str]:
        return list(AGENT_MODELS[self.service])

    async def complete(
        self,
        messages: list[ChatMessage],
        *,
        model: str,
        system: str | None,
        params: GenParams,
    ) -> ChatResult:
        if any(m.images for m in messages):
            raise RuntimeError(
                "agent-mode providers do not support image input — route vision "
                "tasks (AI extraction / evaluation) to a token / LM Studio / Ollama provider"
            )
        payload = {
            "service": self.service,
            "model": model,
            "prompt": _render(messages, system),
            "working_dir": self.working_dir,
            "permission": self.permission,
        }
        # 30 min read — figure-bearing generation legitimately runs long
        timeout = httpx.Timeout(connect=8, read=1800, write=10, pool=8)
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(f"{self.shim_base}/agent", json=payload)
            if r.status_code >= 400:
                raise RuntimeError(f"HTTP {r.status_code} — {_error_detail(r)}")
            body = r.json()
        return ChatResult(
            text=body.get("text", ""),
            model=body.get("model", model),
            tokens_in=body.get("tokens_in", 0),
            tokens_out=body.get("tokens_out", 0),
        )


def _render(messages: list[ChatMessage], system: str | None) -> str:
    if len(messages) == 1 and not system:
        return messages[0].content
    parts: list[str] = []
    if system:
        parts.append(f"# System\n{system}")
    for m in messages:
        parts.append(f"## {m.role.capitalize()}\n{m.content}")
    return "\n\n".join(parts)


def _error_detail(r: httpx.Response) -> str:
    try:
        j = r.json()
        if isinstance(j, dict) and isinstance(j.get("error"), dict):
            return str(j["error"].get("message", j))[:400]
        return str(j)[:400]
    except Exception:  # noqa: BLE001
        return (r.text or r.reason_phrase)[:400]
