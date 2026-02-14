"""Unit tests for PostService.

TDD: Written FIRST - must FAIL until implementation is complete.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4


class TestPostServiceListPosts:
    """Tests for PostService.list_posts method."""

    @pytest.fixture
    def mock_post_repository(self):
        """Create a mock PostRepository."""
        return AsyncMock()

    @pytest.fixture
    def mock_category_repository(self):
        """Create a mock CategoryRepository."""
        return AsyncMock()

    @pytest.fixture
    def mock_feed_repository(self):
        """Create a mock FeedRepository."""
        return AsyncMock()

    @pytest.mark.asyncio
    async def test_list_posts_returns_paginated_posts(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should return posts with pagination info."""
        # This test will fail until PostService is implemented
        from app.application.services.post_service import PostService

        user_id = uuid4()
        mock_posts = [
            MagicMock(
                id=uuid4(),
                feed_id=uuid4(),
                title="Post 1",
                summary="Summary 1",
                published_at=datetime.now(timezone.utc),
            ),
            MagicMock(
                id=uuid4(),
                feed_id=uuid4(),
                title="Post 2",
                summary="Summary 2",
                published_at=datetime.now(timezone.utc),
            ),
        ]
        mock_post_repository.get_posts_for_user.return_value = mock_posts

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        result = await service.list_posts(user_id=user_id, limit=50)

        assert result is not None
        mock_post_repository.get_posts_for_user.assert_called_once()

    @pytest.mark.asyncio
    async def test_list_posts_filters_by_category(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should filter posts by category when category_id provided."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        category_id = uuid4()
        mock_post_repository.get_posts_for_user.return_value = []

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.list_posts(user_id=user_id, category_id=category_id, limit=50)

        # Repository should be called with category filter
        call_kwargs = mock_post_repository.get_posts_for_user.call_args[1]
        assert call_kwargs.get("category_id") == category_id

    @pytest.mark.asyncio
    async def test_list_posts_filters_by_feed(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should filter posts by feed when feed_id provided."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        feed_id = uuid4()
        mock_post_repository.get_posts_for_user.return_value = []

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.list_posts(user_id=user_id, feed_id=feed_id, limit=50)

        # Repository should be called with feed filter
        call_kwargs = mock_post_repository.get_posts_for_user.call_args[1]
        assert call_kwargs.get("feed_id") == feed_id

    @pytest.mark.asyncio
    async def test_list_posts_filters_by_read_state(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should filter posts by read state when specified."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        mock_post_repository.get_posts_for_user.return_value = []

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.list_posts(user_id=user_id, read_state="unread", limit=50)

        # Repository should be called with read state filter
        call_kwargs = mock_post_repository.get_posts_for_user.call_args[1]
        assert call_kwargs.get("read_state") == "unread"

    @pytest.mark.asyncio
    async def test_list_posts_paginates_with_cursor(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should use cursor for pagination when before provided."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        before = datetime.now(timezone.utc)
        mock_post_repository.get_posts_for_user.return_value = []

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.list_posts(user_id=user_id, before=before, limit=50)

        # Repository should be called with cursor
        call_kwargs = mock_post_repository.get_posts_for_user.call_args[1]
        assert call_kwargs.get("before") == before

    @pytest.mark.asyncio
    async def test_list_posts_caps_limit_at_100(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should cap limit at 100 even if larger value requested."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        mock_post_repository.get_posts_for_user.return_value = []

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.list_posts(user_id=user_id, limit=200)

        # Repository should be called with capped limit
        call_kwargs = mock_post_repository.get_posts_for_user.call_args[1]
        assert call_kwargs.get("limit") <= 100

    @pytest.mark.asyncio
    async def test_list_posts_includes_feed_metadata(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should include feed title and icon in post summaries."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        feed_id = uuid4()
        mock_feed = MagicMock(id=feed_id, title="Test Feed", icon_url="https://example.com/icon.png")
        mock_post = MagicMock(
            id=uuid4(),
            feed_id=feed_id,
            title="Test Post",
            summary="Summary",
            published_at=datetime.now(timezone.utc),
            is_read=False,
        )
        mock_post_repository.get_posts_for_user.return_value = [mock_post]
        mock_feed_repository.get_by_id.return_value = mock_feed

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        result = await service.list_posts(user_id=user_id, limit=50)

        # Posts should include feed metadata
        assert len(result.posts) > 0
