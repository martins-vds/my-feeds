"""sanitize existing post html

Revision ID: b7e2f1a9c3d4
Revises: 4d1fa35b8c50
Create Date: 2026-07-21 14:35:00.000000+00:00

One-time data migration: sanitize existing ``posts.content`` and
``posts.summary`` for rows that were stored before ingestion/read-time
sanitization existed. Idempotent — re-running over already-clean content is a
no-op, so only rows that actually change are written.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b7e2f1a9c3d4"
down_revision: Union[str, None] = "4d1fa35b8c50"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_BATCH_SIZE = 500


def upgrade() -> None:
    # Imported lazily so building the migration graph never requires nh3.
    from app.infrastructure.sanitization.html_sanitizer import sanitize_html

    conn = op.get_bind()
    offset = 0
    while True:
        rows = conn.execute(
            sa.text("SELECT id, content, summary FROM posts ORDER BY id LIMIT :lim OFFSET :off"),
            {"lim": _BATCH_SIZE, "off": offset},
        ).fetchall()
        if not rows:
            break

        for row in rows:
            clean_content = sanitize_html(row.content)
            clean_summary = sanitize_html(row.summary)
            if clean_content != row.content or clean_summary != row.summary:
                conn.execute(
                    sa.text(
                        "UPDATE posts SET content = :content, summary = :summary "
                        "WHERE id = CAST(:id AS uuid)"
                    ),
                    {
                        "content": clean_content,
                        "summary": clean_summary,
                        "id": str(row.id),
                    },
                )

        offset += _BATCH_SIZE


def downgrade() -> None:
    # Sanitization is not reversible — the original raw HTML is not retained.
    pass
