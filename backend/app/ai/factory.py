from __future__ import annotations

from app.ai.providers.agent import AgentProvider
from app.ai.providers.base import AbstractProvider
from app.ai.providers.openai_compat import OpenAICompatProvider

PROVIDER_TYPES: tuple[str, ...] = ("subscription", "token", "lmstudio", "ollama")

DEFAULT_BASE_URL: dict[str, str] = {
    "lmstudio": "http://host.docker.internal:1234/v1",
    "ollama": "http://host.docker.internal:11434/v1",
}

SHIM_URL = "http://host.docker.internal:4023/v1"


def build_provider(name: str, type_: str, config: dict) -> AbstractProvider:
    """Instantiate a live provider from a stored Provider row's type + config.

    `subscription` is an HTTP provider pointed at the host AI shim
    (scripts/host-ai-shim.mjs), which wraps the host's logged-in CLIs.
    """
    if type_ == "subscription":
        shim_url = config.get("shim_url") or SHIM_URL
        if config.get("mode") == "agent":
            return AgentProvider(
                name=name,
                service=config.get("service") or "claude",
                shim_url=shim_url,
                working_dir=config.get("working_dir") or "~",
                permission=config.get("permission") or "edit",
            )
        return OpenAICompatProvider(name=name, base_url=shim_url, supports_vision=False)

    if type_ == "token":
        base_url = config.get("base_url")
        if not base_url:
            raise ValueError("token provider requires a base_url")
        if not config.get("api_key"):
            raise ValueError("token provider requires an api_key")
        return OpenAICompatProvider(name=name, base_url=base_url, api_key=config["api_key"])

    if type_ in ("lmstudio", "ollama"):
        base_url = config.get("base_url") or DEFAULT_BASE_URL[type_]
        return OpenAICompatProvider(name=name, base_url=base_url)

    raise ValueError(f"unknown provider type '{type_}'")
