"""Unit tests for the feed ingestion background job."""

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from app.infrastructure.jobs.feed_ingestion import ingest_feed_posts


@pytest.mark.asyncio
async def test_ingest_feed_posts_commits_and_returns_count():
    """The job runs ingest_feed in its own session and commits the result."""
    feed_id = uuid4()
    session = AsyncMock()
    service = AsyncMock()
    service.ingest_feed.return_value = 3

    with (
        patch(
            "app.infrastructure.jobs.feed_ingestion.create_session",
            return_value=session,
        ),
        patch(
            "app.infrastructure.jobs.feed_ingestion.create_feed_service",
            return_value=service,
        ),
    ):
        count = await ingest_feed_posts(feed_id)

    assert count == 3
    service.ingest_feed.assert_awaited_once_with(feed_id)
    session.commit.assert_awaited_once()
    session.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_ingest_feed_posts_rolls_back_on_error():
    """Unexpected errors are rolled back and swallowed (task is fire-and-forget)."""
    feed_id = uuid4()
    session = AsyncMock()
    service = AsyncMock()
    service.ingest_feed.side_effect = RuntimeError("db down")

    with (
        patch(
            "app.infrastructure.jobs.feed_ingestion.create_session",
            return_value=session,
        ),
        patch(
            "app.infrastructure.jobs.feed_ingestion.create_feed_service",
            return_value=service,
        ),
    ):
        count = await ingest_feed_posts(feed_id)

    assert count == 0
    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()
    session.close.assert_awaited_once()
