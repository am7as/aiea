from __future__ import annotations

from pydantic import BaseModel


class SyllabusRead(BaseModel):
    exists: bool
    content: str
    chapters: list[dict]
    elos: list[dict]
    body: str
    status: str
    error: str | None = None
    updated_at: str | None = None


class SyllabusWrite(BaseModel):
    content: str


class SyllabusBuildResult(BaseModel):
    status: str
    detail: str
