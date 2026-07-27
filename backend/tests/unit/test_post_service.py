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
        mock_feed = MagicMock(
            id=feed_id, title="Test Feed", icon_url="https://example.com/icon.png"
        )
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


class TestPostServiceReadState:
    """Tests for PostService read state methods."""

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
    async def test_mark_as_read_updates_read_state(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should mark post as read via repository."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        post_id = uuid4()
        feed_id = uuid4()
        category_id = uuid4()

        # Setup mocks
        mock_post = MagicMock(
            id=post_id,
            feed_id=feed_id,
            is_read=False,
        )
        mock_feed = MagicMock(id=feed_id, user_id=user_id)
        mock_category = MagicMock(id=category_id, user_id=user_id)

        mock_post_repository.get_by_id.return_value = mock_post
        mock_feed_repository.get_by_id.return_value = mock_feed
        mock_category_repository.get_by_id.return_value = mock_category
        mock_post_repository.get_read_state.return_value = (True, datetime.now(timezone.utc))

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        is_read, read_at = await service.mark_as_read(user_id, post_id, True)

        assert is_read is True
        assert read_at is not None
        mock_post_repository.mark_as_read.assert_called_once_with(user_id, post_id, True)

    @pytest.mark.asyncio
    async def test_mark_as_unread(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should mark post as unread via repository."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        post_id = uuid4()
        feed_id = uuid4()
        category_id = uuid4()

        # Setup mocks
        mock_post = MagicMock(id=post_id, feed_id=feed_id, is_read=True)
        mock_feed = MagicMock(id=feed_id, user_id=user_id)
        mock_category = MagicMock(id=category_id, user_id=user_id)

        mock_post_repository.get_by_id.return_value = mock_post
        mock_feed_repository.get_by_id.return_value = mock_feed
        mock_category_repository.get_by_id.return_value = mock_category
        mock_post_repository.get_read_state.return_value = (False, None)

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        is_read, read_at = await service.mark_as_read(user_id, post_id, False)

        assert is_read is False
        assert read_at is None
        mock_post_repository.mark_as_read.assert_called_once_with(user_id, post_id, False)

    @pytest.mark.asyncio
    async def test_mark_as_read_post_not_found(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should raise PostNotFoundError when post doesn't exist."""
        from app.application.services.post_service import PostService, PostNotFoundError

        user_id = uuid4()
        post_id = uuid4()

        mock_post_repository.get_by_id.return_value = None

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        with pytest.raises(PostNotFoundError):
            await service.mark_as_read(user_id, post_id, True)

    @pytest.mark.asyncio
    async def test_mark_as_read_other_user_post(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should raise PostPermissionError when accessing other user's post."""
        from app.application.services.post_service import PostService, PostPermissionError

        user_id = uuid4()
        other_user_id = uuid4()
        post_id = uuid4()
        feed_id = uuid4()
        category_id = uuid4()

        # Setup mocks - category belongs to another user
        mock_post = MagicMock(id=post_id, feed_id=feed_id)
        mock_feed = MagicMock(id=feed_id, user_id=other_user_id)
        mock_category = MagicMock(id=category_id, user_id=other_user_id)

        mock_post_repository.get_by_id.return_value = mock_post
        mock_feed_repository.get_by_id.return_value = mock_feed
        mock_category_repository.get_by_id.return_value = mock_category

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        with pytest.raises(PostPermissionError):
            await service.mark_as_read(user_id, post_id, True)

    @pytest.mark.asyncio
    async def test_auto_mark_read_only_marks_unread_posts(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should only mark as read if post is currently unread."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        post_id = uuid4()

        # Post is already read
        mock_post_repository.get_read_state.return_value = (True, datetime.now(timezone.utc))

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.auto_mark_read(user_id, post_id)

        # Should NOT call mark_as_read since already read
        mock_post_repository.mark_as_read.assert_not_called()

    @pytest.mark.asyncio
    async def test_auto_mark_read_marks_unread_post(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should mark as read if post is currently unread."""
        from app.application.services.post_service import PostService

        user_id = uuid4()
        post_id = uuid4()

        # Post is unread
        mock_post_repository.get_read_state.return_value = (False, None)

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.auto_mark_read(user_id, post_id)

        # Should call mark_as_read
        mock_post_repository.mark_as_read.assert_called_once_with(user_id, post_id, True)


class TestPostServiceUnreadCounts:
    """Tests for PostService.get_unread_counts."""

    @pytest.mark.asyncio
    async def test_get_unread_counts_sums_total(self):
        """Should return the per-feed map and the summed total."""
        from app.application.services.post_service import PostService

        f1, f2 = uuid4(), uuid4()
        post_repo = AsyncMock()
        post_repo.get_unread_counts_by_feed.return_value = {f1: 2, f2: 3}

        service = PostService(
            post_repository=post_repo,
            category_repository=AsyncMock(),
            feed_repository=AsyncMock(),
        )

        by_feed, total = await service.get_unread_counts(uuid4())

        assert by_feed == {f1: 2, f2: 3}
        assert total == 5

    @pytest.mark.asyncio
    async def test_get_unread_counts_empty(self):
        """With no unread posts the total is zero."""
        from app.application.services.post_service import PostService

        post_repo = AsyncMock()
        post_repo.get_unread_counts_by_feed.return_value = {}

        service = PostService(
            post_repository=post_repo,
            category_repository=AsyncMock(),
            feed_repository=AsyncMock(),
        )

        by_feed, total = await service.get_unread_counts(uuid4())

        assert by_feed == {}
        assert total == 0


class TestPostServiceMarkAllRead:
    """Tests for PostService.mark_all_read."""

    @pytest.mark.asyncio
    async def test_delegates_category_scope_to_repository(self):
        """Should forward a category scope and return the affected count."""
        from app.application.services.post_service import PostService

        post_repo = AsyncMock()
        post_repo.mark_all_read.return_value = 7
        service = PostService(
            post_repository=post_repo,
            category_repository=AsyncMock(),
            feed_repository=AsyncMock(),
        )

        user_id = uuid4()
        category_id = uuid4()
        count = await service.mark_all_read(user_id, True, category_id=category_id)

        assert count == 7
        post_repo.mark_all_read.assert_awaited_once_with(
            user_id, True, category_id=category_id, feed_id=None, uncategorized=False
        )

    @pytest.mark.asyncio
    async def test_delegates_uncategorized_scope(self):
        """Should forward an uncategorized scope."""
        from app.application.services.post_service import PostService

        post_repo = AsyncMock()
        post_repo.mark_all_read.return_value = 0
        service = PostService(
            post_repository=post_repo,
            category_repository=AsyncMock(),
            feed_repository=AsyncMock(),
        )

        user_id = uuid4()
        await service.mark_all_read(user_id, False, uncategorized=True)

        post_repo.mark_all_read.assert_awaited_once_with(
            user_id, False, category_id=None, feed_id=None, uncategorized=True
        )
