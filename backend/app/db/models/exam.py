from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Exam(Base):
    __tablename__ = "exams"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courses.id"))

    title: Mapped[str] = mapped_column(String(256))
    instructions_md: Mapped[str] = mapped_column(Text, default="")
    total_minutes: Mapped[int] = mapped_column(Integer, default=90)

    # reference = a real past exam; generated = assembled by AIEA
    origin: Mapped[str] = mapped_column(
        String(24), nullable=False, server_default="generated", default="generated"
    )
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="draft", default="draft"
    )
    tex_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    pdf_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # Solutions PDF — same questions but with worked solutions printed.
    # Produced from solution.tex on every compile alongside exam.pdf.
    solution_pdf_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # For reference exams: absolute path to the original PDF that the
    # questions were harvested from. Stays set even after the reproduced
    # pdf_path is rendered, so the UI can compare reproduced vs original.
    source_pdf_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    # AI-judged similarity between source_pdf_path and pdf_path (0-10).
    reproduction_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    reproduction_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # unvalidated | clean | blocked | overridden
    validation_status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="unvalidated", default="unvalidated"
    )
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Set when an examiner deliberately compiles past open blocking findings. Recording
    # the reason is the point: an override with no stated reason is indistinguishable
    # from nobody having looked.
    validation_override_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    course = relationship("Course", back_populates="exams")
    questions = relationship("ExamQuestion", back_populates="exam", cascade="all, delete-orphan")
    findings = relationship(
        "ValidationFinding", back_populates="exam", cascade="all, delete-orphan"
    )


class ExamQuestion(Base):
    __tablename__ = "exam_questions"
    __table_args__ = (UniqueConstraint("exam_id", "question_id", name="uq_examq"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("exams.id"))
    question_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("questions.id"))

    position: Mapped[int] = mapped_column(Integer)
    points: Mapped[int] = mapped_column(Integer, default=1)
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)

    exam = relationship("Exam", back_populates="questions")


class ValidationFinding(Base):
    """One defect found by the validator, against an exam and/or a single question.

    Findings are rewritten wholesale on each validation run rather than accumulated,
    except for those an examiner has ruled on (`accepted` / `dismissed`), which survive
    so the same argument is not had twice.
    """

    __tablename__ = "validation_findings"
    __table_args__ = (
        Index("ix_validation_findings_exam_status", "exam_id", "status"),
        Index("ix_validation_findings_question", "question_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    exam_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("exams.id"), nullable=True
    )
    question_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id"), nullable=True
    )

    rule_id: Mapped[str] = mapped_column(String(64))
    severity: Mapped[str] = mapped_column(String(16))  # blocking|warning|note
    title: Mapped[str] = mapped_column(Text)
    detail_md: Mapped[str] = mapped_column(Text, default="")
    evidence: Mapped[dict] = mapped_column(JSON, default=dict)

    # open | fixed | accepted | dismissed
    status: Mapped[str] = mapped_column(
        String(16), nullable=False, server_default="open", default="open"
    )
    auto_fixable: Mapped[bool] = mapped_column(Boolean, default=False)
    #: reversible record of an applied automatic repair
    fix_diff: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    exam = relationship("Exam", back_populates="findings")
