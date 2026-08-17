"""exam solution_pdf_path

Revision ID: e7f4c1d8a0b3
Revises: d3a72f5b8e91
Create Date: 2026-05-21 17:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "e7f4c1d8a0b3"
down_revision: str | None = "d3a72f5b8e91"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("exams", sa.Column("solution_pdf_path", sa.String(length=1024), nullable=True))


def downgrade() -> None:
    op.drop_column("exams", "solution_pdf_path")
