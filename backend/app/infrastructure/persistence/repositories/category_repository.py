"""SQLAlchemy implementation of CategoryRepository."""

from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.feed_management.entities.category import Category
from app.domain.feed_management.repositories.category_repository import CategoryRepository
from app.infrastructure.persistence.models.category import CategoryModel


class SQLAlchemyCategoryRepository(CategoryRepository):
    """SQLAlchemy-based implementation of CategoryRepository."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialize repository with database session.

        Args:
            session: SQLAlchemy async session
        """
        self._session = session

    async def get_by_id(self, id: UUID) -> Category | None:
        """Get a category by its ID."""
        result = await self._session.execute(
            select(CategoryModel).where(CategoryModel.id == id)
        )
        model = result.scalar_one_or_none()
        if model:
            # Get feed count for category
            feed_count = await self._get_feed_count(id)
            return self._to_entity(model, feed_count)
        return None

    async def get_by_user(self, user_id: UUID) -> list[Category]:
        """Get all categories for a user, ordered by position."""
        result = await self._session.execute(
            select(CategoryModel)
            .where(CategoryModel.user_id == user_id)
            .order_by(CategoryModel.position)
        )
        models = result.scalars().all()

        # Get feed counts for all categories
        categories = []
        for model in models:
            feed_count = await self._get_feed_count(model.id)
            categories.append(self._to_entity(model, feed_count))
        return categories

    async def get_by_user_and_name(self, user_id: UUID, name: str) -> Category | None:
        """Get a category by user and name."""
        result = await self._session.execute(
            select(CategoryModel).where(
                CategoryModel.user_id == user_id,
                func.lower(CategoryModel.name) == name.lower(),
            )
        )
        model = result.scalar_one_or_none()
        if model:
            feed_count = await self._get_feed_count(model.id)
            return self._to_entity(model, feed_count)
        return None

    async def count_by_user(self, user_id: UUID) -> int:
        """Count categories for a user."""
        result = await self._session.execute(
            select(func.count()).select_from(CategoryModel).where(
                CategoryModel.user_id == user_id
            )
        )
        return result.scalar_one()

    async def get_max_position(self, user_id: UUID) -> int:
        """Get the maximum position value for a user's categories."""
        result = await self._session.execute(
            select(func.max(CategoryModel.position)).where(
                CategoryModel.user_id == user_id
            )
        )
        max_pos = result.scalar_one_or_none()
        return max_pos if max_pos is not None else -1

    async def exists_by_name(
        self, user_id: UUID, name: str, exclude_id: UUID | None = None
    ) -> bool:
        """Check if a category with the given name exists for the user."""
        query = select(CategoryModel.id).where(
            CategoryModel.user_id == user_id,
            func.lower(CategoryModel.name) == name.lower(),
        )
        if exclude_id is not None:
            query = query.where(CategoryModel.id != exclude_id)

        result = await self._session.execute(query)
        return result.scalar_one_or_none() is not None

    async def save(self, category: Category) -> Category:
        """Save a category (create or update)."""
        existing = await self._session.get(CategoryModel, category.id)

        if existing:
            # Update existing category
            existing.name = category.name
            existing.position = category.position
            existing.updated_at = category.updated_at
            await self._session.flush()
            feed_count = await self._get_feed_count(existing.id)
            return self._to_entity(existing, feed_count)
        else:
            # Create new category
            model = self._to_model(category)
            self._session.add(model)
            await self._session.flush()
            return self._to_entity(model, 0)

    async def delete(self, id: UUID) -> bool:
        """Delete a category by ID (cascades to feeds)."""
        result = await self._session.execute(
            delete(CategoryModel).where(CategoryModel.id == id)
        )
        await self._session.flush()
        return result.rowcount > 0

    async def _get_feed_count(self, category_id: UUID) -> int:
        """Get count of feeds in a category."""
        # Import here to avoid circular dependency
        from app.infrastructure.persistence.models.feed import FeedModel

        result = await self._session.execute(
            select(func.count()).select_from(FeedModel).where(
                FeedModel.category_id == category_id
            )
        )
        return result.scalar_one()

    @staticmethod
    def _to_entity(model: CategoryModel, feed_count: int = 0) -> Category:
        """Convert SQLAlchemy model to domain entity."""
        return Category(
            id=model.id,
            user_id=model.user_id,
            name=model.name,
            position=model.position,
            created_at=model.created_at,
            updated_at=model.updated_at,
            feed_count=feed_count,
        )

    @staticmethod
    def _to_model(entity: Category) -> CategoryModel:
        """Convert domain entity to SQLAlchemy model."""
        return CategoryModel(
            id=entity.id,
            user_id=entity.user_id,
            name=entity.name,
            position=entity.position,
            created_at=entity.created_at,
            updated_at=entity.updated_at,
        )
