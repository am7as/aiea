from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

_NS = ConfigDict(protected_namespaces=())


class RouteModelIn(BaseModel):
    model_config = _NS

    provider_id: uuid.UUID
    model: str = Field(min_length=1)
    role: Literal["primary", "secondary"] = "primary"


class RouteModelRead(BaseModel):
    model_config = _NS

    provider_id: uuid.UUID
    provider_name: str
    provider_type: str
    provider_connected: bool
    provider_status: str
    model: str
    role: str
    position: int


class TaskRouteRead(BaseModel):
    model_config = _NS

    task: str
    group: str
    description: str
    temperature: float
    max_tokens: int
    context_length: int | None
    context_mode: str
    share_key: str | None
    system_prompt: str | None
    active_skills: list[str]
    models: list[RouteModelRead]
    status: str  # routed | unrouted | broken


class TaskRouteUpdate(BaseModel):
    model_config = _NS

    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1)
    context_length: int | None = Field(default=None, ge=0)
    context_mode: Literal["isolated", "shared"] | None = None
    share_key: str | None = None
    system_prompt: str | None = None
    active_skills: list[str] | None = None
    models: list[RouteModelIn] | None = None


class RouteTestResult(BaseModel):
    ok: bool
    detail: str
