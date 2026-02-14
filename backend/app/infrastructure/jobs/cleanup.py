"""Post and feed data cleanup job.

Implements 90-day retention policy for posts and related data.
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config.container import create_session
from app.config.settings import get_settings
from app.infrastructure.persistence.models.post import PostModel
from app.infrastructure.persistence.models.user_post import UserPostModel

logger = logging.getLogger(__name__)


async def cleanup_old_posts(
    session: AsyncSession,
    retention_days: int = 90,
    batch_size: int = 100,
) -> int:
    """Delete posts older than retention period.
    
    Args:
        session: Database session
        retention_days: Number of days to retain posts
        batch_size: Number of posts to delete per batch
        
    Returns:
        Total number of posts deleted
    """
    cutoff_date = datetime.utcnow() - timedelta(days=retention_days)
    total_deleted = 0
    
    logger.info(
        f"Starting post cleanup: removing posts older than {retention_days} days "
        f"(cutoff: {cutoff_date.isoformat()})"
    )
    
    while True:
        # Find old post IDs in batches
        stmt = (
            select(PostModel.id)
            .where(PostModel.published_at < cutoff_date)
            .limit(batch_size)
        )
        result = await session.execute(stmt)
        post_ids = [row[0] for row in result.fetchall()]
        
        if not post_ids:
            break
        
        # Delete user_post records first (cascade should handle this, but be explicit)
        await session.execute(
            delete(UserPostModel).where(UserPostModel.post_id.in_(post_ids))
        )
        
        # Delete posts (CASCADE will delete audio records)
        await session.execute(
            delete(PostModel).where(PostModel.id.in_(post_ids))
        )
        
        await session.commit()
        total_deleted += len(post_ids)
        
        logger.info(f"Deleted batch of {len(post_ids)} posts (total: {total_deleted})")
    
    logger.info(f"Post cleanup complete: {total_deleted} posts deleted")
    return total_deleted


async def run_cleanup_job() -> None:
    """Run the complete cleanup job.
    
    This should be scheduled to run daily (e.g., via cron or APScheduler).
    """
    settings = get_settings()
    retention_days = settings.post_retention_days
    
    logger.info(f"Starting cleanup job with {retention_days}-day retention")
    
    session = create_session()
    try:
        deleted_count = await cleanup_old_posts(
            session=session,
            retention_days=retention_days,
        )
        logger.info(f"Cleanup job completed: {deleted_count} posts removed")
    except Exception as e:
        logger.error(f"Cleanup job failed: {e}")
        raise
    finally:
        await session.close()


def start_cleanup_scheduler() -> None:
    """Start the cleanup job scheduler.
    
    Uses APScheduler to run cleanup daily at 3 AM.
    """
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger
        
        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            run_cleanup_job,
            CronTrigger(hour=3, minute=0),  # Run at 3 AM daily
            id="post_cleanup",
            name="Post retention cleanup",
            replace_existing=True,
        )
        scheduler.start()
        logger.info("Cleanup scheduler started (runs daily at 3 AM)")
    except ImportError:
        logger.warning(
            "APScheduler not installed. Cleanup job must be triggered manually. "
            "Install with: uv add apscheduler"
        )


if __name__ == "__main__":
    # Allow running cleanup manually
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_cleanup_job())
