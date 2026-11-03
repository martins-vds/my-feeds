"""Migration test for reading progress on ``user_posts``.

Runs the real Alembic chain against a throw-away database, so it needs the admin
connection (``MIGRATION_DATABASE_URL``) and is skipped in ordinary runs.
"""

import os
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

MIGRATION_URL = os.environ.get("MIGRATION_DATABASE_URL")

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not MIGRATION_URL, reason="MIGRATION_DATABASE_URL is not set"),
]

BACKEND_ROOT = Path(__file__).resolve().parents[2]
PREVIOUS_REVISION = "f7a1b2c3d4e5"
READ_AT = datetime(2026, 1, 5, 12, 0, tzinfo=UTC)


def _id(kind: int, n: int) -> uuid.UUID:
    return uuid.UUID(f"00000000-0000-4000-a{kind:03x}-{n:012x}")


USER = _id(0, 1)
FEED = _id(1, 1)
POST_DUP_MIXED = _id(2, 1)
POST_DUP_UNREAD = _id(2, 2)
POST_SINGLE_READ = _id(2, 3)
POST_SINGLE_UNREAD = _id(2, 4)
POST_FRESH = _id(2, 5)  # no user_posts row; used for the CHECK-constraint inserts
POSTS = [POST_DUP_MIXED, POST_DUP_UNREAD, POST_SINGLE_READ, POST_SINGLE_UNREAD, POST_FRESH]

UP_MIXED_UNREAD = _id(3, 1)  # lower id, but the read row below must win
UP_MIXED_READ = _id(3, 2)
UP_UNREAD_LOW = _id(3, 3)  # both unread: the lowest id survives
UP_UNREAD_HIGH = _id(3, 4)
UP_SINGLE_READ = _id(3, 5)
UP_SINGLE_UNREAD = _id(3, 6)
# (row id, post id, is_read)
USER_POSTS = [
    (UP_MIXED_UNREAD, POST_DUP_MIXED, False),
    (UP_MIXED_READ, POST_DUP_MIXED, True),
    (UP_UNREAD_LOW, POST_DUP_UNREAD, False),
    (UP_UNREAD_HIGH, POST_DUP_UNREAD, False),
    (UP_SINGLE_READ, POST_SINGLE_READ, True),
    (UP_SINGLE_UNREAD, POST_SINGLE_UNREAD, False),
]
SURVIVORS = {UP_MIXED_READ, UP_UNREAD_LOW, UP_SINGLE_READ, UP_SINGLE_UNREAD}


def _alembic(database_url: str, *args: str) -> None:
    env = {**os.environ, "DATABASE_URL": database_url, "ENVIRONMENT": "testing", "DEBUG": "false"}
    env.pop("MIGRATION_DATABASE_URL", None)
    result = subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_ROOT,
        env=env,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}")


@pytest.fixture
async def database_url():
    base = make_url(MIGRATION_URL)
    name = f"reading_progress_migration_{uuid.uuid4().hex[:12]}"
    admin = create_async_engine(
        base.set(database="postgres"), isolation_level="AUTOCOMMIT", poolclass=NullPool
    )
    async with admin.connect() as conn:
        await conn.execute(text(f'CREATE DATABASE "{name}"'))
    try:
        yield base.set(database=name).render_as_string(hide_password=False)
    finally:
        async with admin.connect() as conn:
            await conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        await admin.dispose()


async def _seed_parents(engine) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "INSERT INTO users (id, provider, provider_id, email, name, timezone, "
                "notifications_enabled) VALUES (:id, 'github', 'migration-user', "
                "'migration@example.com', 'Migration User', 'UTC', false)"
            ),
            {"id": USER},
        )
        await conn.execute(
            text(
                "INSERT INTO feeds (id, user_id, url, title, fetch_error_count) "
                "VALUES (:id, :user, 'https://example.com/feed', 'Feed', 0)"
            ),
            {"id": FEED, "user": USER},
        )
        for post_id in POSTS:
            await conn.execute(
                text(
                    "INSERT INTO posts (id, feed_id, guid, title, content, summary, link, "
                    "published_at) VALUES (:id, :feed, :guid, 'Post', 'Body', 'Summary', "
                    "'https://example.com/post', now())"
                ),
                {"id": post_id, "feed": FEED, "guid": f"guid-{post_id}"},
            )


async def _seed_user_posts(engine) -> None:
    async with engine.begin() as conn:
        for row_id, post_id, is_read in USER_POSTS:
            await conn.execute(
                text(
                    "INSERT INTO user_posts (id, user_id, post_id, is_read, read_at) "
                    "VALUES (:id, :user, :post, :is_read, :read_at)"
                ),
                {
                    "id": row_id,
                    "user": USER,
                    "post": post_id,
                    "is_read": is_read,
                    "read_at": READ_AT if is_read else None,
                },
            )


async def _columns(engine) -> set[str]:
    async with engine.connect() as conn:
        result = await conn.execute(
            text(
                "SELECT column_name FROM information_schema.columns WHERE table_name = 'user_posts'"
            )
        )
        return {row[0] for row in result}


class TestReadingProgressMigration:
    @pytest.mark.asyncio
    async def test_upgrade_dedupes_backfills_and_adds_constraints(self, database_url):
        _alembic(database_url, "upgrade", PREVIOUS_REVISION)
        engine = create_async_engine(database_url, poolclass=NullPool)
        try:
            await _seed_parents(engine)
            await _seed_user_posts(engine)

            _alembic(database_url, "upgrade", "head")

            async with engine.connect() as conn:
                result = await conn.execute(
                    text("SELECT id, read_progress, opened_at FROM user_posts")
                )
                rows = {str(row.id): row for row in result}

            assert set(rows) == {str(row_id) for row_id in SURVIVORS}
            for read_id in (UP_MIXED_READ, UP_SINGLE_READ):
                assert rows[str(read_id)].read_progress == 1
                assert rows[str(read_id)].opened_at == READ_AT
            for unread_id in (UP_UNREAD_LOW, UP_SINGLE_UNREAD):
                assert rows[str(unread_id)].read_progress == 0
                assert rows[str(unread_id)].opened_at is None

            with pytest.raises(IntegrityError, match="uq_user_posts_user_id_post_id"):
                async with engine.begin() as conn:
                    await conn.execute(
                        text(
                            "INSERT INTO user_posts (id, user_id, post_id, is_read) "
                            "VALUES (:id, :user, :post, false)"
                        ),
                        {"id": uuid.uuid4(), "user": USER, "post": POST_SINGLE_UNREAD},
                    )

            for bad_progress in (1.5, -0.1):
                with pytest.raises(IntegrityError, match="ck_user_posts_read_progress_range"):
                    async with engine.begin() as conn:
                        await conn.execute(
                            text(
                                "INSERT INTO user_posts (id, user_id, post_id, is_read, "
                                "read_progress) VALUES (:id, :user, :post, false, :progress)"
                            ),
                            {
                                "id": uuid.uuid4(),
                                "user": USER,
                                "post": POST_FRESH,
                                "progress": bad_progress,
                            },
                        )
        finally:
            await engine.dispose()

    @pytest.mark.asyncio
    async def test_downgrade_then_upgrade_round_trips(self, database_url):
        _alembic(database_url, "upgrade", "head")
        engine = create_async_engine(database_url, poolclass=NullPool)
        try:
            columns = await _columns(engine)
            assert {"opened_at", "read_progress"} <= columns
            await _seed_parents(engine)

            _alembic(database_url, "downgrade", PREVIOUS_REVISION)
            columns = await _columns(engine)
            assert not {"opened_at", "read_progress"} & columns

            # The unique constraint is gone again, so duplicates are accepted.
            await _seed_user_posts(engine)

            _alembic(database_url, "upgrade", "head")
            async with engine.connect() as conn:
                count = (await conn.execute(text("SELECT count(*) FROM user_posts"))).scalar_one()
            assert count == len(SURVIVORS)
        finally:
            await engine.dispose()
