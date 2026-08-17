"""OpenAI-compatible HTTP provider — backs token APIs, LM Studio, and Ollama."""
from __future__ import annotations

import httpx

from app.ai.events import ChatMessage, GenParams
from app.ai.providers.base import AbstractProvider, ChatResult, ProviderHealth


class OpenAICompatProvider(AbstractProvider):
    def __init__(
        self,
        *,
        name: str,
        base_url: str,
        api_key: str | None = None,
        supports_vision: bool = True,
    ):
        self.name = name
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key or None
        self.supports_vision = supports_vision

    def _headers(self) -> dict[str, str]:
        h = {"Content-Type": "application/json"}
        if self.api_key:
            h["Authorization"] = f"Bearer {self.api_key}"
        return h

    async def _gemini_chat_models(self, c: httpx.AsyncClient) -> list[str]:
        """Gemini's OpenAI-compat /models has no capability info — its native endpoint
        reports supportedGenerationMethods, so we can keep only real chat models."""
        native = self.base_url.rsplit("/openai", 1)[0]
        r = await c.get(
            f"{native}/models",
            headers={"x-goog-api-key": self.api_key or ""},
            params={"pageSize": 1000},
        )
        r.raise_for_status()
        out: list[str] = []
        for m in r.json().get("models", []):
            if "generateContent" in (m.get("supportedGenerationMethods") or []):
                name = _norm_model(m.get("name", ""))
                if name and _is_chat_model(name):
                    out.append(name)
        return sorted(out)

    async def healthcheck(self) -> ProviderHealth:
        try:
            async with httpx.AsyncClient(timeout=8.0) as c:
                if "generativelanguage.googleapis.com" in self.base_url:
                    ids = await self._gemini_chat_models(c)
                else:
                    r = await c.get(f"{self.base_url}/models", headers=self._headers())
                    if r.status_code in (401, 403):
                        return ProviderHealth(
                            status="error", detail="unauthorized — check the API key"
                        )
                    r.raise_for_status()
                    ids = sorted(
                        m
                        for m in (_norm_model(d["id"]) for d in r.json().get("data", []))
                        if _is_chat_model(m)
                    )
        except httpx.ConnectError:
            return ProviderHealth(status="error", detail=f"unreachable at {self.base_url}")
        except httpx.HTTPStatusError as e:
            return ProviderHealth(status="error", detail=f"HTTP {e.response.status_code}")
        except Exception as e:  # noqa: BLE001
            return ProviderHealth(status="error", detail=str(e)[:200])

        if not ids:
            return ProviderHealth(status="warning", detail="reachable, but no models available", models=[])
        return ProviderHealth(status="healthy", detail=f"connected · {len(ids)} model(s)", models=ids)

    async def list_models(self) -> list[str]:
        return (await self.healthcheck()).models

    async def complete(
        self,
        messages: list[ChatMessage],
        *,
        model: str,
        system: str | None,
        params: GenParams,
    ) -> ChatResult:
        payload = {
            "model": _norm_model(model),
            "messages": _to_openai(messages, system),
            "temperature": params.temperature,
            "max_tokens": params.max_tokens,
            "stream": False,
        }
        # 30 min read — figure-bearing generation legitimately runs long
        timeout = httpx.Timeout(connect=8, read=1800, write=10, pool=8)
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(
                f"{self.base_url}/chat/completions", json=payload, headers=self._headers()
            )
            if r.status_code >= 400:
                raise RuntimeError(f"HTTP {r.status_code} — {_error_detail(r)}")
            body = r.json()

        choice = (body.get("choices") or [{}])[0]
        text = (choice.get("message") or {}).get("content", "") or ""
        usage = body.get("usage") or {}
        return ChatResult(
            text=text,
            model=body.get("model", model),
            tokens_in=usage.get("prompt_tokens", 0),
            tokens_out=usage.get("completion_tokens", 0),
        )


def _to_openai(messages: list[ChatMessage], system: str | None) -> list[dict]:
    out: list[dict] = []
    if system:
        out.append({"role": "system", "content": system})
    for m in messages:
        if m.images:
            content: list[dict] = [{"type": "text", "text": m.content}]
            for img in m.images:
                content.append(
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img}"}}
                )
            out.append({"role": m.role, "content": content})
        else:
            out.append({"role": m.role, "content": m.content})
    return out


def _norm_model(model: str) -> str:
    """Gemini's /models lists ids as 'models/gemini-…' but /chat/completions wants the bare name."""
    return model[len("models/") :] if model.startswith("models/") else model


# Markers that flag a model as not a text-chat model — /models lists embeddings,
# speech, image and other families that 404 on /chat/completions.
_NON_CHAT_MARKERS = (
    "embed",
    "aqa",
    "imagen",
    "veo",
    "lyria",
    "nano-banana",
    "computer-use",
    "deep-research",
    "native-audio",
    "tts",
    "whisper",
    "dall-e",
    "robotics",
)


def _is_chat_model(model_id: str) -> bool:
    low = model_id.lower()
    return not any(marker in low for marker in _NON_CHAT_MARKERS)


def _error_detail(r: httpx.Response) -> str:
    """Pull a human message out of an error response body."""
    try:
        j = r.json()
        if isinstance(j, dict):
            err = j.get("error")
            if isinstance(err, dict) and err.get("message"):
                return str(err["message"])[:400]
            if isinstance(err, str):
                return err[:400]
        return str(j)[:400]
    except Exception:  # noqa: BLE001
        return (r.text or r.reason_phrase)[:400]
