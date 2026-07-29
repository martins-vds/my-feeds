"""SQLAlchemy implementation of PostRepository."""

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import delete, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.repositories.post_repository import PostRepository, ReadState
from app.infrastructure.persistence.models.audio import AudioModel
from app.infrastructure.persistence.models.feed import FeedModel
from app.infrastructure.persistence.models.feed_category import feed_categories
from app.infrastructure.persistence.models.post import PostModel
from app.infrastructure.persistence.models.user_post import UserPostModel
from app.infrastructure.sanitization.html_sanitizer import sanitize_html


class SQLAlchemyPostRepository(PostRepository):
    """SQLAlchemy-based implementation of PostRepository."""

    def __init__(self, session: AsyncSession) -> None:
        """Initialize repository with database session.

        Args:
            session: SQLAlchemy async session
        """
        self._session = session

    async def get_by_id(self, id: UUID) -> Optional[Post]:
        """Get a post by its ID."""
        result = await self._session.execute(
            select(PostModel)
            .options(selectinload(PostModel.feed), selectinload(PostModel.audio))
            .where(PostModel.id == id)
        )
        model = result.scalar_one_or_none()
        if model:
            return self._to_entity(model)
        return None

    async def get_posts_for_user(
        self,
        user_id: UUID,
        *,
        category_id: Optional[UUID] = None,
        feed_id: Optional[UUID] = None,
        read_state: ReadState = "all",
        before: Optional[datetime] = None,
        limit: int = 50,
        uncategorized: bool = False,
    ) -> List[Post]:
        """Get posts for a user with optional filters."""
        # Base query joining posts -> feeds (owned by the user)
        query = (
            select(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .where(FeedModel.user_id == user_id)
            .options(selectinload(PostModel.feed), selectinload(PostModel.audio))
        )

        # Apply filters
        if category_id is not None:
            query = query.join(feed_categories, FeedModel.id == feed_categories.c.feed_id).where(
                feed_categories.c.category_id == category_id
            )

        if uncategorized:
            query = query.where(~exists().where(feed_categories.c.feed_id == FeedModel.id))

        if feed_id is not None:
            query = query.where(PostModel.feed_id == feed_id)

        # Cursor-based pagination
        if before is not None:
            query = query.where(PostModel.published_at < before)

        # Order by published_at descending (newest first); id breaks ties so the
        # ordering — and the response ETag — is deterministic.
        query = query.order_by(PostModel.published_at.desc(), PostModel.id.desc())

        # Limit
        query = query.limit(limit)

        result = await self._session.execute(query)
        models = result.scalars().all()

        # Convert to entities and populate read state
        posts = []
        for model in models:
            post = self._to_entity(model)
            # Get read state for this user
            is_read, _ = await self.get_read_state(user_id, post.id)
            post.is_read = is_read
            posts.append(post)

        # Filter by read state after fetching (not optimal for large datasets)
        if read_state == "unread":
            posts = [p for p in posts if not p.is_read]
        elif read_state == "read":
            posts = [p for p in posts if p.is_read]

        return posts

    async def get_by_feed(
        self,
        feed_id: UUID,
        *,
        limit: int = 100,
    ) -> List[Post]:
        """Get posts for a specific feed."""
        result = await self._session.execute(
            select(PostModel)
            .where(PostModel.feed_id == feed_id)
            .order_by(PostModel.published_at.desc(), PostModel.id.desc())
            .limit(limit)
        )
        models = result.scalars().all()
        return [self._to_entity(model) for model in models]

    async def exists_by_guid(self, feed_id: UUID, guid: str) -> bool:
        """Check if a post with the given GUID exists in the feed."""
        result = await self._session.execute(
            select(
                exists().where(
                    PostModel.feed_id == feed_id,
                    PostModel.guid == guid,
                )
            )
        )
        return result.scalar() or False

    async def _reload(self, post_id: UUID) -> PostModel:
        """Reload a PostModel with audio and feed relationships eager-loaded."""
        result = await self._session.execute(
            select(PostModel)
            .where(PostModel.id == post_id)
            .options(selectinload(PostModel.audio), selectinload(PostModel.feed))
        )
        return result.scalar_one()

    async def save(self, post: Post) -> Post:
        """Save a post (create or update)."""
        existing = await self._session.get(PostModel, post.id)

        if existing:
            # Update existing post
            existing.title = post.title
            existing.content = post.content
            existing.summary = post.summary
            existing.author = post.author
            existing.link = post.link
            existing.published_at = post.published_at
            await self._session.flush()
            return self._to_entity(await self._reload(existing.id))
        else:
            # Create new post
            model = self._to_model(post)
            self._session.add(model)
            await self._session.flush()
            return self._to_entity(await self._reload(model.id))

    async def save_many(self, posts: List[Post]) -> List[Post]:
        """Save multiple posts efficiently."""
        saved = []
        for post in posts:
            # Check if exists by guid first
            exists_already = await self.exists_by_guid(post.feed_id, post.guid)
            if not exists_already:
                model = self._to_model(post)
                self._session.add(model)
                saved.append(post)
        await self._session.flush()
        return saved

    async def delete(self, id: UUID) -> bool:
        """Delete a post by ID."""
        result = await self._session.execute(delete(PostModel).where(PostModel.id == id))
        await self._session.flush()
        return result.rowcount > 0

    async def delete_old_posts(self, older_than: datetime) -> int:
        """Delete posts older than a given date."""
        result = await self._session.execute(
            delete(PostModel).where(PostModel.published_at < older_than)
        )
        await self._session.flush()
        return result.rowcount

    async def mark_as_read(self, user_id: UUID, post_id: UUID, is_read: bool = True) -> None:
        """Mark a post as read/unread for a user."""
        # Check if user_post record exists
        result = await self._session.execute(
            select(UserPostModel).where(
                UserPostModel.user_id == user_id,
                UserPostModel.post_id == post_id,
            )
        )
        user_post = result.scalar_one_or_none()

        if user_post:
            # Update existing
            user_post.is_read = is_read
            user_post.read_at = datetime.now(timezone.utc) if is_read else None
        else:
            # Create new
            user_post = UserPostModel(
                user_id=user_id,
                post_id=post_id,
                is_read=is_read,
                read_at=datetime.now(timezone.utc) if is_read else None,
            )
            self._session.add(user_post)

        await self._session.flush()

    async def get_read_state(self, user_id: UUID, post_id: UUID) -> tuple[bool, Optional[datetime]]:
        """Get read state for a specific post and user."""
        result = await self._session.execute(
            select(UserPostModel).where(
                UserPostModel.user_id == user_id,
                UserPostModel.post_id == post_id,
            )
        )
        user_post = result.scalar_one_or_none()

        if user_post:
            return (user_post.is_read, user_post.read_at)
        return (False, None)  # Posts are unread by default

    async def get_unread_counts_by_feed(self, user_id: UUID) -> dict[UUID, int]:
        """Get unread post counts grouped by feed for a user.

        Single aggregate query: a post counts as unread when the user has no
        ``user_posts`` row for it, or that row's ``is_read`` is False.
        """
        stmt = (
            select(PostModel.feed_id, func.count(PostModel.id))
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .outerjoin(
                UserPostModel,
                (UserPostModel.post_id == PostModel.id) & (UserPostModel.user_id == user_id),
            )
            .where(
                FeedModel.user_id == user_id,
                (UserPostModel.id.is_(None)) | (UserPostModel.is_read.is_(False)),
            )
            .group_by(PostModel.feed_id)
        )
        result = await self._session.execute(stmt)
        return {row[0]: row[1] for row in result.all()}

    async def get_unread_counts_by_category(
        self, user_id: UUID
    ) -> tuple[dict[UUID, int], int]:
        """Get unread post counts grouped by category, plus an uncategorized total."""
        # Per-category: posts -> feeds -> feed_categories, count unread per category.
        by_cat_stmt = (
            select(feed_categories.c.category_id, func.count(PostModel.id))
            .select_from(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .join(feed_categories, feed_categories.c.feed_id == FeedModel.id)
            .outerjoin(
                UserPostModel,
                (UserPostModel.post_id == PostModel.id) & (UserPostModel.user_id == user_id),
            )
            .where(
                FeedModel.user_id == user_id,
                (UserPostModel.id.is_(None)) | (UserPostModel.is_read.is_(False)),
            )
            .group_by(feed_categories.c.category_id)
        )
        by_cat_result = await self._session.execute(by_cat_stmt)
        by_category = {row[0]: row[1] for row in by_cat_result.all()}

        # Uncategorized: unread posts from feeds with no category rows.
        uncat_stmt = (
            select(func.count(PostModel.id))
            .select_from(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .outerjoin(
                UserPostModel,
                (UserPostModel.post_id == PostModel.id) & (UserPostModel.user_id == user_id),
            )
            .where(
                FeedModel.user_id == user_id,
                ~exists().where(feed_categories.c.feed_id == FeedModel.id),
                (UserPostModel.id.is_(None)) | (UserPostModel.is_read.is_(False)),
            )
        )
        uncat_result = await self._session.execute(uncat_stmt)
        uncategorized = uncat_result.scalar_one() or 0
        return by_category, uncategorized

    async def mark_all_read(
        self,
        user_id: UUID,
        is_read: bool,
        *,
        category_id: Optional[UUID] = None,
        feed_id: Optional[UUID] = None,
        uncategorized: bool = False,
    ) -> int:
        """Mark every post in a scope read/unread for a user."""
        # Scoped set of post ids (only the user's own feeds).
        id_query = (
            select(PostModel.id)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .where(FeedModel.user_id == user_id)
        )
        if category_id is not None:
            id_query = id_query.join(
                feed_categories, FeedModel.id == feed_categories.c.feed_id
            ).where(feed_categories.c.category_id == category_id)
        if uncategorized:
            id_query = id_query.where(~exists().where(feed_categories.c.feed_id == FeedModel.id))
        if feed_id is not None:
            id_query = id_query.where(PostModel.feed_id == feed_id)

        result = await self._session.execute(id_query)
        post_ids = [row[0] for row in result.all()]
        if not post_ids:
            return 0

        now = datetime.now(timezone.utc)

        # Update existing read-state rows in the scope.
        existing_result = await self._session.execute(
            select(UserPostModel).where(
                UserPostModel.user_id == user_id,
                UserPostModel.post_id.in_(post_ids),
            )
        )
        existing_ids: set[UUID] = set()
        for user_post in existing_result.scalars().all():
            user_post.is_read = is_read
            user_post.read_at = now if is_read else None
            existing_ids.add(user_post.post_id)

        # Posts with no row are already unread; only "mark read" needs inserts.
        if is_read:
            for post_id_ in post_ids:
                if post_id_ not in existing_ids:
                    self._session.add(
                        UserPostModel(
                            user_id=user_id,
                            post_id=post_id_,
                            is_read=True,
                            read_at=now,
                        )
                    )

        await self._session.flush()
        return len(post_ids)

    def _to_entity(self, model: PostModel) -> Post:
        """Convert SQLAlchemy model to domain entity.

        Content is sanitized on read (defense in depth) so even rows that were
        stored before ingestion-time sanitization are safe when served.
        """
        post = Post(
            id=model.id,
            feed_id=model.feed_id,
            guid=model.guid,
            title=model.title,
            link=model.link,
            published_at=model.published_at,
            content=sanitize_html(model.content),
            summary=sanitize_html(model.summary),
            author=model.author,
            fetched_at=model.fetched_at,
            is_read=False,  # Populated by caller
            has_audio=model.audio is not None,
        )
        if model.feed:
            post.feed_title = model.feed.title
            post.feed_icon_url = model.feed.icon_url
        return post

    @staticmethod
    def _to_model(entity: Post) -> PostModel:
        """Convert domain entity to SQLAlchemy model."""
        return PostModel(
            id=entity.id,
            feed_id=entity.feed_id,
            guid=entity.guid,
            title=entity.title,
            content=entity.content,
            summary=entity.summary,
            author=entity.author,
            link=entity.link,
            published_at=entity.published_at,
            fetched_at=entity.fetched_at,
        )
