"""Unit tests for PostService.

TDD: Written FIRST - must FAIL until implementation is complete.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.entities.user_post_state import UserPostState


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
    async def test_list_posts_passes_the_in_progress_filter_through(
        self, mock_post_repository, mock_category_repository, mock_feed_repository
    ):
        """Should hand the in-progress filter to the repository unchanged."""
        from app.application.services.post_service import PostService

        mock_post_repository.get_posts_for_user.return_value = []

        service = PostService(
            post_repository=mock_post_repository,
            category_repository=mock_category_repository,
            feed_repository=mock_feed_repository,
        )

        await service.list_posts(user_id=uuid4(), read_state="in_progress", limit=50)

        call_kwargs = mock_post_repository.get_posts_for_user.call_args[1]
        assert call_kwargs.get("read_state") == "in_progress"

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


class TestPostServiceReadingProgress:
    """Opening a post only records that it was seen; progress is reported separately."""

    @pytest.fixture
    def user_id(self):
        return uuid4()

    @pytest.fixture
    def post(self):
        return Post.create(
            feed_id=uuid4(),
            guid="guid-1",
            title="Title",
            link="https://example.com/1",
            published_at=datetime.now(timezone.utc),
        )

    @pytest.fixture
    def repo(self, post):
        repo = AsyncMock()
        repo.get_by_id.return_value = post
        repo.get_user_post_state.return_value = UserPostState()
        return repo

    @pytest.fixture
    def service(self, repo, post, user_id):
        from app.application.services.post_service import PostService

        feeds = AsyncMock()
        feeds.get_by_id.return_value = MagicMock(id=post.feed_id, user_id=user_id)
        return PostService(
            post_repository=repo, category_repository=AsyncMock(), feed_repository=feeds
        )

    @pytest.mark.asyncio
    async def test_get_post_includes_the_users_reading_state(self, service, repo, post, user_id):
        repo.get_user_post_state.return_value = UserPostState(
            read_progress=0.4, opened_at=datetime.now(timezone.utc)
        )

        result = await service.get_post(user_id, post.id)

        assert result.is_read is False
        assert result.read_progress == 0.4
        assert result.is_seen is True

    @pytest.mark.asyncio
    async def test_get_post_looks_up_the_post_and_the_users_state_by_id(
        self, service, repo, post, user_id
    ):
        await service.get_post(user_id, post.id)

        repo.get_by_id.assert_awaited_once_with(post.id)
        repo.get_user_post_state.assert_awaited_once_with(user_id, post.id)

    @pytest.mark.asyncio
    async def test_open_post_and_record_progress_look_up_the_requested_post(
        self, service, repo, post, user_id
    ):
        repo.record_progress.return_value = UserPostState()

        await service.open_post(user_id, post.id)
        repo.get_by_id.assert_awaited_once_with(post.id)

        repo.get_by_id.reset_mock()
        await service.record_progress(user_id, post.id, 0.5)
        repo.get_by_id.assert_awaited_once_with(post.id)

    @pytest.mark.asyncio
    async def test_open_post_records_the_first_open_without_marking_read(
        self, service, repo, post, user_id
    ):
        result = await service.open_post(user_id, post.id)

        repo.record_opened.assert_awaited_once_with(user_id, post.id)
        repo.mark_as_read.assert_not_called()
        assert result.is_seen is True
        assert result.is_read is False

    @pytest.mark.asyncio
    async def test_open_post_does_not_write_for_an_already_seen_post(
        self, service, repo, post, user_id
    ):
        repo.get_user_post_state.return_value = UserPostState(
            read_progress=0.6, opened_at=datetime.now(timezone.utc)
        )

        result = await service.open_post(user_id, post.id)

        repo.record_opened.assert_not_called()
        assert result.read_progress == 0.6
        assert result.is_seen is True

    @pytest.mark.asyncio
    async def test_open_post_records_the_open_of_a_post_marked_read_by_hand(
        self, service, repo, post, user_id
    ):
        repo.get_user_post_state.return_value = UserPostState(
            is_read=True, read_at=datetime.now(timezone.utc), read_progress=1.0
        )

        result = await service.open_post(user_id, post.id)

        repo.record_opened.assert_awaited_once_with(user_id, post.id)
        assert result.is_read is True
        assert result.is_seen is True

    @pytest.mark.asyncio
    async def test_open_post_rejects_another_users_post(self, service, repo, post):
        from app.application.services.post_service import PostPermissionError

        with pytest.raises(PostPermissionError):
            await service.open_post(uuid4(), post.id)

        repo.record_opened.assert_not_called()

    @pytest.mark.asyncio
    async def test_open_post_raises_for_a_missing_post(self, service, repo, user_id):
        from app.application.services.post_service import PostNotFoundError

        repo.get_by_id.return_value = None

        with pytest.raises(PostNotFoundError):
            await service.open_post(user_id, uuid4())

        repo.record_opened.assert_not_called()

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("progress", "completed"),
        [(0.0, False), (0.949, False), (0.95, True), (1.0, True)],
    )
    async def test_record_progress_completes_at_the_threshold(
        self, service, repo, post, user_id, progress, completed
    ):
        repo.record_progress.return_value = UserPostState()

        await service.record_progress(user_id, post.id, progress)

        repo.record_progress.assert_awaited_once_with(
            user_id, post.id, progress, completed=completed
        )

    @pytest.mark.asyncio
    async def test_record_progress_returns_the_stored_state(self, service, repo, post, user_id):
        read_at = datetime.now(timezone.utc)
        repo.record_progress.return_value = UserPostState(
            is_read=True, read_at=read_at, read_progress=1.0
        )

        result = await service.record_progress(user_id, post.id, 0.97)

        assert result == (True, 1.0, read_at)

    @pytest.mark.asyncio
    async def test_record_progress_rejects_another_users_post(self, service, repo, post):
        from app.application.services.post_service import PostPermissionError

        with pytest.raises(PostPermissionError):
            await service.record_progress(uuid4(), post.id, 0.5)

        repo.record_progress.assert_not_called()

    @pytest.mark.asyncio
    async def test_record_progress_raises_for_a_missing_post(self, service, repo, user_id):
        from app.application.services.post_service import PostNotFoundError

        repo.get_by_id.return_value = None

        with pytest.raises(PostNotFoundError):
            await service.record_progress(user_id, uuid4(), 0.5)

        repo.record_progress.assert_not_called()


class TestPostServiceUnreadCounts:
    """Tests for PostService.get_unread_counts."""

    @pytest.mark.asyncio
    async def test_get_unread_counts_sums_total(self):
        """Returns per-feed / per-category maps, uncategorized, and summed total."""
        from app.application.services.post_service import PostService

        f1, f2, c1 = uuid4(), uuid4(), uuid4()
        post_repo = AsyncMock()
        post_repo.get_unread_counts_by_feed.return_value = {f1: 2, f2: 3}
        post_repo.get_unread_counts_by_category.return_value = ({c1: 4}, 1)

        service = PostService(
            post_repository=post_repo,
            category_repository=AsyncMock(),
            feed_repository=AsyncMock(),
        )

        counts = await service.get_unread_counts(uuid4())

        assert counts.by_feed == {f1: 2, f2: 3}
        assert counts.by_category == {c1: 4}
        assert counts.uncategorized == 1
        assert counts.total == 5

    @pytest.mark.asyncio
    async def test_get_unread_counts_empty(self):
        """With no unread posts every field is empty/zero."""
        from app.application.services.post_service import PostService

        post_repo = AsyncMock()
        post_repo.get_unread_counts_by_feed.return_value = {}
        post_repo.get_unread_counts_by_category.return_value = ({}, 0)

        service = PostService(
            post_repository=post_repo,
            category_repository=AsyncMock(),
            feed_repository=AsyncMock(),
        )

        counts = await service.get_unread_counts(uuid4())

        assert counts.by_feed == {}
        assert counts.by_category == {}
        assert counts.uncategorized == 0
        assert counts.total == 0


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
