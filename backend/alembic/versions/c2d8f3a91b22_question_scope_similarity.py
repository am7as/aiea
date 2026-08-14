"""question scope + similarity columns

Revision ID: c2d8f3a91b22
Revises: 8a1f4cb2e91a
Create Date: 2026-05-20 14:30:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


revision: str = 'c2d8f3a91b22'
down_revision: str | None = '8a1f4cb2e91a'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('questions', sa.Column('scope_alignment', sa.Float(), nullable=True))
    op.add_column('questions', sa.Column('off_topic_reason', sa.Text(), nullable=True))
    op.add_column('questions', sa.Column('closest_reference_id', UUID(as_uuid=True), nullable=True))
    op.add_column('questions', sa.Column('reference_deviation', sa.Float(), nullable=True))
    op.add_column('questions', sa.Column('reference_match_note', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('questions', 'reference_match_note')
    op.drop_column('questions', 'reference_deviation')
    op.drop_column('questions', 'closest_reference_id')
    op.drop_column('questions', 'off_topic_reason')
    op.drop_column('questions', 'scope_alignment')
