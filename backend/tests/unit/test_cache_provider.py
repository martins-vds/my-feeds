"""Tests for selecting the configured audio cache provider."""

import pytest
from pydantic import ValidationError

from app.config.settings import Settings


def test_local_cache_provider_is_the_default(tmp_path):
    settings = Settings(audio_cache_dir=str(tmp_path))

    assert settings.audio_cache_provider == "local"


def test_unknown_cache_provider_is_rejected():
    with pytest.raises(ValidationError):
        Settings(audio_cache_provider="unknown")
