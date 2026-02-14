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
    ) -> PostListResult:
        """List posts for a user with optional filters.

        Args:
            user_id: User UUID
            category_id: Optional category filter
            feed_id: Optional feed filter
            read_state: Filter by read state
            before: Cursor for pagination (posts older than this)
            limit: Maximum posts to return (capped at MAX_LIMIT)

        Returns:
            PostListResult with posts and pagination info
        """
        # Cap limit at maximum
        limit = min(limit, self.MAX_LIMIT)
        if limit < 1:
            limit = self.DEFAULT_LIMIT

        # Fetch one extra to determine if there are more
        fetch_limit = limit + 1

        posts = await self._post_repository.get_posts_for_user(
            user_id=user_id,
            category_id=category_id,
            feed_id=feed_id,
            read_state=read_state,
            before=before,
            limit=fetch_limit,
        )

        # Determine if there are more posts
        has_more = len(posts) > limit
        if has_more:
            posts = posts[:limit]

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

        # Verify user has access to this post's feed
        feed = await self._feed_repository.get_by_id(post.feed_id)
        if not feed:
            raise PostNotFoundError(f"Post {post_id} not found")

        category = await self._category_repository.get_by_id(feed.category_id)
        if not category or category.user_id != user_id:
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
