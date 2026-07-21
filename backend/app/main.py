"""Quart application factory."""

from quart import Quart

from app.api.middleware import register_error_handlers
from app.api.routes import register_routes
from app.config.container import RequestContainer, set_request_container
from app.config.logging import setup_logging
from app.config.settings import get_settings
from app.infrastructure.persistence.database import close_db, init_db


def create_app() -> Quart:
    """Create and configure the Quart application.

    Returns:
        Configured Quart application instance.
    """
    # Setup logging first
    setup_logging()

    # Create Quart app
    app = Quart(__name__)

    # Load settings
    settings = get_settings()
    app.config["SECRET_KEY"] = settings.secret_key
    app.config["DEBUG"] = settings.debug

    # Configure CORS and security headers
    @app.after_request
    async def add_security_headers(response):
        # Security headers (always apply)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"

        if settings.is_production:
            # Production: strict CORS
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data: https:; "
                "connect-src 'self'; "
                "font-src 'self'; "
                "media-src 'self'"
            )
        else:
            # Development: permissive CORS
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Access-Control-Allow-Methods"] = (
                "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            )
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Allow-Credentials"] = "true"
        return response

    # Register error handlers
    register_error_handlers(app)

    # Register routes
    register_routes(app)

    # Request-scoped DI container middleware
    @app.before_request
    async def setup_request_container():
        """Create request-scoped container with database session."""
        container = RequestContainer()
        set_request_container(container)

    @app.teardown_request
    async def teardown_request_container(exception=None):
        """Commit or rollback, then close the session."""
        from app.config.container import get_request_container

        try:
            container = get_request_container()
            if container._session is not None:
                if exception is None:
                    await container._session.commit()
                else:
                    await container._session.rollback()
            await container.close()
        except RuntimeError:
            pass  # No container was set
        finally:
            set_request_container(None)

    # Lifecycle hooks
    @app.before_serving
    async def startup():
        """Initialize resources on startup."""
        await init_db()

        # Background jobs (run separately from feed ingestion; skipped in
        # tests): poll active feeds for new posts on a schedule, fill in TTS
        # audio for posts that don't have it yet, and keep the audio cache
        # within its retention/size limits.
        if settings.environment != "testing":
            from app.infrastructure.jobs.audio_cleanup import (
                run_audio_cleanup_loop,
            )
            from app.infrastructure.jobs.audio_generation import (
                run_audio_generation_loop,
            )
            from app.infrastructure.jobs.feed_refresh import (
                run_feed_refresh_loop,
            )

            app.add_background_task(run_feed_refresh_loop)
            app.add_background_task(run_audio_generation_loop)
            app.add_background_task(run_audio_cleanup_loop)

    @app.after_serving
    async def shutdown():
        """Cleanup resources on shutdown."""
        await close_db()

    # Health check endpoint
    @app.route("/health")
    async def health_check():
        """Health check endpoint for container orchestration."""
        return {"status": "healthy"}

    return app


# Application instance for running directly
app = create_app()
