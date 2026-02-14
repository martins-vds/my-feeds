"""Category repository interface."""

from abc import ABC, abstractmethod
from uuid import UUID

from app.domain.feed_management.entities.category import Category


class CategoryRepository(ABC):
    """Abstract repository interface for Category entities.

    Implementations handle persistence details (e.g., SQLAlchemy).
    """

    @abstractmethod
    async def get_by_id(self, id: UUID) -> Category | None:
        """Get a category by its ID.

        Args:
            id: The category's UUID

        Returns:
            Category if found, None otherwise
        """
        ...

    @abstractmethod
    async def get_by_user(self, user_id: UUID) -> list[Category]:
        """Get all categories for a user, ordered by position.

        Args:
            user_id: The user's UUID

        Returns:
            List of categories ordered by position
        """
        ...

    @abstractmethod
    async def get_by_user_and_name(self, user_id: UUID, name: str) -> Category | None:
        """Get a category by user and name.

        Args:
            user_id: The user's UUID
            name: Category name (case-insensitive match)

        Returns:
            Category if found, None otherwise
        """
        ...

    @abstractmethod
    async def count_by_user(self, user_id: UUID) -> int:
        """Count categories for a user.

        Args:
            user_id: The user's UUID

        Returns:
            Number of categories owned by user
        """
        ...

    @abstractmethod
    async def get_max_position(self, user_id: UUID) -> int:
        """Get the maximum position value for a user's categories.

        Args:
            user_id: The user's UUID

        Returns:
            Maximum position value, or -1 if user has no categories
        """
        ...

    @abstractmethod
    async def exists_by_name(self, user_id: UUID, name: str, exclude_id: UUID | None = None) -> bool:
        """Check if a category with the given name exists for the user.

        Args:
            user_id: The user's UUID
            name: Category name to check (case-insensitive)
            exclude_id: Optional category ID to exclude from check (for updates)

        Returns:
            True if name exists, False otherwise
        """
        ...

    @abstractmethod
    async def save(self, category: Category) -> Category:
        """Save a category (create or update).

        Args:
            category: The category to save

        Returns:
            The saved category with any updated fields
        """
        ...

    @abstractmethod
    async def delete(self, id: UUID) -> bool:
        """Delete a category by ID.

        Note: This cascades to delete all feeds in the category.

        Args:
            id: The category's UUID

        Returns:
            True if deleted, False if not found
        """
        ...
