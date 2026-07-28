"""add audio.has_timings

Revision ID: d5e9f0a1b2c3
Revises: c3f8a1d5e7b9
Create Date: 2026-07-27 12:00:00.000000+00:00

Adds ``audio.has_timings`` (default false): a queryable marker that a valid
word-timing sidecar was written for the clip. Existing rows backfill to false
via the server default, which — combined with the audio cache-version bump —
makes every legacy clip eligible for timing backfill.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d5e9f0a1b2c3"
down_revision: Union[str, None] = "c3f8a1d5e7b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "audio",
        sa.Column(
            "has_timings",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("audio", "has_timings")
