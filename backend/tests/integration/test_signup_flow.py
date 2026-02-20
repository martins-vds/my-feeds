"""Integration test: full sign-up flow across layers.

Verifies the end-to-end path:
  1. OAuth callback sets pending cookie for a new user
  2. GET /auth/me returns pending profile
  3. POST /auth/complete-signup creates user and returns full session
  4. GET /auth/me returns fully authenticated user
"""

import json
from datetime import datetime
from uuid import uuid4

import pytest
from quart import Quart
from quart.testing import QuartClient

from app.main import create_app
from app.infrastructure.oauth.session import SessionManager


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


def _make_pending_cookie(
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
    data = {
        "provider": provider,
        "provider_id": provider_id,
        "email": email,
        "name": name,
        "avatar_url": avatar_url,
        "pending_created_at": datetime.utcnow().isoformat(),
    }
    return json.dumps(data)


class TestFullSignUpFlow:
    """Integration test: full sign-up flow across all layers."""

    @pytest.mark.asyncio
    async def test_complete_flow_new_user(self, client: QuartClient):
        """Full flow: pending cookie → /auth/me pending → complete-signup → /auth/me authed."""
        unique_id = f"integ-flow-{uuid4().hex[:8]}"
        email = f"{unique_id}@example.com"
        pending_cookie = _make_pending_cookie(
            provider="github",
            provider_id=unique_id,
            email=email,
            name="Flow Test",
        )
        cookie_header = {"Cookie": f"my_feeds_session={pending_cookie}"}

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
        pending_cookie = _make_pending_cookie(
            provider="github",
            provider_id=unique_id,
            email=email,
        )
        cookie_header = {"Cookie": f"my_feeds_session={pending_cookie}"}

        # First signup: should succeed
        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "First Signup", "timezone": "UTC"},
            headers=cookie_header,
        )
        assert response.status_code == 201

        # Second signup with same identity: should get 409
        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "Second Signup", "timezone": "UTC"},
            headers=cookie_header,
        )
        assert response.status_code == 409
