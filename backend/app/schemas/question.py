from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

QuestionKind = Literal["mcq", "short", "essay", "problem", "code", "true_false"]


class QuestionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    course_id: uuid.UUID
    kind: str
    status: str
    prompt_md: str
    answer_md: str
    distractors: list[str]
    worked_solution_md: str | None
    difficulty: int | None
    bloom: str | None
    est_minutes: int | None
    topics: list[str]
    chapter_id: str | None
    category: str | None
    elo_ids: list[str]
    source_material_ids: list[str]
    source_pages: list[int]
    origin: str
    created_by: str | None
    source_ref: str | None
    evaluation_md: str | None
    eval_correctness: float | None
    eval_clarity: float | None
    feedback_md: str | None
    translation_sv: str | None
    scope_alignment: float | None
    off_topic_reason: str | None
    closest_reference_id: uuid.UUID | None
    reference_deviation: float | None
    reference_match_note: str | None
    needs_human_review: bool
    vault_path: str
    current_iteration: int
    created_at: datetime
    updated_at: datetime


class QuestionGenerateRequest(BaseModel):
    course_id: uuid.UUID
    material_ids: list[uuid.UUID] = Field(min_length=1)
    kind: QuestionKind = "mcq"
    count: int = Field(default=5, ge=1, le=30)
    difficulty: int | None = Field(default=None, ge=1, le=5)
    bloom: str | None = None
    topics: list[str] | None = None
    chapter_id: str | None = None
    category: str | None = None
    with_diagrams: bool = True


class QuestionGenerateResult(BaseModel):
    status: str
    detail: str


class QuestionUpdate(BaseModel):
    """Partial edit of a question — only the supplied fields change."""

    prompt_md: str | None = None
    answer_md: str | None = None
    worked_solution_md: str | None = None
    distractors: list[str] | None = None
    difficulty: int | None = None
    bloom: str | None = None
    est_minutes: int | None = None
    category: str | None = None
    status: str | None = None
    feedback_md: str | None = None
    translation_sv: str | None = None
