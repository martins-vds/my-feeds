"""Quart application factory."""

from quart import Quart
from quart_injector import QuartInjector

from app.api.middleware import register_error_handlers
from app.api.routes import register_routes
from app.config.container import create_injector
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

    # Configure CORS for development
    @app.after_request
    async def add_cors_headers(response):
        if settings.debug:
            response.headers["Access-Control-Allow-Origin"] = "*"
            response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
            response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
            response.headers["Access-Control-Allow-Credentials"] = "true"
        return response

    # Register error handlers
    register_error_handlers(app)

    # Register routes
    register_routes(app)

    # Setup dependency injection
    injector = create_injector()
    QuartInjector(app, injector)

    # Lifecycle hooks
    @app.before_serving
    async def startup():
        """Initialize resources on startup."""
        await init_db()

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
