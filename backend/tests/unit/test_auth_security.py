"""Exercise actual auth routes using durable identity storage and fake upstream HTTP."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit

import pytest
from quart import Quart

from app.api.middleware import register_error_handlers
from app.api.routes import auth
from app.config.container import create_oauth_service, set_request_container
from tests.unit.test_session import cookie

pytest_plugins = ["tests.unit.test_session"]


@pytest.fixture
async def auth_client(identity_db, manager, monkeypatch):
    app = Quart(__name__)
    app.register_blueprint(auth.bp, url_prefix="/api/auth")
    register_error_handlers(app)
    monkeypatch.setattr(auth, "session_manager", manager)
    service = create_oauth_service(identity_db[0]())
    service.exchange_code_for_user = AsyncMock(
        return_value={
            "provider": "github",
            "provider_id": "new-identity",
            "email": "new@example.com",
            "name": "New Person",
            "avatar_url": None,
        }
    )

    @app.before_request
    async def setup():
        set_request_container(SimpleNamespace(session=identity_db[0](), oauth_service=service))

    @app.after_request
    async def cleanup(response):
        from app.config.container import get_request_container

        await get_request_container().session.close()
        set_request_container(None)
        return response

    yield app.test_client(), manager, service
    await service.close()
    await service._user_repository._session.close()


async def test_login_persists_browser_state_cookie_and_pkce(auth_client):
    client, manager, _ = auth_client
    response = await client.get("/api/auth/login/github")
    assert response.status_code == 302
    params = parse_qs(urlsplit(response.headers["Location"]).query)
    assert params["code_challenge_method"] == ["S256"]
    assert cookie(response, manager.OAUTH_COOKIE_NAME)


@pytest.mark.parametrize("query", ["?code=attacker", "?code=attacker&state=forged-state"])
async def test_callback_rejects_missing_or_unbound_state_before_exchange(auth_client, query):
    client, _, service = auth_client
    response = await client.get("/api/auth/github/callback" + query)
    assert response.status_code == 401
    service.exchange_code_for_user.assert_not_awaited()


async def test_callback_state_is_single_use_and_signup_rotates(auth_client):
    client, manager, service = auth_client
    start = await client.get("/api/auth/login/github")
    state = parse_qs(urlsplit(start.headers["Location"]).query)["state"][0]
    callback = f"/api/auth/github/callback?code=code&state={state}"
    response = await client.get(callback)
    assert response.status_code == 302
    assert urlsplit(response.headers["Location"]).path == "/signup"
    pending_token = cookie(response)
    assert service.exchange_code_for_user.await_args.kwargs["code_verifier"]
    assert (await (await client.get("/api/auth/me")).get_json())["pending_signup"]
    replay = await client.get(callback)
    assert replay.status_code == 401
    assert service.exchange_code_for_user.await_count == 1
    signup = await client.post(
        "/api/auth/complete-signup", json={"name": "Final Name", "timezone": "UTC"}
    )
    assert signup.status_code == 201
    assert cookie(signup) != pending_token
    profile = await (await client.get("/api/auth/me")).get_json()
    assert profile["email"] == "new@example.com"
    copied = SimpleNamespace(cookies={manager.COOKIE_NAME: pending_token})
    assert await manager.get_pending_signup(copied) is None
    token = cookie(signup)
    assert (await client.post("/api/auth/logout")).status_code == 200
    assert await manager.get_user_id(SimpleNamespace(cookies={manager.COOKIE_NAME: token})) is None


@pytest.mark.parametrize(
    "body",
    [
        [],
        "text",
        {"name": [], "timezone": "UTC"},
        {"name": True, "timezone": "UTC"},
        {"name": "Name", "timezone": []},
        {"name": "Name", "timezone": True},
    ],
)
async def test_signup_rejects_invalid_json_field_types(auth_client, body):
    client, manager, _ = auth_client
    from quart import Response

    response = Response()
    await manager.create_pending_session(response, "github", "new", "new@example.com")
    client.set_cookie("localhost", manager.COOKIE_NAME, cookie(response))
    result = await client.post("/api/auth/complete-signup", json=body)
    assert result.status_code == 400


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"name": "   ", "timezone": "UTC"},
        {"name": "x" * 256, "timezone": "UTC"},
        {"name": "Name", "timezone": "Not/A/Zone"},
    ],
)
async def test_signup_validation_retains_pending_credential(auth_client, body):
    client, manager, _ = auth_client
    from quart import Response

    response = Response()
    await manager.create_pending_session(response, "github", "new", "new@example.com")
    token = cookie(response)
    client.set_cookie("localhost", manager.COOKIE_NAME, token)
    result = await client.post("/api/auth/complete-signup", json=body)
    assert result.status_code == 400
    assert await manager.get_pending_signup(SimpleNamespace(cookies={manager.COOKIE_NAME: token}))


async def test_returning_user_callback_sets_full_session(auth_client, identity_db):
    client, manager, service = auth_client
    service.exchange_code_for_user.return_value = {
        "provider": "github",
        "provider_id": "123",
        "email": "person@example.com",
    }
    response = await client.get("/api/auth/login/github")
    state = parse_qs(urlsplit(response.headers["Location"]).query)["state"][0]
    callback = await client.get(f"/api/auth/github/callback?code=code&state={state}")
    assert callback.status_code == 302
    assert urlsplit(callback.headers["Location"]).path == "/auth/callback"
    token = cookie(callback)
    request = SimpleNamespace(cookies={manager.COOKIE_NAME: token})
    assert await manager.get_user_id(request) == identity_db[1]
    assert await manager.get_pending_signup(request) is None


async def test_callback_upstream_errors_are_generic(auth_client):
    from app.infrastructure.oauth.oauth_service import OAuthError

    client, _, service = auth_client
    response = await client.get("/api/auth/login/github")
    state = parse_qs(urlsplit(response.headers["Location"]).query)["state"][0]
    service.exchange_code_for_user.side_effect = OAuthError("secret-code upstream-error")
    failed = await client.get(f"/api/auth/github/callback?code=secret-code&state={state}")
    assert failed.status_code == 401
    assert "secret-code" not in (await failed.get_data()).decode()
