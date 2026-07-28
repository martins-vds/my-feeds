"""PostService application service for post operations."""

from dataclasses import dataclass
from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.repositories.category_repository import CategoryRepository
from app.domain.feed_management.repositories.feed_repository import FeedRepository
from app.domain.feed_management.repositories.post_repository import PostRepository

ReadState = Literal["all", "unread", "read"]


class PostNotFoundError(Exception):
    """Raised when a post is not found."""

    pass


class PostPermissionError(Exception):
    """Raised when user doesn't have permission to access a post."""

    pass


@dataclass
class PostListResult:
    """Result of listing posts with pagination info."""

    posts: List[Post]
    has_more: bool
    next_cursor: Optional[str] = None


@dataclass
class UnreadCounts:
    """Unread post counts for a user, grouped for the sidebar."""

    by_feed: dict[UUID, int]
    by_category: dict[UUID, int]
    uncategorized: int
    total: int


class PostService:
    """Application service for post-related operations.

    Handles listing, filtering, and managing post read state.
    """

    MAX_LIMIT = 100
    DEFAULT_LIMIT = 50

    def __init__(
        self,
        post_repository: PostRepository,
        category_repository: CategoryRepository,
        feed_repository: FeedRepository,
    ):
        """Initialize PostService with repositories.

        Args:
            post_repository: Repository for post persistence
            category_repository: Repository for category access
            feed_repository: Repository for feed access
        """
        self._post_repository = post_repository
        self._category_repository = category_repository
        self._feed_repository = feed_repository

    async def list_posts(
        self,
        user_id: UUID,
        *,
        category_id: Optional[UUID] = None,
        feed_id: Optional[UUID] = None,
        read_state: ReadState = "all",
        before: Optional[datetime] = None,
        limit: int = DEFAULT_LIMIT,
        uncategorized: bool = False,
    ) -> PostListResult:
        """List posts for a user with optional filters.

        Args:
            user_id: User UUID
            category_id: Optional category filter
            feed_id: Optional feed filter
            read_state: Filter by read state
            before: Cursor for pagination (posts older than this)
            limit: Maximum posts to return (capped at MAX_LIMIT)
            uncategorized: If True, only posts from feeds with no categories

        Returns:
            PostListResult with posts and pagination info
        """
        # Cap limit at maximum
        limit = min(limit, self.MAX_LIMIT)
        if limit < 1:
            limit = self.DEFAULT_LIMIT

        posts = await self._post_repository.get_posts_for_user(
            user_id=user_id,
            category_id=category_id,
            feed_id=feed_id,
            read_state=read_state,
            before=before,
            limit=limit,
            uncategorized=uncategorized,
        )

        # Determine if there are more posts
        has_more = len(posts) >= limit

        # Calculate next cursor (ISO timestamp of last post)
        next_cursor = None
        if has_more and posts:
            next_cursor = posts[-1].published_at.isoformat()

        return PostListResult(
            posts=posts,
            has_more=has_more,
            next_cursor=next_cursor,
        )

    async def get_post(self, user_id: UUID, post_id: UUID) -> Post:
        """Get a single post by ID.

        Verifies that the post belongs to a feed the user is subscribed to.

        Args:
            user_id: User UUID
            post_id: Post UUID

        Returns:
            Post with full content

        Raises:
            PostNotFoundError: If post doesn't exist
            PostPermissionError: If user doesn't have access
        """
        post = await self._post_repository.get_by_id(post_id)
        if not post:
            raise PostNotFoundError(f"Post {post_id} not found")

        # Verify the post's feed belongs to the user
        feed = await self._feed_repository.get_by_id(post.feed_id)
        if not feed:
            raise PostNotFoundError(f"Post {post_id} not found")

        if feed.user_id != user_id:
            raise PostPermissionError("You don't have access to this post")

        # Get read state
        is_read, _ = await self._post_repository.get_read_state(user_id, post_id)
        post.is_read = is_read

        return post

    async def mark_as_read(
        self, user_id: UUID, post_id: UUID, is_read: bool = True
    ) -> tuple[bool, Optional[datetime]]:
        """Mark a post as read or unread.

        Args:
            user_id: User UUID
            post_id: Post UUID
            is_read: Read state to set

        Returns:
            Tuple of (is_read, read_at)

        Raises:
            PostNotFoundError: If post doesn't exist
            PostPermissionError: If user doesn't have access
        """
        # Verify access first
        post = await self.get_post(user_id, post_id)

        # Update read state
        await self._post_repository.mark_as_read(user_id, post_id, is_read)

        # Return updated state
        return await self._post_repository.get_read_state(user_id, post_id)

    async def auto_mark_read(self, user_id: UUID, post_id: UUID) -> None:
        """Auto-mark a post as read when viewing.

        Args:
            user_id: User UUID
            post_id: Post UUID
        """
        # Only mark if not already read
        is_read, _ = await self._post_repository.get_read_state(user_id, post_id)
        if not is_read:
            await self._post_repository.mark_as_read(user_id, post_id, True)

    async def get_unread_counts(self, user_id: UUID) -> UnreadCounts:
        """Get unread post counts (per feed, per category, uncategorized, total).

        Args:
            user_id: User UUID

        Returns:
            UnreadCounts with by_feed / by_category maps, an uncategorized count,
            and the overall total (the sum of the per-feed counts).
        """
        by_feed = await self._post_repository.get_unread_counts_by_feed(user_id)
        by_category, uncategorized = await self._post_repository.get_unread_counts_by_category(
            user_id
        )
        total = sum(by_feed.values())
        return UnreadCounts(
            by_feed=by_feed,
            by_category=by_category,
            uncategorized=uncategorized,
            total=total,
        )

    async def mark_all_read(
        self,
        user_id: UUID,
        is_read: bool,
        *,
        category_id: Optional[UUID] = None,
        feed_id: Optional[UUID] = None,
        uncategorized: bool = False,
    ) -> int:
        """Mark all posts in a scope (category / feed / uncategorized) read/unread.

        The scope is always limited to the user's own feeds, so it silently
        affects nothing for feeds or categories the user doesn't own.

        Returns:
            The number of posts in the scope.
        """
        return await self._post_repository.mark_all_read(
            user_id,
            is_read,
            category_id=category_id,
            feed_id=feed_id,
            uncategorized=uncategorized,
        )
