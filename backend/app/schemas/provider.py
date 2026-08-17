from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ProviderType = Literal["subscription", "token", "lmstudio", "ollama"]

_MASK = "…"  # ellipsis


def mask_config(config: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of config with any api_key obscured for display."""
    out = dict(config)
    key = out.get("api_key")
    if isinstance(key, str) and key:
        out["api_key"] = f"{key[:5]}{_MASK}{key[-4:]}" if len(key) > 12 else _MASK
    return out


def is_masked_key(key: Any) -> bool:
    return isinstance(key, str) and _MASK in key


class ProviderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    type: ProviderType
    config: dict[str, Any] = Field(default_factory=dict)


class ProviderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=128)
    config: dict[str, Any] | None = None


class ProviderRead(BaseModel):
    id: uuid.UUID
    name: str
    type: str
    config: dict[str, Any]
    status: str
    status_detail: str
    models: list[str]
    connected: bool
    last_checked_at: datetime | None
    created_at: datetime


class TestConfigRequest(BaseModel):
    type: ProviderType
    config: dict[str, Any] = Field(default_factory=dict)


class TestResult(BaseModel):
    status: str
    detail: str
    models: list[str]


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ConsoleChatRequest(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    model: str = Field(min_length=1)
    message: str = Field(min_length=1)
    history: list[ChatTurn] = Field(default_factory=list)
    session: str | None = None  # memory session file name; defaults per-provider


class ConsoleChatReply(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    reply: str
    model: str
    tokens_in: int
    tokens_out: int
