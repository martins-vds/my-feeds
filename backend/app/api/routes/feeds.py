"""Feed API routes."""

from uuid import UUID

from quart import Blueprint, jsonify, request

from app.api.middleware import UnauthorizedError, ValidationError
from app.application.services.feed_service import (
    CategoryNotFoundError,
    FeedConflictError,
    FeedLimitError,
    FeedNotFoundError,
    FeedPermissionError,
)
from app.config.container import get_request_container
from app.domain.feed_management.services.feed_validator import FeedValidationError
from app.infrastructure.oauth.session import session_manager

bp = Blueprint("feeds", __name__)


def get_current_user_id() -> UUID:
    """Get the current authenticated user's ID from session.

    Returns:
        The user's UUID

    Raises:
        UnauthorizedError: If not authenticated
    """
    user_id = session_manager.get_current_user_id()
    if user_id is None:
        raise UnauthorizedError("Authentication required")
    return user_id


@bp.route("/categories/<uuid:category_id>/feeds", methods=["GET"])
async def list_feeds_in_category(category_id: UUID):
    """List all feeds in a category.

    GET /api/categories/{categoryId}/feeds

    Returns:
        JSON array of feeds in the category
    """
    user_id = get_current_user_id()
    container = get_request_container()

    try:
        feeds = await container.feed_service.list_feeds_in_category(user_id, category_id)
        return jsonify([feed.to_dict() for feed in feeds])
    except CategoryNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404
    except FeedPermissionError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404


@bp.route("/categories/<uuid:category_id>/feeds", methods=["POST"])
async def add_feed(category_id: UUID):
    """Add a new feed to a category.

    POST /api/categories/{categoryId}/feeds
    Body: { "url": "https://example.com/feed.xml" }

    Returns:
        201: Created feed with metadata
        400: Invalid URL or not a valid feed
        401: Not authenticated
        404: Category not found
        409: Feed already subscribed
    """
    user_id = get_current_user_id()

    data = await request.get_json()
    if not data:
        raise ValidationError("Request body is required")

    url = data.get("url")
    if not url:
        raise ValidationError("Feed URL is required")

    container = get_request_container()
    try:
        feed = await container.feed_service.add_feed(user_id, category_id, url)
        return jsonify(feed.to_dict()), 201
    except FeedLimitError as e:
        raise ValidationError(str(e))
    except FeedConflictError:
        return jsonify({
            "error": "conflict",
            "message": "Feed already subscribed in this category"
        }), 409
    except FeedValidationError as e:
        return jsonify({
            "error": "invalid_feed",
            "message": str(e)
        }), 400
    except CategoryNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404
    except FeedPermissionError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404


@bp.route("/feeds/<uuid:feed_id>", methods=["GET"])
async def get_feed(feed_id: UUID):
    """Get feed details with recent posts.

    GET /api/feeds/{feedId}

    Returns:
        Feed details with posts array
    """
    user_id = get_current_user_id()
    container = get_request_container()

    try:
        feed = await container.feed_service.get_feed(user_id, feed_id)
        result = feed.to_dict()
        # Note: posts will be populated in US3
        result["posts"] = []
        return jsonify(result)
    except FeedNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Feed not found"
        }), 404
    except FeedPermissionError:
        return jsonify({
            "error": "not_found",
            "message": "Feed not found"
        }), 404


@bp.route("/feeds/<uuid:feed_id>", methods=["PATCH"])
async def move_feed(feed_id: UUID):
    """Move a feed to a different category.

    PATCH /api/feeds/{feedId}
    Body: { "categoryId": "uuid" }

    Returns:
        Updated feed
    """
    user_id = get_current_user_id()

    data = await request.get_json()
    if not data:
        raise ValidationError("Request body is required")

    category_id_str = data.get("categoryId")
    if not category_id_str:
        raise ValidationError("Target categoryId is required")

    try:
        target_category_id = UUID(category_id_str)
    except ValueError:
        raise ValidationError("Invalid categoryId format")

    container = get_request_container()
    try:
        feed = await container.feed_service.move_feed(user_id, feed_id, target_category_id)
        return jsonify(feed.to_dict())
    except FeedNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Feed not found"
        }), 404
    except CategoryNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Target category not found"
        }), 404
    except FeedPermissionError:
        return jsonify({
            "error": "not_found",
            "message": "Feed not found"
        }), 404


@bp.route("/feeds/<uuid:feed_id>", methods=["DELETE"])
async def delete_feed(feed_id: UUID):
    """Unsubscribe from a feed.

    DELETE /api/feeds/{feedId}

    Returns:
        204: Deleted
        404: Not found
    """
    user_id = get_current_user_id()
    container = get_request_container()

    try:
        await container.feed_service.delete_feed(user_id, feed_id)
        return "", 204
    except FeedNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Feed not found"
        }), 404
    except FeedPermissionError:
        return jsonify({
            "error": "not_found",
            "message": "Feed not found"
        }), 404


@bp.route("/feeds/<uuid:feed_id>/refresh", methods=["POST"])
async def refresh_feed(feed_id: UUID):
    """Manually refresh a feed to fetch new posts.

    POST /api/feeds/{feedId}/refresh

    Returns:
        Updated feed with new posts
    """
    user_id = get_current_user_id()
    container = get_request_container()

    try:
        feed = await container.feed_service.refresh_feed(user_id, feed_id)
        return jsonify(feed.to_dict())
    except FeedNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Feed not found"
        }), 404
    except FeedPermissionError:
        return jsonify({
            "error": "not_found",
            "message": "Feed not found"
        }), 404
