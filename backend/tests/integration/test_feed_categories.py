"""Integration tests for the feed <-> category many-to-many relationship.

Exercises the repository layer against a real database to verify that:
- a feed can hold zero or many categories,
- the same category can be applied to many feeds,
- deleting a category keeps its feeds (only the association is removed),
- feed URLs are unique per user.
"""

from uuid import uuid4

import pytest
from sqlalchemy import text

from app.domain.feed_management.entities.category import Category
from app.domain.feed_management.entities.feed import Feed
from app.infrastructure.persistence.database import get_session_factory
from app.infrastructure.persistence.repositories.category_repository import (
    SQLAlchemyCategoryRepository,
)
from app.infrastructure.persistence.repositories.feed_repository import (
    SQLAlchemyFeedRepository,
)


@pytest.fixture
async def user_id():
    """Create an isolated user for the test and clean up afterwards.

    Deleting the user cascades to its categories, feeds and associations.
    """
    uid = uuid4()
    factory = get_session_factory()
    async with factory() as session:
        await session.execute(
            text(
                "INSERT INTO users (id, provider, provider_id, email, name, "
                "timezone, notifications_enabled) "
                "VALUES (:id, 'github', :pid, :email, 'M2M Tester', 'UTC', false)"
            ),
            {"id": uid, "pid": f"m2m-{uid}", "email": f"{uid}@example.com"},
        )
        await session.commit()
    yield uid
    async with factory() as session:
        await session.execute(text("DELETE FROM users WHERE id = :id"), {"id": uid})
        await session.commit()


class TestFeedCategoryManyToMany:
    @pytest.mark.asyncio
    async def test_feed_with_many_categories_and_reassignment(self, user_id):
        factory = get_session_factory()
        async with factory() as session:
            cats = SQLAlchemyCategoryRepository(session)
            feeds = SQLAlchemyFeedRepository(session)

            c1 = await cats.save(Category.create(user_id=user_id, name="Tech", position=1))
            c2 = await cats.save(Category.create(user_id=user_id, name="News", position=2))
            await session.commit()

            # A feed with two categories, plus an uncategorized feed
            f1 = await feeds.save(
                Feed.create(
                    user_id=user_id,
                    url="https://a.example/feed",
                    category_ids=[c1.id, c2.id],
                )
            )
            f2 = await feeds.save(Feed.create(user_id=user_id, url="https://b.example/feed"))
            await session.commit()

            assert set(f1.category_ids) == {c1.id, c2.id}
            assert f2.category_ids == []

            # The same category applies to (only) the feeds that carry it
            in_c1 = await feeds.get_by_category(c1.id)
            assert [x.id for x in in_c1] == [f1.id]
            assert await feeds.count_by_category(c1.id) == 1

            # Reassign f1 to just c2
            f1b = await feeds.save(
                Feed(
                    id=f1.id,
                    user_id=user_id,
                    url="https://a.example/feed",
                    category_ids=[c2.id],
                )
            )
            await session.commit()
            assert f1b.category_ids == [c2.id]
            assert await feeds.count_by_category(c1.id) == 0
            assert await feeds.count_by_category(c2.id) == 1

    @pytest.mark.asyncio
    async def test_deleting_category_keeps_feeds(self, user_id):
        factory = get_session_factory()
        async with factory() as session:
            cats = SQLAlchemyCategoryRepository(session)
            feeds = SQLAlchemyFeedRepository(session)

            c1 = await cats.save(Category.create(user_id=user_id, name="Keep", position=1))
            await session.commit()
            f1 = await feeds.save(
                Feed.create(
                    user_id=user_id,
                    url="https://keep.example/feed",
                    category_ids=[c1.id],
                )
            )
            await session.commit()
            assert f1.category_ids == [c1.id]

            # Deleting the category must NOT delete the feed
            await cats.delete(c1.id)
            await session.commit()

            remaining = await feeds.get_by_user(user_id)
            assert [x.id for x in remaining] == [f1.id]
            assert remaining[0].category_ids == []  # label removed, feed kept

    @pytest.mark.asyncio
    async def test_feed_url_unique_per_user(self, user_id):
        factory = get_session_factory()
        async with factory() as session:
            feeds = SQLAlchemyFeedRepository(session)
            await feeds.save(Feed.create(user_id=user_id, url="https://dup.example/feed"))
            await session.commit()

            assert await feeds.exists_by_url_for_user(user_id, "https://dup.example/feed") is True
            assert await feeds.exists_by_url_for_user(user_id, "https://nope.example/feed") is False
