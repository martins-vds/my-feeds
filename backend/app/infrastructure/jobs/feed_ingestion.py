"""Background job for ingesting a feed's posts.

Fetching and storing a feed's posts can be slow (large feeds have thousands
of entries), so ingestion runs outside the request/response cycle in its own
database session and transaction.
"""

import logging
from uuid import UUID

from app.config.container import create_feed_service, create_session
from app.infrastructure.http.response_cache import get_response_cache

logger = logging.getLogger(__name__)


async def ingest_feed_posts(feed_id: UUID) -> int:
    """Fetch and persist new posts for a single feed.

    Runs in its own database session/transaction so it can execute as a
    background task, independent of any HTTP request. Fetch failures are
    recorded on the feed by the service and committed; unexpected errors are
    rolled back and logged (never raised, since nothing awaits this task).

    Args:
        feed_id: The feed to ingest posts for.

    Returns:
        The number of new posts saved (0 if the feed is missing or the fetch
        failed).
    """
    session = create_session()
    try:
        feed_service = create_feed_service(session)
        count = await feed_service.ingest_feed(feed_id)
        await session.commit()
        # Feed metadata (last-fetched time, error counts) may have changed, so
        # drop the owner's cached feed lists rather than letting them lag to TTL.
        owner_id = await feed_service.get_feed_owner(feed_id)
        if owner_id is not None:
            await get_response_cache().invalidate_user(owner_id)
        logger.info("Ingested %d new post(s) for feed %s", count, feed_id)
        return count
    except Exception:
        await session.rollback()
        logger.exception("Post ingestion failed for feed %s", feed_id)
        return 0
    finally:
        await session.close()
