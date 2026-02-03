"""DI container configuration using quart-injector with Module pattern."""

from collections.abc import AsyncGenerator
from typing import Any

from injector import Binder, Injector, Module, provider, singleton
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings, get_settings
from app.infrastructure.persistence.database import get_session_factory


class SettingsModule(Module):
    """Module for application settings."""

    @singleton
    @provider
    def provide_settings(self) -> Settings:
        """Provide singleton settings instance."""
        return get_settings()


class DatabaseModule(Module):
    """Module for database dependencies."""

    @provider
    def provide_session(self) -> AsyncSession:
        """Provide a new database session per request.

        Note: This creates a transient session. The actual lifecycle
        is managed by the request context in Quart.
        """
        session_factory = get_session_factory()
        return session_factory()


def configure_injector(binder: Binder) -> None:
    """Configure the injector with all modules.

    This function is called by quart-injector to set up DI.

    Args:
        binder: The injector binder for registering dependencies.
    """
    # Import modules here to avoid circular imports
    from app.config.modules.oauth_module import OAuthModule

    # Install core modules
    binder.install(SettingsModule())
    binder.install(DatabaseModule())

    # Feature modules
    binder.install(OAuthModule())

    # Additional modules will be installed here as features are added:
    # - FeedManagementModule (US2)
    # - AudioModule (US5)
    # - NotificationsModule (US6)


def create_injector() -> Injector:
    """Create and configure the application injector.

    Returns:
        Configured Injector instance.
    """
    return Injector([configure_injector])
