"""Contract test fixtures.

Provides authentication and data fixtures for API contract tests.

Two-phase seeding:
  Phase 1 (autouse): ensure all test users exist in the ``users`` table so
      that any route creating DB records with FK → users won't blow up.
  Phase 2 (on-demand): seed categories / feeds / posts / user_posts only
      when a test requests a data-dependent fixture like ``category_id``,
      ``feed_id``, or ``post_id``.
"""

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text

# ---------------------------------------------------------------------------
# Fixed IDs — deterministic so ON CONFLICT guards are reliable
# ---------------------------------------------------------------------------
TEST_USER_ID = UUID("00000000-0000-4000-a000-000000000001")
TEST_OTHER_USER_ID = UUID("00000000-0000-4000-a000-000000000002")
TEST_CATEGORY_ID = UUID("00000000-0000-4000-b000-000000000001")
TEST_OTHER_CAT_ID = UUID("00000000-0000-4000-b000-000000000002")
TEST_FEED_ID = UUID("00000000-0000-4000-c000-000000000001")
TEST_OTHER_FEED_ID = UUID("00000000-0000-4000-c000-000000000002")
TEST_POST1_ID = UUID("00000000-0000-4000-d000-000000000001")  # unread
TEST_POST2_ID = UUID("00000000-0000-4000-d000-000000000002")  # read
TEST_OTHER_POST_ID = UUID("00000000-0000-4000-d000-000000000003")
TEST_USERPOST_ID = UUID("00000000-0000-4000-e000-000000000001")

TEST_CACHE_KEY = "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"

# ---------------------------------------------------------------------------
# Phase 1 — users only (autouse)
# ---------------------------------------------------------------------------
_users_seeded = False


async def _ensure_users():
    global _users_seeded
    if _users_seeded:
        return
    _users_seeded = True

    from app.infrastructure.persistence.database import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        for uid, name, email in [
            (TEST_USER_ID, "Test User", "test@example.com"),
            (TEST_OTHER_USER_ID, "Other User", "other@example.com"),
        ]:
            await session.execute(
                text(
                    "INSERT INTO users (id, provider, provider_id, email, name, "
                    "timezone, notifications_enabled) "
                    "VALUES (:id, 'github', :pid, :email, :name, 'UTC', false) "
                    "ON CONFLICT (id) DO NOTHING"
                ),
                {
                    "id": uid,
                    "pid": str(uid),
                    "email": email,
                    "name": name,
                },
            )
        await session.commit()


@pytest.fixture(autouse=True)
async def _ensure_test_users(app):
    """Ensure test users exist in the DB before every contract test."""
    await _ensure_users()


# ---------------------------------------------------------------------------
# Teardown — keep API-created rows from persisting (autouse)
# ---------------------------------------------------------------------------
# Deterministic seed rows that must survive between tests (they are re-seeded
# idempotently). Everything else the tests create via the API is cleaned up.
_SEED_CATEGORY_IDS = (TEST_CATEGORY_ID, TEST_OTHER_CAT_ID)
_SEED_FEED_IDS = (TEST_FEED_ID, TEST_OTHER_FEED_ID)


@pytest.fixture(autouse=True)
async def _reset_response_cache():
    """Clear the process-wide response cache between contract tests so a body
    cached in one test can't leak into the next."""
    from app.infrastructure.http.response_cache import reset_response_cache

    reset_response_cache()
    yield
    reset_response_cache()


@pytest.fixture(autouse=True)
async def _cleanup_created_rows(app):
    """Contract tests run against a persistent database with no transactional
    rollback, so rows created through the API (categories, feeds) would
    otherwise accumulate for the fixed test users across runs — eventually
    tripping the per-user category limit and breaking ``POST /categories``.

    After each test, delete any categories/feeds owned by the test users that
    aren't part of the deterministic seed. Dependent rows (``feed_categories``
    links and a feed's ``posts``) cascade on delete, and the seed re-creates the
    fixed rows on demand, so this keeps the shared DB from growing unbounded.
    """
    yield

    from app.infrastructure.persistence.database import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            text("DELETE FROM categories WHERE user_id IN (:u1, :u2) AND id NOT IN (:c1, :c2)"),
            {
                "u1": TEST_USER_ID,
                "u2": TEST_OTHER_USER_ID,
                "c1": TEST_CATEGORY_ID,
                "c2": TEST_OTHER_CAT_ID,
            },
        )
        await session.execute(
            text("DELETE FROM feeds WHERE user_id IN (:u1, :u2) AND id NOT IN (:f1, :f2)"),
            {
                "u1": TEST_USER_ID,
                "u2": TEST_OTHER_USER_ID,
                "f1": TEST_FEED_ID,
                "f2": TEST_OTHER_FEED_ID,
            },
        )
        await session.commit()


# ---------------------------------------------------------------------------
# Phase 2 — full data (on-demand)
# ---------------------------------------------------------------------------
_data_seeded = False


async def _seed_full_data():
    global _data_seeded
    if _data_seeded:
        return
    _data_seeded = True

    # Users must be present first
    await _ensure_users()

    from app.infrastructure.persistence.database import get_session_factory

    now = datetime.now(timezone.utc)
    factory = get_session_factory()
    async with factory() as session:
        # Categories
        await session.execute(
            text(
                "INSERT INTO categories (id, user_id, name, position) "
                "VALUES (:id, :uid, 'Test Category', 0) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": TEST_CATEGORY_ID, "uid": TEST_USER_ID},
        )
        await session.execute(
            text(
                "INSERT INTO categories (id, user_id, name, position) "
                "VALUES (:id, :uid, 'Other Category', 0) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": TEST_OTHER_CAT_ID, "uid": TEST_OTHER_USER_ID},
        )

        # Feeds (owned by the user; categories assigned via feed_categories)
        await session.execute(
            text(
                "INSERT INTO feeds (id, user_id, url, title, fetch_error_count) "
                "VALUES (:id, :uid, 'https://example.com/feed.xml', 'Test Feed', 0) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": TEST_FEED_ID, "uid": TEST_USER_ID},
        )
        await session.execute(
            text(
                "INSERT INTO feeds (id, user_id, url, title, fetch_error_count) "
                "VALUES (:id, :uid, 'https://other.com/feed.xml', 'Other Feed', 0) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": TEST_OTHER_FEED_ID, "uid": TEST_OTHER_USER_ID},
        )

        # Category assignments (many-to-many)
        await session.execute(
            text(
                "INSERT INTO feed_categories (feed_id, category_id) "
                "VALUES (:fid, :cid) ON CONFLICT DO NOTHING"
            ),
            {"fid": TEST_FEED_ID, "cid": TEST_CATEGORY_ID},
        )
        await session.execute(
            text(
                "INSERT INTO feed_categories (feed_id, category_id) "
                "VALUES (:fid, :cid) ON CONFLICT DO NOTHING"
            ),
            {"fid": TEST_OTHER_FEED_ID, "cid": TEST_OTHER_CAT_ID},
        )

        # Posts
        await session.execute(
            text(
                "INSERT INTO posts (id, feed_id, guid, title, content, summary, "
                "author, link, published_at) "
                "VALUES (:id, :fid, 'guid-post1', 'Test Post 1', "
                "'<p>Content 1</p>', 'Summary 1', 'Author', "
                "'https://example.com/1', :pub) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": TEST_POST1_ID, "fid": TEST_FEED_ID, "pub": now - timedelta(hours=1)},
        )
        await session.execute(
            text(
                "INSERT INTO posts (id, feed_id, guid, title, content, summary, "
                "author, link, published_at) "
                "VALUES (:id, :fid, 'guid-post2', 'Test Post 2', "
                "'<p>Content 2</p>', 'Summary 2', 'Author', "
                "'https://example.com/2', :pub) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": TEST_POST2_ID, "fid": TEST_FEED_ID, "pub": now - timedelta(hours=2)},
        )
        await session.execute(
            text(
                "INSERT INTO posts (id, feed_id, guid, title, content, summary, "
                "link, published_at) "
                "VALUES (:id, :fid, 'guid-other', 'Other Post', "
                "'<p>Other</p>', 'Other summary', "
                "'https://other.com/1', :pub) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": TEST_OTHER_POST_ID, "fid": TEST_OTHER_FEED_ID, "pub": now},
        )

        # Mark post2 as read
        await session.execute(
            text(
                "INSERT INTO user_posts (id, user_id, post_id, is_read, read_at) "
                "VALUES (:id, :uid, :pid, true, :at) "
                "ON CONFLICT (id) DO NOTHING"
            ),
            {"id": TEST_USERPOST_ID, "uid": TEST_USER_ID, "pid": TEST_POST2_ID, "at": now},
        )

        await session.commit()


# ---------------------------------------------------------------------------
# Auth fixtures
# ---------------------------------------------------------------------------


def _make_auth_headers(user_id: UUID) -> dict:
    session_data = {
        "user_id": str(user_id),
        "provider": "github",
        "created_at": datetime.utcnow().isoformat(),
    }
    return {"Cookie": f"my_feeds_session={json.dumps(session_data)}"}


@pytest.fixture
def auth_headers():
    """HTTP headers authenticating as the main test user (TEST_USER_ID)."""
    return _make_auth_headers(TEST_USER_ID)


@pytest.fixture
def authenticated_session():
    return {"user_id": str(TEST_USER_ID), "provider": "github"}


# ---------------------------------------------------------------------------
# Data fixtures — requesting any of these triggers Phase 2 seeding
# ---------------------------------------------------------------------------


@pytest.fixture
async def category_id():
    await _seed_full_data()
    return TEST_CATEGORY_ID


@pytest.fixture
async def feed_id():
    await _seed_full_data()
    return TEST_FEED_ID


@pytest.fixture
async def post_id():
    await _seed_full_data()
    return TEST_POST1_ID


@pytest.fixture
async def unread_post_id():
    await _seed_full_data()
    return TEST_POST1_ID


@pytest.fixture
async def read_post_id():
    await _seed_full_data()
    return TEST_POST2_ID


@pytest.fixture
async def other_user_post_id():
    await _seed_full_data()
    return TEST_OTHER_POST_ID


# ---------------------------------------------------------------------------
# Mock / utility fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def test_post():
    post = MagicMock()
    post.id = uuid4()
    return post


@pytest.fixture
def test_post_with_audio():
    post = MagicMock()
    post.id = uuid4()
    return post


@dataclass
class MockAudio:
    cache_key: str = TEST_CACHE_KEY


@pytest.fixture
def test_audio():
    """Create a real cached MP3 file for streaming tests."""
    cache_dir = Path("audio_cache")
    prefix = TEST_CACHE_KEY[:2]
    file_dir = cache_dir / prefix
    file_dir.mkdir(parents=True, exist_ok=True)

    file_path = file_dir / f"{TEST_CACHE_KEY}.mp3"
    fake_mp3 = b"\xff\xfb\x90\x00" + b"\x00" * 2044
    file_path.write_bytes(fake_mp3)

    yield MockAudio(cache_key=TEST_CACHE_KEY)

    if file_path.exists():
        file_path.unlink()
    try:
        file_dir.rmdir()
    except OSError:
        pass


@pytest.fixture
def other_user_post():
    post = MagicMock()
    post.id = uuid4()
    return post
