from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant"]
    content: str
    images: list[str] = Field(default_factory=list)
    """Optional base64-encoded PNG images (vision input). Ignored by text-only providers."""


class GenParams(BaseModel):
    temperature: float = 0.3
    max_tokens: int = 1024
    top_p: float = 1.0
