"""Integration tests for reading-progress persistence (real Postgres)."""

import asyncio
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from sqlalchemy import event, text

from app.application.services.post_service import PostService
from app.domain.feed_management.entities.category import Category
from app.domain.feed_management.entities.feed import Feed
from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.entities.user_post_state import UserPostState
from app.infrastructure.persistence.database import get_engine, get_session_factory
from app.infrastructure.persistence.repositories.category_repository import (
    SQLAlchemyCategoryRepository,
)
from app.infrastructure.persistence.repositories.feed_repository import (
    SQLAlchemyFeedRepository,
)
from app.infrastructure.persistence.repositories.post_repository import (
    SQLAlchemyPostRepository,
)


async def _insert_user(label: str):
    uid = uuid4()
    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, provider, provider_id, email, name, "
                "timezone, notifications_enabled) "
                "VALUES (:id, 'github', :pid, :email, :name, 'UTC', false)"
            ),
            {"id": uid, "pid": f"{label}-{uid}", "email": f"{uid}@example.com", "name": label},
        )
        await session.commit()
    return uid


async def _delete_user(uid) -> None:
    factory = get_session_factory()
    async with factory() as session:
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": uid})
        await session.commit()


@pytest.fixture
async def user_id():
    """An isolated user; deleting it cascades to feeds, posts and user_posts."""
    uid = await _insert_user("progress")
    yield uid
    await _delete_user(uid)


@pytest.fixture
async def other_user_id():
    uid = await _insert_user("other")
    yield uid
    await _delete_user(uid)


async def _make_feed_with_posts(owner_id, guids=("a", "b", "c"), category_ids=None):
    """Create a feed with one post per guid; the first guid is the newest post."""
    factory = get_session_factory()
    async with factory() as session:
        feeds = SQLAlchemyFeedRepository(session)
        posts = SQLAlchemyPostRepository(session)
        feed = await feeds.save(
            Feed.create(
                user_id=owner_id,
                url=f"https://example.com/{uuid4()}",
                category_ids=category_ids,
            )
        )
        await session.commit()
        saved = []
        for minutes_ago, guid in enumerate(guids):
            saved.append(
                await posts.save(
                    Post.create(
                        feed_id=feed.id,
                        guid=guid,
                        title=f"Post {guid}",
                        link=f"https://example.com/{guid}",
                        published_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
                    )
                )
            )
        await session.commit()
    return feed, saved


@pytest.fixture
async def feed_and_posts(user_id):
    return await _make_feed_with_posts(user_id)


class TestRecordOpened:
    @pytest.mark.asyncio
    async def test_creates_an_unread_row_marked_as_opened(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            await posts.record_opened(user_id, post_a.id)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert state.is_read is False
        assert state.read_progress == 0.0
        assert state.read_at is None
        assert state.is_seen is True

    @pytest.mark.asyncio
    async def test_keeps_the_first_opened_at(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            await posts.record_opened(user_id, post_a.id)
            first = (await posts.get_user_post_state(user_id, post_a.id)).opened_at
            await posts.record_opened(user_id, post_a.id)
            second = (await posts.get_user_post_state(user_id, post_a.id)).opened_at

        assert first is not None
        assert second == first

    @pytest.mark.asyncio
    async def test_does_not_touch_an_existing_read_state(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_a.id, True)

            await posts.record_opened(user_id, post_a.id)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert state.is_read is True
        assert state.read_progress == 1.0
        assert state.is_seen is True


class TestRecordProgress:
    @pytest.mark.asyncio
    async def test_creates_a_row_with_progress_and_opened_at(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            state = await posts.record_progress(user_id, post_a.id, 0.4, completed=False)

        assert state.is_read is False
        assert state.read_progress == pytest.approx(0.4)
        assert state.read_at is None
        assert state.is_seen is True

    @pytest.mark.asyncio
    async def test_progress_only_moves_forward(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_progress(user_id, post_a.id, 0.5, completed=False)

            lower = await posts.record_progress(user_id, post_a.id, 0.2, completed=False)
            higher = await posts.record_progress(user_id, post_a.id, 0.7, completed=False)

        assert lower.read_progress == pytest.approx(0.5)
        assert higher.read_progress == pytest.approx(0.7)

    @pytest.mark.asyncio
    async def test_completion_marks_the_post_read_at_full_progress(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            state = await posts.record_progress(user_id, post_a.id, 0.97, completed=True)

        assert state.is_read is True
        assert state.read_progress == 1.0
        assert state.read_at is not None

    @pytest.mark.asyncio
    async def test_a_read_post_stays_read_and_keeps_its_read_at(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            done = await posts.record_progress(user_id, post_a.id, 0.97, completed=True)

            later = await posts.record_progress(user_id, post_a.id, 0.1, completed=False)

        assert later.is_read is True
        assert later.read_progress == 1.0
        assert later.read_at == done.read_at

    @pytest.mark.asyncio
    async def test_sets_opened_at_on_a_row_created_by_mark_as_read(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_a.id, True)
            assert (await posts.get_user_post_state(user_id, post_a.id)).is_seen is False

            state = await posts.record_progress(user_id, post_a.id, 0.3, completed=False)

        assert state.opened_at is not None
        assert state.is_read is True

    @pytest.mark.asyncio
    async def test_concurrent_writers_keep_the_highest_progress(self, user_id, feed_and_posts):
        """Tabs and devices race on a post with no row yet: nothing raises, the max wins."""
        _, (post_a, _b, _c) = feed_and_posts

        async def in_own_session(write):
            async with get_session_factory()() as session:
                await write(SQLAlchemyPostRepository(session))
                await session.commit()

        writers = [
            lambda posts: posts.record_opened(user_id, post_a.id),
            lambda posts: posts.record_progress(user_id, post_a.id, 0.2, completed=False),
            lambda posts: posts.record_progress(user_id, post_a.id, 0.6, completed=False),
            lambda posts: posts.record_progress(user_id, post_a.id, 0.4, completed=False),
        ]
        await asyncio.gather(*(in_own_session(write) for write in writers))

        async with get_session_factory()() as session:
            state = await SQLAlchemyPostRepository(session).get_user_post_state(user_id, post_a.id)
        assert state.read_progress == pytest.approx(0.6)
        assert state.is_read is False
        assert state.is_seen is True


class TestMarkAsRead:
    @pytest.mark.asyncio
    async def test_mark_read_without_a_row_creates_one_at_full_progress(
        self, user_id, feed_and_posts
    ):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            await posts.mark_as_read(user_id, post_a.id, True)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert state.is_read is True
        assert state.read_progress == 1.0
        assert state.read_at is not None
        assert state.is_seen is False

    @pytest.mark.asyncio
    async def test_mark_read_keeps_opened_at(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_opened(user_id, post_a.id)
            opened_at = (await posts.get_user_post_state(user_id, post_a.id)).opened_at

            await posts.mark_as_read(user_id, post_a.id, True)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert state.is_read is True
        assert state.opened_at == opened_at

    @pytest.mark.asyncio
    async def test_mark_unread_resets_progress_and_read_at_but_keeps_opened_at(
        self, user_id, feed_and_posts
    ):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_progress(user_id, post_a.id, 0.97, completed=True)
            opened_at = (await posts.get_user_post_state(user_id, post_a.id)).opened_at

            await posts.mark_as_read(user_id, post_a.id, False)
            state = await posts.get_user_post_state(user_id, post_a.id)

        assert (state.is_read, state.read_progress, state.read_at) == (False, 0.0, None)
        assert state.opened_at == opened_at

    @pytest.mark.asyncio
    async def test_get_read_state_returns_the_tuple_form(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            assert await posts.get_read_state(user_id, post_a.id) == (False, None)

            await posts.mark_as_read(user_id, post_a.id, True)
            is_read, read_at = await posts.get_read_state(user_id, post_a.id)

        assert is_read is True
        assert read_at is not None

    @pytest.mark.asyncio
    async def test_getters_are_not_stale_after_an_upsert_in_the_same_session(
        self, user_id, feed_and_posts
    ):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_opened(user_id, post_a.id)
            before = await posts.get_user_post_state(user_id, post_a.id)

            await posts.mark_as_read(user_id, post_a.id, True)
            after = await posts.get_user_post_state(user_id, post_a.id)

        assert before.is_read is False
        assert after.is_read is True


class TestMarkAllRead:
    @pytest.mark.asyncio
    async def test_mark_read_creates_missing_rows_and_updates_existing_ones(
        self, user_id, feed_and_posts
    ):
        feed, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_progress(user_id, post_a.id, 0.5, completed=False)
            await posts.mark_as_read(user_id, post_b.id, True)

            count = await posts.mark_all_read(user_id, True, feed_id=feed.id)
            state_a, state_b, state_c = [
                await posts.get_user_post_state(user_id, post.id)
                for post in (post_a, post_b, post_c)
            ]

        assert count == 3
        for state in (state_a, state_b, state_c):
            assert state.is_read is True
            assert state.read_progress == 1.0
            assert state.read_at is not None
        assert state_a.is_seen is True  # the opened_at of an existing row is kept
        assert state_c.is_seen is False  # inserted rows were never opened

    @pytest.mark.asyncio
    async def test_mark_unread_resets_progress_but_keeps_opened_at(self, user_id, feed_and_posts):
        feed, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.record_progress(user_id, post_a.id, 0.5, completed=False)
            await posts.mark_as_read(user_id, post_b.id, True)

            count = await posts.mark_all_read(user_id, False, feed_id=feed.id)
            state_a, state_b, state_c = [
                await posts.get_user_post_state(user_id, post.id)
                for post in (post_a, post_b, post_c)
            ]

        assert count == 3
        assert (state_a.is_read, state_a.read_progress, state_a.read_at) == (False, 0.0, None)
        assert state_a.is_seen is True
        assert (state_b.is_read, state_b.read_progress, state_b.read_at) == (False, 0.0, None)
        assert state_c == UserPostState()  # no row is created for an untouched post

    @pytest.mark.asyncio
    @pytest.mark.usefixtures("feed_and_posts")
    async def test_scope_never_reaches_other_users_posts(self, user_id, other_user_id):
        _, (other_post,) = await _make_feed_with_posts(other_user_id, guids=("x",))
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            count = await posts.mark_all_read(user_id, True)
            foreign = await posts.get_user_post_state(user_id, other_post.id)

        assert count == 3
        assert foreign.is_read is False

    @pytest.mark.asyncio
    async def test_category_and_uncategorized_scopes(self, user_id):
        async with get_session_factory()() as session:
            category = await SQLAlchemyCategoryRepository(session).save(
                Category.create(user_id=user_id, name="Tech", position=1)
            )
            await session.commit()
        _, (in_category, _second) = await _make_feed_with_posts(
            user_id, guids=("c1", "c2"), category_ids=[category.id]
        )
        _, (loose,) = await _make_feed_with_posts(user_id, guids=("u1",))

        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)

            categorized_count = await posts.mark_all_read(user_id, True, category_id=category.id)
            categorized_state = await posts.get_user_post_state(user_id, in_category.id)
            loose_before = await posts.get_user_post_state(user_id, loose.id)
            uncategorized_count = await posts.mark_all_read(user_id, True, uncategorized=True)
            loose_after = await posts.get_user_post_state(user_id, loose.id)

        assert categorized_count == 2
        assert categorized_state.is_read is True
        assert loose_before.is_read is False
        assert uncategorized_count == 1
        assert loose_after.is_read is True


async def _seed_reading_states(posts, user_id, post_a, post_b, post_c):
    """a = marked read, b = 40% read, c = opened only."""
    await posts.mark_as_read(user_id, post_a.id, True)
    await posts.record_progress(user_id, post_b.id, 0.4, completed=False)
    await posts.record_opened(user_id, post_c.id)


class TestListPostsForUser:
    @pytest.mark.asyncio
    async def test_posts_carry_the_users_reading_state(self, user_id, feed_and_posts):
        _, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await _seed_reading_states(posts, user_id, post_a, post_b, post_c)

            listed = {post.guid: post for post in await posts.get_posts_for_user(user_id)}

        read, partial, opened = listed["a"], listed["b"], listed["c"]
        assert (read.is_read, read.read_progress, read.is_seen) == (True, 1.0, False)
        assert (partial.is_read, partial.is_seen) == (False, True)
        assert partial.read_progress == pytest.approx(0.4)
        assert (opened.is_read, opened.read_progress, opened.is_seen) == (False, 0.0, True)

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("read_state", "expected"),
        [
            ("all", ["a", "b", "c"]),
            ("unread", ["b", "c"]),
            ("in_progress", ["b"]),
            ("read", ["a"]),
        ],
    )
    async def test_read_state_filters(self, user_id, feed_and_posts, read_state, expected):
        _, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await _seed_reading_states(posts, user_id, post_a, post_b, post_c)

            listed = await posts.get_posts_for_user(user_id, read_state=read_state)

        assert [post.guid for post in listed] == expected

    @pytest.mark.asyncio
    async def test_limit_applies_after_the_read_state_filter(self, user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_a.id, True)  # the newest post

            listed = await posts.get_posts_for_user(user_id, read_state="unread", limit=2)

        assert [post.guid for post in listed] == ["b", "c"]

    @pytest.mark.asyncio
    async def test_before_cursor_paginates_within_a_filter(self, user_id, feed_and_posts):
        _, (post_a, post_b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_b.id, True)

            page = await posts.get_posts_for_user(
                user_id, read_state="unread", before=post_a.published_at
            )

        assert [post.guid for post in page] == ["c"]

    @pytest.mark.asyncio
    async def test_another_users_state_does_not_leak(self, user_id, other_user_id, feed_and_posts):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(other_user_id, post_a.id, True)

            everything = await posts.get_posts_for_user(user_id)
            unread = await posts.get_posts_for_user(user_id, read_state="unread")

        assert [(post.guid, post.is_read) for post in everything] == [
            ("a", False),
            ("b", False),
            ("c", False),
        ]
        assert [post.guid for post in unread] == ["a", "b", "c"]

    @pytest.mark.asyncio
    async def test_a_filtered_list_pages_through_the_service_without_gaps(
        self, user_id, feed_and_posts
    ):
        _, (post_a, _b, _c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await posts.mark_as_read(user_id, post_a.id, True)
            service = PostService(
                post_repository=posts,
                category_repository=SQLAlchemyCategoryRepository(session),
                feed_repository=SQLAlchemyFeedRepository(session),
            )

            first = await service.list_posts(user_id, read_state="unread", limit=1)
            assert ([post.guid for post in first.posts], first.has_more) == (["b"], True)

            second = await service.list_posts(
                user_id,
                read_state="unread",
                limit=1,
                before=datetime.fromisoformat(first.next_cursor),
            )
            assert ([post.guid for post in second.posts], second.has_more) == (["c"], True)

            third = await service.list_posts(
                user_id,
                read_state="unread",
                limit=1,
                before=datetime.fromisoformat(second.next_cursor),
            )
            assert (third.posts, third.has_more) == ([], False)

    @pytest.mark.asyncio
    async def test_progress_does_not_change_the_unread_counts(self, user_id, feed_and_posts):
        feed, (post_a, post_b, post_c) = feed_and_posts
        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await _seed_reading_states(posts, user_id, post_a, post_b, post_c)

            counts = await posts.get_unread_counts_by_feed(user_id)

        # Only the hand-marked post leaves the badge; 40% read and merely opened both stay.
        assert counts == {feed.id: 2}

    @pytest.mark.asyncio
    async def test_reads_user_posts_in_a_single_statement(self, user_id, feed_and_posts):
        _, (post_a, post_b, post_c) = feed_and_posts
        statements: list[str] = []

        def record(_conn, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement)

        async with get_session_factory()() as session:
            posts = SQLAlchemyPostRepository(session)
            await _seed_reading_states(posts, user_id, post_a, post_b, post_c)

            sync_engine = get_engine().sync_engine
            event.listen(sync_engine, "before_cursor_execute", record)
            try:
                await posts.get_posts_for_user(user_id)
            finally:
                event.remove(sync_engine, "before_cursor_execute", record)

        assert sum("user_posts" in statement for statement in statements) == 1
