"""API routes package."""

from quart import Blueprint

# Create API blueprint
api_bp = Blueprint("api", __name__, url_prefix="/api")


def register_routes(app) -> None:
    """Register all API routes with the application.

    Args:
        app: The Quart application instance.
    """
    # Import route modules here to avoid circular imports
    from app.api.routes import auth

    # Register blueprints
    api_bp.register_blueprint(auth.bp)

    # Additional routes will be registered as features are added:
    # api_bp.register_blueprint(categories.bp)  # US2
    # api_bp.register_blueprint(feeds.bp)       # US2
    # api_bp.register_blueprint(posts.bp)       # US3, US4
    # api_bp.register_blueprint(audio.bp)       # US5
    # api_bp.register_blueprint(notifications.bp)  # US6
    # api_bp.register_blueprint(user.bp)        # US6

    # Register the main API blueprint
    app.register_blueprint(api_bp)
