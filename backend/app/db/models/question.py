from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


QUESTION_KINDS = ("mcq", "short", "essay", "problem", "code", "true_false")
QUESTION_STATUSES = ("draft", "generated", "evaluating", "ready", "in_exam", "archived")
BLOOM_LEVELS = ("remember", "understand", "apply", "analyze", "evaluate", "create")


class Question(Base):
    __tablename__ = "questions"
    __table_args__ = (Index("ix_questions_course_status", "course_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("courses.id"))

    kind: Mapped[str] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="draft")

    prompt_md: Mapped[str] = mapped_column(Text)
    answer_md: Mapped[str] = mapped_column(Text, default="")
    distractors: Mapped[list[str]] = mapped_column(JSON, default=list)
    worked_solution_md: Mapped[str | None] = mapped_column(Text, nullable=True)

    difficulty: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bloom: Mapped[str | None] = mapped_column(String(16), nullable=True)
    est_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    topics: Mapped[list[str]] = mapped_column(JSON, default=list)
    chapter_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    category: Mapped[str | None] = mapped_column(String(64), nullable=True)
    elo_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_material_ids: Mapped[list[str]] = mapped_column(JSON, default=list)
    source_pages: Mapped[list[int]] = mapped_column(JSON, default=list)

    # provenance — where the question came from and who made it
    origin: Mapped[str] = mapped_column(
        String(24), nullable=False, server_default="ai-generated", default="ai-generated"
    )
    created_by: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_ref: Mapped[str | None] = mapped_column(Text, nullable=True)

    evaluation_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    eval_correctness: Mapped[float | None] = mapped_column(Float, nullable=True)
    eval_clarity: Mapped[float | None] = mapped_column(Float, nullable=True)
    feedback_md: Mapped[str | None] = mapped_column(Text, nullable=True)
    translation_sv: Mapped[str | None] = mapped_column(Text, nullable=True)
    scope_alignment: Mapped[float | None] = mapped_column(Float, nullable=True)
    off_topic_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    closest_reference_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    reference_deviation: Mapped[float | None] = mapped_column(Float, nullable=True)
    reference_match_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    needs_human_review: Mapped[bool] = mapped_column(default=False)

    vault_path: Mapped[str] = mapped_column(String(1024))
    current_iteration: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    course = relationship("Course", back_populates="questions")
    iterations = relationship("QuestionIteration", back_populates="question", cascade="all, delete-orphan")


class QuestionIteration(Base):
    __tablename__ = "question_iterations"
    __table_args__ = (Index("ix_qiter_question_seq", "question_id", "iteration_no", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    question_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("questions.id"))
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_conversations.id"), nullable=True
    )

    iteration_no: Mapped[int] = mapped_column(Integer)
    focus: Mapped[str] = mapped_column(String(32))
    body_md: Mapped[str] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    vault_path: Mapped[str] = mapped_column(String(1024))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    question = relationship("Question", back_populates="iterations")
