from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


COLLECTIONS = {"book", "lectures", "exercises", "exams", "exam-template", "other"}


class MaterialVersionBrief(BaseModel):
    method: str
    status: str
    is_final: bool
    eval_score: int | None = None


class MaterialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    course_id: uuid.UUID
    collection: str
    subpath: str
    title: str
    original_filename: str
    pages: int | None = None
    extraction_method: str | None = None
    extraction_status: str
    extraction_error: str | None = None
    word_count: int | None = None
    uploaded_at: datetime
    versions: list[MaterialVersionBrief] = []
    comparison: dict | None = None


class MaterialUpdate(BaseModel):
    title: str | None = Field(default=None, max_length=256)
    collection: str | None = Field(default=None, max_length=32)


class MaterialBatch(BaseModel):
    material_ids: list[uuid.UUID] = Field(min_length=1)


class ExtractionVersionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    material_id: uuid.UUID
    method: str
    status: str
    extraction_method: str | None
    pages: int | None
    word_count: int | None
    vault_path: str | None
    error: str | None
    eval_score: int | None
    eval_notes: str | None
    is_final: bool
    created_at: datetime
    updated_at: datetime


class MaterialVersionsRead(BaseModel):
    material_id: uuid.UUID
    versions: list[ExtractionVersionRead]
    comparison: dict | None = None
    python_text: str | None = None
    ai_text: str | None = None
    comparison_report: str | None = None
    evaluation_report: str | None = None
    python_path: str | None = None
    ai_path: str | None = None
    comparison_path: str | None = None
    evaluation_path: str | None = None


class ScanFileEntry(BaseModel):
    collection: str
    subpath: str
    filename: str
    size: int
    suffix: str
    material_id: uuid.UUID | None = None
    extraction_status: str | None = None
    pages: int | None = None


class ScanCollection(BaseModel):
    name: str
    files: list[ScanFileEntry]


class ScanResult(BaseModel):
    materials_path: str
    collections: list[ScanCollection]
    total_files: int
    registered: int
    new_registered: int
