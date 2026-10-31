"""Session credentials must be opaque, persisted, bounded and revocable."""

import inspect
import json
from datetime import UTC, datetime, timedelta
from http.cookies import SimpleCookie
from types import SimpleNamespace
from uuid import uuid4

import pytest
from quart import Quart, Response
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.infrastructure.oauth.session import SessionManager
from app.infrastructure.persistence.database import Base
from app.infrastructure.persistence.models import UserModel


@pytest.fixture
async def identity_db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    factory = async_sessionmaker(engine, expire_on_commit=False)
    user_id = uuid4()
    async with factory() as session:
        session.add(
            UserModel(id=user_id, provider="github", provider_id="123", email="person@example.com")
        )
        await session.commit()
    yield factory, user_id
    await engine.dispose()


@pytest.fixture
def manager(identity_db):
    return SessionManager(session_factory=identity_db[0])


def cookie(response, name=SessionManager.COOKIE_NAME):
    jar = SimpleCookie()
    for header in response.headers.getlist("Set-Cookie"):
        jar.load(header)
    return jar[name].value


def browser(token, name=SessionManager.COOKIE_NAME):
    return SimpleNamespace(cookies={name: token})


@pytest.mark.parametrize(
    "data",
    [
        {
            "user_id": str(uuid4()),
            "provider": "github",
            "created_at": datetime.now(UTC).isoformat(),
        },
        {
            "provider": "github",
            "provider_id": "victim",
            "email": "victim@example.com",
            "pending_created_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        },
        [],
        "text",
        42,
        {"user_id": [], "created_at": True, "provider": {}},
    ],
)
async def test_unsigned_legacy_identity_never_authenticates(manager, data):
    request = browser(json.dumps(data))
    assert await manager.get_user_id(request) is None
    assert await manager.get_pending_signup(request) is None


async def test_forged_user_cookie_is_rejected():
    manager = SessionManager()
    request = browser(
        json.dumps(
            {
                "user_id": str(uuid4()),
                "provider": "github",
                "created_at": datetime.now().isoformat(),
            }
        )
    )
    result = manager.get_user_id(request)
    if inspect.isawaitable(result):
        result = await result
    assert result is None


async def test_session_is_opaque_persisted_and_survives_manager_restart(manager, identity_db):
    factory, user_id = identity_db
    response = Response()
    await manager.create_session(response, user_id, "github")
    token = cookie(response)
    assert len(token) >= 43
    assert str(user_id) not in token
    assert "github" not in token
    assert await SessionManager(session_factory=factory).get_user_id(browser(token)) == user_id
    assert await manager.get_user_id(browser(token[:-1] + "!")) is None
    async with factory() as session:
        from app.infrastructure.persistence.models.identity_session import IdentitySessionModel

        row = (await session.execute(select(IdentitySessionModel))).scalar_one()
        assert row.token_hash != token
        assert len(row.token_hash) == 64


async def test_pending_profile_not_in_cookie_and_cannot_authenticate(manager, identity_db):
    response = Response()
    await manager.create_pending_session(response, "google", "provider-id", "person@example.com")
    token = cookie(response)
    assert "person@example.com" not in token
    assert await manager.get_user_id(browser(token)) is None
    restarted = SessionManager(session_factory=identity_db[0])
    pending = await restarted.get_pending_signup(browser(token))
    assert pending["provider_id"] == "provider-id"
    assert pending["email"] == "person@example.com"
    assert pending["name"] is None
    assert await manager.consume_pending_signup(browser(token)) == pending
    assert await manager.consume_pending_signup(browser(token)) is None


async def test_logout_revokes_a_copied_cookie(manager, identity_db):
    response = Response()
    await manager.create_session(response, identity_db[1], "github")
    token = cookie(response)
    await manager.clear_session(Response(), browser(token))
    assert await manager.get_user_id(browser(token)) is None


async def test_login_rotates_and_revokes_previous_session(manager, identity_db):
    old = Response()
    await manager.create_session(old, identity_db[1], "github")
    old_token = cookie(old)
    new = Response()
    app = Quart(__name__)
    async with app.test_request_context("/", headers={"Cookie": f"my_feeds_session={old_token}"}):
        await manager.create_session(new, identity_db[1], "github")
    assert cookie(new) != old_token
    assert await manager.get_user_id(browser(old_token)) is None
    assert await manager.get_user_id(browser(cookie(new))) == identity_db[1]


@pytest.mark.parametrize(
    "field,value",
    [
        ("expires_at", datetime.now(UTC) - timedelta(seconds=1)),
        ("created_at", datetime.now(UTC) + timedelta(days=1)),
        ("data", {"user_id": [], "provider": True}),
        ("data", {"user_id": str(uuid4()), "provider": []}),
    ],
)
async def test_expired_future_or_invalid_stored_session_rejected(
    manager, identity_db, field, value
):
    from app.infrastructure.persistence.models.identity_session import IdentitySessionModel

    response = Response()
    await manager.create_session(response, identity_db[1], "github")
    async with identity_db[0]() as session:
        await session.execute(update(IdentitySessionModel).values({field: value}))
        await session.commit()
    assert await manager.get_user_id(browser(cookie(response))) is None


async def test_deleted_user_cannot_authenticate(manager, identity_db):
    response = Response()
    await manager.create_session(response, identity_db[1], "github")
    async with identity_db[0]() as session:
        await session.execute(delete(UserModel).where(UserModel.id == identity_db[1]))
        await session.commit()
    assert await manager.get_user_id(browser(cookie(response))) is None


async def test_secure_cookie_on_https_and_secure_delete(manager, identity_db, monkeypatch):
    monkeypatch.setattr(manager._settings, "oauth_redirect_base_url", "https://feeds.example.com")
    response = Response()
    await manager.create_session(response, identity_db[1], "github")
    header = response.headers["Set-Cookie"]
    assert "Secure" in header and "HttpOnly" in header and "SameSite=Lax" in header
    cleared = Response()
    await manager.clear_session(cleared, browser(cookie(response)))
    assert "Secure" in cleared.headers["Set-Cookie"]


async def test_oauth_state_browser_provider_callback_bound_and_single_use(manager, identity_db):
    response = Response()
    state, verifier = await manager.create_oauth_state(response, "google", "https://app/callback")
    token = cookie(response, manager.OAUTH_COOKIE_NAME)
    assert len(verifier) >= 43
    assert (
        await manager.consume_oauth_state(
            browser("wrong", manager.OAUTH_COOKIE_NAME), state, "google", "https://app/callback"
        )
        is None
    )
    assert (
        await manager.consume_oauth_state(
            browser(token, manager.OAUTH_COOKIE_NAME), state, "github", "https://app/callback"
        )
        is None
    )
    assert (
        await manager.consume_oauth_state(
            browser(token, manager.OAUTH_COOKIE_NAME), state, "google", "https://evil/callback"
        )
        is None
    )
    request = browser(token, manager.OAUTH_COOKIE_NAME)
    assert (
        await manager.consume_oauth_state(request, "a" * 43, "google", "https://app/callback")
        is None
    )
    manager = SessionManager(session_factory=identity_db[0])
    assert (
        await manager.consume_oauth_state(request, state, "google", "https://app/callback")
        == verifier
    )
    assert (
        await manager.consume_oauth_state(request, state, "google", "https://app/callback") is None
    )


@pytest.mark.parametrize("kind", ["pending", "oauth"])
async def test_pending_and_oauth_expiration_checked_server_side(manager, identity_db, kind):
    from app.infrastructure.persistence.models.identity_session import IdentitySessionModel

    response = Response()
    if kind == "pending":
        await manager.create_pending_session(response, "github", "123", "person@example.com")
        token = cookie(response)
    else:
        state, _ = await manager.create_oauth_state(response, "github", "https://app/callback")
        token = cookie(response, manager.OAUTH_COOKIE_NAME)
    async with identity_db[0]() as session:
        await session.execute(
            update(IdentitySessionModel).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
    if kind == "pending":
        assert await manager.get_pending_signup(browser(token)) is None
        assert await manager.consume_pending_signup(browser(token)) is None
    else:
        assert (
            await manager.consume_oauth_state(
                browser(token, manager.OAUTH_COOKIE_NAME), state, "github", "https://app/callback"
            )
            is None
        )


async def test_issuing_credentials_prunes_expired_identity_rows(manager, identity_db):
    from app.infrastructure.persistence.models.identity_session import IdentitySessionModel

    response = Response()
    await manager.create_pending_session(response, "github", "123", "person@example.com")
    async with identity_db[0]() as session:
        await session.execute(
            update(IdentitySessionModel).values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
        )
        await session.commit()
    await manager.create_session(Response(), identity_db[1], "github")
    async with identity_db[0]() as session:
        rows = (await session.execute(select(IdentitySessionModel))).scalars().all()
        assert len(rows) == 1
        assert rows[0].kind == "session"
