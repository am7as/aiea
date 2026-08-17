from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (UniqueConstraint("code", name="uq_courses_code"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    code: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(256))
    description_md: Mapped[str] = mapped_column(Text, default="")
    topics: Mapped[list[str]] = mapped_column(JSON, default=list)
    language: Mapped[str | None] = mapped_column(String(8), nullable=True)

    materials_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    brain_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    library_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    workshop_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    materials = relationship("Material", back_populates="course", cascade="all, delete-orphan")
    questions = relationship("Question", back_populates="course", cascade="all, delete-orphan")
    exams = relationship("Exam", back_populates="course", cascade="all, delete-orphan")


class Material(Base):
    __tablename__ = "materials"
    __table_args__ = (UniqueConstraint("course_id", "subpath", name="uq_materials_course_subpath"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courses.id"))

    collection: Mapped[str] = mapped_column(String(32))  # book|lectures|exercises|exams|exam-template|other
    subpath: Mapped[str] = mapped_column(String(1024))   # relative to materials_path, e.g. "lectures/L01.pptx"
    title: Mapped[str] = mapped_column(String(256), default="")
    original_filename: Mapped[str] = mapped_column(String(512), default="")

    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    extracted_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    extraction_method: Mapped[str | None] = mapped_column(String(32), nullable=True)
    extraction_status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|running|done|error
    extraction_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    meta: Mapped[dict] = mapped_column(JSON, default=dict)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    course = relationship("Course", back_populates="materials")
    versions = relationship(
        "ExtractionVersion", back_populates="material", cascade="all, delete-orphan"
    )


class ExtractionVersion(Base):
    """One extraction of a material by one method (python | ai). A material can
    hold both; exactly one may be marked `is_final` and drives downstream use."""

    __tablename__ = "extraction_versions"
    __table_args__ = (
        UniqueConstraint("material_id", "method", name="uq_extraction_versions_material_method"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    material_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("materials.id"), index=True
    )

    method: Mapped[str] = mapped_column(String(16))  # python | ai
    status: Mapped[str] = mapped_column(String(16), default="pending")  # pending|running|done|error
    extraction_method: Mapped[str | None] = mapped_column(String(64), nullable=True)
    pages: Mapped[int | None] = mapped_column(Integer, nullable=True)
    word_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vault_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    job_id: Mapped[str | None] = mapped_column(String(64), nullable=True)

    eval_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    eval_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_final: Mapped[bool] = mapped_column(default=False)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    material = relationship("Material", back_populates="versions")
