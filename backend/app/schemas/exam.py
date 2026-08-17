from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ExamListItem(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    origin: str
    status: str
    total_minutes: int
    question_count: int
    tex_path: str | None = None
    pdf_path: str | None = None
    solution_pdf_path: str | None = None
    source_pdf_path: str | None = None
    reproduction_score: float | None = None
    reproduction_notes: str | None = None
    validation_status: str = "unvalidated"
    open_blocking: int = 0
    created_at: datetime


class ExamCreate(BaseModel):
    course_id: uuid.UUID
    title: str = Field(min_length=1, max_length=256)
    total_minutes: int = Field(default=90, ge=1, le=600)


class ExamQuestionItem(BaseModel):
    question_id: uuid.UUID
    position: int
    points: int = Field(default=1, ge=0)
    category: str | None = None
    kind: str | None = None
    difficulty: int | None = None
    prompt_preview: str | None = None


class ExamDetail(BaseModel):
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    instructions_md: str
    total_minutes: int
    origin: str
    status: str
    tex_path: str | None
    pdf_path: str | None
    solution_pdf_path: str | None = None
    source_pdf_path: str | None = None
    reproduction_score: float | None = None
    reproduction_notes: str | None = None
    created_at: datetime
    questions: list[ExamQuestionItem]


class ExamQuestionInput(BaseModel):
    question_id: uuid.UUID
    position: int
    points: int = Field(default=1, ge=0)
    category: str | None = None


class ExamQuestionsUpdate(BaseModel):
    questions: list[ExamQuestionInput]


class ExamBlueprintSlot(BaseModel):
    category: str | None = None
    difficulty: int | None = Field(default=None, ge=1, le=5)
    points: int = Field(default=1, ge=0)


class ExamBuildAuto(BaseModel):
    course_id: uuid.UUID
    title: str = Field(min_length=1, max_length=256)
    total_minutes: int = Field(default=90, ge=1, le=600)
    variants: int = Field(default=1, ge=1, le=20)
    slots: list[ExamBlueprintSlot] = Field(min_length=1)
