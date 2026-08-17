from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from app.ai.events import ChatMessage, GenParams


@dataclass
class ProviderHealth:
    """Outcome of a connection test. status is one of healthy | warning | error."""

    status: str
    detail: str = ""
    models: list[str] = field(default_factory=list)


@dataclass
class ChatResult:
    text: str
    model: str
    tokens_in: int = 0
    tokens_out: int = 0


class AbstractProvider(ABC):
    """Common interface every AI provider type implements."""

    name: str

    @abstractmethod
    async def healthcheck(self) -> ProviderHealth:
        ...

    @abstractmethod
    async def list_models(self) -> list[str]:
        ...

    @abstractmethod
    async def complete(
        self,
        messages: list[ChatMessage],
        *,
        model: str,
        system: str | None,
        params: GenParams,
    ) -> ChatResult:
        ...
