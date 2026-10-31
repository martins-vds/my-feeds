"""Allow identical audio content to be linked to multiple owned posts."""

from alembic import op

revision = "f7a1b2c3d4e5"
down_revision = "e6f0a1b2c3d4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_audio_cache_key", table_name="audio")
    op.create_index("ix_audio_cache_key", "audio", ["cache_key"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_audio_cache_key", table_name="audio")
    op.create_index("ix_audio_cache_key", "audio", ["cache_key"], unique=True)
