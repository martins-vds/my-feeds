"""Unit tests for the audio generation background job."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.application.services.audio_service import AudioStatus
from app.infrastructure.jobs.audio_generation import generate_pending_audio


def _session_returning(post_ids):
    """Build a mock session whose SELECT returns the given post ids."""
    session = AsyncMock()
    exec_result = MagicMock()
    exec_result.fetchall.return_value = [(pid,) for pid in post_ids]
    session.execute.return_value = exec_result
    return session


@pytest.mark.asyncio
async def test_generate_pending_audio_processes_each_missing_post():
    p1, p2 = uuid4(), uuid4()
    session = _session_returning([p1, p2])

    audio_service = AsyncMock()
    audio_service.generate_for_post.return_value = SimpleNamespace(
        status=AudioStatus.READY, error=None
    )

    with (
        patch(
            "app.infrastructure.jobs.audio_generation.create_session",
            return_value=session,
        ),
        patch(
            "app.infrastructure.jobs.audio_generation.create_audio_service",
            return_value=audio_service,
        ),
    ):
        count = await generate_pending_audio(batch_size=5)

    assert count == 2
    assert audio_service.generate_for_post.await_count == 2
    assert session.commit.await_count == 2
    session.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_generate_pending_audio_no_missing_posts_is_noop():
    session = _session_returning([])

    with (
        patch(
            "app.infrastructure.jobs.audio_generation.create_session",
            return_value=session,
        ),
        patch("app.infrastructure.jobs.audio_generation.create_audio_service") as mk_service,
    ):
        count = await generate_pending_audio()

    assert count == 0
    mk_service.assert_not_called()
    session.commit.assert_not_awaited()
    session.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_selection_includes_timingless_posts_and_preserves_filters():
    """The SELECT targets audio-less OR has_timings=false posts, keeping the
    content filter, published_at DESC ordering, and batch limit."""
    session = _session_returning([])

    with (
        patch(
            "app.infrastructure.jobs.audio_generation.create_session",
            return_value=session,
        ),
        patch("app.infrastructure.jobs.audio_generation.create_audio_service"),
    ):
        await generate_pending_audio(batch_size=7)

    stmt = session.execute.call_args[0][0]
    sql = str(stmt).lower()

    # Timings-aware selection.
    assert "has_timings" in sql
    assert "is null" in sql  # audio.id IS NULL
    # Preserved constraints.
    assert "content" in sql
    assert "published_at" in sql
    assert "desc" in sql
    assert "limit" in sql


@pytest.mark.asyncio
async def test_generate_pending_audio_continues_after_a_failure():
    p1, p2 = uuid4(), uuid4()
    session = _session_returning([p1, p2])

    audio_service = AsyncMock()
    audio_service.generate_for_post.side_effect = [
        RuntimeError("boom"),
        SimpleNamespace(status=AudioStatus.READY, error=None),
    ]

    with (
        patch(
            "app.infrastructure.jobs.audio_generation.create_session",
            return_value=session,
        ),
        patch(
            "app.infrastructure.jobs.audio_generation.create_audio_service",
            return_value=audio_service,
        ),
    ):
        count = await generate_pending_audio(batch_size=5)

    assert count == 1  # the second post still succeeds after the first fails
    session.rollback.assert_awaited_once()
    session.commit.assert_awaited_once()
    session.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_error_status_outcome_is_logged_and_not_counted():
    """A post whose generation returns an ERROR status (no exception) is still
    committed, but is logged and not counted as generated."""
    p1 = uuid4()
    session = _session_returning([p1])

    audio_service = AsyncMock()
    audio_service.generate_for_post.return_value = SimpleNamespace(
        status=AudioStatus.ERROR, error="no readable content"
    )

    with (
        patch(
            "app.infrastructure.jobs.audio_generation.create_session",
            return_value=session,
        ),
        patch(
            "app.infrastructure.jobs.audio_generation.create_audio_service",
            return_value=audio_service,
        ),
    ):
        count = await generate_pending_audio(batch_size=5)

    assert count == 0  # ERROR outcome is not counted as generated
    session.commit.assert_awaited_once()  # committed despite the non-READY status
    session.rollback.assert_not_awaited()  # not an exception path
    session.close.assert_awaited_once()
