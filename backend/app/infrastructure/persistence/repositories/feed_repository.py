"""SQLAlchemy implementation of FeedRepository."""

from uuid import UUID

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.feed_management.entities.feed import Feed
from app.domain.feed_management.repositories.feed_repository import FeedRepository
from app.infrastructure.persistence.models.category import CategoryModel
from app.infrastructure.persistence.models.feed import FeedModel


class SQLAlchemyFeedRepository(FeedRepository):
    """SQLAlchemy-based implementation of FeedRepository."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialize repository with database session.

        Args:
            session: SQLAlchemy async session
        """
        self._session = session

    async def get_by_id(self, id: UUID) -> Feed | None:
        """Get a feed by its ID."""
        result = await self._session.execute(
            select(FeedModel).where(FeedModel.id == id)
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def get_by_category(self, category_id: UUID) -> list[Feed]:
        """Get all feeds in a category."""
        result = await self._session.execute(
            select(FeedModel)
            .where(FeedModel.category_id == category_id)
            .order_by(FeedModel.created_at)
        )
        models = result.scalars().all()
        return [self._to_entity(model) for model in models]

    async def get_by_user(self, user_id: UUID) -> list[Feed]:
        """Get all feeds for a user across all categories."""
        result = await self._session.execute(
            select(FeedModel)
            .join(CategoryModel, FeedModel.category_id == CategoryModel.id)
            .where(CategoryModel.user_id == user_id)
            .order_by(CategoryModel.position, FeedModel.created_at)
        )
        models = result.scalars().all()
        return [self._to_entity(model) for model in models]

    async def count_by_user(self, user_id: UUID) -> int:
        """Count total feeds for a user across all categories."""
        result = await self._session.execute(
            select(func.count())
            .select_from(FeedModel)
            .join(CategoryModel, FeedModel.category_id == CategoryModel.id)
            .where(CategoryModel.user_id == user_id)
        )
        return result.scalar_one()

    async def count_by_category(self, category_id: UUID) -> int:
        """Count feeds in a specific category."""
        result = await self._session.execute(
            select(func.count())
            .select_from(FeedModel)
            .where(FeedModel.category_id == category_id)
        )
        return result.scalar_one()

    async def exists_by_url_in_category(self, category_id: UUID, url: str) -> bool:
        """Check if a feed with the given URL exists in the category."""
        result = await self._session.execute(
            select(FeedModel.id).where(
                FeedModel.category_id == category_id,
                FeedModel.url == url,
            )
        )
        return result.scalar_one_or_none() is not None

    async def exists_by_url_for_user(self, user_id: UUID, url: str) -> bool:
        """Check if a feed with the given URL exists for the user anywhere."""
        result = await self._session.execute(
            select(FeedModel.id)
            .join(CategoryModel, FeedModel.category_id == CategoryModel.id)
            .where(
                CategoryModel.user_id == user_id,
                FeedModel.url == url,
            )
        )
        return result.scalar_one_or_none() is not None

    async def save(self, feed: Feed) -> Feed:
        """Save a feed (create or update)."""
        existing = await self._session.get(FeedModel, feed.id)

        if existing:
            # Update existing feed
            existing.category_id = feed.category_id
            existing.url = feed.url
            existing.title = feed.title
            existing.description = feed.description
            existing.site_url = feed.site_url
            existing.icon_url = feed.icon_url
            existing.last_fetched_at = feed.last_fetched_at
            existing.last_error = feed.last_error
            existing.fetch_error_count = feed.fetch_error_count
            existing.updated_at = feed.updated_at
            await self._session.flush()
            return self._to_entity(existing)
        else:
            # Create new feed
            model = self._to_model(feed)
            self._session.add(model)
            await self._session.flush()
            return self._to_entity(model)

    async def delete(self, id: UUID) -> bool:
        """Delete a feed by ID (cascades to posts)."""
        result = await self._session.execute(
            delete(FeedModel).where(FeedModel.id == id)
        )
        await self._session.flush()
        return result.rowcount > 0

    @staticmethod
    def _to_entity(model: FeedModel) -> Feed:
        """Convert SQLAlchemy model to domain entity."""
        return Feed(
            id=model.id,
            category_id=model.category_id,
            url=model.url,
            title=model.title,
            description=model.description,
            site_url=model.site_url,
            icon_url=model.icon_url,
            last_fetched_at=model.last_fetched_at,
            last_error=model.last_error,
            fetch_error_count=model.fetch_error_count,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    @staticmethod
    def _to_model(entity: Feed) -> FeedModel:
        """Convert domain entity to SQLAlchemy model."""
        return FeedModel(
            id=entity.id,
            category_id=entity.category_id,
            url=entity.url,
            title=entity.title,
            description=entity.description,
            site_url=entity.site_url,
            icon_url=entity.icon_url,
            last_fetched_at=entity.last_fetched_at,
            last_error=entity.last_error,
            fetch_error_count=entity.fetch_error_count,
            created_at=entity.created_at,
            updated_at=entity.updated_at,
        )
