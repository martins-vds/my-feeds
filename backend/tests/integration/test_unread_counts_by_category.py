"""Integration tests for per-category unread counts (repository layer)."""

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import text

from app.domain.feed_management.entities.category import Category
from app.domain.feed_management.entities.feed import Feed
from app.domain.feed_management.entities.post import Post
from app.infrastructure.persistence.database import get_session_factory
from app.infrastructure.persistence.repositories.category_repository import (
    SQLAlchemyCategoryRepository,
)
from app.infrastructure.persistence.repositories.feed_repository import (
    SQLAlchemyFeedRepository,
)
from app.infrastructure.persistence.repositories.post_repository import (
    SQLAlchemyPostRepository,
)


@pytest.fixture
async def user_id():
    """Create an isolated user; deleting it cascades to feeds/posts/categories."""
    uid = uuid4()
    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, provider, provider_id, email, name, "
                "timezone, notifications_enabled) "
                "VALUES (:id, 'github', :pid, :email, 'Unread Tester', 'UTC', false)"
            ),
            {"id": uid, "pid": f"unread-{uid}", "email": f"{uid}@example.com"},
        )
        await session.commit()
    yield uid
    async with factory() as session:
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": uid})
        await session.commit()


def _post(feed_id, guid):
    return Post.create(
        feed_id=feed_id,
        guid=guid,
        title=f"Post {guid}",
        link=f"https://example.com/{guid}",
        published_at=datetime.now(timezone.utc),
    )


class TestUnreadCountsByCategory:
    @pytest.mark.asyncio
    async def test_counts_group_by_category_and_uncategorized(self, user_id):
        factory = get_session_factory()
        async with factory() as session:
            cats = SQLAlchemyCategoryRepository(session)
            feeds = SQLAlchemyFeedRepository(session)
            posts = SQLAlchemyPostRepository(session)

            c1 = await cats.save(Category.create(user_id=user_id, name="Tech", position=1))
            c2 = await cats.save(Category.create(user_id=user_id, name="News", position=2))
            await session.commit()

            # f1 in c1 & c2 (shared), f2 in c1 only, f3 uncategorized
            f1 = await feeds.save(
                Feed.create(user_id=user_id, url="https://a/f", category_ids=[c1.id, c2.id])
            )
            f2 = await feeds.save(
                Feed.create(user_id=user_id, url="https://b/f", category_ids=[c1.id])
            )
            f3 = await feeds.save(Feed.create(user_id=user_id, url="https://c/f"))
            await session.commit()

            # f1: 2 posts (1 later marked read → unread 1); f2: 1 unread; f3: 3 unread
            await posts.save(_post(f1.id, "f1a"))
            p1b = await posts.save(_post(f1.id, "f1b"))
            await posts.save(_post(f2.id, "f2a"))
            await posts.save(_post(f3.id, "f3a"))
            await posts.save(_post(f3.id, "f3b"))
            await posts.save(_post(f3.id, "f3c"))
            await session.commit()

            await posts.mark_as_read(user_id, p1b.id, True)
            await session.commit()

            by_category, uncategorized = await posts.get_unread_counts_by_category(user_id)

            assert by_category[c1.id] == 2   # f1(1) + f2(1)
            assert by_category[c2.id] == 1   # f1(1)
            assert uncategorized == 3        # f3(3)
