"""Session management with secure cookies."""

import json
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from quart import Request, Response

from app.config.settings import get_settings


class SessionManager:
    """Manage user sessions using secure HTTP-only cookies."""

    COOKIE_NAME = "my_feeds_session"
    SESSION_DURATION_DAYS = 30

    def __init__(self) -> None:
        """Initialize session manager."""
        self._settings = get_settings()

    def create_session(
        self,
        response: Response,
        user_id: UUID,
        provider: str,
    ) -> None:
        """Create a session cookie for the authenticated user.

        Args:
            response: Quart response object
            user_id: The user's UUID
            provider: OAuth provider used for authentication
        """
        session_data = {
            "user_id": str(user_id),
            "provider": provider,
            "created_at": datetime.utcnow().isoformat(),
        }

        # In production, this should be encrypted/signed
        # For MVP, we'll use a simple JSON string
        # TODO: Add proper session encryption with SECRET_KEY
        session_value = json.dumps(session_data)

        expires = datetime.utcnow() + timedelta(days=self.SESSION_DURATION_DAYS)

        response.set_cookie(
            self.COOKIE_NAME,
            session_value,
            httponly=True,
            secure=self._settings.is_production,
            samesite="Lax",
            expires=expires,
            path="/",
        )

    def get_session(self, request: Request) -> dict[str, Any] | None:
        """Get session data from request cookies.

        Args:
            request: Quart request object

        Returns:
            Session data dict or None if no valid session
        """
        session_cookie = request.cookies.get(self.COOKIE_NAME)

        if not session_cookie:
            return None

        try:
            session_data = json.loads(session_cookie)

            # Validate session data
            if not all(k in session_data for k in ["user_id", "provider", "created_at"]):
                return None

            # Check session age
            created_at = datetime.fromisoformat(session_data["created_at"])
            if datetime.utcnow() - created_at > timedelta(days=self.SESSION_DURATION_DAYS):
                return None

            return session_data
        except (json.JSONDecodeError, ValueError):
            return None

    def get_user_id(self, request: Request) -> UUID | None:
        """Get user ID from session.

        Args:
            request: Quart request object

        Returns:
            User UUID or None if not authenticated
        """
        session = self.get_session(request)
        if session:
            try:
                return UUID(session["user_id"])
            except ValueError:
                return None
        return None

    def clear_session(self, response: Response) -> None:
        """Clear the session cookie.

        Args:
            response: Quart response object
        """
        response.delete_cookie(
            self.COOKIE_NAME,
            path="/",
        )


# Singleton instance
session_manager = SessionManager()
