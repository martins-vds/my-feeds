"""SQLAlchemy implementation of PostRepository."""

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from sqlalchemy import and_, case, delete, exists, func, literal, or_, select, true, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.entities.user_post_state import UserPostState
from app.domain.feed_management.repositories.post_repository import PostRepository, ReadState
from app.infrastructure.persistence.models.audio import AudioModel
from app.infrastructure.persistence.models.feed import FeedModel
from app.infrastructure.persistence.models.feed_category import feed_categories
from app.infrastructure.persistence.models.post import PostModel
from app.infrastructure.persistence.models.user_post import UserPostModel
from app.infrastructure.sanitization.html_sanitizer import sanitize_html

_USER_POST_UNIQUE = "uq_user_posts_user_id_post_id"


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

    async def get_by_id_for_user(self, post_id: UUID, user_id: UUID) -> Optional[Post]:
        result = await self._session.execute(
            select(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .where(PostModel.id == post_id, FeedModel.user_id == user_id)
            .options(selectinload(PostModel.feed), selectinload(PostModel.audio))
        )
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

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
        """Get posts for a user with optional filters.

        The user's reading state comes from one LEFT JOIN, and the read-state
        filter is a SQL predicate, so LIMIT applies to the filtered rows.
        """
        query = (
            select(
                PostModel,
                UserPostModel.is_read,
                UserPostModel.read_progress,
                UserPostModel.opened_at.is_not(None).label("is_seen"),
            )
            .select_from(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            # The user predicate sits in the ON clause so posts without a row stay in.
            .outerjoin(
                UserPostModel,
                and_(UserPostModel.post_id == PostModel.id, UserPostModel.user_id == user_id),
            )
            .where(FeedModel.user_id == user_id)
            .options(selectinload(PostModel.feed), selectinload(PostModel.audio))
        )

        if category_id is not None:
            query = query.join(feed_categories, FeedModel.id == feed_categories.c.feed_id).where(
                feed_categories.c.category_id == category_id
            )

        if uncategorized:
            query = query.where(~exists().where(feed_categories.c.feed_id == FeedModel.id))

        if feed_id is not None:
            query = query.where(PostModel.feed_id == feed_id)

        # A post with no user_posts row is unread with no progress, hence IS NOT TRUE.
        if read_state == "read":
            query = query.where(UserPostModel.is_read.is_(True))
        elif read_state == "unread":
            query = query.where(UserPostModel.is_read.is_not(True))
        elif read_state == "in_progress":
            query = query.where(
                UserPostModel.is_read.is_not(True), UserPostModel.read_progress > 0.0
            )

        # Cursor-based pagination
        if before is not None:
            query = query.where(PostModel.published_at < before)

        # Order by published_at descending (newest first); id breaks ties so the
        # ordering — and the response ETag — is deterministic.
        query = query.order_by(PostModel.published_at.desc(), PostModel.id.desc())

        # Limit
        query = query.limit(limit)

        result = await self._session.execute(query)
        posts: List[Post] = []
        for model, is_read, read_progress, is_seen in result.all():
            post = self._to_entity(model)
            post.is_read = bool(is_read)
            post.read_progress = float(read_progress or 0.0)
            post.is_seen = bool(is_seen)
            posts.append(post)
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
        """Mark a post as read/unread for a user.

        Marking read sets the progress to 100%; marking unread resets it to 0%.
        ``opened_at`` is never touched.
        """
        stmt = pg_insert(UserPostModel).values(
            user_id=user_id,
            post_id=post_id,
            is_read=is_read,
            read_progress=1.0 if is_read else 0.0,
            read_at=datetime.now(timezone.utc) if is_read else None,
        )
        stmt = stmt.on_conflict_do_update(
            constraint=_USER_POST_UNIQUE,
            set_={
                "is_read": stmt.excluded.is_read,
                "read_progress": stmt.excluded.read_progress,
                "read_at": stmt.excluded.read_at,
            },
        )
        await self._session.execute(stmt)

    async def record_opened(self, user_id: UUID, post_id: UUID) -> None:
        """Remember that the user opened a post; ``opened_at`` is only ever set once."""
        stmt = pg_insert(UserPostModel).values(
            user_id=user_id,
            post_id=post_id,
            is_read=False,
            read_progress=0.0,
            read_at=None,
            opened_at=datetime.now(timezone.utc),
        )
        stmt = stmt.on_conflict_do_update(
            constraint=_USER_POST_UNIQUE,
            set_={"opened_at": func.coalesce(UserPostModel.opened_at, stmt.excluded.opened_at)},
        )
        await self._session.execute(stmt)

    async def record_progress(
        self, user_id: UUID, post_id: UUID, progress: float, *, completed: bool
    ) -> UserPostState:
        """Upsert reading progress and return the resulting state.

        Progress is a monotonic maximum. A post that is already read stays read at
        100% with its original ``read_at``. ``opened_at`` is set while still NULL.
        """
        now = datetime.now(timezone.utc)
        stmt = pg_insert(UserPostModel).values(
            user_id=user_id,
            post_id=post_id,
            is_read=completed,
            read_progress=1.0 if completed else progress,
            read_at=now if completed else None,
            opened_at=now,
        )
        new = stmt.excluded
        already_read = UserPostModel.is_read.is_(True)
        stmt = stmt.on_conflict_do_update(
            constraint=_USER_POST_UNIQUE,
            set_={
                "is_read": or_(UserPostModel.is_read, new.is_read),
                "read_progress": case(
                    (already_read, 1.0),
                    else_=func.greatest(UserPostModel.read_progress, new.read_progress),
                ),
                "read_at": case(
                    (already_read, UserPostModel.read_at),
                    (new.is_read.is_(True), new.read_at),
                    else_=UserPostModel.read_at,
                ),
                "opened_at": func.coalesce(UserPostModel.opened_at, new.opened_at),
            },
        ).returning(
            UserPostModel.is_read,
            UserPostModel.read_at,
            UserPostModel.read_progress,
            UserPostModel.opened_at,
        )
        row = (await self._session.execute(stmt)).one()
        return UserPostState(
            is_read=row.is_read,
            read_at=row.read_at,
            read_progress=float(row.read_progress),
            opened_at=row.opened_at,
        )

    async def get_user_post_state(self, user_id: UUID, post_id: UUID) -> UserPostState:
        """Get a user's state for a post; the untouched default when there is no row."""
        result = await self._session.execute(
            select(
                UserPostModel.is_read,
                UserPostModel.read_at,
                UserPostModel.read_progress,
                UserPostModel.opened_at,
            ).where(UserPostModel.user_id == user_id, UserPostModel.post_id == post_id)
        )
        row = result.one_or_none()
        if row is None:
            return UserPostState()
        return UserPostState(
            is_read=row.is_read,
            read_at=row.read_at,
            read_progress=float(row.read_progress),
            opened_at=row.opened_at,
        )

    async def get_read_state(self, user_id: UUID, post_id: UUID) -> tuple[bool, Optional[datetime]]:
        """Get read state for a specific post and user."""
        state = await self.get_user_post_state(user_id, post_id)
        return (state.is_read, state.read_at)

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

    async def get_unread_counts_by_category(self, user_id: UUID) -> tuple[dict[UUID, int], int]:
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

    @staticmethod
    def _scoped_posts(
        *columns,
        user_id: UUID,
        category_id: Optional[UUID],
        feed_id: Optional[UUID],
        uncategorized: bool,
    ):
        """SELECT ``columns`` for the posts in a scope (only the user's own feeds)."""
        query = (
            select(*columns)
            .select_from(PostModel)
            .join(FeedModel, PostModel.feed_id == FeedModel.id)
            .where(FeedModel.user_id == user_id)
        )
        if category_id is not None:
            query = query.join(feed_categories, FeedModel.id == feed_categories.c.feed_id).where(
                feed_categories.c.category_id == category_id
            )
        if uncategorized:
            query = query.where(~exists().where(feed_categories.c.feed_id == FeedModel.id))
        if feed_id is not None:
            query = query.where(PostModel.feed_id == feed_id)
        return query

    async def mark_all_read(
        self,
        user_id: UUID,
        is_read: bool,
        *,
        category_id: Optional[UUID] = None,
        feed_id: Optional[UUID] = None,
        uncategorized: bool = False,
    ) -> int:
        """Mark every post in a scope read/unread for a user (set-based)."""
        scope = {
            "user_id": user_id,
            "category_id": category_id,
            "feed_id": feed_id,
            "uncategorized": uncategorized,
        }

        if is_read:
            insert_stmt = pg_insert(UserPostModel).from_select(
                ["id", "user_id", "post_id", "is_read", "read_progress", "read_at"],
                self._scoped_posts(
                    func.gen_random_uuid(),
                    literal(user_id, UserPostModel.user_id.type),
                    PostModel.id,
                    true(),
                    literal(1.0, UserPostModel.read_progress.type),
                    literal(datetime.now(timezone.utc), UserPostModel.read_at.type),
                    **scope,
                ),
            )
            insert_stmt = insert_stmt.on_conflict_do_update(
                constraint=_USER_POST_UNIQUE,
                set_={
                    "is_read": insert_stmt.excluded.is_read,
                    "read_progress": insert_stmt.excluded.read_progress,
                    "read_at": insert_stmt.excluded.read_at,
                },
            )
            result = await self._session.execute(insert_stmt)
            return result.rowcount

        scoped_ids = self._scoped_posts(PostModel.id, **scope)
        total = (
            await self._session.execute(select(func.count()).select_from(scoped_ids.subquery()))
        ).scalar_one()
        if total:
            await self._session.execute(
                update(UserPostModel)
                .where(UserPostModel.user_id == user_id, UserPostModel.post_id.in_(scoped_ids))
                .values(is_read=False, read_progress=0.0, read_at=None)
                .execution_options(synchronize_session=False)
            )
        return total

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
