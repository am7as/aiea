from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


class Provider(Base):
    """A user-configured AI connection. Many per type (subscription / token / lmstudio / ollama)."""

    __tablename__ = "providers"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(128))
    type: Mapped[str] = mapped_column(String(16))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default="unknown")
    status_detail: Mapped[str] = mapped_column(String(512), default="")
    models: Mapped[list[str]] = mapped_column(JSON, default=list)
    connected: Mapped[bool] = mapped_column(Boolean, default=False)
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)


class TaskRoute(Base):
    """Routing config for one AI task — params plus one or more assigned models."""

    __tablename__ = "task_routes"
    __table_args__ = (Index("ix_task_routes_task", "task", unique=True),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task: Mapped[str] = mapped_column(String(64))
    temperature: Mapped[float] = mapped_column(default=0.3)
    max_tokens: Mapped[int] = mapped_column(Integer, default=4096)
    context_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    context_mode: Mapped[str] = mapped_column(String(16), default="isolated")
    share_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    active_skills: Mapped[list[str]] = mapped_column(JSON, default=list)
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    models = relationship(
        "TaskRouteModel",
        back_populates="route",
        cascade="all, delete-orphan",
        order_by="TaskRouteModel.position",
    )


class TaskRouteModel(Base):
    """One model assignment on a route — primary, or a secondary for cross-checking."""

    __tablename__ = "task_route_models"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    route_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("task_routes.id", ondelete="CASCADE")
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("providers.id", ondelete="CASCADE")
    )
    model: Mapped[str] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(16), default="primary")
    position: Mapped[int] = mapped_column(Integer, default=0)

    route = relationship("TaskRoute", back_populates="models")


class AIConversation(Base):
    __tablename__ = "ai_conversations"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    task: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(256), default="")
    current_provider: Mapped[str] = mapped_column(String(32))
    current_model: Mapped[str] = mapped_column(String(128))
    system_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)

    question_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("questions.id"), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow
    )

    messages = relationship("AIMessage", back_populates="conversation", cascade="all, delete-orphan")
    sessions = relationship("ProviderSession", back_populates="conversation", cascade="all, delete-orphan")


class ProviderSession(Base):
    __tablename__ = "provider_sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_conversations.id")
    )
    provider: Mapped[str] = mapped_column(String(32))
    model: Mapped[str] = mapped_column(String(128))
    external_session_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    active: Mapped[bool] = mapped_column(default=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    conversation = relationship("AIConversation", back_populates="sessions")


class AIMessage(Base):
    __tablename__ = "ai_messages"
    __table_args__ = (Index("ix_ai_messages_conv_seq", "conversation_id", "seq"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("ai_conversations.id")
    )
    seq: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(16))
    content: Mapped[str] = mapped_column(Text)

    provider_session_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("provider_sessions.id"), nullable=True
    )

    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    conversation = relationship("AIConversation", back_populates="messages")
