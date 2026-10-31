"""Real application middleware must protect persisted identity mutations."""

from types import SimpleNamespace

import pytest
from quart import Response

from app.api.routes import auth
from app.config.settings import get_settings
from app.infrastructure.persistence import database
from app.main import create_app
from tests.unit.test_session import cookie

pytest_plugins = ["tests.unit.test_session"]


@pytest.fixture
def csrf_client(identity_db, manager, monkeypatch):
    monkeypatch.setattr(database, "_session_factory", identity_db[0])
    monkeypatch.setattr(auth, "session_manager", manager)
    app = create_app()
    app.config["TESTING"] = True
    return app.test_client()


@pytest.mark.parametrize(
    "headers",
    [
        {"Origin": "https://attacker.example"},
        {"Referer": "https://attacker.example/form"},
        {"Sec-Fetch-Site": "cross-site", "X-Requested-With": "XMLHttpRequest"},
        {},
    ],
)
async def test_cross_site_signup_cannot_consume_pending(csrf_client, manager, headers):
    response = Response()
    await manager.create_pending_session(response, "github", "new", "new@example.com")
    token = cookie(response)
    csrf_client.set_cookie("localhost", manager.COOKIE_NAME, token)
    result = await csrf_client.post(
        "/api/auth/complete-signup",
        json={"name": "Name", "timezone": "UTC"},
        headers=headers,
    )
    assert result.status_code == 403
    assert await manager.get_pending_signup(SimpleNamespace(cookies={manager.COOKIE_NAME: token}))


async def test_same_origin_signup_rotates_through_real_middleware(csrf_client, manager):
    response = Response()
    await manager.create_pending_session(response, "github", "new", "new@example.com")
    token = cookie(response)
    csrf_client.set_cookie("localhost", manager.COOKIE_NAME, token)
    result = await csrf_client.post(
        "/api/auth/complete-signup",
        json={"name": "Name", "timezone": "UTC"},
        headers={"Origin": get_settings().frontend_url, "X-Requested-With": "XMLHttpRequest"},
    )
    assert result.status_code == 201
    assert cookie(result) != token
    assert (
        await manager.get_pending_signup(SimpleNamespace(cookies={manager.COOKIE_NAME: token}))
        is None
    )


async def test_cross_site_logout_cannot_revoke_but_same_origin_can(
    csrf_client, manager, identity_db
):
    response = Response()
    await manager.create_session(response, identity_db[1], "github")
    token = cookie(response)
    csrf_client.set_cookie("localhost", manager.COOKIE_NAME, token)
    copied = SimpleNamespace(cookies={manager.COOKIE_NAME: token})
    blocked = await csrf_client.post("/api/auth/logout", headers={"Origin": "https://evil.example"})
    assert blocked.status_code == 403
    assert await manager.get_user_id(copied) == identity_db[1]
    accepted = await csrf_client.post(
        "/api/auth/logout", headers={"Origin": get_settings().frontend_url}
    )
    assert accepted.status_code == 200
    assert await manager.get_user_id(copied) is None
