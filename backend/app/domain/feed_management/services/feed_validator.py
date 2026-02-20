"""Feed URL validation service."""

from dataclasses import dataclass
from urllib.parse import urlparse

from app.infrastructure.feed_fetcher.feed_fetcher import FeedFetcher, FeedFetchError


class FeedValidationError(Exception):
    """Raised when feed validation fails."""

    def __init__(self, message: str, error_code: str = "invalid_feed"):
        super().__init__(message)
        self.error_code = error_code


@dataclass
class ValidationResult:
    """Result of feed URL validation."""

    is_valid: bool
    title: str | None = None
    description: str | None = None
    site_url: str | None = None
    icon_url: str | None = None
    format: str | None = None  # 'rss' or 'atom'
    error_message: str | None = None


class FeedValidator:
    """Domain service for validating feed URLs.

    Validates URL format, reachability, and RSS/Atom content.
    """

    MAX_URL_LENGTH = 2048
    ALLOWED_SCHEMES = {"http", "https"}

    def __init__(self, fetcher: FeedFetcher | None = None) -> None:
        """Initialize the validator.

        Args:
            fetcher: FeedFetcher instance for remote validation.
                     If None, a default instance is created.
        """
        self._fetcher = fetcher or FeedFetcher()

    def validate_url_format(self, url: str) -> None:
        """Validate URL format without making network requests.

        Args:
            url: URL to validate

        Raises:
            FeedValidationError: If URL format is invalid
        """
        if not url:
            raise FeedValidationError("URL is required", "missing_url")

        if len(url) > self.MAX_URL_LENGTH:
            raise FeedValidationError(
                f"URL must not exceed {self.MAX_URL_LENGTH} characters",
                "url_too_long",
            )

        try:
            parsed = urlparse(url)
        except ValueError as e:
            raise FeedValidationError(f"Invalid URL format: {e}", "invalid_format")

        if not parsed.scheme:
            raise FeedValidationError(
                "URL must include scheme (http:// or https://)",
                "missing_scheme",
            )

        if parsed.scheme.lower() not in self.ALLOWED_SCHEMES:
            raise FeedValidationError(
                f"URL scheme must be http or https, not {parsed.scheme}",
                "invalid_scheme",
            )

        if not parsed.netloc:
            raise FeedValidationError(
                "URL must include a domain",
                "missing_domain",
            )

    async def validate_url(self, url: str) -> ValidationResult:
        """Validate a URL including format and content type.

        Performs network request to verify URL is reachable and
        contains valid RSS/Atom content.

        Args:
            url: URL to validate

        Returns:
            ValidationResult with feed metadata if valid

        Raises:
            FeedValidationError: If validation fails
        """
        # First validate format
        self.validate_url_format(url)

        # Then fetch and validate content
        try:
            metadata = await self._fetcher.fetch_metadata(url)
            return ValidationResult(
                is_valid=True,
                title=metadata.title,
                description=metadata.description,
                site_url=metadata.site_url,
                icon_url=metadata.icon_url,
                format=metadata.format,
            )
        except FeedFetchError as e:
            raise FeedValidationError(
                f"Could not validate feed: {e}",
                "fetch_failed",
            ) from e

    async def validate_and_extract(self, url: str) -> ValidationResult:
        """Validate URL and extract metadata.

        Convenience method that combines validation and metadata extraction.

        Args:
            url: URL to validate

        Returns:
            ValidationResult with feed metadata

        Raises:
            FeedValidationError: If validation fails
        """
        return await self.validate_url(url)
