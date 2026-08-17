"""question translation_sv column

Revision ID: 8a1f4cb2e91a
Revises: ecf18336f678
Create Date: 2026-05-20 11:00:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = '8a1f4cb2e91a'
down_revision: str | None = 'ecf18336f678'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('questions', sa.Column('translation_sv', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('questions', 'translation_sv')
