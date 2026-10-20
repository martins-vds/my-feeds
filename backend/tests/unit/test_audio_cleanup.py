from unittest.mock import AsyncMock, MagicMock

import pytest


@pytest.mark.asyncio
async def test_cleanup_job_applies_provider_timestamp_retention(monkeypatch):
    import app.infrastructure.jobs.audio_cleanup as cleanup

    cache = MagicMock()
    cache.initialize = AsyncMock()
    cache.cleanup_old_files = AsyncMock(return_value=3)
    session = AsyncMock()
    monkeypatch.setattr(cleanup, "create_cache_manager", lambda: cache)
    monkeypatch.setattr(cleanup, "create_session", lambda: session)
    monkeypatch.setattr(cleanup, "cleanup_old_audio_records", AsyncMock())
    monkeypatch.setattr(cleanup, "cleanup_orphaned_audio_files", AsyncMock())
    monkeypatch.setattr(cleanup, "cleanup_cache_by_size", AsyncMock())

    await cleanup.run_audio_cleanup_job()

    cache.cleanup_old_files.assert_awaited_once_with(90)
