"""SQLAlchemy implementation of FeedRepository."""

from uuid import UUID

from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.feed_management.entities.feed import Feed
from app.domain.feed_management.repositories.feed_repository import FeedRepository
from app.infrastructure.persistence.models.feed import FeedModel
from app.infrastructure.persistence.models.feed_category import feed_categories


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
            select(FeedModel).where(FeedModel.id == id).options(selectinload(FeedModel.categories))
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def get_by_category(self, category_id: UUID) -> list[Feed]:
        """Get all feeds labelled with a category."""
        result = await self._session.execute(
            select(FeedModel)
            .join(feed_categories, FeedModel.id == feed_categories.c.feed_id)
            .where(feed_categories.c.category_id == category_id)
            .options(selectinload(FeedModel.categories))
            .order_by(FeedModel.created_at)
        )
        models = result.scalars().all()
        return [self._to_entity(model) for model in models]

    async def get_by_user(self, user_id: UUID) -> list[Feed]:
        """Get all feeds owned by a user."""
        result = await self._session.execute(
            select(FeedModel)
            .where(FeedModel.user_id == user_id)
            .options(selectinload(FeedModel.categories))
            .order_by(FeedModel.created_at)
        )
        models = result.scalars().all()
        return [self._to_entity(model) for model in models]

    async def count_by_user(self, user_id: UUID) -> int:
        """Count total feeds owned by a user."""
        result = await self._session.execute(
            select(func.count()).select_from(FeedModel).where(FeedModel.user_id == user_id)
        )
        return result.scalar_one()

    async def count_by_category(self, category_id: UUID) -> int:
        """Count feeds labelled with a category."""
        result = await self._session.execute(
            select(func.count())
            .select_from(feed_categories)
            .where(feed_categories.c.category_id == category_id)
        )
        return result.scalar_one()

    async def exists_by_url_for_user(self, user_id: UUID, url: str) -> bool:
        """Check if a feed with the given URL exists for the user."""
        result = await self._session.execute(
            select(FeedModel.id).where(
                FeedModel.user_id == user_id,
                FeedModel.url == url,
            )
        )
        return result.scalar_one_or_none() is not None

    async def save(self, feed: Feed) -> Feed:
        """Save a feed (create or update) and sync its category labels."""
        existing = await self._session.get(FeedModel, feed.id)

        if existing:
            existing.user_id = feed.user_id
            existing.url = feed.url
            existing.title = feed.title
            existing.description = feed.description
            existing.site_url = feed.site_url
            existing.icon_url = feed.icon_url
            existing.last_fetched_at = feed.last_fetched_at
            existing.last_error = feed.last_error
            existing.fetch_error_count = feed.fetch_error_count
            existing.updated_at = feed.updated_at
        else:
            self._session.add(self._to_model(feed))

        await self._session.flush()
        await self._sync_categories(feed.id, feed.category_ids)
        await self._session.flush()
        return await self._reload(feed.id)

    async def _sync_categories(self, feed_id: UUID, category_ids: list[UUID]) -> None:
        """Replace the feed's category associations with the given set."""
        await self._session.execute(
            delete(feed_categories).where(feed_categories.c.feed_id == feed_id)
        )
        unique = list(dict.fromkeys(category_ids))
        if unique:
            await self._session.execute(
                insert(feed_categories),
                [{"feed_id": feed_id, "category_id": cid} for cid in unique],
            )

    async def _reload(self, feed_id: UUID) -> Feed:
        """Reload a feed with its category associations eagerly loaded."""
        result = await self._session.execute(
            select(FeedModel)
            .where(FeedModel.id == feed_id)
            .options(selectinload(FeedModel.categories))
        )
        return self._to_entity(result.scalar_one())

    async def delete(self, id: UUID) -> bool:
        """Delete a feed by ID (cascades to posts)."""
        result = await self._session.execute(delete(FeedModel).where(FeedModel.id == id))
        await self._session.flush()
        return result.rowcount > 0

    @staticmethod
    def _to_entity(model: FeedModel) -> Feed:
        """Convert SQLAlchemy model to domain entity.

        Requires ``model.categories`` to be eagerly loaded.
        """
        return Feed(
            id=model.id,
            user_id=model.user_id,
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
            category_ids=[category.id for category in model.categories],
        )

    @staticmethod
    def _to_model(entity: Feed) -> FeedModel:
        """Convert domain entity to SQLAlchemy model (categories synced separately)."""
        return FeedModel(
            id=entity.id,
            user_id=entity.user_id,
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
