"""OAuth DI module for dependency injection."""

from injector import Binder, Module, provider, singleton
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.feed_management.repositories.user_repository import UserRepository
from app.infrastructure.oauth.oauth_service import OAuthService
from app.infrastructure.persistence.repositories.user_repository import (
    SQLAlchemyUserRepository,
)


class OAuthModule(Module):
    """DI Module for OAuth-related dependencies."""

    @provider
    def provide_user_repository(self, session: AsyncSession) -> UserRepository:
        """Provide UserRepository implementation.

        Args:
            session: Database session from DatabaseModule

        Returns:
            SQLAlchemy-based UserRepository
        """
        return SQLAlchemyUserRepository(session)

    @provider
    def provide_oauth_service(self, user_repository: UserRepository) -> OAuthService:
        """Provide OAuthService with repository.

        Args:
            user_repository: User repository for persistence

        Returns:
            Configured OAuthService
        """
        return OAuthService(user_repository=user_repository)
