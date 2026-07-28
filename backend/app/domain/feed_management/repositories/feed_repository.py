"""Feed repository interface."""

from abc import ABC, abstractmethod
from uuid import UUID

from app.domain.feed_management.entities.feed import Feed


class FeedRepository(ABC):
    """Abstract repository interface for Feed entities.

    Implementations handle persistence details (e.g., SQLAlchemy).
    """

    @abstractmethod
    async def get_by_id(self, id: UUID) -> Feed | None:
        """Get a feed by its ID.

        Args:
            id: The feed's UUID

        Returns:
            Feed if found, None otherwise
        """
        ...

    @abstractmethod
    async def get_by_category(self, category_id: UUID) -> list[Feed]:
        """Get all feeds in a category.

        Args:
            category_id: The category's UUID

        Returns:
            List of feeds in the category
        """
        ...

    @abstractmethod
    async def get_by_user(self, user_id: UUID) -> list[Feed]:
        """Get all feeds for a user across all categories.

        Args:
            user_id: The user's UUID

        Returns:
            List of all user's feeds
        """
        ...

    @abstractmethod
    async def get_uncategorized(self, user_id: UUID) -> list[Feed]:
        """Get all feeds owned by a user that have no category labels.

        Args:
            user_id: The user's UUID

        Returns:
            List of the user's feeds that are not in any category
        """
        ...

    @abstractmethod
    async def count_by_user(self, user_id: UUID) -> int:
        """Count total feeds for a user across all categories.

        Args:
            user_id: The user's UUID

        Returns:
            Total number of feeds owned by user
        """
        ...

    @abstractmethod
    async def count_by_category(self, category_id: UUID) -> int:
        """Count feeds in a specific category.

        Args:
            category_id: The category's UUID

        Returns:
            Number of feeds in the category
        """
        ...

    @abstractmethod
    async def exists_by_url_for_user(self, user_id: UUID, url: str) -> bool:
        """Check if a feed with the given URL exists for the user anywhere.

        Args:
            user_id: The user's UUID
            url: Feed URL to check

        Returns:
            True if URL exists for user, False otherwise
        """
        ...

    @abstractmethod
    async def save(self, feed: Feed) -> Feed:
        """Save a feed (create or update).

        Args:
            feed: The feed to save

        Returns:
            The saved feed with any updated fields
        """
        ...

    @abstractmethod
    async def delete(self, id: UUID) -> bool:
        """Delete a feed by ID.

        Note: This cascades to delete all posts from the feed.

        Args:
            id: The feed's UUID

        Returns:
            True if deleted, False if not found
        """
        ...
