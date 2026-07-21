"""Unit tests for FeedService.

Feeds are owned by the user; categories are optional many-to-many labels.
Tests use mock repositories and fetchers to isolate service logic.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.application.services.feed_service import (
    CategoryNotFoundError,
    FeedConflictError,
    FeedLimitError,
    FeedNotFoundError,
    FeedPermissionError,
    FeedService,
)
from app.domain.feed_management.entities.category import Category
from app.domain.feed_management.entities.feed import Feed
from app.domain.feed_management.services.feed_validator import (
    FeedValidationError,
    ValidationResult,
)
from app.infrastructure.feed_fetcher.feed_fetcher import FeedPost


def _make_category(user_id=None, category_id=None):
    return Category(
        id=category_id or uuid4(),
        user_id=user_id or uuid4(),
        name="Test Category",
        position=0,
    )


def _make_feed(user_id=None, category_ids=None, url="https://example.com/feed.xml"):
    return Feed.create(
        user_id=user_id or uuid4(),
        url=url,
        title="Test Feed",
        category_ids=category_ids or [],
    )


def _make_service(feed_repo=None, cat_repo=None, fetcher=None, validator=None, post_repo=None):
    return FeedService(
        feed_repository=feed_repo or AsyncMock(),
        category_repository=cat_repo or AsyncMock(),
        post_repository=post_repo or AsyncMock(),
        feed_fetcher=fetcher or AsyncMock(),
        feed_validator=validator or AsyncMock(),
    )


def _valid_result():
    return ValidationResult(
        is_valid=True,
        title="Example Blog",
        description="A blog about examples",
        site_url="https://example.com",
    )


def _make_feed_post(guid="p1"):
    return FeedPost(
        guid=guid,
        title=f"Post {guid}",
        content="<p>body</p>",
        summary="A summary",
        author="Author",
        link=f"https://example.com/{guid}",
        published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )


class TestFeedServiceAdd:
    """Tests for FeedService.add_feed()."""

    @pytest.mark.asyncio
    async def test_add_feed_uncategorized(self):
        """A feed can be added with no categories."""
        user_id = uuid4()
        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 0
        feed_repo.exists_by_url_for_user.return_value = False
        feed_repo.save.side_effect = lambda f: f

        validator = AsyncMock()
        validator.validate_url.return_value = _valid_result()

        service = _make_service(feed_repo, validator=validator)
        result = await service.add_feed(user_id, "https://example.com/feed.xml")

        assert result.url == "https://example.com/feed.xml"
        assert result.title == "Example Blog"
        assert result.user_id == user_id
        assert result.category_ids == []
        feed_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_add_feed_with_multiple_categories(self):
        """A feed can be added with several categories, verified for the user."""
        user_id = uuid4()
        c1, c2 = uuid4(), uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.side_effect = lambda cid: _make_category(user_id, cid)

        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 0
        feed_repo.exists_by_url_for_user.return_value = False
        feed_repo.save.side_effect = lambda f: f

        validator = AsyncMock()
        validator.validate_url.return_value = _valid_result()

        service = _make_service(feed_repo, cat_repo, validator=validator)
        result = await service.add_feed(user_id, "https://example.com/feed.xml", [c1, c2])

        assert result.category_ids == [c1, c2]
        feed_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_add_feed_deduplicates_categories(self):
        """Duplicate category ids are collapsed."""
        user_id = uuid4()
        c1 = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.side_effect = lambda cid: _make_category(user_id, cid)

        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 0
        feed_repo.exists_by_url_for_user.return_value = False
        feed_repo.save.side_effect = lambda f: f

        validator = AsyncMock()
        validator.validate_url.return_value = _valid_result()

        service = _make_service(feed_repo, cat_repo, validator=validator)
        result = await service.add_feed(user_id, "https://example.com/feed.xml", [c1, c1])

        assert result.category_ids == [c1]

    @pytest.mark.asyncio
    async def test_add_feed_validates_url(self):
        """Invalid URL / non-feed should raise validation error."""
        user_id = uuid4()
        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 0
        feed_repo.exists_by_url_for_user.return_value = False

        validator = AsyncMock()
        validator.validate_url.side_effect = FeedValidationError("Invalid URL")

        service = _make_service(feed_repo, validator=validator)
        with pytest.raises(FeedValidationError):
            await service.add_feed(user_id, "not-a-url")

    @pytest.mark.asyncio
    async def test_add_feed_enforces_100_limit(self):
        """Should raise error when user has 100 feeds total (FR-038)."""
        user_id = uuid4()
        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 100

        service = _make_service(feed_repo)
        with pytest.raises(FeedLimitError):
            await service.add_feed(user_id, "https://example.com/feed.xml")

    @pytest.mark.asyncio
    async def test_add_feed_duplicate_url_for_user(self):
        """Same URL already subscribed by the user should raise conflict."""
        user_id = uuid4()
        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 5
        feed_repo.exists_by_url_for_user.return_value = True

        service = _make_service(feed_repo)
        with pytest.raises(FeedConflictError):
            await service.add_feed(user_id, "https://example.com/feed.xml")

    @pytest.mark.asyncio
    async def test_add_feed_category_not_found(self):
        """Non-existent category should raise not found error."""
        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = None

        service = _make_service(cat_repo=cat_repo)
        with pytest.raises(CategoryNotFoundError):
            await service.add_feed(uuid4(), "https://example.com/feed.xml", [uuid4()])

    @pytest.mark.asyncio
    async def test_add_feed_does_not_ingest_posts_synchronously(self):
        """Adding a feed must not fetch/save posts inline (that is backgrounded)."""
        user_id = uuid4()
        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 0
        feed_repo.exists_by_url_for_user.return_value = False
        feed_repo.save.side_effect = lambda f: f

        validator = AsyncMock()
        validator.validate_url.return_value = _valid_result()

        fetcher = AsyncMock()
        post_repo = AsyncMock()

        service = _make_service(
            feed_repo, validator=validator, fetcher=fetcher, post_repo=post_repo
        )
        result = await service.add_feed(user_id, "https://example.com/feed.xml")

        assert result.url == "https://example.com/feed.xml"
        feed_repo.save.assert_called_once()
        fetcher.fetch_posts.assert_not_called()
        post_repo.save_many.assert_not_called()

    @pytest.mark.asyncio
    async def test_add_feed_category_different_user(self):
        """Category belonging to a different user should raise permission error."""
        user_id = uuid4()
        other_user_id = uuid4()
        category_id = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(other_user_id, category_id)

        service = _make_service(cat_repo=cat_repo)
        with pytest.raises(FeedPermissionError):
            await service.add_feed(user_id, "https://example.com/feed.xml", [category_id])


class TestFeedServiceSetCategories:
    """Tests for FeedService.set_feed_categories()."""

    @pytest.mark.asyncio
    async def test_set_categories_success(self):
        """Should replace the feed's categories with the given set."""
        user_id = uuid4()
        c1, c2 = uuid4(), uuid4()

        feed = _make_feed(user_id=user_id, category_ids=[c1])
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.save.side_effect = lambda f: f

        cat_repo = AsyncMock()
        cat_repo.get_by_id.side_effect = lambda cid: _make_category(user_id, cid)

        service = _make_service(feed_repo, cat_repo)
        result = await service.set_feed_categories(user_id, feed.id, [c1, c2])

        assert result.category_ids == [c1, c2]
        feed_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_set_categories_empty_makes_uncategorized(self):
        """Passing an empty list removes all categories."""
        user_id = uuid4()
        feed = _make_feed(user_id=user_id, category_ids=[uuid4()])
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.save.side_effect = lambda f: f

        service = _make_service(feed_repo)
        result = await service.set_feed_categories(user_id, feed.id, [])

        assert result.category_ids == []

    @pytest.mark.asyncio
    async def test_set_categories_category_not_found(self):
        """Assigning a non-existent category should raise error."""
        user_id = uuid4()
        feed = _make_feed(user_id=user_id)
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = None

        service = _make_service(feed_repo, cat_repo)
        with pytest.raises(CategoryNotFoundError):
            await service.set_feed_categories(user_id, feed.id, [uuid4()])

    @pytest.mark.asyncio
    async def test_set_categories_feed_not_found(self):
        """Non-existent feed should raise not found error."""
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = None

        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedNotFoundError):
            await service.set_feed_categories(uuid4(), uuid4(), [])

    @pytest.mark.asyncio
    async def test_set_categories_other_users_feed(self):
        """Editing another user's feed should raise permission error."""
        feed = _make_feed(user_id=uuid4())
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed

        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedPermissionError):
            await service.set_feed_categories(uuid4(), feed.id, [])


class TestFeedServiceSetActive:
    """Tests for FeedService.set_feed_active()."""

    @pytest.mark.asyncio
    async def test_pause_feed(self):
        """Setting active=False pauses the feed."""
        user_id = uuid4()
        feed = _make_feed(user_id=user_id)
        assert feed.is_active is True
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.save.side_effect = lambda f: f

        service = _make_service(feed_repo=feed_repo)
        result = await service.set_feed_active(user_id, feed.id, False)

        assert result.is_active is False
        feed_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_resume_feed(self):
        """Setting active=True resumes a paused feed."""
        user_id = uuid4()
        feed = _make_feed(user_id=user_id)
        feed.pause()
        assert feed.is_active is False
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.save.side_effect = lambda f: f

        service = _make_service(feed_repo=feed_repo)
        result = await service.set_feed_active(user_id, feed.id, True)

        assert result.is_active is True

    @pytest.mark.asyncio
    async def test_set_active_feed_not_found(self):
        """Non-existent feed should raise not found error."""
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = None

        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedNotFoundError):
            await service.set_feed_active(uuid4(), uuid4(), False)

    @pytest.mark.asyncio
    async def test_set_active_other_users_feed(self):
        """Pausing another user's feed should raise permission error."""
        feed = _make_feed(user_id=uuid4())
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed

        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedPermissionError):
            await service.set_feed_active(uuid4(), feed.id, False)


class TestFeedServiceGet:
    """Tests for FeedService.get_feed()."""

    @pytest.mark.asyncio
    async def test_get_feed_success(self):
        user_id = uuid4()
        feed = _make_feed(user_id=user_id)
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed

        service = _make_service(feed_repo=feed_repo)
        result = await service.get_feed(user_id, feed.id)
        assert result.id == feed.id

    @pytest.mark.asyncio
    async def test_get_feed_other_user(self):
        feed = _make_feed(user_id=uuid4())
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed

        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedPermissionError):
            await service.get_feed(uuid4(), feed.id)

    @pytest.mark.asyncio
    async def test_get_feed_not_found(self):
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = None
        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedNotFoundError):
            await service.get_feed(uuid4(), uuid4())


class TestFeedServiceDelete:
    """Tests for FeedService.delete_feed()."""

    @pytest.mark.asyncio
    async def test_delete_feed_success(self):
        user_id = uuid4()
        feed = _make_feed(user_id=user_id)
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.delete.return_value = True

        service = _make_service(feed_repo=feed_repo)
        result = await service.delete_feed(user_id, feed.id)

        assert result is True
        feed_repo.delete.assert_called_once_with(feed.id)

    @pytest.mark.asyncio
    async def test_delete_feed_not_found(self):
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = None
        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedNotFoundError):
            await service.delete_feed(uuid4(), uuid4())

    @pytest.mark.asyncio
    async def test_delete_other_users_feed(self):
        feed = _make_feed(user_id=uuid4())
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedPermissionError):
            await service.delete_feed(uuid4(), feed.id)


class TestFeedServiceList:
    """Tests for FeedService listing."""

    @pytest.mark.asyncio
    async def test_list_all_feeds(self):
        user_id = uuid4()
        feeds = [_make_feed(user_id=user_id), _make_feed(user_id=user_id)]
        feed_repo = AsyncMock()
        feed_repo.get_by_user.return_value = feeds

        service = _make_service(feed_repo=feed_repo)
        result = await service.list_all_feeds(user_id)
        assert len(result) == 2
        feed_repo.get_by_user.assert_called_once_with(user_id)

    @pytest.mark.asyncio
    async def test_list_feeds_in_category(self):
        user_id = uuid4()
        category_id = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        feeds = [_make_feed(user_id=user_id, category_ids=[category_id])]
        feed_repo = AsyncMock()
        feed_repo.get_by_category.return_value = feeds

        service = _make_service(feed_repo, cat_repo)
        result = await service.list_feeds_in_category(user_id, category_id)

        assert len(result) == 1
        feed_repo.get_by_category.assert_called_once_with(category_id)

    @pytest.mark.asyncio
    async def test_list_feeds_in_category_other_user(self):
        """Listing feeds in another user's category should raise permission error."""
        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(uuid4(), uuid4())

        service = _make_service(cat_repo=cat_repo)
        with pytest.raises(FeedPermissionError):
            await service.list_feeds_in_category(uuid4(), uuid4())


class TestFeedServiceIngest:
    """Tests for FeedService.ingest_feed() (the background ingestion op)."""

    @pytest.mark.asyncio
    async def test_ingest_feed_saves_posts(self):
        feed = _make_feed()
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.save.side_effect = lambda f: f

        fetcher = AsyncMock()
        fetcher.fetch_posts.return_value = [_make_feed_post("p1"), _make_feed_post("p2")]

        post_repo = AsyncMock()
        post_repo.save_many.side_effect = lambda posts: posts

        service = _make_service(feed_repo, fetcher=fetcher, post_repo=post_repo)
        count = await service.ingest_feed(feed.id)

        assert count == 2
        post_repo.save_many.assert_called_once()
        assert feed.last_fetched_at is not None
        feed_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_ingest_feed_records_error(self):
        feed = _make_feed()
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.save.side_effect = lambda f: f

        fetcher = AsyncMock()
        fetcher.fetch_posts.side_effect = Exception("Connection timeout")

        service = _make_service(feed_repo, fetcher=fetcher)
        count = await service.ingest_feed(feed.id)

        assert count == 0
        assert feed.fetch_error_count == 1
        feed_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_ingest_feed_missing_feed_is_noop(self):
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = None

        service = _make_service(feed_repo)
        count = await service.ingest_feed(uuid4())

        assert count == 0
        feed_repo.save.assert_not_called()
