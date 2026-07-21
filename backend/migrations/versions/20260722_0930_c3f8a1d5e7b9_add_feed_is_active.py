"""add feeds.is_active

Revision ID: c3f8a1d5e7b9
Revises: b7e2f1a9c3d4
Create Date: 2026-07-22 09:30:00.000000+00:00

Adds ``feeds.is_active`` (default true) so feeds can be paused: a paused feed
keeps its posts but is skipped by scheduled ingestion. Existing rows backfill
to active via the server default.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3f8a1d5e7b9"
down_revision: Union[str, None] = "b7e2f1a9c3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "feeds",
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    op.drop_column("feeds", "is_active")
