"""Background job that periodically ingests new posts for active feeds.

In addition to on-demand refresh (triggered from the UI), this loop polls all
active feeds on a schedule so new posts show up without manual action. Paused
feeds (``is_active = False``) are skipped: they keep their existing posts but
are not fetched automatically.
"""

import asyncio
import logging
from uuid import UUID

from sqlalchemy import select

from app.config.container import create_session
from app.infrastructure.jobs.feed_ingestion import ingest_feed_posts
from app.infrastructure.persistence.models.feed import FeedModel

logger = logging.getLogger(__name__)

# Poll active feeds every 15 minutes by default.
DEFAULT_INTERVAL_SECONDS = 900


async def _get_active_feed_ids() -> list[UUID]:
    """Return the IDs of all feeds enabled for scheduled ingestion."""
    session = create_session()
    try:
        result = await session.execute(select(FeedModel.id).where(FeedModel.is_active.is_(True)))
        return [row[0] for row in result.fetchall()]
    finally:
        await session.close()


async def refresh_active_feeds() -> int:
    """Ingest new posts for every active feed.

    Each feed is ingested in its own session/transaction (via
    ``ingest_feed_posts``) so one slow or failing feed never blocks or rolls
    back the others.

    Returns:
        The total number of new posts saved across all active feeds.
    """
    feed_ids = await _get_active_feed_ids()
    if not feed_ids:
        return 0

    total = 0
    for feed_id in feed_ids:
        total += await ingest_feed_posts(feed_id)
    return total


async def run_feed_refresh_loop(
    interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
) -> None:
    """Continuously ingest new posts for active feeds on a schedule.

    Intended to be started once at application startup via
    ``app.add_background_task``. Sleeps ``interval_seconds`` between passes so
    feeds are polled without hammering their servers.
    """
    logger.info("Feed refresh background loop started")
    while True:
        try:
            count = await refresh_active_feeds()
            if count:
                logger.info("Scheduled feed refresh: %d new post(s)", count)
        except asyncio.CancelledError:
            logger.info("Feed refresh loop cancelled")
            raise
        except Exception:
            logger.exception("Scheduled feed refresh failed")
        await asyncio.sleep(interval_seconds)
