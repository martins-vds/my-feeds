"""API routes package."""

from quart import Blueprint


def register_routes(app) -> None:
    """Register all API routes with the application.

    Args:
        app: The Quart application instance.
    """
    # Create a fresh blueprint each time to support multiple create_app() calls (e.g. tests)
    api_bp = Blueprint("api", __name__, url_prefix="/api")

    # Import route modules here to avoid circular imports
    from app.api.routes import audio, auth, categories, feeds, posts

    # Register blueprints
    api_bp.register_blueprint(auth.bp)
    api_bp.register_blueprint(categories.bp)
    api_bp.register_blueprint(feeds.bp)
    api_bp.register_blueprint(posts.bp)
    api_bp.register_blueprint(audio.bp)

    # Additional routes will be registered as features are added:
    # api_bp.register_blueprint(user.bp)        # Settings

    # Register the main API blueprint
    app.register_blueprint(api_bp)
