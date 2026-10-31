"""Background job for ingesting a feed's posts.

Fetching and storing a feed's posts can be slow (large feeds have thousands
of entries), so ingestion runs outside the request/response cycle in its own
database session and transaction.
"""

import logging
from dataclasses import dataclass
from uuid import UUID

from app.config.container import create_feed_service, create_session
from app.infrastructure.http.response_cache import get_response_cache

logger = logging.getLogger(__name__)


class FeedJobAdmissionError(Exception):
    """No work was admitted; callers must return an explicit retry response."""

    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


@dataclass
class FeedJobReservation:
    feed_id: UUID
    gate: "FeedJobGate"
    started: bool = False

    def release(self) -> None:
        if self.gate._jobs.get(self.feed_id) is self:
            del self.gate._jobs[self.feed_id]

    def start(self, feed_id: UUID) -> None:
        if self.feed_id != feed_id or self.started or self.gate._jobs.get(feed_id) is not self:
            raise FeedJobAdmissionError("Invalid feed job reservation", 429)
        self.started = True


class FeedJobGate:
    """Non-waiting, process-wide admission for both scheduled and manual jobs.

    Reservations happen before background task creation. There are no semaphore
    waiters and no queue: at most four tasks are admitted, including tasks not
    yet started by Quart.
    """

    def __init__(self, max_jobs: int = 4) -> None:
        self.max_jobs = max_jobs
        self._jobs: dict[UUID, FeedJobReservation] = {}

    def reserve(self, feed_id: UUID) -> FeedJobReservation:
        if feed_id in self._jobs:
            raise FeedJobAdmissionError("Feed refresh is already in progress", 429)
        if len(self._jobs) >= self.max_jobs:
            raise FeedJobAdmissionError("Feed refresh capacity is full", 503)
        reservation = FeedJobReservation(feed_id, self)
        self._jobs[feed_id] = reservation
        return reservation


feed_job_gate = FeedJobGate()


async def ingest_feed_posts(feed_id: UUID, reservation: FeedJobReservation | None = None) -> int:
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
    reservation = reservation or feed_job_gate.reserve(feed_id)
    reservation.start(feed_id)
    session = None
    try:
        session = create_session()
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
        if session is not None:
            await session.rollback()
        logger.exception("Post ingestion failed for feed %s", feed_id)
        return 0
    finally:
        try:
            if session is not None:
                await session.close()
        finally:
            reservation.release()
