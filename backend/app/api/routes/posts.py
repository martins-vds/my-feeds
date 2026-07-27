"""Post API routes."""

from datetime import datetime
from uuid import UUID

from quart import Blueprint, jsonify, request

from app.api.middleware import UnauthorizedError, ValidationError
from app.application.services.post_service import (
    PostNotFoundError,
    PostPermissionError,
)
from app.config.container import get_request_container
from app.infrastructure.oauth.session import session_manager

bp = Blueprint("posts", __name__, url_prefix="/posts")


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


@bp.route("", methods=["GET"])
async def list_posts():
    """List latest posts from all subscribed feeds.

    GET /api/posts

    Query parameters:
        categoryId: Filter by category (UUID)
        feedId: Filter by feed (UUID)
        readState: Filter by read state (all|unread|read, default: all)
        limit: Maximum posts to return (1-100, default: 50)
        before: Cursor for pagination (ISO 8601 timestamp)

    Returns:
        JSON object with posts array, hasMore, and nextCursor
    """
    user_id = get_current_user_id()
    container = get_request_container()

    # Parse query parameters
    category_id_str = request.args.get("categoryId")
    feed_id_str = request.args.get("feedId")
    read_state = request.args.get("readState", "all")
    limit_str = request.args.get("limit", "50")
    before_str = request.args.get("before")

    # Validate and convert parameters
    category_id = None
    uncategorized = False
    if category_id_str == "none":
        # Sentinel: posts from feeds that have no categories.
        uncategorized = True
    elif category_id_str:
        try:
            category_id = UUID(category_id_str)
        except ValueError:
            raise ValidationError("Invalid categoryId format")

    feed_id = None
    if feed_id_str:
        try:
            feed_id = UUID(feed_id_str)
        except ValueError:
            raise ValidationError("Invalid feedId format")

    if read_state not in ("all", "unread", "read"):
        raise ValidationError("readState must be one of: all, unread, read")

    try:
        limit = int(limit_str)
        if limit < 1:
            limit = 1
        elif limit > 100:
            limit = 100
    except ValueError:
        limit = 50

    before = None
    if before_str:
        try:
            before = datetime.fromisoformat(before_str.replace("Z", "+00:00"))
        except ValueError:
            raise ValidationError("Invalid before timestamp format")

    # Get posts from service
    result = await container.post_service.list_posts(
        user_id=user_id,
        category_id=category_id,
        feed_id=feed_id,
        read_state=read_state,  # type: ignore
        before=before,
        limit=limit,
        uncategorized=uncategorized,
    )

    return jsonify(
        {
            "posts": [post.to_summary_dict() for post in result.posts],
            "hasMore": result.has_more,
            "nextCursor": result.next_cursor,
        }
    )


@bp.route("/unread-counts", methods=["GET"])
async def unread_counts():
    """Return unread post counts per feed and the total for the user.

    GET /api/posts/unread-counts

    Returns:
        JSON: { "byFeed": { "<feedId>": <count> }, "total": <count> }
    """
    user_id = get_current_user_id()
    container = get_request_container()

    by_feed, total = await container.post_service.get_unread_counts(user_id)

    return jsonify(
        {
            "byFeed": {str(feed_id): count for feed_id, count in by_feed.items()},
            "total": total,
        }
    )


@bp.route("/<uuid:post_id>", methods=["GET"])
async def get_post(post_id: UUID):
    """Get full post content.

    GET /api/posts/{postId}

    Auto-marks the post as read.

    Returns:
        PostDetail with full content
    """
    user_id = get_current_user_id()
    container = get_request_container()

    try:
        # Get post
        post = await container.post_service.get_post(user_id, post_id)

        # Auto-mark as read
        await container.post_service.auto_mark_read(user_id, post_id)
        post.is_read = True

        return jsonify(post.to_detail_dict())
    except PostNotFoundError:
        return jsonify({"error": "not_found", "message": "Post not found"}), 404
    except PostPermissionError:
        return jsonify({"error": "not_found", "message": "Post not found"}), 404


@bp.route("/<uuid:post_id>/read-state", methods=["PUT"])
async def update_read_state(post_id: UUID):
    """Update post read state.

    PUT /api/posts/{postId}/read-state
    Body: { "isRead": true }

    Returns:
        ReadState with updated values
    """
    user_id = get_current_user_id()
    container = get_request_container()

    data = await request.get_json()
    if not data:
        raise ValidationError("Request body is required")

    is_read = data.get("isRead")
    if is_read is None:
        raise ValidationError("isRead is required")
    if not isinstance(is_read, bool):
        raise ValidationError("isRead must be a boolean")

    try:
        is_read_result, read_at = await container.post_service.mark_as_read(
            user_id, post_id, is_read
        )

        return jsonify(
            {
                "postId": str(post_id),
                "isRead": is_read_result,
                "readAt": read_at.isoformat() if read_at else None,
            }
        )
    except PostNotFoundError:
        return jsonify({"error": "not_found", "message": "Post not found"}), 404
    except PostPermissionError:
        return jsonify({"error": "not_found", "message": "Post not found"}), 404
