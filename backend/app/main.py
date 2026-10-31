"""Quart application factory."""

from pathlib import Path

from quart import Quart, abort, request, send_from_directory
from werkzeug.exceptions import NotFound

from app.api.middleware import register_error_handlers
from app.api.routes import register_routes
from app.config.container import RequestContainer, set_request_container
from app.config.logging import setup_logging
from app.config.settings import get_settings
from app.config.telemetry import setup_telemetry
from app.infrastructure.oauth.session import session_manager
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
    # After setup_logging: basicConfig(force=True) would drop the Azure Monitor log handler.
    setup_telemetry(app)
    app.config["FRONTEND_DIST_DIR"] = Path(__file__).resolve().parents[2] / "frontend" / "dist"

    # Load settings
    settings = get_settings()
    app.config["SECRET_KEY"] = settings.secret_key
    app.config["DEBUG"] = settings.debug
    app.config["MAX_CONTENT_LENGTH"] = 1024 * 1024
    from app.api.middleware.request_security import (
        RequestAdmission,
        client_address,
        verify_mutation_origin,
    )

    admission = RequestAdmission()
    preauth_admission = RequestAdmission(limit=1200)

    @app.before_request
    async def enforce_request_security():
        if request.path.startswith("/api/"):
            verify_mutation_origin(settings.frontend_url)
            peer = client_address(
                request.remote_addr or "127.0.0.1",
                request.headers.get("X-Real-IP"),
                settings.trusted_proxy_networks,
            )
            preauth_admission.admit(f"peer:{peer}", False)
            user_id = (
                await session_manager.get_current_user_id()
                if request.cookies.get(session_manager.COOKIE_NAME)
                else None
            )
            admission.admit(
                f"user:{user_id}" if user_id else f"peer:{peer}",
                request.method not in {"GET", "HEAD", "OPTIONS"},
            )

    # Configure CORS and security headers
    @app.after_request
    async def add_security_headers(response):
        if request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "private, no-store"
        if response.status_code == 429:
            response.headers["Retry-After"] = "60"
        # Security headers (always apply)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"

        if settings.is_production:
            # Production: strict CORS
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; "
                "script-src 'self'; "
                "style-src 'self' 'unsafe-inline'; "
                f"img-src 'self' data:{' https:' if settings.allow_external_images else ''}; "
                "connect-src 'self'; "
                "font-src 'self'; "
                "media-src 'self'; "
                "object-src 'none'; "
                "base-uri 'none'; "
                "frame-ancestors 'none'; "
                "form-action 'self'"
            )
        elif request.headers.get("Origin") == settings.frontend_url.rstrip("/"):
            response.headers["Access-Control-Allow-Origin"] = settings.frontend_url.rstrip("/")
            response.headers["Access-Control-Allow-Methods"] = (
                "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            )
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, X-Requested-With"
            response.headers["Access-Control-Allow-Credentials"] = "true"
            response.headers["Vary"] = "Origin"
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
        from app.config.container import create_cache_manager

        await create_cache_manager().initialize()
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
        from app.config.container import create_cache_manager

        await create_cache_manager().close()
        await close_db()

    # Health check endpoint
    @app.route("/health")
    async def health_check():
        """Health check endpoint for container orchestration."""
        return {"status": "healthy"}

    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    async def serve_frontend(path: str):
        """Serve static assets and client-side routes from the built frontend."""
        if path == "api" or path.startswith("api/"):
            abort(404)

        frontend_dist = app.config["FRONTEND_DIST_DIR"]
        try:
            return await send_from_directory(frontend_dist, path or "index.html")
        except NotFound:
            return await send_from_directory(frontend_dist, "index.html")

    return app


# Application instance for running directly
app = create_app()
