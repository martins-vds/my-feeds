"""Simple DI container - manual dependency wiring without external libraries.

This module provides factory functions for creating service instances with
their dependencies. Dependencies are resolved per-request using the database
session from the request context.
"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.config.settings import Settings, get_settings
from app.infrastructure.persistence.database import get_session_factory


# =============================================================================
# Singleton instances
# =============================================================================

_settings: Settings | None = None


def get_settings_instance() -> Settings:
    """Get singleton Settings instance."""
    global _settings
    if _settings is None:
        _settings = get_settings()
    return _settings


# =============================================================================
# Session-scoped factory functions
# =============================================================================


def create_session() -> AsyncSession:
    """Create a new database session.
    
    Returns:
        New AsyncSession instance
    """
    session_factory = get_session_factory()
    return session_factory()


# =============================================================================
# Repository factories
# =============================================================================


def create_user_repository(session: AsyncSession):
    """Create UserRepository with session.
    
    Args:
        session: Database session
        
    Returns:
        SQLAlchemyUserRepository instance
    """
    from app.infrastructure.persistence.repositories.user_repository import (
        SQLAlchemyUserRepository,
    )
    return SQLAlchemyUserRepository(session)


def create_category_repository(session: AsyncSession):
    """Create CategoryRepository with session.
    
    Args:
        session: Database session
        
    Returns:
        SQLAlchemyCategoryRepository instance
    """
    from app.infrastructure.persistence.repositories.category_repository import (
        SQLAlchemyCategoryRepository,
    )
    return SQLAlchemyCategoryRepository(session)


def create_feed_repository(session: AsyncSession):
    """Create FeedRepository with session.
    
    Args:
        session: Database session
        
    Returns:
        SQLAlchemyFeedRepository instance
    """
    from app.infrastructure.persistence.repositories.feed_repository import (
        SQLAlchemyFeedRepository,
    )
    return SQLAlchemyFeedRepository(session)


def create_post_repository(session: AsyncSession):
    """Create PostRepository with session.
    
    Args:
        session: Database session
        
    Returns:
        SQLAlchemyPostRepository instance
    """
    from app.infrastructure.persistence.repositories.post_repository import (
        SQLAlchemyPostRepository,
    )
    return SQLAlchemyPostRepository(session)


# =============================================================================
# Service factories
# =============================================================================


def create_feed_fetcher():
    """Create FeedFetcher instance.
    
    Returns:
        FeedFetcher instance
    """
    from app.infrastructure.feed_fetcher.feed_fetcher import FeedFetcher
    return FeedFetcher()


def create_oauth_service(session: AsyncSession):
    """Create OAuthService with dependencies.
    
    Args:
        session: Database session
        
    Returns:
        OAuthService instance
    """
    from app.infrastructure.oauth.oauth_service import OAuthService
    user_repository = create_user_repository(session)
    return OAuthService(user_repository=user_repository)


def create_category_service(session: AsyncSession):
    """Create CategoryService with dependencies.
    
    Args:
        session: Database session
        
    Returns:
        CategoryService instance
    """
    from app.application.services.category_service import CategoryService
    category_repository = create_category_repository(session)
    return CategoryService(category_repository=category_repository)


def create_feed_service(session: AsyncSession):
    """Create FeedService with dependencies.
    
    Args:
        session: Database session
        
    Returns:
        FeedService instance
    """
    from app.application.services.feed_service import FeedService
    feed_repository = create_feed_repository(session)
    category_repository = create_category_repository(session)
    feed_fetcher = create_feed_fetcher()
    return FeedService(
        feed_repository=feed_repository,
        category_repository=category_repository,
        feed_fetcher=feed_fetcher,
    )


def create_post_service(session: AsyncSession):
    """Create PostService with dependencies.
    
    Args:
        session: Database session
        
    Returns:
        PostService instance
    """
    from app.application.services.post_service import PostService
    post_repository = create_post_repository(session)
    category_repository = create_category_repository(session)
    feed_repository = create_feed_repository(session)
    return PostService(
        post_repository=post_repository,
        category_repository=category_repository,
        feed_repository=feed_repository,
    )


def create_audio_repository(session: AsyncSession):
    """Create AudioRepository with session.
    
    Args:
        session: Database session
        
    Returns:
        SQLAlchemyAudioRepository instance
    """
    from app.infrastructure.persistence.repositories.audio_repository import (
        SQLAlchemyAudioRepository,
    )
    return SQLAlchemyAudioRepository(session)


def create_tts_service():
    """Create TTSService instance.
    
    Uses Azure TTS in production, Mock TTS in testing.
    
    Returns:
        TTSService implementation
    """
    settings = get_settings_instance()
    
    if settings.environment == "testing" or not settings.azure_speech_key:
        from app.infrastructure.tts.mock_tts import MockTTSService
        return MockTTSService()
    
    from app.infrastructure.tts.azure_tts import AzureTTSService
    return AzureTTSService(
        speech_key=settings.azure_speech_key,
        speech_region=settings.azure_speech_region,
    )


def create_cache_manager():
    """Create AudioCacheManager instance.
    
    Returns:
        AudioCacheManager configured from settings
    """
    from pathlib import Path
    from app.infrastructure.tts.cache_manager import AudioCacheManager
    
    settings = get_settings_instance()
    cache_dir = Path(settings.audio_cache_dir)
    
    return AudioCacheManager(
        cache_dir=cache_dir,
        max_size_mb=settings.audio_max_cache_size_mb,
    )


def create_audio_service(session: AsyncSession):
    """Create AudioService with dependencies.
    
    Args:
        session: Database session
        
    Returns:
        AudioService instance
    """
    from app.application.services.audio_service import AudioService
    
    audio_repository = create_audio_repository(session)
    post_repository = create_post_repository(session)
    tts_service = create_tts_service()
    cache_manager = create_cache_manager()
    
    return AudioService(
        audio_repository=audio_repository,
        post_repository=post_repository,
        tts_service=tts_service,
        cache_manager=cache_manager,
    )


# =============================================================================
# Request context helpers
# =============================================================================


class RequestContainer:
    """Container for request-scoped dependencies.
    
    Creates and caches service instances for a single request,
    ensuring all services share the same database session.
    """
    
    def __init__(self):
        self._session: AsyncSession | None = None
        self._category_service = None
        self._feed_service = None
        self._post_service = None
        self._oauth_service = None
        self._audio_service = None
    
    @property
    def session(self) -> AsyncSession:
        """Get or create the request's database session."""
        if self._session is None:
            self._session = create_session()
        return self._session
    
    @property
    def category_service(self):
        """Get or create CategoryService for this request."""
        if self._category_service is None:
            self._category_service = create_category_service(self.session)
        return self._category_service
    
    @property
    def feed_service(self):
        """Get or create FeedService for this request."""
        if self._feed_service is None:
            self._feed_service = create_feed_service(self.session)
        return self._feed_service
    
    @property
    def post_service(self):
        """Get or create PostService for this request."""
        if self._post_service is None:
            self._post_service = create_post_service(self.session)
        return self._post_service
    
    @property
    def oauth_service(self):
        """Get or create OAuthService for this request."""
        if self._oauth_service is None:
            self._oauth_service = create_oauth_service(self.session)
        return self._oauth_service
    
    @property
    def audio_service(self):
        """Get or create AudioService for this request."""
        if self._audio_service is None:
            self._audio_service = create_audio_service(self.session)
        return self._audio_service
    
    async def close(self):
        """Close the session and cleanup resources."""
        if self._session is not None:
            await self._session.close()
            self._session = None


# Global request container accessor (set per-request via middleware)
from contextvars import ContextVar

_request_container: ContextVar[RequestContainer | None] = ContextVar(
    "request_container", default=None
)


def get_request_container() -> RequestContainer:
    """Get the current request's container.
    
    Returns:
        RequestContainer for current request
        
    Raises:
        RuntimeError: If called outside request context
    """
    container = _request_container.get()
    if container is None:
        raise RuntimeError("No request container - called outside request context")
    return container


def set_request_container(container: RequestContainer | None) -> None:
    """Set the request container for the current context.
    
    Args:
        container: RequestContainer or None to clear
    """
    _request_container.set(container)

