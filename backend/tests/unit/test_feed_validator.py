"""Unit tests for FeedValidator."""

from unittest.mock import AsyncMock

import pytest

from app.domain.feed_management.services.feed_validator import (
    FeedValidationError,
    FeedValidator,
    ValidationResult,
)
from app.infrastructure.feed_fetcher.feed_fetcher import FeedFetchError, FeedMetadata


class TestFeedValidatorURLFormat:
    """Tests for URL format validation."""

    def test_valid_https_url(self):
        """HTTPS URLs should be valid."""
        validator = FeedValidator(fetcher=AsyncMock())
        # Should not raise
        validator.validate_url_format("https://example.com/feed.xml")

    def test_valid_http_url(self):
        """HTTP URLs should be valid."""
        validator = FeedValidator(fetcher=AsyncMock())
        validator.validate_url_format("http://example.com/feed.xml")

    def test_invalid_scheme_ftp(self):
        """FTP URLs should be invalid."""
        validator = FeedValidator(fetcher=AsyncMock())
        with pytest.raises(FeedValidationError) as exc_info:
            validator.validate_url_format("ftp://example.com/feed.xml")
        assert "scheme" in str(exc_info.value).lower()

    def test_invalid_url_no_scheme(self):
        """URLs without scheme should be invalid."""
        validator = FeedValidator(fetcher=AsyncMock())
        with pytest.raises(FeedValidationError):
            validator.validate_url_format("example.com/feed.xml")

    def test_invalid_url_malformed(self):
        """Malformed URLs should be invalid."""
        validator = FeedValidator(fetcher=AsyncMock())
        with pytest.raises(FeedValidationError):
            validator.validate_url_format("not-a-url")

    def test_url_too_long(self):
        """URLs over 2048 chars should be invalid."""
        validator = FeedValidator(fetcher=AsyncMock())
        long_url = "https://example.com/" + "x" * 2048
        with pytest.raises(FeedValidationError):
            validator.validate_url_format(long_url)


class TestFeedValidatorFeedFormat:
    """Tests for RSS/Atom format validation via validate_url (async)."""

    @pytest.mark.asyncio
    async def test_valid_rss_2_0(self):
        """RSS 2.0 feeds should be valid."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.return_value = FeedMetadata(
            title="Example Feed",
            description="A feed",
            site_url="https://example.com",
            icon_url=None,
            format="rss",
        )

        validator = FeedValidator(fetcher=mock_fetcher)
        result = await validator.validate_url("https://example.com/feed.xml")

        assert result.is_valid
        assert result.format == "rss"

    @pytest.mark.asyncio
    async def test_valid_atom_1_0(self):
        """Atom 1.0 feeds should be valid."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.return_value = FeedMetadata(
            title="Atom Feed",
            description=None,
            site_url="https://example.com",
            icon_url=None,
            format="atom",
        )

        validator = FeedValidator(fetcher=mock_fetcher)
        result = await validator.validate_url("https://example.com/atom.xml")

        assert result.is_valid
        assert result.format == "atom"

    @pytest.mark.asyncio
    async def test_invalid_html_page(self):
        """HTML pages should be invalid (fetcher raises error)."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.side_effect = FeedFetchError("Not a valid feed")

        validator = FeedValidator(fetcher=mock_fetcher)
        with pytest.raises(FeedValidationError) as exc_info:
            await validator.validate_url("https://example.com/page.html")
        assert "could not validate feed" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_invalid_json(self):
        """JSON responses should be invalid (unless JSON Feed)."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.side_effect = FeedFetchError("Not a valid feed")

        validator = FeedValidator(fetcher=mock_fetcher)
        with pytest.raises(FeedValidationError):
            await validator.validate_url("https://example.com/api/data")


class TestFeedValidatorReachability:
    """Tests for URL reachability validation."""

    @pytest.mark.asyncio
    async def test_unreachable_url_timeout(self):
        """Timeout should raise validation error."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.side_effect = FeedFetchError("Timeout")

        validator = FeedValidator(fetcher=mock_fetcher)
        with pytest.raises(FeedValidationError):
            await validator.validate_url("https://slow-server.com/feed.xml")

    @pytest.mark.asyncio
    async def test_unreachable_url_404(self):
        """404 response should raise validation error."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.side_effect = FeedFetchError("HTTP 404")

        validator = FeedValidator(fetcher=mock_fetcher)
        with pytest.raises(FeedValidationError):
            await validator.validate_url("https://example.com/nonexistent.xml")

    @pytest.mark.asyncio
    async def test_unreachable_url_dns_error(self):
        """DNS resolution failure should raise validation error."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.side_effect = FeedFetchError("DNS resolution failed")

        validator = FeedValidator(fetcher=mock_fetcher)
        with pytest.raises(FeedValidationError):
            await validator.validate_url("https://nonexistent-domain-xyz.com/feed.xml")


class TestFeedValidatorMetadataExtraction:
    """Tests for feed metadata extraction."""

    @pytest.mark.asyncio
    async def test_extracts_title(self):
        """Should extract feed title."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.return_value = FeedMetadata(
            title="Example Feed",
            description="A great feed",
            site_url="https://example.com",
            icon_url=None,
            format="rss",
        )

        validator = FeedValidator(fetcher=mock_fetcher)
        result = await validator.validate_url("https://example.com/feed.xml")
        assert result.title == "Example Feed"

    @pytest.mark.asyncio
    async def test_extracts_description(self):
        """Should extract feed description."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.return_value = FeedMetadata(
            title="Feed",
            description="A detailed description",
            site_url="https://example.com",
            icon_url=None,
            format="rss",
        )

        validator = FeedValidator(fetcher=mock_fetcher)
        result = await validator.validate_url("https://example.com/feed.xml")
        assert result.description == "A detailed description"

    @pytest.mark.asyncio
    async def test_extracts_site_url(self):
        """Should extract website URL."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.return_value = FeedMetadata(
            title="Feed",
            description=None,
            site_url="https://example.com",
            icon_url=None,
            format="rss",
        )

        validator = FeedValidator(fetcher=mock_fetcher)
        result = await validator.validate_url("https://example.com/feed.xml")
        assert result.site_url == "https://example.com"

    @pytest.mark.asyncio
    async def test_handles_missing_metadata(self):
        """Should handle feeds with missing optional metadata."""
        mock_fetcher = AsyncMock()
        mock_fetcher.fetch_metadata.return_value = FeedMetadata(
            title="Minimal Feed",
            description=None,
            site_url=None,
            icon_url=None,
            format="rss",
        )

        validator = FeedValidator(fetcher=mock_fetcher)
        result = await validator.validate_url("https://example.com/feed.xml")

        assert result.is_valid
        assert result.title == "Minimal Feed"
        assert result.description is None
        assert result.site_url is None
