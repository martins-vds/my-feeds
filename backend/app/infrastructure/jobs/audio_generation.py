"""Background job that generates TTS audio for posts that don't have it yet.

This runs independently of feed ingestion: ingestion only stores posts, while
this job fills in audio for them in small batches on a periodic loop. Kept
separate so a slow/failing TTS provider never affects post ingestion.
"""

import asyncio
import logging

from sqlalchemy import or_, select

from app.application.services.audio_service import AudioStatus
from app.config.container import create_audio_service, create_session
from app.infrastructure.persistence.models.audio import AudioModel
from app.infrastructure.persistence.models.post import PostModel

logger = logging.getLogger(__name__)

# Tunables for the periodic background loop.
DEFAULT_BATCH_SIZE = 5
DEFAULT_INTERVAL_SECONDS = 60


async def generate_pending_audio(batch_size: int = DEFAULT_BATCH_SIZE) -> int:
    """Generate audio for up to ``batch_size`` posts that lack it.

    Selects the newest posts without an audio record and generates audio for
    each. Each post is committed independently so partial progress is preserved
    and a single failure doesn't roll back the whole batch. Runs in its own DB
    session.

    Args:
        batch_size: Maximum number of posts to process in this run.

    Returns:
        The number of posts for which audio was generated.
    """
    session = create_session()
    try:
        stmt = (
            select(PostModel.id)
            .outerjoin(AudioModel, AudioModel.post_id == PostModel.id)
            .where(
                # Posts with no audio yet, OR clips lacking word timings
                # (pre-feature backfill). Idempotent: has_timings=true is skipped.
                or_(AudioModel.id.is_(None), AudioModel.has_timings.is_(False)),
                PostModel.content.isnot(None),
                PostModel.content != "",
            )
            .order_by(PostModel.published_at.desc())
            .limit(batch_size)
        )
        result = await session.execute(stmt)
        post_ids = [row[0] for row in result.fetchall()]
        if not post_ids:
            return 0

        audio_service = create_audio_service(session)
        generated = 0
        for post_id in post_ids:
            try:
                outcome = await audio_service.generate_for_post(post_id)
                await session.commit()
                if outcome.status == AudioStatus.READY:
                    generated += 1
                else:
                    logger.warning(
                        "Audio generation failed for post %s: %s",
                        post_id,
                        outcome.error,
                    )
            except Exception:
                await session.rollback()
                logger.exception("Audio generation errored for post %s", post_id)
        return generated
    finally:
        await session.close()


async def run_audio_generation_loop(
    interval_seconds: int = DEFAULT_INTERVAL_SECONDS,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> None:
    """Continuously generate audio for posts missing it, in small batches.

    Intended to be started once at application startup via
    ``app.add_background_task``. Sleeps ``interval_seconds`` between batches so
    it trickles through the backlog without overwhelming the TTS provider.
    """
    logger.info("Audio generation background loop started")
    while True:
        try:
            count = await generate_pending_audio(batch_size)
            if count:
                logger.info("Background audio generation: %d post(s)", count)
        except asyncio.CancelledError:
            logger.info("Audio generation loop cancelled")
            raise
        except Exception:
            logger.exception("Audio generation batch failed")
        await asyncio.sleep(interval_seconds)
