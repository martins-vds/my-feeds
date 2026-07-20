"""Error handling middleware for consistent API error responses."""

import logging
from functools import wraps
from typing import Any, Callable

from quart import Response, jsonify
from werkzeug.exceptions import HTTPException

logger = logging.getLogger(__name__)


class APIError(Exception):
    """Base exception for API errors."""

    def __init__(
        self,
        message: str,
        status_code: int = 400,
        error_code: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.error_code = error_code or "BAD_REQUEST"
        self.details = details or {}


class NotFoundError(APIError):
    """Resource not found error."""

    def __init__(self, message: str = "Resource not found", **kwargs: Any) -> None:
        super().__init__(message, status_code=404, error_code="NOT_FOUND", **kwargs)


class UnauthorizedError(APIError):
    """Authentication required error."""

    def __init__(self, message: str = "Authentication required", **kwargs: Any) -> None:
        super().__init__(message, status_code=401, error_code="UNAUTHORIZED", **kwargs)


class ForbiddenError(APIError):
    """Access denied error."""

    def __init__(self, message: str = "Access denied", **kwargs: Any) -> None:
        super().__init__(message, status_code=403, error_code="FORBIDDEN", **kwargs)


class ValidationError(APIError):
    """Request validation error."""

    def __init__(self, message: str = "Validation failed", **kwargs: Any) -> None:
        super().__init__(message, status_code=400, error_code="VALIDATION_ERROR", **kwargs)


class ConflictError(APIError):
    """Resource conflict error."""

    def __init__(self, message: str = "Resource conflict", **kwargs: Any) -> None:
        super().__init__(message, status_code=409, error_code="CONFLICT", **kwargs)


def error_response(error: APIError) -> tuple[Response, int]:
    """Create a standardized error response.

    Args:
        error: The API error to convert to a response.

    Returns:
        Tuple of (JSON response, status code).
    """
    response_body = {
        "error": {
            "code": error.error_code,
            "message": error.message,
        }
    }
    if error.details:
        response_body["error"]["details"] = error.details

    return jsonify(response_body), error.status_code


async def handle_api_error(error: APIError) -> tuple[Response, int]:
    """Handle APIError exceptions.

    Args:
        error: The API error that was raised.

    Returns:
        Standardized error response.
    """
    logger.warning(f"API Error: {error.error_code} - {error.message}")
    return error_response(error)


async def handle_http_exception(error: HTTPException) -> tuple[Response, int]:
    """Handle werkzeug/Quart HTTP exceptions (404, 405, ...).

    These are expected client errors (e.g. requesting an unknown route), so they
    are returned with their proper status code and logged without a traceback
    rather than being treated as unexpected server errors.

    Args:
        error: The HTTP exception that was raised.

    Returns:
        Standardized error response using the exception's status code.
    """
    status_code = error.code or 500
    logger.info("HTTP %d: %s", status_code, error.name)
    return (
        jsonify(
            {
                "error": {
                    "code": error.name.upper().replace(" ", "_"),
                    "message": error.description or error.name,
                }
            }
        ),
        status_code,
    )


async def handle_unexpected_error(error: Exception) -> tuple[Response, int]:
    """Handle unexpected exceptions.

    Args:
        error: The unexpected exception.

    Returns:
        Generic 500 error response.
    """
    logger.exception(f"Unexpected error: {error}")
    return (
        jsonify(
            {
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "An unexpected error occurred",
                }
            }
        ),
        500,
    )


def register_error_handlers(app: Any) -> None:
    """Register error handlers with the Quart application.

    Args:
        app: The Quart application instance.
    """
    app.register_error_handler(APIError, handle_api_error)
    app.register_error_handler(HTTPException, handle_http_exception)
    app.register_error_handler(Exception, handle_unexpected_error)
