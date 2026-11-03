"""Track reading progress on user_posts.

Adds ``opened_at`` and ``read_progress`` so opening a post and reading it are
recorded separately, and a unique ``(user_id, post_id)`` constraint so progress
writes can upsert atomically. Rows that duplicate a (user, post) pair are
collapsed to one survivor (a read row wins, then the latest ``read_at``, then
the lowest ``id``); that clean-up cannot be reversed by ``downgrade``.
"""

import sqlalchemy as sa
from alembic import op

revision = "b8e4a1c7d903"
down_revision = "f7a1b2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_posts",
        sa.Column(
            "opened_at",
            sa.DateTime(timezone=True),
            nullable=True,
            comment="When the user first opened this post",
        ),
    )
    op.add_column(
        "user_posts",
        sa.Column(
            "read_progress",
            sa.Float(),
            nullable=False,
            server_default="0",
            comment="Furthest reading position reached, from 0.0 to 1.0",
        ),
    )
    op.create_check_constraint(
        "ck_user_posts_read_progress_range",
        "user_posts",
        "read_progress >= 0 AND read_progress <= 1",
    )
    op.execute(
        """
        DELETE FROM user_posts
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY user_id, post_id
                           ORDER BY is_read DESC, read_at DESC NULLS LAST, id
                       ) AS rn
                FROM user_posts
            ) ranked
            WHERE ranked.rn > 1
        )
        """
    )
    op.execute("UPDATE user_posts SET read_progress = 1, opened_at = read_at WHERE is_read")
    op.create_unique_constraint(
        "uq_user_posts_user_id_post_id", "user_posts", ["user_id", "post_id"]
    )
    op.create_table_comment("user_posts", "Per-user read state and reading progress for posts")


def downgrade() -> None:
    op.create_table_comment("user_posts", "Per-user read state for posts")
    op.drop_constraint("uq_user_posts_user_id_post_id", "user_posts", type_="unique")
    op.drop_constraint("ck_user_posts_read_progress_range", "user_posts", type_="check")
    op.drop_column("user_posts", "read_progress")
    op.drop_column("user_posts", "opened_at")
