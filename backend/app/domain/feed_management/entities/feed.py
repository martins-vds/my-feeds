"""Feed domain entity."""

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class Feed:
    """Feed domain entity representing an RSS/Atom subscription.

    This is the domain model, independent of persistence concerns.
    """

    id: UUID = field(default_factory=uuid4)
    category_id: UUID = field(default_factory=uuid4)
    url: str = ""
    title: str | None = None
    description: str | None = None
    site_url: str | None = None
    icon_url: str | None = None
    last_fetched_at: datetime | None = None
    last_error: str | None = None
    fetch_error_count: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    # Domain validation constants
    MAX_URL_LENGTH = 2048
    MAX_TITLE_LENGTH = 500
    MAX_CONSECUTIVE_ERRORS = 10

    def __post_init__(self) -> None:
        """Validate entity invariants after initialization."""
        self._validate_url()

    def _validate_url(self) -> None:
        """Ensure URL meets validation rules."""
        if not self.url:
            raise ValueError("Feed URL is required")
        if len(self.url) > self.MAX_URL_LENGTH:
            raise ValueError(f"Feed URL must not exceed {self.MAX_URL_LENGTH} characters")
        if not self.url.startswith(("http://", "https://")):
            raise ValueError("Feed URL must use HTTP or HTTPS scheme")

    def update_metadata(
        self,
        title: str | None = None,
        description: str | None = None,
        site_url: str | None = None,
        icon_url: str | None = None,
    ) -> None:
        """Update feed metadata from fetched content.

        Args:
            title: Feed title from metadata
            description: Feed description
            site_url: Website URL
            icon_url: Favicon/icon URL
        """
        if title is not None:
            self.title = title[:self.MAX_TITLE_LENGTH] if title else None
        if description is not None:
            self.description = description
        if site_url is not None:
            self.site_url = site_url
        if icon_url is not None:
            self.icon_url = icon_url
        self.updated_at = datetime.utcnow()

    def record_successful_fetch(self) -> None:
        """Record a successful feed fetch.

        Resets error count and updates last_fetched_at timestamp.
        """
        self.last_fetched_at = datetime.utcnow()
        self.last_error = None
        self.fetch_error_count = 0
        self.updated_at = datetime.utcnow()

    def record_fetch_error(self, error_message: str) -> None:
        """Record a failed feed fetch.

        Args:
            error_message: Description of the error

        Note:
            Increments error count. After MAX_CONSECUTIVE_ERRORS,
            the feed should be disabled (handled by service layer).
        """
        self.last_error = error_message
        self.fetch_error_count += 1
        self.updated_at = datetime.utcnow()

    def is_disabled(self) -> bool:
        """Check if feed should be disabled due to consecutive errors.

        Returns:
            True if error count exceeds threshold
        """
        return self.fetch_error_count >= self.MAX_CONSECUTIVE_ERRORS

    def has_error(self) -> bool:
        """Check if feed has a current error.

        Returns:
            True if there is a recorded error
        """
        return self.last_error is not None

    def move_to_category(self, new_category_id: UUID) -> None:
        """Move feed to a different category.

        Args:
            new_category_id: Target category's UUID
        """
        self.category_id = new_category_id
        self.updated_at = datetime.utcnow()

    @classmethod
    def create(
        cls,
        category_id: UUID,
        url: str,
        title: str | None = None,
        description: str | None = None,
        site_url: str | None = None,
        icon_url: str | None = None,
    ) -> "Feed":
        """Factory method to create a new feed subscription.

        Args:
            category_id: Parent category's UUID
            url: RSS/Atom feed URL
            title: Feed title (optional, can be fetched)
            description: Feed description (optional)
            site_url: Website URL (optional)
            icon_url: Icon URL (optional)

        Returns:
            New Feed instance

        Raises:
            ValueError: If validation fails
        """
        return cls(
            category_id=category_id,
            url=url,
            title=title,
            description=description,
            site_url=site_url,
            icon_url=icon_url,
        )

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses.

        Returns:
            Dictionary representation suitable for JSON serialization
        """
        return {
            "id": str(self.id),
            "categoryId": str(self.category_id),
            "url": self.url,
            "title": self.title or self.url,  # Fallback to URL if no title
            "description": self.description,
            "siteUrl": self.site_url,
            "iconUrl": self.icon_url,
            "lastFetchedAt": self.last_fetched_at.isoformat() + "Z" if self.last_fetched_at else None,
            "hasError": self.has_error(),
            "createdAt": self.created_at.isoformat() + "Z",
        }
