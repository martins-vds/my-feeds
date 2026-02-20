"""Contract tests for auth API endpoints.

These tests verify the API contract matches the OpenAPI specification.
TDD: Written FIRST - must FAIL until implementation is complete.
"""

import pytest
from quart import Quart
from quart.testing import QuartClient

from app.main import create_app


@pytest.fixture
def app() -> Quart:
    """Create test application instance."""
    app = create_app()
    app.config["TESTING"] = True
    return app


@pytest.fixture
def client(app: Quart) -> QuartClient:
    """Create test client."""
    return app.test_client()


class TestAuthLoginEndpoint:
    """Tests for GET /api/auth/login/{provider}."""

    @pytest.mark.asyncio
    async def test_login_github_redirects_to_oauth(self, client: QuartClient):
        """GET /api/auth/login/github should redirect to GitHub OAuth."""
        response = await client.get("/api/auth/login/github")

        assert response.status_code == 302
        location = response.headers.get("Location", "")
        assert "github.com" in location or "oauth" in location.lower()

    @pytest.mark.asyncio
    async def test_login_google_redirects_to_oauth(self, client: QuartClient):
        """GET /api/auth/login/google should redirect to Google OAuth."""
        response = await client.get("/api/auth/login/google")

        assert response.status_code == 302
        location = response.headers.get("Location", "")
        assert "google.com" in location or "accounts.google" in location

    @pytest.mark.asyncio
    async def test_login_microsoft_redirects_to_oauth(self, client: QuartClient):
        """GET /api/auth/login/microsoft should redirect to Microsoft OAuth."""
        response = await client.get("/api/auth/login/microsoft")

        assert response.status_code == 302
        location = response.headers.get("Location", "")
        assert "microsoft" in location.lower() or "login.microsoftonline" in location

    @pytest.mark.asyncio
    async def test_login_invalid_provider_returns_400(self, client: QuartClient):
        """GET /api/auth/login/{invalid} should return 400 Bad Request."""
        response = await client.get("/api/auth/login/invalid_provider")

        assert response.status_code == 400
        data = await response.get_json()
        assert "error" in data


class TestAuthCallbackEndpoint:
    """Tests for GET /api/auth/{provider}/callback."""

    @pytest.mark.asyncio
    async def test_callback_without_code_returns_400(self, client: QuartClient):
        """GET /api/auth/github/callback without code should return 400."""
        response = await client.get("/api/auth/github/callback")

        assert response.status_code == 400
        data = await response.get_json()
        assert "error" in data

    @pytest.mark.asyncio
    async def test_callback_with_error_param_returns_401(self, client: QuartClient):
        """GET /api/auth/github/callback with error param should return 401."""
        response = await client.get("/api/auth/github/callback?error=access_denied")

        assert response.status_code == 401
        data = await response.get_json()
        assert "error" in data


class TestAuthMeEndpoint:
    """Tests for GET /api/auth/me."""

    @pytest.mark.asyncio
    async def test_me_without_session_returns_401(self, client: QuartClient):
        """GET /api/auth/me without session should return 401 Unauthorized."""
        response = await client.get("/api/auth/me")

        assert response.status_code == 401
        data = await response.get_json()
        assert data["error"]["code"] == "UNAUTHORIZED"

    @pytest.mark.asyncio
    async def test_me_with_valid_session_returns_user(self, client: QuartClient):
        """GET /api/auth/me with valid session should return user data."""
        # This test requires a mock session - will be implemented with auth
        # For now, skip until we have session management
        pytest.skip("Requires session management implementation")


class TestAuthLogoutEndpoint:
    """Tests for POST /api/auth/logout."""

    @pytest.mark.asyncio
    async def test_logout_clears_session(self, client: QuartClient):
        """POST /api/auth/logout should clear session and return 200."""
        response = await client.post("/api/auth/logout")

        # Should succeed even without session (idempotent)
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_logout_returns_success_message(self, client: QuartClient):
        """POST /api/auth/logout should return success message."""
        response = await client.post("/api/auth/logout")

        assert response.status_code == 200
        data = await response.get_json()
        assert "message" in data or "status" in data
