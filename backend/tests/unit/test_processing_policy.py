"""External processing is a policy decision, including background work."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.config.settings import Settings
from app.infrastructure.jobs.audio_generation import generate_pending_audio


@pytest.mark.asyncio
async def test_background_audio_does_not_scan_or_send_private_posts_when_disabled(monkeypatch):
    from app.config import container
    from app.infrastructure.jobs import audio_generation

    monkeypatch.setattr(
        container,
        "_settings",
        Settings(_env_file=None, environment="development", external_tts_enabled=False),
    )
    session = AsyncMock()
    session.execute.return_value = SimpleNamespace(fetchall=lambda: [])
    monkeypatch.setattr(audio_generation, "create_session", lambda: session)
    assert await generate_pending_audio() == 0
    session.execute.assert_not_awaited()


@pytest.mark.parametrize("name", ["oauth_redirect_base_url", "frontend_url"])
def test_production_rejects_plaintext_public_origins(name):
    values = {
        "environment": "production",
        "secret_key": "a" * 40,
        "oauth_redirect_base_url": "https://feeds.example.org",
        "frontend_url": "https://feeds.example.org",
    }
    values[name] = "http://feeds.example.org"
    with pytest.raises(ValueError, match="HTTPS"):
        Settings(_env_file=None, **values)


def test_production_rejects_debug_mode_and_default_secrets():
    with pytest.raises(ValueError, match="DEBUG"):
        Settings(_env_file=None, environment="production", debug=True)
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(_env_file=None, environment="production")
