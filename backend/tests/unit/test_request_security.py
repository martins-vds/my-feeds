"""Security middleware rejects cross-origin and oversized mutations."""

from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

from app.api.middleware.error_handler import APIError
from app.api.middleware.request_security import RequestAdmission, _origin
from app.config.settings import Settings
from app.main import create_app


@pytest.fixture
def security_app():
    app = create_app()
    app.config["TESTING"] = True

    @app.post("/api/security-probe")
    async def probe():
        return {"accepted": True}

    return app


@pytest.mark.asyncio
async def test_foreign_origin_cannot_mutate_even_with_ajax_marker(security_app):
    response = await security_app.test_client().post(
        "/api/security-probe",
        headers={"Origin": "https://attacker.invalid", "X-Requested-With": "XMLHttpRequest"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_browser_mutation_without_origin_or_non_simple_marker_is_rejected(security_app):
    response = await security_app.test_client().post("/api/security-probe")
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_same_origin_mutation_is_allowed(security_app):
    response = await security_app.test_client().post(
        "/api/security-probe", headers={"Origin": "http://localhost"}
    )
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_configured_frontend_origin_is_allowed_when_distinct_from_api(
    security_app, monkeypatch
):
    from app.config.settings import get_settings

    monkeypatch.setattr(get_settings(), "frontend_url", "http://localhost:5174")
    response = await security_app.test_client().post(
        "/api/security-probe", headers={"Origin": "http://localhost:5174"}
    )
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("origin", ["null", "https://user@localhost", "http://localhost:invalid"])
async def test_opaque_or_malformed_origins_are_not_allowed(security_app, origin):
    response = await security_app.test_client().post(
        "/api/security-probe",
        headers={"Origin": origin, "X-Requested-With": "XMLHttpRequest"},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
@pytest.mark.parametrize("method", ["GET", "HEAD", "OPTIONS"])
async def test_safe_methods_do_not_require_mutation_credentials(security_app, method):
    from app.api.middleware.request_security import verify_mutation_origin

    async with security_app.test_request_context("/api/security-probe", method=method):
        verify_mutation_origin("http://localhost:5174")


@pytest.mark.asyncio
async def test_api_request_rate_is_bounded(security_app):
    client = security_app.test_client()
    responses = [
        await client.post("/api/security-probe", headers={"X-Requested-With": "XMLHttpRequest"})
        for _ in range(61)
    ]
    assert responses[-1].status_code == 429
    assert responses[-1].headers["Retry-After"]


@pytest.mark.asyncio
async def test_authenticated_accounts_do_not_share_the_proxy_request_budget(
    security_app, monkeypatch
):
    identity = AsyncMock(return_value=uuid4())
    monkeypatch.setattr(
        "app.infrastructure.oauth.session.session_manager.get_current_user_id", identity
    )
    client = security_app.test_client()
    headers = {
        "Cookie": "my_feeds_session=" + "a" * 43,
        "Origin": "http://localhost",
    }
    for _ in range(60):
        assert (await client.post("/api/security-probe", headers=headers)).status_code == 200
    assert (await client.post("/api/security-probe", headers=headers)).status_code == 429
    identity.return_value = uuid4()
    assert (await client.post("/api/security-probe", headers=headers)).status_code == 200


@pytest.mark.asyncio
async def test_exhausted_pre_authentication_budget_stops_session_database_lookups(
    security_app, monkeypatch
):
    identity = AsyncMock(return_value=None)
    monkeypatch.setattr(
        "app.infrastructure.oauth.session.session_manager.get_current_user_id", identity
    )
    client = security_app.test_client()
    headers = {
        "Cookie": "my_feeds_session=" + "a" * 43,
        "Origin": "http://localhost",
    }
    for _ in range(1205):
        response = await client.post("/api/security-probe", headers=headers)
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"
    assert identity.await_count == 1200


@pytest.mark.asyncio
async def test_private_api_responses_are_not_reused_from_browser_http_cache(security_app):
    response = await security_app.test_client().post(
        "/api/security-probe", headers={"Origin": "http://localhost"}
    )
    assert response.headers["Cache-Control"] == "private, no-store"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("HTTPS://EXAMPLE.ORG/path?key=private", "https://example.org:443"),
        ("http://example.org:8080/path", "http://example.org:8080"),
        ("http://example.org", "http://example.org:80"),
        ("ftp://example.org", None),
        ("null", None),
        ("https://user@example.org", None),
        ("https://example.org:invalid", None),
        ("https://[invalid", None),
    ],
)
def test_origin_normalization_rejects_ambiguous_sources(value, expected):
    assert _origin(value) == expected


@pytest.mark.parametrize(
    ("peer", "forwarded", "networks", "expected"),
    [
        ("192.0.2.1", "198.51.100.1", [], "192.0.2.1"),
        ("192.0.2.1", "198.51.100.1", ["172.30.16.2/32"], "192.0.2.1"),
        ("172.30.16.2", "198.51.100.1", ["172.30.16.2/32"], "198.51.100.1"),
        ("172.30.16.2", None, ["172.30.16.2/32"], "172.30.16.2"),
    ],
)
def test_forwarded_client_address_requires_an_explicit_trusted_peer(
    peer, forwarded, networks, expected
):
    from app.api.middleware.request_security import client_address

    assert client_address(peer, forwarded, networks) == expected


def test_trusted_proxy_cannot_supply_an_ambiguous_address():
    from app.api.middleware.error_handler import ForbiddenError
    from app.api.middleware.request_security import client_address

    with pytest.raises(ForbiddenError):
        client_address("172.30.16.2", "198.51.100.1, 192.0.2.1", ["172.30.16.2/32"])


@pytest.mark.parametrize(("mutation", "limit"), [(True, 60), (False, 120)])
def test_exact_request_limits_and_window_reset(monkeypatch, mutation, limit):
    clock = [10.0]
    monkeypatch.setattr("app.api.middleware.request_security.time.monotonic", lambda: clock[0])
    admission = RequestAdmission()
    for _ in range(limit):
        admission.admit("peer", mutation)
    clock[0] = 69.0
    with pytest.raises(APIError) as denied:
        admission.admit("peer", mutation)
    assert denied.value.status_code == 429
    assert denied.value.error_code == "RATE_LIMITED"
    assert denied.value.details == {"retryAfter": 1}
    admission.admit("different-peer", mutation)
    admission.admit("peer", not mutation)
    clock[0] = 70.0
    admission.admit("peer", mutation)
    assert admission._windows[("peer", mutation)].count == 1


def test_admission_evicts_oldest_peer_without_resetting_recent_peer(monkeypatch):
    monkeypatch.setattr("app.api.middleware.request_security.time.monotonic", lambda: 10.0)
    admission = RequestAdmission()
    for peer in range(1024):
        admission.admit(str(peer), True)
    admission.admit("0", True)
    admission.admit("new-peer", True)
    assert len(admission._windows) == 1024
    assert ("1", True) not in admission._windows
    assert admission._windows[("0", True)].count == 2
    assert admission._windows[("new-peer", True)].count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [
        {"Referer": "https://attacker.invalid/private"},
        {"Origin": "http://localhost", "Sec-Fetch-Site": "cross-site"},
        {"X-Requested-With": "XMLHttpRequest", "Sec-Fetch-Site": "cross-site"},
    ],
)
async def test_referer_and_fetch_metadata_fail_closed(security_app, headers):
    response = await security_app.test_client().post("/api/security-probe", headers=headers)
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_same_origin_referer_can_authorize_mutations(security_app):
    response = await security_app.test_client().post(
        "/api/security-probe", headers={"Referer": "http://localhost/settings"}
    )
    assert response.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("allow_images", [False, True])
async def test_production_headers_block_publisher_resources_without_operator_opt_in(
    monkeypatch, allow_images
):
    settings = Settings(
        _env_file=None,
        environment="production",
        secret_key="a" * 40,
        oauth_redirect_base_url="https://feeds.example.org",
        frontend_url="https://feeds.example.org",
        allow_external_images=allow_images,
    )
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    response = await create_app().test_client().get("/health")
    csp = response.headers["Content-Security-Policy"]
    assert ("img-src 'self' data: https:;" in csp) is allow_images
    if not allow_images:
        assert "img-src 'self' data:;" in csp
    for directive in (
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'self'",
    ):
        assert directive in csp
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert response.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()"
