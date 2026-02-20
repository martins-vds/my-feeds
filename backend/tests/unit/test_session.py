"""Unit tests for SessionManager pending session support.

TDD: Written FIRST — must FAIL until pending session methods are implemented.
Tests cover: create_pending_session, get_pending_signup, TTL expiration, clear_session.
"""

import json
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from app.infrastructure.oauth.session import SessionManager


@pytest.fixture
def session_manager():
    """Create a SessionManager instance with test settings."""
    with patch("app.infrastructure.oauth.session.get_settings") as mock_settings:
        settings = MagicMock()
        settings.is_production = False
        mock_settings.return_value = settings
        yield SessionManager()


@pytest.fixture
def mock_response():
    """Create a mock Quart Response object."""
    response = MagicMock()
    response.set_cookie = MagicMock()
    response.delete_cookie = MagicMock()
    return response


@pytest.fixture
def pending_oauth_data():
    """Sample OAuth data for a new user."""
    return {
        "provider": "github",
        "provider_id": "12345",
        "email": "jane@example.com",
        "name": "Jane Doe",
        "avatar_url": "https://avatars.githubusercontent.com/u/12345",
    }


class TestCreatePendingSession:
    """Tests for create_pending_session()."""

    def test_sets_cookie_with_pending_signup_fields(
        self, session_manager, mock_response, pending_oauth_data
    ):
        """create_pending_session() should set a cookie with pending_signup data."""
        session_manager.create_pending_session(
            response=mock_response,
            provider=pending_oauth_data["provider"],
            provider_id=pending_oauth_data["provider_id"],
            email=pending_oauth_data["email"],
            name=pending_oauth_data["name"],
            avatar_url=pending_oauth_data["avatar_url"],
        )

        mock_response.set_cookie.assert_called_once()
        call_args = mock_response.set_cookie.call_args

        # Cookie name should be the standard session cookie
        assert call_args[0][0] == SessionManager.COOKIE_NAME

        # Parse the cookie value
        cookie_value = json.loads(call_args[0][1])

        assert cookie_value["provider"] == "github"
        assert cookie_value["provider_id"] == "12345"
        assert cookie_value["email"] == "jane@example.com"
        assert cookie_value["name"] == "Jane Doe"
        assert cookie_value["avatar_url"] == "https://avatars.githubusercontent.com/u/12345"
        assert "pending_created_at" in cookie_value
        # No user_id in pending session
        assert "user_id" not in cookie_value

    def test_sets_httponly_cookie(self, session_manager, mock_response, pending_oauth_data):
        """Pending session cookie should be HttpOnly."""
        session_manager.create_pending_session(
            response=mock_response,
            provider=pending_oauth_data["provider"],
            provider_id=pending_oauth_data["provider_id"],
            email=pending_oauth_data["email"],
            name=pending_oauth_data["name"],
            avatar_url=pending_oauth_data["avatar_url"],
        )

        call_kwargs = mock_response.set_cookie.call_args[1]
        assert call_kwargs["httponly"] is True
        assert call_kwargs["samesite"] == "Lax"

    def test_handles_none_name_and_avatar(self, session_manager, mock_response):
        """create_pending_session() should work with None name and avatar_url."""
        session_manager.create_pending_session(
            response=mock_response,
            provider="google",
            provider_id="67890",
            email="user@gmail.com",
            name=None,
            avatar_url=None,
        )

        call_args = mock_response.set_cookie.call_args
        cookie_value = json.loads(call_args[0][1])
        assert cookie_value["name"] is None
        assert cookie_value["avatar_url"] is None


class TestGetPendingSignup:
    """Tests for get_pending_signup()."""

    def test_reads_and_returns_pending_data(self, session_manager, pending_oauth_data):
        """get_pending_signup() should read pending data from request cookie."""
        pending_cookie = {
            "provider": "github",
            "provider_id": "12345",
            "email": "jane@example.com",
            "name": "Jane Doe",
            "avatar_url": "https://avatars.githubusercontent.com/u/12345",
            "pending_created_at": datetime.utcnow().isoformat(),
        }

        mock_request = MagicMock()
        mock_request.cookies = {SessionManager.COOKIE_NAME: json.dumps(pending_cookie)}

        result = session_manager.get_pending_signup(mock_request)

        assert result is not None
        assert result["provider"] == "github"
        assert result["provider_id"] == "12345"
        assert result["email"] == "jane@example.com"
        assert result["name"] == "Jane Doe"
        assert result["avatar_url"] == "https://avatars.githubusercontent.com/u/12345"

    def test_returns_none_for_no_cookie(self, session_manager):
        """get_pending_signup() should return None when no cookie exists."""
        mock_request = MagicMock()
        mock_request.cookies = {}

        result = session_manager.get_pending_signup(mock_request)
        assert result is None

    def test_returns_none_for_full_session_cookie(self, session_manager):
        """get_pending_signup() should return None for a fully authenticated session."""
        full_session = {
            "user_id": "550e8400-e29b-41d4-a716-446655440000",
            "provider": "github",
            "created_at": datetime.utcnow().isoformat(),
        }

        mock_request = MagicMock()
        mock_request.cookies = {SessionManager.COOKIE_NAME: json.dumps(full_session)}

        result = session_manager.get_pending_signup(mock_request)
        assert result is None

    def test_expired_pending_returns_none(self, session_manager):
        """get_pending_signup() should return None for expired pending data (>15 min)."""
        expired_cookie = {
            "provider": "github",
            "provider_id": "12345",
            "email": "jane@example.com",
            "name": "Jane Doe",
            "avatar_url": None,
            "pending_created_at": (datetime.utcnow() - timedelta(minutes=16)).isoformat(),
        }

        mock_request = MagicMock()
        mock_request.cookies = {SessionManager.COOKIE_NAME: json.dumps(expired_cookie)}

        result = session_manager.get_pending_signup(mock_request)
        assert result is None

    def test_just_within_ttl_returns_data(self, session_manager):
        """get_pending_signup() should return data for pending within 15-min TTL."""
        valid_cookie = {
            "provider": "github",
            "provider_id": "12345",
            "email": "jane@example.com",
            "name": "Jane Doe",
            "avatar_url": None,
            "pending_created_at": (datetime.utcnow() - timedelta(minutes=14)).isoformat(),
        }

        mock_request = MagicMock()
        mock_request.cookies = {SessionManager.COOKIE_NAME: json.dumps(valid_cookie)}

        result = session_manager.get_pending_signup(mock_request)
        assert result is not None
        assert result["provider"] == "github"

    def test_returns_none_for_malformed_cookie(self, session_manager):
        """get_pending_signup() should return None for malformed cookie data."""
        mock_request = MagicMock()
        mock_request.cookies = {SessionManager.COOKIE_NAME: "not-valid-json"}

        result = session_manager.get_pending_signup(mock_request)
        assert result is None

    def test_returns_none_for_missing_required_fields(self, session_manager):
        """get_pending_signup() should return None if required fields are missing."""
        incomplete_cookie = {
            "provider": "github",
            # missing provider_id, email, pending_created_at
        }

        mock_request = MagicMock()
        mock_request.cookies = {SessionManager.COOKIE_NAME: json.dumps(incomplete_cookie)}

        result = session_manager.get_pending_signup(mock_request)
        assert result is None


class TestClearSessionRemovesPending:
    """Tests for clear_session() removing pending cookie."""

    def test_clear_session_removes_cookie(self, session_manager, mock_response):
        """clear_session() should delete the session cookie (including pending)."""
        session_manager.clear_session(mock_response)

        mock_response.delete_cookie.assert_called_once_with(
            SessionManager.COOKIE_NAME,
            path="/",
        )
