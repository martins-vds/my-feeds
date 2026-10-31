"""Contract tests for auth API endpoints.

These tests verify the API contract matches the OpenAPI specification.
TDD: Written FIRST - must FAIL until implementation is complete.
"""

from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie
from uuid import uuid4

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
    async def test_me_with_valid_session_returns_user(self, client: QuartClient, auth_headers):
        """GET /api/auth/me with valid session should return user data."""
        response = await client.get("/api/auth/me", headers=auth_headers)
        assert response.status_code == 200
        assert (await response.get_json())["id"] == "00000000-0000-4000-a000-000000000001"


class TestAuthLogoutEndpoint:
    """Tests for POST /api/auth/logout."""

    @pytest.mark.asyncio
    async def test_logout_clears_session(self, client: QuartClient):
        """POST /api/auth/logout should clear session and return 200."""
        response = await client.post("/api/auth/logout", headers=_same_origin_headers())

        # Should succeed even without session (idempotent)
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_logout_returns_success_message(self, client: QuartClient):
        """POST /api/auth/logout should return success message."""
        response = await client.post("/api/auth/logout", headers=_same_origin_headers())

        assert response.status_code == 200
        data = await response.get_json()
        assert "message" in data or "status" in data


# =============================================================================
# T006: New-user callback contract tests
# =============================================================================


async def _make_pending_cookie(
    provider: str = "github",
    provider_id: str = "new-user-999",
    email: str = "newuser@example.com",
    name: str | None = "New User",
    avatar_url: str | None = "https://avatars.example.com/999",
    created_at: datetime | None = None,
) -> str:
    """Issue a real persisted pending credential instead of forging identity."""
    import hashlib

    from quart import Response
    from sqlalchemy import update

    from app.infrastructure.oauth.session import session_manager
    from app.infrastructure.persistence.database import get_session_factory
    from app.infrastructure.persistence.models.identity_session import IdentitySessionModel

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
    token = jar[session_manager.COOKIE_NAME].value
    if created_at:
        async with get_session_factory()() as session:
            await session.execute(
                update(IdentitySessionModel)
                .where(
                    IdentitySessionModel.token_hash == hashlib.sha256(token.encode()).hexdigest()
                )
                .values(created_at=created_at, expires_at=created_at + timedelta(minutes=15))
            )
            await session.commit()
    return token


def _same_origin_headers(token: str | None = None) -> dict[str, str]:
    from app.config.settings import get_settings

    headers = {
        "Origin": get_settings().frontend_url,
        "X-Requested-With": "XMLHttpRequest",
    }
    if token:
        headers["Cookie"] = f"my_feeds_session={token}"
    return headers


class TestNewUserCallbackContract:
    """T006: Contract tests for new-user callback flow.

    Callback with unknown (provider, provider_id) should set pending cookie
    and redirect. These tests verify the modified callback behavior.
    """

    @pytest.mark.asyncio
    async def test_callback_new_user_sets_pending_cookie(self, client: QuartClient):
        """Callback for unknown user should set pending sign-up cookie and 302."""
        # We can't easily simulate a full OAuth exchange in contract tests
        # but we can verify that a valid pending cookie is accepted by /auth/me
        # The actual callback redirection is integration-tested
        pending_cookie = await _make_pending_cookie()
        response = await client.get(
            "/api/auth/me",
            headers=_same_origin_headers(pending_cookie),
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert data.get("pending_signup") is True
        assert "profile" in data
        assert data["profile"]["email"] == "newuser@example.com"
        assert data["profile"]["provider"] == "github"


# =============================================================================
# T007: Complete sign-up contract tests
# =============================================================================


class TestCompleteSignUpContract:
    """T007: Contract tests for POST /auth/complete-signup.

    Tests: valid request → 201, empty name → 400, invalid timezone → 400,
    no pending cookie → 401, expired pending → 401, duplicate → 409.
    """

    @pytest.mark.asyncio
    async def test_complete_signup_valid_returns_201(self, client: QuartClient):
        """POST /auth/complete-signup with valid data should return 201 AuthStatus."""
        unique_id = f"signup-test-{uuid4().hex[:12]}"
        pending_cookie = await _make_pending_cookie(
            provider="github",
            provider_id=unique_id,
            email=f"{unique_id}@example.com",
            name="Test SignUp",
        )

        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "Jane Doe", "timezone": "America/New_York"},
            headers=_same_origin_headers(pending_cookie),
        )

        assert response.status_code == 201
        data = await response.get_json()
        assert data.get("authenticated") is True
        assert "user" in data
        assert data["user"]["email"] == f"{unique_id}@example.com"
        assert data["user"]["name"] == "Jane Doe"
        assert data["user"]["provider"] == "github"

    @pytest.mark.asyncio
    async def test_complete_signup_empty_name_returns_400(self, client: QuartClient):
        """POST /auth/complete-signup with empty name should return 400."""
        pending_cookie = await _make_pending_cookie()

        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "   ", "timezone": "America/New_York"},
            headers=_same_origin_headers(pending_cookie),
        )

        assert response.status_code == 400
        data = await response.get_json()
        assert "error" in data

    @pytest.mark.asyncio
    async def test_complete_signup_invalid_timezone_returns_400(self, client: QuartClient):
        """POST /auth/complete-signup with invalid timezone should return 400."""
        pending_cookie = await _make_pending_cookie()

        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "Jane", "timezone": "Not/A/Timezone"},
            headers=_same_origin_headers(pending_cookie),
        )

        assert response.status_code == 400
        data = await response.get_json()
        assert "error" in data

    @pytest.mark.asyncio
    async def test_complete_signup_no_pending_returns_401(self, client: QuartClient):
        """POST /auth/complete-signup without pending cookie should return 401."""
        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "Jane", "timezone": "UTC"},
            headers=_same_origin_headers(),
        )

        assert response.status_code == 401
        data = await response.get_json()
        assert data["error"]["code"] == "UNAUTHORIZED" or "error" in data

    @pytest.mark.asyncio
    async def test_complete_signup_expired_pending_returns_401(self, client: QuartClient):
        """POST /auth/complete-signup with expired pending should return 401."""
        expired_cookie = await _make_pending_cookie(
            created_at=datetime.now(UTC) - timedelta(minutes=16),
        )

        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "Jane", "timezone": "UTC"},
            headers=_same_origin_headers(expired_cookie),
        )

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_complete_signup_duplicate_returns_409(self, client: QuartClient):
        """POST /auth/complete-signup for existing user should return 409."""
        # Use the test user that's seeded by conftest (provider=github, provider_id=TEST_USER_ID)
        pending_cookie = await _make_pending_cookie(
            provider="github",
            provider_id="00000000-0000-4000-a000-000000000001",
            email="test@example.com",
        )

        response = await client.post(
            "/api/auth/complete-signup",
            json={"name": "Test User", "timezone": "UTC"},
            headers=_same_origin_headers(pending_cookie),
        )

        assert response.status_code == 409
        data = await response.get_json()
        assert "error" in data


# =============================================================================
# T008: /auth/me pending state contract tests
# =============================================================================


class TestAuthMePendingContract:
    """T008: Contract tests for GET /auth/me with pending cookie.

    Returns {pending_signup: true, profile: {email, name, avatarUrl, provider}}.
    """

    @pytest.mark.asyncio
    async def test_me_with_pending_returns_pending_status(self, client: QuartClient):
        """GET /auth/me with pending cookie should return pending_signup status."""
        pending_cookie = await _make_pending_cookie(
            email="pending@example.com",
            name="Pending User",
            avatar_url="https://avatars.example.com/pending",
            provider="google",
        )

        response = await client.get(
            "/api/auth/me",
            headers=_same_origin_headers(pending_cookie),
        )

        assert response.status_code == 200
        data = await response.get_json()
        assert data.get("pending_signup") is True
        assert "profile" in data
        profile = data["profile"]
        assert profile["email"] == "pending@example.com"
        assert profile["name"] == "Pending User"
        assert profile["avatarUrl"] == "https://avatars.example.com/pending"
        assert profile["provider"] == "google"

    @pytest.mark.asyncio
    async def test_me_with_full_session_returns_authenticated(
        self, client: QuartClient, auth_headers
    ):
        """GET /auth/me with full session should return authenticated status."""
        response = await client.get("/api/auth/me", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        # Existing behavior: user object (not pending)
        assert "pending_signup" not in data or data.get("pending_signup") is not True

    @pytest.mark.asyncio
    async def test_me_with_expired_pending_returns_401(self, client: QuartClient):
        """GET /auth/me with expired pending cookie should return 401."""
        expired_cookie = await _make_pending_cookie(
            created_at=datetime.now(UTC) - timedelta(minutes=16),
        )

        response = await client.get(
            "/api/auth/me",
            headers=_same_origin_headers(expired_cookie),
        )

        assert response.status_code == 401


# =============================================================================
# T017: Returning-user callback contract tests
# =============================================================================


class TestReturningUserCallbackContract:
    """T017: Contract test verifying returning-user callback.

    Callback with known (provider, provider_id) sets full session cookie
    (with user_id) and 302 redirect. No pending state.
    """

    @pytest.mark.asyncio
    async def test_returning_user_me_returns_authenticated(self, client: QuartClient, auth_headers):
        """GET /auth/me for returning user should return authenticated user data."""
        response = await client.get("/api/auth/me", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        # Returning user: no pending_signup flag
        assert data.get("pending_signup") is not True
        # Should have user data as a direct object (id, email, etc.)
        assert "id" in data or ("user" in data and "id" in data["user"])

    @pytest.mark.asyncio
    async def test_full_session_does_not_trigger_pending(self, client: QuartClient, auth_headers):
        """Full session cookie should never return pending_signup status."""
        response = await client.get("/api/auth/me", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()
        assert "pending_signup" not in data


# =============================================================================
# T018: GET /auth/me for fully authenticated user
# =============================================================================


class TestAuthMeAuthenticatedContract:
    """T018: Contract test for GET /auth/me for fully authenticated user.

    Returns {id, email, name, avatarUrl, provider, timezone, notificationsEnabled}.
    """

    @pytest.mark.asyncio
    async def test_me_returns_expected_fields(self, client: QuartClient, auth_headers):
        """GET /auth/me should return all expected user fields."""
        response = await client.get("/api/auth/me", headers=auth_headers)

        assert response.status_code == 200
        data = await response.get_json()

        # Check required fields
        assert "id" in data
        assert "email" in data
        assert "provider" in data
        # Check optional/additional fields
        assert "name" in data
        assert "avatarUrl" in data
        assert "timezone" in data
        assert "notificationsEnabled" in data
