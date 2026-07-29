"""Category API routes."""

from uuid import UUID

from quart import Blueprint, jsonify, request

from app.api.middleware import UnauthorizedError, ValidationError
from app.api.middleware.conditional import cached_conditional_json
from app.application.services.category_service import (
    CategoryLimitError,
    CategoryNameConflictError,
    CategoryNotFoundError,
    CategoryPermissionError,
)
from app.config.container import get_request_container
from app.infrastructure.http.response_cache import get_response_cache
from app.infrastructure.oauth.session import session_manager

bp = Blueprint("categories", __name__, url_prefix="/categories")


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
async def list_categories():
    """List all categories for the authenticated user.

    GET /api/categories

    Returns:
        JSON array of categories ordered by position
    """
    user_id = get_current_user_id()
    container = get_request_container()

    async def build():
        categories = await container.category_service.list_categories(user_id)
        return [cat.to_dict() for cat in categories]

    return await cached_conditional_json(user_id, "categories", build)


@bp.route("", methods=["POST"])
async def create_category():
    """Create a new category.

    POST /api/categories
    Body: { "name": "Category Name" }

    Returns:
        201: Created category
        400: Validation error
        401: Not authenticated
        409: Category name already exists
    """
    user_id = get_current_user_id()

    data = await request.get_json()
    if not data:
        raise ValidationError("Request body is required")

    name = data.get("name")
    if not name:
        raise ValidationError("Category name is required")

    if len(name) > 100:
        raise ValidationError("Category name must not exceed 100 characters")

    container = get_request_container()
    try:
        category = await container.category_service.create_category(user_id, name)
        # Commit-then-invalidate: persist before clearing the cache so a concurrent
        # same-user read cannot re-cache the pre-commit body.
        await container.session.commit()
        await get_response_cache().invalidate_user(user_id)
        return jsonify(category.to_dict()), 201
    except CategoryLimitError as e:
        raise ValidationError(str(e))
    except CategoryNameConflictError:
        return jsonify({
            "error": "conflict",
            "message": f"Category '{name}' already exists"
        }), 409
    except ValueError as e:
        raise ValidationError(str(e))


@bp.route("/<uuid:category_id>", methods=["GET"])
async def get_category(category_id: UUID):
    """Get a single category with its feeds.

    GET /api/categories/{categoryId}

    Returns:
        Category details with feeds array
    """
    user_id = get_current_user_id()
    container = get_request_container()

    try:
        category = await container.category_service.get_category(user_id, category_id)
        result = category.to_dict()
        # Note: feeds will be populated by feed_service in integration
        result["feeds"] = []
        return jsonify(result)
    except CategoryNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404
    except CategoryPermissionError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404


@bp.route("/<uuid:category_id>", methods=["PATCH"])
async def update_category(category_id: UUID):
    """Update a category's name or position.

    PATCH /api/categories/{categoryId}
    Body: { "name": "New Name", "position": 0 }

    Returns:
        Updated category
    """
    user_id = get_current_user_id()

    data = await request.get_json()
    if not data:
        raise ValidationError("Request body is required")

    name = data.get("name")
    position = data.get("position")

    if name is not None and len(name) > 100:
        raise ValidationError("Category name must not exceed 100 characters")

    if position is not None and position < 0:
        raise ValidationError("Position must be non-negative")

    container = get_request_container()
    try:
        category = await container.category_service.update_category(
            user_id, category_id, name=name, position=position
        )
        # Commit-then-invalidate (see create_category).
        await container.session.commit()
        await get_response_cache().invalidate_user(user_id)
        return jsonify(category.to_dict())
    except CategoryNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404
    except CategoryPermissionError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404
    except CategoryNameConflictError:
        return jsonify({
            "error": "conflict",
            "message": f"Category '{name}' already exists"
        }), 409
    except ValueError as e:
        raise ValidationError(str(e))


@bp.route("/<uuid:category_id>", methods=["DELETE"])
async def delete_category(category_id: UUID):
    """Delete a category and all its feeds.

    DELETE /api/categories/{categoryId}

    Returns:
        204: Deleted
        404: Not found
    """
    user_id = get_current_user_id()
    container = get_request_container()

    try:
        await container.category_service.delete_category(user_id, category_id)
        # Commit-then-invalidate (see create_category).
        await container.session.commit()
        await get_response_cache().invalidate_user(user_id)
        return "", 204
    except CategoryNotFoundError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404
    except CategoryPermissionError:
        return jsonify({
            "error": "not_found",
            "message": "Category not found"
        }), 404
