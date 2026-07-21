"""Unit tests for the scheduled feed refresh background job."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest

from app.infrastructure.jobs.feed_refresh import refresh_active_feeds


def _session_returning(feed_ids):
    """Build a mock session whose SELECT returns the given feed ids."""
    session = AsyncMock()
    result = MagicMock()
    result.fetchall.return_value = [(fid,) for fid in feed_ids]
    session.execute.return_value = result
    return session


@pytest.mark.asyncio
async def test_refresh_active_feeds_ingests_each_active_feed():
    """Every active feed is ingested and the new-post counts are summed."""
    f1, f2 = uuid4(), uuid4()
    session = _session_returning([f1, f2])

    with (
        patch(
            "app.infrastructure.jobs.feed_refresh.create_session",
            return_value=session,
        ),
        patch(
            "app.infrastructure.jobs.feed_refresh.ingest_feed_posts",
            new=AsyncMock(side_effect=[2, 3]),
        ) as ingest,
    ):
        total = await refresh_active_feeds()

    assert total == 5
    assert ingest.await_count == 2
    ingest.assert_any_await(f1)
    ingest.assert_any_await(f2)
    session.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_refresh_active_feeds_no_active_feeds():
    """With no active feeds, nothing is ingested."""
    session = _session_returning([])

    with (
        patch(
            "app.infrastructure.jobs.feed_refresh.create_session",
            return_value=session,
        ),
        patch(
            "app.infrastructure.jobs.feed_refresh.ingest_feed_posts",
            new=AsyncMock(),
        ) as ingest,
    ):
        total = await refresh_active_feeds()

    assert total == 0
    ingest.assert_not_awaited()
    session.close.assert_awaited_once()
