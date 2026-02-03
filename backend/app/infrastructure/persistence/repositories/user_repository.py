"""SQLAlchemy implementation of UserRepository."""

from typing import Literal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.feed_management.entities.user import User
from app.domain.feed_management.repositories.user_repository import UserRepository
from app.infrastructure.persistence.models.user import UserModel


class SQLAlchemyUserRepository(UserRepository):
    """SQLAlchemy-based implementation of UserRepository."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialize repository with database session.

        Args:
            session: SQLAlchemy async session
        """
        self._session = session

    async def get_by_id(self, id: UUID) -> User | None:
        """Get a user by their internal ID."""
        result = await self._session.execute(
            select(UserModel).where(UserModel.id == id)
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def get_by_provider(
        self,
        provider: Literal["github", "google", "microsoft"],
        provider_id: str,
    ) -> User | None:
        """Get a user by their OAuth provider and provider ID."""
        result = await self._session.execute(
            select(UserModel).where(
                UserModel.provider == provider,
                UserModel.provider_id == provider_id,
            )
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def get_by_email(self, email: str) -> User | None:
        """Get a user by their email address."""
        result = await self._session.execute(
            select(UserModel).where(UserModel.email == email)
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def save(self, user: User) -> User:
        """Save a user (create or update)."""
        # Check if user exists
        existing = await self._session.get(UserModel, user.id)

        if existing:
            # Update existing user
            existing.email = user.email
            existing.name = user.name
            existing.avatar_url = user.avatar_url
            existing.timezone = user.timezone
            existing.notifications_enabled = user.notifications_enabled
            existing.updated_at = user.updated_at
            await self._session.flush()
            return self._to_entity(existing)
        else:
            # Create new user
            model = self._to_model(user)
            self._session.add(model)
            await self._session.flush()
            return self._to_entity(model)

    async def delete(self, id: UUID) -> bool:
        """Delete a user by ID."""
        result = await self._session.execute(
            select(UserModel).where(UserModel.id == id)
        )
        model = result.scalar_one_or_none()
        if model:
            await self._session.delete(model)
            await self._session.flush()
            return True
        return False

    @staticmethod
    def _to_entity(model: UserModel) -> User:
        """Convert SQLAlchemy model to domain entity."""
        return User(
            id=model.id,
            provider=model.provider,  # type: ignore
            provider_id=model.provider_id,
            email=model.email,
            name=model.name,
            avatar_url=model.avatar_url,
            timezone=model.timezone,
            notifications_enabled=model.notifications_enabled,
            created_at=model.created_at,
            updated_at=model.updated_at,
        )

    @staticmethod
    def _to_model(entity: User) -> UserModel:
        """Convert domain entity to SQLAlchemy model."""
        return UserModel(
            id=entity.id,
            provider=entity.provider,
            provider_id=entity.provider_id,
            email=entity.email,
            name=entity.name,
            avatar_url=entity.avatar_url,
            timezone=entity.timezone,
            notifications_enabled=entity.notifications_enabled,
            created_at=entity.created_at,
            updated_at=entity.updated_at,
        )
