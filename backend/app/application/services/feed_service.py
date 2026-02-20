"""Feed application service."""

from uuid import UUID

from app.domain.feed_management.entities.feed import Feed
from app.domain.feed_management.repositories.category_repository import CategoryRepository
from app.domain.feed_management.repositories.feed_repository import FeedRepository
from app.domain.feed_management.services.feed_validator import (
    FeedValidationError,
    FeedValidator,
)
from app.infrastructure.feed_fetcher.feed_fetcher import FeedFetcher


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
        feed_fetcher: FeedFetcher | None = None,
        feed_validator: FeedValidator | None = None,
    ) -> None:
        """Initialize service with dependencies.

        Args:
            feed_repository: Repository for feed persistence
            category_repository: Repository for category lookup
            feed_fetcher: Service for fetching feed content
            feed_validator: Service for validating feed URLs
        """
        self._feed_repository = feed_repository
        self._category_repository = category_repository
        self._fetcher = feed_fetcher or FeedFetcher()
        self._validator = feed_validator or FeedValidator(self._fetcher)

    async def list_feeds_in_category(
        self, user_id: UUID, category_id: UUID
    ) -> list[Feed]:
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

        # Verify user owns the category this feed belongs to
        await self._verify_category_access(user_id, feed.category_id)

        return feed

    async def add_feed(
        self, user_id: UUID, category_id: UUID, url: str
    ) -> Feed:
        """Add a new feed subscription.

        Validates URL, fetches metadata, and creates feed.

        Args:
            user_id: The user's UUID
            category_id: Target category's UUID
            url: RSS/Atom feed URL

        Returns:
            The created feed with metadata

        Raises:
            FeedLimitError: If user has 100 feeds (FR-038)
            FeedConflictError: If URL already subscribed in category
            FeedValidationError: If URL is invalid or not a feed
            CategoryNotFoundError: If category doesn't exist
            FeedPermissionError: If category belongs to different user
        """
        # Verify category access
        await self._verify_category_access(user_id, category_id)

        # Check total limit (FR-038)
        feed_count = await self._feed_repository.count_by_user(user_id)
        if feed_count >= self.MAX_FEEDS_PER_USER:
            raise FeedLimitError(
                f"Maximum of {self.MAX_FEEDS_PER_USER} feeds allowed"
            )

        # Check for duplicate URL in category
        if await self._feed_repository.exists_by_url_in_category(category_id, url):
            raise FeedConflictError(f"Feed URL already subscribed in this category")

        # Validate URL and fetch metadata
        try:
            validation_result = await self._validator.validate_url(url)
        except FeedValidationError:
            raise

        # Create feed with metadata
        feed = Feed.create(
            category_id=category_id,
            url=url,
            title=validation_result.title,
            description=validation_result.description,
            site_url=validation_result.site_url,
            icon_url=validation_result.icon_url,
        )

        return await self._feed_repository.save(feed)

    async def move_feed(
        self, user_id: UUID, feed_id: UUID, target_category_id: UUID
    ) -> Feed:
        """Move a feed to a different category.

        Args:
            user_id: The requesting user's UUID
            feed_id: The feed's UUID
            target_category_id: Target category's UUID

        Returns:
            The updated feed

        Raises:
            FeedNotFoundError: If feed doesn't exist
            FeedPermissionError: If feed/category belongs to different user
            CategoryNotFoundError: If target category doesn't exist
        """
        feed = await self.get_feed(user_id, feed_id)

        # Verify target category access
        await self._verify_category_access(user_id, target_category_id)

        # Move and save
        feed.move_to_category(target_category_id)
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

    async def refresh_feed(self, user_id: UUID, feed_id: UUID) -> Feed:
        """Manually refresh a feed to fetch new posts.

        Args:
            user_id: The requesting user's UUID
            feed_id: The feed's UUID

        Returns:
            The updated feed

        Raises:
            FeedNotFoundError: If feed doesn't exist
            FeedPermissionError: If feed belongs to different user
        """
        feed = await self.get_feed(user_id, feed_id)

        try:
            # Fetch new posts
            posts = await self._fetcher.fetch_posts(
                feed.url,
                since=feed.last_fetched_at,
            )

            # TODO: Save posts to repository (implemented in US3)
            # For now, just update feed metadata
            feed.record_successful_fetch()

        except Exception as e:
            feed.record_fetch_error(str(e))

        return await self._feed_repository.save(feed)

    async def get_feed_count(self, user_id: UUID) -> int:
        """Get total feed count for a user.

        Args:
            user_id: The user's UUID

        Returns:
            Number of feeds
        """
        return await self._feed_repository.count_by_user(user_id)

    async def _verify_category_access(
        self, user_id: UUID, category_id: UUID
    ) -> None:
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
