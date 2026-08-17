from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator


class CourseBase(BaseModel):
    code: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=256)
    description_md: str = ""
    topics: list[str] = Field(default_factory=list)
    language: str | None = Field(default=None, max_length=8)


class CourseCreate(CourseBase):
    """Provide EITHER quick_parent (AIEA derives 4 paths) OR all four explicit paths."""

    quick_parent: str | None = None

    materials_path: str | None = None
    brain_path: str | None = None
    library_path: str | None = None
    workshop_path: str | None = None

    @model_validator(mode="after")
    def _check_paths(self) -> "CourseCreate":
        explicit = (self.materials_path, self.brain_path, self.library_path, self.workshop_path)
        all_set = all(p for p in explicit)
        none_set = not any(p for p in explicit)
        if self.quick_parent:
            if all_set:
                raise ValueError(
                    "Provide either quick_parent or the four explicit paths, not both."
                )
        else:
            if not all_set:
                raise ValueError(
                    "Provide quick_parent OR all four of materials_path / brain_path / "
                    "library_path / workshop_path."
                )
            _ = none_set  # silence unused
        return self


class CourseUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=64)
    title: str | None = Field(default=None, min_length=1, max_length=256)
    description_md: str | None = None
    topics: list[str] | None = None
    language: str | None = Field(default=None, max_length=8)
    materials_path: str | None = None
    brain_path: str | None = None
    library_path: str | None = None
    workshop_path: str | None = None


class CourseRead(CourseBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    materials_path: str | None = None
    brain_path: str | None = None
    library_path: str | None = None
    workshop_path: str | None = None
    materials_count: int = 0
    questions_count: int = 0
    exams_count: int = 0
