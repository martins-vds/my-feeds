"""Audio cache cleanup job.

Cleans up old audio files from the cache directory based on retention policy.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Tuple

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.container import create_cache_manager, create_session
from app.config.settings import get_settings
from app.infrastructure.tts.cache_manager import AudioCacheManager
from app.infrastructure.persistence.models.audio import AudioModel

logger = logging.getLogger(__name__)


async def cleanup_orphaned_audio_files(
    cache: AudioCacheManager,
    session: AsyncSession,
) -> Tuple[int, int]:
    """Remove audio files that no longer have database records.

    Args:
        cache: Configured audio cache manager
        session: Database session

    Returns:
        Tuple of (files_deleted, bytes_freed)
    """
    files_deleted = 0
    bytes_freed = 0

    logger.info("Scanning for orphaned audio files")

    # Get all cache keys from database
    stmt = select(AudioModel.cache_key)
    result = await session.execute(stmt)
    valid_cache_keys = {row[0] for row in result.fetchall()}

    # Provider listing keeps cleanup independent of local paths.
    for entry in await cache.list_audio_files():
        if entry.cache_key not in valid_cache_keys and await cache.delete(entry.cache_key):
            files_deleted += 1
            bytes_freed += entry.size
            logger.debug(f"Deleted orphaned audio: {entry.cache_key}")

    logger.info(
        f"Orphan cleanup complete: {files_deleted} files deleted, "
        f"{bytes_freed / (1024 * 1024):.2f} MB freed"
    )
    return files_deleted, bytes_freed


async def cleanup_old_audio_records(
    session: AsyncSession,
    retention_days: int = 90,
) -> int:
    """Delete audio records older than retention period.

    Audio is deleted via CASCADE when posts are deleted, but this catches
    any orphaned records.

    Args:
        session: Database session
        retention_days: Number of days to retain audio

    Returns:
        Number of records deleted
    """
    cutoff_date = datetime.utcnow() - timedelta(days=retention_days)

    stmt = delete(AudioModel).where(AudioModel.last_accessed_at < cutoff_date)
    result = await session.execute(stmt)
    await session.commit()

    deleted_count = result.rowcount or 0
    logger.info(f"Deleted {deleted_count} old audio records")
    return deleted_count


async def cleanup_cache_by_size(
    cache: AudioCacheManager,
    max_size_mb: int,
    session: AsyncSession,
) -> Tuple[int, int]:
    """Remove oldest audio files if cache exceeds size limit.

    Uses LRU-style eviction based on last_accessed_at.

    Args:
        cache: Configured audio cache manager
        max_size_mb: Maximum cache size in megabytes
        session: Database session

    Returns:
        Tuple of (files_deleted, bytes_freed)
    """
    max_size_bytes = max_size_mb * 1024 * 1024

    # Calculate current cache size
    entries = {entry.cache_key: entry for entry in await cache.list_audio_files()}
    total_size = sum(entry.size for entry in entries.values())

    if total_size <= max_size_bytes:
        logger.info(
            f"Cache size ({total_size / (1024 * 1024):.2f} MB) within limit ({max_size_mb} MB)"
        )
        return 0, 0

    # Get audio records ordered by last access (oldest first)
    stmt = select(AudioModel).order_by(AudioModel.last_accessed_at.asc())
    result = await session.execute(stmt)
    audio_records = result.scalars().all()

    files_deleted = 0
    bytes_freed = 0

    for audio in audio_records:
        if total_size - bytes_freed <= max_size_bytes:
            break

        entry = entries.get(audio.cache_key)
        if entry and await cache.delete(audio.cache_key):
            bytes_freed += entry.size
            files_deleted += 1

        await session.delete(audio)

    await session.commit()

    logger.info(
        f"LRU eviction complete: {files_deleted} files deleted, "
        f"{bytes_freed / (1024 * 1024):.2f} MB freed"
    )
    return files_deleted, bytes_freed


async def run_audio_cleanup_job() -> None:
    """Run the complete audio cleanup job.

    This should be scheduled to run daily.
    """
    settings = get_settings()
    retention_days = settings.post_retention_days
    max_cache_size = settings.audio_max_cache_size_mb
    cache = create_cache_manager()

    logger.info("Starting audio cache cleanup job")

    session = create_session()
    try:
        await cache.initialize()
        # Step 1: Clean up old records
        await cleanup_old_audio_records(
            session=session,
            retention_days=retention_days,
        )

        # Step 2: Clean up orphaned files
        await cleanup_orphaned_audio_files(
            cache=cache,
            session=session,
        )

        # Step 3: Enforce size limit
        await cleanup_cache_by_size(
            cache=cache,
            max_size_mb=max_cache_size,
            session=session,
        )

        logger.info("Audio cleanup job completed")
    except Exception as e:
        logger.error(f"Audio cleanup job failed: {e}")
        raise
    finally:
        await session.close()


# Interval for the periodic cleanup loop. Runs often enough to keep the cache
# near its size limit while the audio generation job actively fills it.
DEFAULT_CLEANUP_INTERVAL_SECONDS = 300


async def run_audio_cleanup_loop(
    interval_seconds: int = DEFAULT_CLEANUP_INTERVAL_SECONDS,
) -> None:
    """Periodically enforce the audio cache retention/size policy.

    Intended to be started once at application startup via
    ``app.add_background_task``. Runs :func:`run_audio_cleanup_job`
    (orphan removal, stale-record pruning, LRU size eviction) every
    ``interval_seconds``.
    """
    logger.info("Audio cache cleanup loop started")
    while True:
        try:
            await run_audio_cleanup_job()
        except asyncio.CancelledError:
            logger.info("Audio cache cleanup loop cancelled")
            raise
        except Exception:
            logger.exception("Audio cache cleanup run failed")
        await asyncio.sleep(interval_seconds)


def start_audio_cleanup_scheduler() -> None:
    """Start the audio cleanup job scheduler.

    Uses APScheduler to run cleanup daily at 4 AM.
    """
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            run_audio_cleanup_job,
            CronTrigger(hour=4, minute=0),  # Run at 4 AM daily
            id="audio_cleanup",
            name="Audio cache cleanup",
            replace_existing=True,
        )
        scheduler.start()
        logger.info("Audio cleanup scheduler started (runs daily at 4 AM)")
    except ImportError:
        logger.warning("APScheduler not installed. Audio cleanup must be triggered manually.")


if __name__ == "__main__":
    # Allow running cleanup manually
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_audio_cleanup_job())
