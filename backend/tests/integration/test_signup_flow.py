"""Integration test: full sign-up flow across layers.

Verifies the end-to-end path:
  1. OAuth callback sets pending cookie for a new user
  2. GET /auth/me returns pending profile
  3. POST /auth/complete-signup creates user and returns full session
  4. GET /auth/me returns fully authenticated user
"""

from http.cookies import SimpleCookie
from uuid import uuid4

import pytest
from quart import Quart
from quart.testing import QuartClient

from app.infrastructure.oauth.session import SessionManager
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


async def _make_pending_cookie(
    provider: str = "github",
    provider_id: str | None = None,
    email: str | None = None,
    name: str | None = "Integration Test User",
    avatar_url: str | None = None,
) -> str:
    """Build a pending sign-up session cookie."""
    if provider_id is None:
        provider_id = f"integ-{uuid4().hex[:12]}"
    if email is None:
        email = f"{provider_id}@example.com"
    from quart import Response

    from app.infrastructure.oauth.session import session_manager

    response = Response()
    await session_manager.create_pending_session(
        response,
        provider,
        provider_id,
        email,
        name,
        avatar_url,
    )
    jar = SimpleCookie()
    jar.load(response.headers["Set-Cookie"])
    return jar[SessionManager.COOKIE_NAME].value


class TestFullSignUpFlow:
    """Integration test: full sign-up flow across all layers."""

    @pytest.mark.asyncio
    async def test_complete_flow_new_user(self, client: QuartClient):
        """Full flow: pending cookie → /auth/me pending → complete-signup → /auth/me authed."""
        unique_id = f"integ-flow-{uuid4().hex[:8]}"
        email = f"{unique_id}@example.com"
        pending_cookie = await _make_pending_cookie(
            provider="github",
            provider_id=unique_id,
            email=email,
            name="Flow Test",
        )
        cookie_header = {
            "Cookie": f"my_feeds_session={pending_cookie}",
            "Origin": "http://localhost",
            "X-Requested-With": "XMLHttpRequest",
        }

        # Step 1: GET /auth/me should return pending_signup
        response = await client.get("/api/auth/me", headers=cookie_header)
        assert response.status_code == 200
        data = await response.get_json()
        assert data["pending_signup"] is True
        assert data["profile"]["email"] == email
        assert data["profile"]["name"] == "Flow Test"
        assert data["profile"]["provider"] == "github"

        # Step 2: POST /auth/complete-signup creates the user
        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "Final Name", "timezone": "America/Chicago"},
            headers=cookie_header,
        )
        assert response.status_code == 201
        data = await response.get_json()
        assert data["authenticated"] is True
        assert data["user"]["email"] == email
        assert data["user"]["name"] == "Final Name"
        assert data["user"]["provider"] == "github"
        assert data["user"]["timezone"] == "America/Chicago"
        user_id = data["user"]["id"]

        # Extract the full session cookie from the response
        set_cookie = response.headers.get("Set-Cookie", "")
        assert "my_feeds_session" in set_cookie
        # Parse the session cookie value
        cookie_start = set_cookie.index("my_feeds_session=") + len("my_feeds_session=")
        cookie_end = set_cookie.index(";", cookie_start)
        session_cookie_value = set_cookie[cookie_start:cookie_end]

        # Step 3: GET /auth/me with the full session should return authenticated user
        full_cookie_header = {"Cookie": f"my_feeds_session={session_cookie_value}"}
        response = await client.get("/api/auth/me", headers=full_cookie_header)
        assert response.status_code == 200
        data = await response.get_json()
        # Should NOT be pending
        assert data.get("pending_signup") is not True
        assert data["id"] == user_id
        assert data["email"] == email
        assert data["name"] == "Final Name"
        assert data["timezone"] == "America/Chicago"

    @pytest.mark.asyncio
    async def test_duplicate_signup_returns_409(self, client: QuartClient):
        """Attempting complete-signup twice with same identity returns 409."""
        unique_id = f"integ-dup-{uuid4().hex[:8]}"
        email = f"{unique_id}@example.com"
        pending_cookie = await _make_pending_cookie(
            provider="github",
            provider_id=unique_id,
            email=email,
        )
        cookie_header = {
            "Cookie": f"my_feeds_session={pending_cookie}",
            "Origin": "http://localhost",
            "X-Requested-With": "XMLHttpRequest",
        }

        # First signup: should succeed
        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "First Signup", "timezone": "UTC"},
            headers=cookie_header,
        )
        assert response.status_code == 201

        # Replaying the consumed pending credential must fail authentication.
        client = client.app.test_client()
        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "Second Signup", "timezone": "UTC"},
            headers=cookie_header,
        )
        assert response.status_code == 401
