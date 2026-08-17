from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel


class OrchestratorMsg(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class OrchestratorTurn(BaseModel):
    message: str
    history: list[OrchestratorMsg] = []
    course_id: uuid.UUID | None = None
    page: str | None = None


class OrchestratorReply(BaseModel):
    reply: str
    provider: str
    model: str
