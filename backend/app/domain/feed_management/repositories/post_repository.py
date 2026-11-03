"""PostRepository abstract base class."""

from abc import ABC, abstractmethod
from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.entities.user_post_state import UserPostState


ReadState = Literal["all", "unread", "in_progress", "read"]


class PostRepository(ABC):
    """Abstract base class for Post persistence.

    Defines the interface for Post storage operations.
    Implementations should handle database-specific logic.
    """

    @abstractmethod
    async def get_by_id_for_user(self, post_id: UUID, user_id: UUID) -> Optional[Post]:
        """Return a post only when its feed belongs to the requesting user."""
        pass

    @abstractmethod
    async def get_by_id(self, id: UUID) -> Optional[Post]:
        """Get a post by its ID.

        Args:
            id: Post UUID

        Returns:
            Post if found, None otherwise
        """
        pass

    @abstractmethod
    async def get_posts_for_user(
        self,
        user_id: UUID,
        *,
        category_id: Optional[UUID] = None,
        feed_id: Optional[UUID] = None,
        read_state: ReadState = "all",
        before: Optional[datetime] = None,
        limit: int = 50,
        uncategorized: bool = False,
    ) -> List[Post]:
        """Get posts for a user with optional filters.

        Args:
            user_id: User UUID (for filtering to their subscribed feeds)
            category_id: Optional category filter
            feed_id: Optional feed filter
            read_state: Filter by read state ("all", "unread", "in_progress", "read");
                "in_progress" means not read yet but with some reading progress
            before: Cursor for pagination (posts older than this)
            limit: Maximum posts to return
            uncategorized: If True, only posts from feeds with no categories

        Returns:
            List of Post entities with is_read, read_progress, is_seen and has_audio populated
        """
        pass

    @abstractmethod
    async def get_by_feed(
        self,
        feed_id: UUID,
        *,
        limit: int = 100,
    ) -> List[Post]:
        """Get posts for a specific feed.

        Args:
            feed_id: Feed UUID
            limit: Maximum posts to return

        Returns:
            List of Post entities
        """
        pass

    @abstractmethod
    async def exists_by_guid(self, feed_id: UUID, guid: str) -> bool:
        """Check if a post with the given GUID exists in the feed.

        Args:
            feed_id: Feed UUID
            guid: Post GUID from feed

        Returns:
            True if exists, False otherwise
        """
        pass

    @abstractmethod
    async def save(self, post: Post) -> Post:
        """Save a post (create or update).

        Args:
            post: Post entity to save

        Returns:
            Saved Post entity with any generated fields
        """
        pass

    @abstractmethod
    async def save_many(self, posts: List[Post]) -> List[Post]:
        """Save multiple posts efficiently.

        Args:
            posts: List of Post entities to save

        Returns:
            List of saved Post entities
        """
        pass

    @abstractmethod
    async def delete(self, id: UUID) -> bool:
        """Delete a post by ID.

        Args:
            id: Post UUID

        Returns:
            True if deleted, False if not found
        """
        pass

    @abstractmethod
    async def delete_old_posts(self, older_than: datetime) -> int:
        """Delete posts older than a given date.

        Used for cleanup per FR-032 (90-day retention).

        Args:
            older_than: Delete posts published before this date

        Returns:
            Number of posts deleted
        """
        pass

    @abstractmethod
    async def mark_as_read(self, user_id: UUID, post_id: UUID, is_read: bool = True) -> None:
        """Mark a post as read/unread for a user.

        Creates UserPost record if it doesn't exist. Marking read sets the progress to
        1.0; marking unread resets it to 0.0. ``opened_at`` is left alone either way.

        Args:
            user_id: User UUID
            post_id: Post UUID
            is_read: Read state to set
        """
        pass

    @abstractmethod
    async def get_read_state(self, user_id: UUID, post_id: UUID) -> tuple[bool, Optional[datetime]]:
        """Get read state for a specific post and user.

        Args:
            user_id: User UUID
            post_id: Post UUID

        Returns:
            Tuple of (is_read, read_at timestamp)
        """
        pass

    @abstractmethod
    async def record_opened(self, user_id: UUID, post_id: UUID) -> None:
        """Remember that the user opened a post.

        Creates the UserPost row when it is missing and sets ``opened_at`` only
        while it is still NULL. Never changes the read state or the progress.

        Args:
            user_id: User UUID
            post_id: Post UUID
        """
        pass

    @abstractmethod
    async def record_progress(
        self, user_id: UUID, post_id: UUID, progress: float, *, completed: bool
    ) -> UserPostState:
        """Record reading progress for a post and return the resulting state.

        Progress only ever moves forward (a monotonic maximum). ``completed``
        flips the post to read at 100%. A post that is already read stays read
        and keeps its ``read_at``. ``opened_at`` is set while it is still NULL.

        Args:
            user_id: User UUID
            post_id: Post UUID
            progress: Reading position from 0.0 to 1.0
            completed: Whether this report crosses the completion threshold

        Returns:
            The user's state for the post after the write
        """
        pass

    @abstractmethod
    async def get_user_post_state(self, user_id: UUID, post_id: UUID) -> UserPostState:
        """Get a user's read state, progress and opened time for a post.

        Returns the untouched default state when the user has no row for it.

        Args:
            user_id: User UUID
            post_id: Post UUID
        """
        pass

    @abstractmethod
    async def get_unread_counts_by_feed(self, user_id: UUID) -> dict[UUID, int]:
        """Get the number of unread posts per feed for a user.

        A post is unread if the user has no UserPost row for it, or the row's
        ``is_read`` is False. Feeds with zero unread posts are omitted.

        Args:
            user_id: User UUID

        Returns:
            Mapping of feed UUID to unread post count.
        """
        pass

    @abstractmethod
    async def get_unread_counts_by_category(self, user_id: UUID) -> tuple[dict[UUID, int], int]:
        """Get unread post counts grouped by category, plus an uncategorized total.

        A feed in several categories contributes its unread count to each of
        them. The second tuple element is the unread count across feeds that
        have no category at all.

        Returns:
            Tuple of (mapping category_id -> unread count, uncategorized count).
        """
        ...

    @abstractmethod
    async def mark_all_read(
        self,
        user_id: UUID,
        is_read: bool,
        *,
        category_id: Optional[UUID] = None,
        feed_id: Optional[UUID] = None,
        uncategorized: bool = False,
    ) -> int:
        """Mark every post in a scope read/unread for a user.

        The scope is limited to the user's own feeds and narrowed by exactly
        one of ``category_id``, ``feed_id``, or ``uncategorized`` (or none, for
        all posts).

        Args:
            user_id: User UUID
            is_read: Read state to set
            category_id: Restrict to a category
            feed_id: Restrict to a single feed
            uncategorized: Restrict to feeds with no categories

        Returns:
            Number of posts in the scope.
        """
        pass
