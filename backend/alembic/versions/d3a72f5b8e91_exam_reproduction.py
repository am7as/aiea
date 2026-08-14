"""exam source_pdf_path + reproduction score

Revision ID: d3a72f5b8e91
Revises: c2d8f3a91b22
Create Date: 2026-05-21 12:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "d3a72f5b8e91"
down_revision: str | None = "c2d8f3a91b22"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("exams", sa.Column("source_pdf_path", sa.String(length=1024), nullable=True))
    op.add_column("exams", sa.Column("reproduction_score", sa.Float(), nullable=True))
    op.add_column("exams", sa.Column("reproduction_notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("exams", "reproduction_notes")
    op.drop_column("exams", "reproduction_score")
    op.drop_column("exams", "source_pdf_path")
