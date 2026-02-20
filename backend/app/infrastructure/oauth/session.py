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
    PENDING_TTL_MINUTES = 15

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

    def get_current_user_id(self) -> UUID | None:
        """Get user ID from the current request context.

        Convenience method that uses quart.request automatically.

        Returns:
            User UUID or None if not authenticated
        """
        from quart import request as current_request

        return self.get_user_id(current_request)

    def clear_session(self, response: Response) -> None:
        """Clear the session cookie.

        Args:
            response: Quart response object
        """
        response.delete_cookie(
            self.COOKIE_NAME,
            path="/",
        )

    def create_pending_session(
        self,
        response: Response,
        provider: str,
        provider_id: str,
        email: str,
        name: str | None = None,
        avatar_url: str | None = None,
    ) -> None:
        """Create a pending sign-up session cookie with OAuth data.

        Sets a cookie that holds OAuth profile data while the user
        completes the sign-up form. No user_id — distinguishes it
        from a fully-authenticated session.

        Args:
            response: Quart response object
            provider: OAuth provider name
            provider_id: User ID from the OAuth provider
            email: Email from the OAuth provider
            name: Display name from OAuth (pre-fill)
            avatar_url: Avatar URL from OAuth
        """
        pending_data = {
            "provider": provider,
            "provider_id": provider_id,
            "email": email,
            "name": name,
            "avatar_url": avatar_url,
            "pending_created_at": datetime.utcnow().isoformat(),
        }

        session_value = json.dumps(pending_data)

        expires = datetime.utcnow() + timedelta(minutes=self.PENDING_TTL_MINUTES)

        response.set_cookie(
            self.COOKIE_NAME,
            session_value,
            httponly=True,
            secure=self._settings.is_production,
            samesite="Lax",
            expires=expires,
            path="/",
        )

    def get_pending_signup(self, request: Request) -> dict[str, Any] | None:
        """Get pending sign-up data from request cookie.

        Returns the pending OAuth data if the cookie exists, is valid,
        and has not expired (within PENDING_TTL_MINUTES). Returns None
        for fully-authenticated sessions (those with user_id).

        Args:
            request: Quart request object

        Returns:
            Pending sign-up data dict or None
        """
        session_cookie = request.cookies.get(self.COOKIE_NAME)

        if not session_cookie:
            return None

        try:
            data = json.loads(session_cookie)

            # If it's a full session (has user_id), this is NOT a pending signup
            if "user_id" in data:
                return None

            # Validate required pending fields
            required = ("provider", "provider_id", "email", "pending_created_at")
            if not all(k in data for k in required):
                return None

            # Check TTL
            created_at = datetime.fromisoformat(data["pending_created_at"])
            if datetime.utcnow() - created_at > timedelta(minutes=self.PENDING_TTL_MINUTES):
                return None

            return data
        except (json.JSONDecodeError, ValueError, KeyError):
            return None


# Singleton instance
session_manager = SessionManager()
