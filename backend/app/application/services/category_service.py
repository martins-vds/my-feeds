"""Category application service."""

from uuid import UUID

from app.domain.feed_management.entities.category import Category
from app.domain.feed_management.repositories.category_repository import CategoryRepository


class CategoryLimitError(Exception):
    """Raised when category limit is exceeded."""

    pass


class CategoryNotFoundError(Exception):
    """Raised when category is not found."""

    pass


class CategoryNameConflictError(Exception):
    """Raised when category name already exists."""

    pass


class CategoryPermissionError(Exception):
    """Raised when user doesn't have permission to access category."""

    pass


class CategoryService:
    """Application service for category operations.

    Orchestrates category CRUD operations with business rule enforcement.
    """

    MAX_CATEGORIES_PER_USER = 25  # FR-039

    def __init__(self, category_repository: CategoryRepository) -> None:
        """Initialize service with repository.

        Args:
            category_repository: Repository for category persistence
        """
        self._repository = category_repository

    async def list_categories(self, user_id: UUID) -> list[Category]:
        """Get all categories for a user, ordered by position.

        Args:
            user_id: The user's UUID

        Returns:
            List of categories ordered by position
        """
        return await self._repository.get_by_user(user_id)

    async def get_category(self, user_id: UUID, category_id: UUID) -> Category:
        """Get a single category by ID.

        Args:
            user_id: The requesting user's UUID
            category_id: The category's UUID

        Returns:
            The requested category

        Raises:
            CategoryNotFoundError: If category doesn't exist
            CategoryPermissionError: If category belongs to different user
        """
        category = await self._repository.get_by_id(category_id)
        if category is None:
            raise CategoryNotFoundError(f"Category {category_id} not found")

        if category.user_id != user_id:
            raise CategoryPermissionError("Cannot access another user's category")

        return category

    async def create_category(self, user_id: UUID, name: str) -> Category:
        """Create a new category.

        Args:
            user_id: The owner's UUID
            name: Category display name

        Returns:
            The created category

        Raises:
            CategoryLimitError: If user has reached 25 categories (FR-039)
            CategoryNameConflictError: If name already exists for user
            ValueError: If name is invalid
        """
        # Check limit (FR-039)
        count = await self._repository.count_by_user(user_id)
        if count >= self.MAX_CATEGORIES_PER_USER:
            raise CategoryLimitError(
                f"Maximum of {self.MAX_CATEGORIES_PER_USER} categories allowed"
            )

        # Check name uniqueness
        if await self._repository.exists_by_name(user_id, name):
            raise CategoryNameConflictError(f"Category '{name}' already exists")

        # Get next position
        max_position = await self._repository.get_max_position(user_id)
        position = max_position + 1

        # Create category
        category = Category.create(
            user_id=user_id,
            name=name,
            position=position,
        )

        return await self._repository.save(category)

    async def update_category(
        self,
        user_id: UUID,
        category_id: UUID,
        name: str | None = None,
        position: int | None = None,
    ) -> Category:
        """Update a category's name or position.

        Args:
            user_id: The requesting user's UUID
            category_id: The category's UUID
            name: New name (optional)
            position: New position (optional)

        Returns:
            The updated category

        Raises:
            CategoryNotFoundError: If category doesn't exist
            CategoryPermissionError: If category belongs to different user
            CategoryNameConflictError: If new name already exists
            ValueError: If name is invalid
        """
        category = await self.get_category(user_id, category_id)

        if name is not None and name != category.name:
            # Check name uniqueness (excluding current category)
            if await self._repository.exists_by_name(user_id, name, exclude_id=category_id):
                raise CategoryNameConflictError(f"Category '{name}' already exists")
            category.rename(name)

        if position is not None:
            category.reposition(position)

        return await self._repository.save(category)

    async def delete_category(self, user_id: UUID, category_id: UUID) -> bool:
        """Delete a category.

        Note: This cascades to delete all feeds in the category.

        Args:
            user_id: The requesting user's UUID
            category_id: The category's UUID

        Returns:
            True if deleted

        Raises:
            CategoryNotFoundError: If category doesn't exist
            CategoryPermissionError: If category belongs to different user
        """
        # Verify ownership
        await self.get_category(user_id, category_id)

        return await self._repository.delete(category_id)

    async def get_category_count(self, user_id: UUID) -> int:
        """Get count of categories for a user.

        Args:
            user_id: The user's UUID

        Returns:
            Number of categories
        """
        return await self._repository.count_by_user(user_id)
