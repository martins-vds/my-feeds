"""Feed application service."""

from uuid import UUID

from app.domain.feed_management.entities.feed import Feed
from app.domain.feed_management.entities.post import Post
from app.domain.feed_management.repositories.category_repository import CategoryRepository
from app.domain.feed_management.repositories.feed_repository import FeedRepository
from app.domain.feed_management.repositories.post_repository import PostRepository
from app.domain.feed_management.services.feed_validator import (
    FeedValidationError,
    FeedValidator,
)
from app.infrastructure.feed_fetcher.feed_fetcher import FeedFetcher
from app.infrastructure.sanitization.html_sanitizer import sanitize_html


class FeedLimitError(Exception):
    """Raised when feed limit is exceeded."""

    pass


class FeedNotFoundError(Exception):
    """Raised when feed is not found."""

    pass


class FeedConflictError(Exception):
    """Raised when feed URL already exists."""

    pass


class FeedPermissionError(Exception):
    """Raised when user doesn't have permission to access feed."""

    pass


class CategoryNotFoundError(Exception):
    """Raised when category is not found."""

    pass


class FeedService:
    """Application service for feed operations.

    Orchestrates feed CRUD operations with business rule enforcement.
    """

    MAX_FEEDS_PER_USER = 100  # FR-038

    def __init__(
        self,
        feed_repository: FeedRepository,
        category_repository: CategoryRepository,
        post_repository: PostRepository | None = None,
        feed_fetcher: FeedFetcher | None = None,
        feed_validator: FeedValidator | None = None,
    ) -> None:
        """Initialize service with dependencies.

        Args:
            feed_repository: Repository for feed persistence
            category_repository: Repository for category lookup
            post_repository: Repository for persisting fetched posts
            feed_fetcher: Service for fetching feed content
            feed_validator: Service for validating feed URLs
        """
        self._feed_repository = feed_repository
        self._category_repository = category_repository
        self._post_repository = post_repository
        self._fetcher = feed_fetcher or FeedFetcher()
        self._validator = feed_validator or FeedValidator(self._fetcher)

    async def list_feeds_in_category(self, user_id: UUID, category_id: UUID) -> list[Feed]:
        """Get all feeds in a category.

        Args:
            user_id: The requesting user's UUID
            category_id: The category's UUID

        Returns:
            List of feeds in the category

        Raises:
            CategoryNotFoundError: If category doesn't exist
            FeedPermissionError: If category belongs to different user
        """
        await self._verify_category_access(user_id, category_id)
        return await self._feed_repository.get_by_category(category_id)

    async def list_all_feeds(self, user_id: UUID) -> list[Feed]:
        """Get all feeds for a user across all categories.

        Args:
            user_id: The user's UUID

        Returns:
            List of all user's feeds
        """
        return await self._feed_repository.get_by_user(user_id)

    async def get_feed(self, user_id: UUID, feed_id: UUID) -> Feed:
        """Get a single feed by ID.

        Args:
            user_id: The requesting user's UUID
            feed_id: The feed's UUID

        Returns:
            The requested feed

        Raises:
            FeedNotFoundError: If feed doesn't exist
            FeedPermissionError: If feed belongs to different user
        """
        feed = await self._feed_repository.get_by_id(feed_id)
        if feed is None:
            raise FeedNotFoundError(f"Feed {feed_id} not found")

        # Verify the feed belongs to the requesting user
        if feed.user_id != user_id:
            raise FeedPermissionError("Cannot access another user's feed")

        return feed

    async def add_feed(
        self, user_id: UUID, url: str, category_ids: list[UUID] | None = None
    ) -> Feed:
        """Add a new feed subscription for a user.

        Validates the URL, fetches metadata, creates the feed (owned by the
        user), and assigns any provided category labels.

        Args:
            user_id: The user's UUID
            url: RSS/Atom feed URL
            category_ids: Optional category labels to assign (0..many)

        Returns:
            The created feed with metadata and categories

        Raises:
            FeedLimitError: If user has 100 feeds (FR-038)
            FeedConflictError: If URL already subscribed by the user
            FeedValidationError: If URL is invalid or not a feed
            CategoryNotFoundError: If a category doesn't exist
            FeedPermissionError: If a category belongs to a different user
        """
        category_ids = list(dict.fromkeys(category_ids or []))

        # Verify each category belongs to the user
        for category_id in category_ids:
            await self._verify_category_access(user_id, category_id)

        # Check total limit (FR-038)
        feed_count = await self._feed_repository.count_by_user(user_id)
        if feed_count >= self.MAX_FEEDS_PER_USER:
            raise FeedLimitError(f"Maximum of {self.MAX_FEEDS_PER_USER} feeds allowed")

        # Check for duplicate URL for this user
        if await self._feed_repository.exists_by_url_for_user(user_id, url):
            raise FeedConflictError("Feed URL already subscribed")

        # Validate URL and fetch metadata
        validation_result = await self._validator.validate_url(url)

        # Create feed with metadata
        feed = Feed.create(
            user_id=user_id,
            url=url,
            title=validation_result.title,
            description=validation_result.description,
            site_url=validation_result.site_url,
            icon_url=validation_result.icon_url,
            category_ids=category_ids,
        )

        saved = await self._feed_repository.save(feed)

        # Post ingestion is handled separately as a background task, so adding
        # a feed returns immediately instead of blocking on a full fetch.
        return saved

    async def set_feed_categories(
        self, user_id: UUID, feed_id: UUID, category_ids: list[UUID]
    ) -> Feed:
        """Replace the set of categories assigned to a feed.

        Args:
            user_id: The requesting user's UUID
            feed_id: The feed's UUID
            category_ids: The categories to assign (may be empty)

        Returns:
            The updated feed

        Raises:
            FeedNotFoundError: If feed doesn't exist
            FeedPermissionError: If feed/category belongs to different user
            CategoryNotFoundError: If a category doesn't exist
        """
        feed = await self.get_feed(user_id, feed_id)

        category_ids = list(dict.fromkeys(category_ids))
        for category_id in category_ids:
            await self._verify_category_access(user_id, category_id)

        feed.set_categories(category_ids)
        return await self._feed_repository.save(feed)

    async def delete_feed(self, user_id: UUID, feed_id: UUID) -> bool:
        """Delete a feed subscription.

        Note: This cascades to delete all posts from the feed.

        Args:
            user_id: The requesting user's UUID
            feed_id: The feed's UUID

        Returns:
            True if deleted

        Raises:
            FeedNotFoundError: If feed doesn't exist
            FeedPermissionError: If feed belongs to different user
        """
        # Verify ownership
        await self.get_feed(user_id, feed_id)

        return await self._feed_repository.delete(feed_id)

    async def ingest_feed(self, feed_id: UUID) -> int:
        """Fetch and persist new posts for a feed (system operation).

        Intended to be run from a background task, so there is no per-user
        permission check. Fetch success/failure is recorded on the feed.

        Args:
            feed_id: The feed to ingest posts for.

        Returns:
            The number of new posts saved (0 if the feed no longer exists).
        """
        feed = await self._feed_repository.get_by_id(feed_id)
        if feed is None:
            return 0

        try:
            count = await self._fetch_and_save_posts(feed)
            feed.record_successful_fetch()
        except Exception as e:
            feed.record_fetch_error(str(e))
            count = 0

        await self._feed_repository.save(feed)
        return count

    async def _fetch_and_save_posts(self, feed: Feed) -> int:
        """Fetch the feed's entries and persist any new posts.

        The feed must already be persisted (posts reference it via FK).

        Args:
            feed: The feed to ingest posts for.

        Returns:
            The number of new posts saved.

        Raises:
            Exception: If fetching/parsing the feed fails. Callers decide
                whether to swallow the error or record it on the feed.
        """
        if self._post_repository is None:
            return 0

        fetched = await self._fetcher.fetch_posts(
            feed.url,
            since=feed.last_fetched_at,
        )

        posts: list[Post] = []
        for entry in fetched:
            try:
                posts.append(
                    Post.create(
                        feed_id=feed.id,
                        guid=entry.guid,
                        title=entry.title,
                        link=entry.link,
                        published_at=entry.published_at,
                        content=sanitize_html(entry.content),
                        summary=sanitize_html(entry.summary),
                        author=entry.author,
                    )
                )
            except (ValueError, AttributeError):
                # Skip entries missing required fields.
                continue

        if not posts:
            return 0

        saved = await self._post_repository.save_many(posts)
        return len(saved)

    async def get_feed_count(self, user_id: UUID) -> int:
        """Get total feed count for a user.

        Args:
            user_id: The user's UUID

        Returns:
            Number of feeds
        """
        return await self._feed_repository.count_by_user(user_id)

    async def _verify_category_access(self, user_id: UUID, category_id: UUID) -> None:
        """Verify user has access to a category.

        Args:
            user_id: The user's UUID
            category_id: The category's UUID

        Raises:
            CategoryNotFoundError: If category doesn't exist
            FeedPermissionError: If category belongs to different user
        """
        category = await self._category_repository.get_by_id(category_id)
        if category is None:
            raise CategoryNotFoundError(f"Category {category_id} not found")

        if category.user_id != user_id:
            raise FeedPermissionError("Cannot access another user's category")
