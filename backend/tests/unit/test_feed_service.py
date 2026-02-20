"""Unit tests for FeedService.

Tests use mock repositories and fetchers to isolate service logic.
"""

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


def _make_category(user_id=None, category_id=None):
    return Category(
        id=category_id or uuid4(),
        user_id=user_id or uuid4(),
        name="Test Category",
        position=0,
    )


def _make_feed(category_id=None, feed_id=None, url="https://example.com/feed.xml"):
    return Feed.create(
        category_id=category_id or uuid4(),
        url=url,
        title="Test Feed",
    )


def _make_service(feed_repo=None, cat_repo=None, fetcher=None, validator=None):
    return FeedService(
        feed_repository=feed_repo or AsyncMock(),
        category_repository=cat_repo or AsyncMock(),
        feed_fetcher=fetcher or AsyncMock(),
        feed_validator=validator or AsyncMock(),
    )


class TestFeedServiceAdd:
    """Tests for FeedService.add_feed()."""

    @pytest.mark.asyncio
    async def test_add_feed_success(self):
        """Should validate URL, fetch metadata, and create feed."""
        user_id = uuid4()
        category_id = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 10
        feed_repo.exists_by_url_in_category.return_value = False
        feed_repo.save.side_effect = lambda f: f

        validator = AsyncMock()
        validator.validate_url.return_value = ValidationResult(
            is_valid=True,
            title="Example Blog",
            description="A blog about examples",
            site_url="https://example.com",
        )

        service = _make_service(feed_repo, cat_repo, validator=validator)
        result = await service.add_feed(user_id, category_id, "https://example.com/feed.xml")

        assert result.url == "https://example.com/feed.xml"
        assert result.title == "Example Blog"
        feed_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_add_feed_validates_url_format(self):
        """Invalid URL format should raise validation error."""
        user_id = uuid4()
        category_id = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 0
        feed_repo.exists_by_url_in_category.return_value = False

        validator = AsyncMock()
        validator.validate_url.side_effect = FeedValidationError("Invalid URL")

        service = _make_service(feed_repo, cat_repo, validator=validator)
        with pytest.raises(FeedValidationError):
            await service.add_feed(user_id, category_id, "not-a-url")

    @pytest.mark.asyncio
    async def test_add_feed_validates_is_rss_atom(self):
        """URL that is not RSS/Atom should raise validation error."""
        user_id = uuid4()
        category_id = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 0
        feed_repo.exists_by_url_in_category.return_value = False

        validator = AsyncMock()
        validator.validate_url.side_effect = FeedValidationError("Not a valid feed")

        service = _make_service(feed_repo, cat_repo, validator=validator)
        with pytest.raises(FeedValidationError):
            await service.add_feed(user_id, category_id, "https://example.com/page.html")

    @pytest.mark.asyncio
    async def test_add_feed_enforces_100_limit(self):
        """Should raise error when user has 100 feeds total (FR-038)."""
        user_id = uuid4()
        category_id = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 100

        service = _make_service(feed_repo, cat_repo)
        with pytest.raises(FeedLimitError):
            await service.add_feed(user_id, category_id, "https://example.com/feed.xml")

    @pytest.mark.asyncio
    async def test_add_feed_duplicate_url_same_category(self):
        """Same URL in same category should raise conflict error."""
        user_id = uuid4()
        category_id = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        feed_repo = AsyncMock()
        feed_repo.count_by_user.return_value = 5
        feed_repo.exists_by_url_in_category.return_value = True

        service = _make_service(feed_repo, cat_repo)
        with pytest.raises(FeedConflictError):
            await service.add_feed(user_id, category_id, "https://example.com/feed.xml")

    @pytest.mark.asyncio
    async def test_add_feed_category_not_found(self):
        """Non-existent category should raise not found error."""
        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = None

        service = _make_service(cat_repo=cat_repo)
        with pytest.raises(CategoryNotFoundError):
            await service.add_feed(uuid4(), uuid4(), "https://example.com/feed.xml")

    @pytest.mark.asyncio
    async def test_add_feed_category_different_user(self):
        """Category belonging to different user should raise permission error."""
        user_id = uuid4()
        other_user_id = uuid4()
        category_id = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(other_user_id, category_id)

        service = _make_service(cat_repo=cat_repo)
        with pytest.raises(FeedPermissionError):
            await service.add_feed(user_id, category_id, "https://example.com/feed.xml")


class TestFeedServiceMove:
    """Tests for FeedService.move_feed()."""

    @pytest.mark.asyncio
    async def test_move_feed_success(self):
        """Should change feed's category_id."""
        user_id = uuid4()
        old_category_id = uuid4()
        new_category_id = uuid4()

        feed = Feed.create(
            category_id=old_category_id, url="https://example.com/feed.xml", title="Feed"
        )
        feed_id = feed.id

        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.save.side_effect = lambda f: f

        cat_repo = AsyncMock()
        cat_repo.get_by_id.side_effect = lambda cid: (
            _make_category(user_id, old_category_id)
            if cid == old_category_id
            else _make_category(user_id, new_category_id)
        )

        service = _make_service(feed_repo, cat_repo)
        result = await service.move_feed(user_id, feed_id, new_category_id)

        assert result.category_id == new_category_id

    @pytest.mark.asyncio
    async def test_move_feed_target_category_not_found(self):
        """Moving to non-existent category should raise error."""
        user_id = uuid4()
        old_category_id = uuid4()

        feed = Feed.create(
            category_id=old_category_id, url="https://example.com/feed.xml", title="Feed"
        )

        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed

        cat_repo = AsyncMock()
        # First call (verify source) succeeds, second call (target) fails
        cat_repo.get_by_id.side_effect = [
            _make_category(user_id, old_category_id),
            None,
        ]

        service = _make_service(feed_repo, cat_repo)
        with pytest.raises(CategoryNotFoundError):
            await service.move_feed(user_id, feed.id, uuid4())

    @pytest.mark.asyncio
    async def test_move_feed_not_found(self):
        """Non-existent feed should raise not found error."""
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = None

        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedNotFoundError):
            await service.move_feed(uuid4(), uuid4(), uuid4())


class TestFeedServiceDelete:
    """Tests for FeedService.delete_feed()."""

    @pytest.mark.asyncio
    async def test_delete_feed_success(self):
        """Should delete feed."""
        user_id = uuid4()
        category_id = uuid4()

        feed = Feed.create(
            category_id=category_id, url="https://example.com/feed.xml", title="Feed"
        )

        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.delete.return_value = True

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        service = _make_service(feed_repo, cat_repo)
        result = await service.delete_feed(user_id, feed.id)

        assert result is True
        feed_repo.delete.assert_called_once_with(feed.id)

    @pytest.mark.asyncio
    async def test_delete_feed_not_found(self):
        """Non-existent feed should raise error."""
        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = None

        service = _make_service(feed_repo=feed_repo)
        with pytest.raises(FeedNotFoundError):
            await service.delete_feed(uuid4(), uuid4())


class TestFeedServiceList:
    """Tests for FeedService.list_feeds()."""

    @pytest.mark.asyncio
    async def test_list_feeds_in_category(self):
        """Should return feeds in specified category."""
        user_id = uuid4()
        category_id = uuid4()

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        feeds = [
            Feed.create(category_id=category_id, url="https://a.com/feed.xml", title="Feed 1"),
            Feed.create(category_id=category_id, url="https://b.com/feed.xml", title="Feed 2"),
        ]
        feed_repo = AsyncMock()
        feed_repo.get_by_category.return_value = feeds

        service = _make_service(feed_repo, cat_repo)
        result = await service.list_feeds_in_category(user_id, category_id)

        assert len(result) == 2
        feed_repo.get_by_category.assert_called_once_with(category_id)


class TestFeedServiceRefresh:
    """Tests for FeedService.refresh_feed()."""

    @pytest.mark.asyncio
    async def test_refresh_feed_fetches_new_posts(self):
        """Should fetch and store new posts from feed."""
        user_id = uuid4()
        category_id = uuid4()

        feed = Feed.create(
            category_id=category_id, url="https://example.com/feed.xml", title="Feed"
        )

        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.save.side_effect = lambda f: f

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        fetcher = AsyncMock()
        fetcher.fetch_posts.return_value = [
            {"guid": "post-1", "title": "New Post 1"},
            {"guid": "post-2", "title": "New Post 2"},
        ]

        service = _make_service(feed_repo, cat_repo, fetcher=fetcher)
        result = await service.refresh_feed(user_id, feed.id)

        assert result.last_fetched_at is not None
        feed_repo.save.assert_called_once()

    @pytest.mark.asyncio
    async def test_refresh_feed_records_error_on_failure(self):
        """Failed fetch should increment error count and store error message."""
        user_id = uuid4()
        category_id = uuid4()

        feed = Feed.create(
            category_id=category_id, url="https://example.com/feed.xml", title="Feed"
        )

        feed_repo = AsyncMock()
        feed_repo.get_by_id.return_value = feed
        feed_repo.save.side_effect = lambda f: f

        cat_repo = AsyncMock()
        cat_repo.get_by_id.return_value = _make_category(user_id, category_id)

        fetcher = AsyncMock()
        fetcher.fetch_posts.side_effect = Exception("Connection timeout")

        service = _make_service(feed_repo, cat_repo, fetcher=fetcher)
        result = await service.refresh_feed(user_id, feed.id)

        assert result.fetch_error_count == 1
        feed_repo.save.assert_called_once()
