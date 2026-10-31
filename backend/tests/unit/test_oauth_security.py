"""OAuth state/PKCE and safe upstream failures."""

from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from app.infrastructure.oauth.oauth_service import OAuthError, OAuthService


@pytest.mark.parametrize("provider", ["github", "google", "microsoft"])
async def test_pkce_challenge_is_s256(provider):
    service = OAuthService()
    try:
        url = await service.get_authorization_url(
            provider, "https://app/callback", state="bound-state", code_verifier="a" * 43
        )
        params = parse_qs(urlsplit(url).query)
        assert params["state"] == ["bound-state"]
        assert params["code_challenge_method"] == ["S256"]
        assert params["code_challenge"] == ["ZtNPunH49FD35FWYhT5Tv8I7vRKQJ8uxMaL0_9eHjNA"]
    finally:
        await service.close()


async def test_exchange_sends_verifier_and_real_bearer_header():
    captured = []

    def upstream(request):
        captured.append(request)
        if request.method == "POST":
            return httpx.Response(200, json={"access_token": "secret-access-token"})
        return httpx.Response(200, json={"id": "123", "email": "test@example.com"})

    service = OAuthService()
    await service._http_client.aclose()
    service._http_client = httpx.AsyncClient(transport=httpx.MockTransport(upstream))
    try:
        user = await service.exchange_code_for_user(
            "google", "code", "https://app/callback", code_verifier="a" * 43
        )
        assert user["provider_id"] == "123"
        assert b"code_verifier=" + b"a" * 43 in captured[0].content
        assert captured[1].headers["Authorization"] == "Bearer secret-access-token"
    finally:
        await service.close()


async def test_token_failure_never_leaks_upstream_url_or_code():
    service = OAuthService()
    await service._http_client.aclose()
    service._http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _req: httpx.Response(400))
    )
    try:
        with pytest.raises(OAuthError) as error:
            await service.exchange_code_for_user("github", "secret-code", "https://app/callback")
        assert str(error.value) == "Token exchange failed"
    finally:
        await service.close()


@pytest.mark.parametrize(
    "token_payload,user_payload",
    [
        ([], {"id": "123", "email": "test@example.com"}),
        ({"access_token": []}, {"id": "123", "email": "test@example.com"}),
        ({"access_token": "token"}, []),
        ({"access_token": "token"}, {"email": "test@example.com"}),
        ({"access_token": "token"}, {"id": [], "email": "test@example.com"}),
        ({"access_token": "token"}, {"id": "123", "email": []}),
    ],
)
async def test_malformed_upstream_identity_is_rejected(token_payload, user_payload):
    service = OAuthService()
    await service._http_client.aclose()
    service._http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200, json=(token_payload if request.method == "POST" else user_payload)
            )
        )
    )
    try:
        with pytest.raises(OAuthError):
            await service.exchange_code_for_user("google", "code", "https://app/callback")
    finally:
        await service.close()
