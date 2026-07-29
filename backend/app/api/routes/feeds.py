"""Feed API routes."""

from uuid import UUID

from quart import Blueprint, current_app, jsonify, request

from app.api.middleware import UnauthorizedError, ValidationError
from app.api.middleware.conditional import cached_conditional_json, conditional_json
from app.infrastructure.http.response_cache import get_response_cache
from app.application.services.feed_service import (
    CategoryNotFoundError,
    FeedConflictError,
    FeedLimitError,
    FeedNotFoundError,
    FeedPermissionError,
)
from app.config.container import get_request_container
from app.domain.feed_management.services.feed_validator import FeedValidationError
from app.infrastructure.jobs.feed_ingestion import ingest_feed_posts
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


def _parse_category_ids(raw: object) -> list[UUID]:
    """Parse a list of category UUID strings from request data."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValidationError("categoryIds must be an array")
    ids: list[UUID] = []
    for item in raw:
        try:
            ids.append(UUID(str(item)))
        except (ValueError, TypeError):
            raise ValidationError(f"Invalid category id: {item}")
    return ids


@bp.route("/categories/<uuid:category_id>/feeds", methods=["GET"])
async def list_feeds_in_category(category_id: UUID):
    """List all feeds in a category.

    GET /api/categories/{categoryId}/feeds

    Returns:
        JSON array of feeds in the category
    """
    user_id = get_current_user_id()
    container = get_request_container()

    async def build():
        feeds = await container.feed_service.list_feeds_in_category(user_id, category_id)
        return [feed.to_dict() for feed in feeds]

    try:
        return await cached_conditional_json(user_id, f"category-feeds:{category_id}", build)
    except CategoryNotFoundError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404
    except FeedPermissionError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404


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
        feed = await container.feed_service.add_feed(user_id, url, [category_id])
        # Commit so the new feed is visible, then ingest its posts in the
        # background instead of blocking the request.
        await container.session.commit()
        await get_response_cache().invalidate_user(user_id)
        current_app.add_background_task(ingest_feed_posts, feed.id)
        return jsonify(feed.to_dict()), 201
    except FeedLimitError as e:
        raise ValidationError(str(e))
    except FeedConflictError:
        return jsonify(
            {"error": "conflict", "message": "Feed already subscribed in this category"}
        ), 409
    except FeedValidationError as e:
        return jsonify({"error": "invalid_feed", "message": str(e)}), 400
    except CategoryNotFoundError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404
    except FeedPermissionError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404


@bp.route("/feeds", methods=["GET"])
async def list_all_feeds():
    """List all of the current user's feeds, each with its categories.

    GET /api/feeds
    GET /api/feeds?uncategorized=true  -> only feeds that have no category
    """
    user_id = get_current_user_id()
    container = get_request_container()
    uncategorized = request.args.get("uncategorized") == "true"

    async def build():
        if uncategorized:
            feeds = await container.feed_service.list_uncategorized_feeds(user_id)
        else:
            feeds = await container.feed_service.list_all_feeds(user_id)
        return [feed.to_dict() for feed in feeds]

    if uncategorized:
        return await cached_conditional_json(user_id, "feeds:uncategorized", build)
    return await conditional_json(build)


@bp.route("/feeds", methods=["POST"])
async def create_feed():
    """Create a feed subscription for the current user.

    POST /api/feeds
    Body: { "url": "https://...", "categoryIds": ["uuid", ...] }

    categoryIds is optional; an empty/omitted list creates an uncategorized feed.

    Returns:
        201: Created feed
        400: Invalid URL / not a valid feed
        404: A category was not found
        409: Feed already subscribed
    """
    user_id = get_current_user_id()

    data = await request.get_json()
    if not data:
        raise ValidationError("Request body is required")

    url = data.get("url")
    if not url:
        raise ValidationError("Feed URL is required")

    category_ids = _parse_category_ids(data.get("categoryIds"))

    container = get_request_container()
    try:
        feed = await container.feed_service.add_feed(user_id, url, category_ids)
        # Commit so the new feed is visible, then ingest its posts in the
        # background instead of blocking the request.
        await container.session.commit()
        await get_response_cache().invalidate_user(user_id)
        current_app.add_background_task(ingest_feed_posts, feed.id)
        return jsonify(feed.to_dict()), 201
    except FeedLimitError as e:
        raise ValidationError(str(e))
    except FeedConflictError:
        return jsonify({"error": "conflict", "message": "Feed already subscribed"}), 409
    except FeedValidationError as e:
        return jsonify({"error": "invalid_feed", "message": str(e)}), 400
    except CategoryNotFoundError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404
    except FeedPermissionError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404


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
        return jsonify({"error": "not_found", "message": "Feed not found"}), 404
    except FeedPermissionError:
        return jsonify({"error": "not_found", "message": "Feed not found"}), 404


@bp.route("/feeds/<uuid:feed_id>", methods=["PATCH"])
async def update_feed(feed_id: UUID):
    """Update a feed's mutable fields.

    PATCH /api/feeds/{feedId}
    Body (any subset):
        { "categoryIds": ["uuid", ...] }   # replace category labels
        { "isActive": true | false }        # resume / pause scheduled ingestion

    Returns:
        Updated feed
    """
    user_id = get_current_user_id()

    data = await request.get_json()
    if not data:
        raise ValidationError("Request body is required")

    if "categoryIds" not in data and "isActive" not in data:
        raise ValidationError("categoryIds or isActive is required")

    # Validate the isActive type BEFORE any mutation so a bad value can't leave a
    # partial update (categories changed) paired with a stale cache — the cache is
    # only invalidated after both mutations succeed.
    if "isActive" in data and not isinstance(data["isActive"], bool):
        raise ValidationError("isActive must be a boolean")

    container = get_request_container()
    try:
        feed = None
        if "categoryIds" in data:
            category_ids = _parse_category_ids(data.get("categoryIds"))
            feed = await container.feed_service.set_feed_categories(user_id, feed_id, category_ids)
        if "isActive" in data:
            feed = await container.feed_service.set_feed_active(user_id, feed_id, data["isActive"])
        # Commit-then-invalidate: persist before clearing the cache so a concurrent
        # same-user read cannot re-cache the pre-commit body.
        await container.session.commit()
        await get_response_cache().invalidate_user(user_id)
        return jsonify(feed.to_dict())
    except FeedNotFoundError:
        return jsonify({"error": "not_found", "message": "Feed not found"}), 404
    except CategoryNotFoundError:
        return jsonify({"error": "not_found", "message": "Category not found"}), 404
    except FeedPermissionError:
        return jsonify({"error": "not_found", "message": "Feed not found"}), 404


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
        # Commit-then-invalidate (see update_feed).
        await container.session.commit()
        await get_response_cache().invalidate_user(user_id)
        return "", 204
    except FeedNotFoundError:
        return jsonify({"error": "not_found", "message": "Feed not found"}), 404
    except FeedPermissionError:
        return jsonify({"error": "not_found", "message": "Feed not found"}), 404


@bp.route("/feeds/<uuid:feed_id>/refresh", methods=["POST"])
async def refresh_feed(feed_id: UUID):
    """Trigger a background refresh of a feed's posts.

    POST /api/feeds/{feedId}/refresh

    New posts are fetched and stored asynchronously; the response returns
    immediately with the current feed. Paused feeds cannot be refreshed
    (resume the feed first) and return 409.
    """
    user_id = get_current_user_id()
    container = get_request_container()

    try:
        # Verify ownership, then re-fetch posts in the background.
        feed = await container.feed_service.get_feed(user_id, feed_id)
        if not feed.is_active:
            return (
                jsonify(
                    {
                        "error": "feed_paused",
                        "message": "Feed is paused. Resume it to refresh.",
                    }
                ),
                409,
            )
        current_app.add_background_task(ingest_feed_posts, feed_id)
        return jsonify(feed.to_dict())
    except FeedNotFoundError:
        return jsonify({"error": "not_found", "message": "Feed not found"}), 404
    except FeedPermissionError:
        return jsonify({"error": "not_found", "message": "Feed not found"}), 404
