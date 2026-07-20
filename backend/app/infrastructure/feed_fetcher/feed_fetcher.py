"""Feed fetcher service using feedparser."""

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import aiohttp
import feedparser


@dataclass
class FeedMetadata:
    """Metadata extracted from a feed."""

    title: str | None
    description: str | None
    site_url: str | None
    icon_url: str | None
    format: str  # 'rss' or 'atom'


@dataclass
class FeedPost:
    """A post extracted from a feed."""

    guid: str
    title: str
    content: str | None
    summary: str | None
    author: str | None
    link: str
    published_at: datetime


class FeedFetchError(Exception):
    """Raised when feed fetching fails."""

    pass


class FeedFetcher:
    """Service for fetching and parsing RSS/Atom feeds.

    Uses feedparser library for parsing and aiohttp for async HTTP requests.
    """

    DEFAULT_TIMEOUT = 30  # seconds
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5MB max feed size

    def __init__(self, timeout: int = DEFAULT_TIMEOUT) -> None:
        """Initialize the feed fetcher.

        Args:
            timeout: HTTP request timeout in seconds
        """
        self._timeout = aiohttp.ClientTimeout(total=timeout)

    async def fetch_metadata(self, url: str) -> FeedMetadata:
        """Fetch and parse feed metadata (title, description, etc.).

        Args:
            url: The feed URL to fetch

        Returns:
            FeedMetadata with extracted information

        Raises:
            FeedFetchError: If fetching or parsing fails
        """
        content = await self._fetch_url(url)
        parsed = await asyncio.to_thread(feedparser.parse, content)

        if parsed.bozo and not parsed.entries:
            # Feed is malformed and has no entries
            error = parsed.get("bozo_exception")
            raise FeedFetchError(f"Invalid feed format: {error}")

        feed_info = parsed.get("feed", {})
        feed_type = self._detect_feed_type(parsed)

        return FeedMetadata(
            title=feed_info.get("title"),
            description=feed_info.get("description") or feed_info.get("subtitle"),
            site_url=feed_info.get("link"),
            icon_url=self._extract_icon_url(feed_info),
            format=feed_type,
        )

    async def fetch_posts(self, url: str, since: datetime | None = None) -> list[FeedPost]:
        """Fetch and parse posts from a feed.

        Args:
            url: The feed URL to fetch
            since: Optional cutoff date - only return posts newer than this

        Returns:
            List of FeedPost objects

        Raises:
            FeedFetchError: If fetching or parsing fails
        """
        content = await self._fetch_url(url)
        parsed = await asyncio.to_thread(feedparser.parse, content)

        if parsed.bozo and not parsed.entries:
            error = parsed.get("bozo_exception")
            raise FeedFetchError(f"Invalid feed format: {error}")

        posts = []
        for entry in parsed.entries:
            try:
                post = self._parse_entry(entry)
                if since is None or post.published_at > since:
                    posts.append(post)
            except Exception:
                # Skip malformed entries but continue parsing
                continue

        # Sort by published date, newest first
        posts.sort(key=lambda p: p.published_at, reverse=True)
        return posts

    async def _fetch_url(self, url: str) -> str:
        """Fetch content from a URL.

        Args:
            url: URL to fetch

        Returns:
            Raw content as string

        Raises:
            FeedFetchError: On network or HTTP errors
        """
        try:
            async with aiohttp.ClientSession(timeout=self._timeout) as session:
                async with session.get(url) as response:
                    if response.status != 200:
                        raise FeedFetchError(f"HTTP {response.status}: {response.reason}")

                    # Check content length
                    content_length = response.content_length
                    if content_length and content_length > self.MAX_CONTENT_LENGTH:
                        raise FeedFetchError(f"Feed too large: {content_length} bytes")

                    return await response.text()

        except aiohttp.ClientError as e:
            raise FeedFetchError(f"Network error: {e}") from e
        except asyncio.TimeoutError:
            raise FeedFetchError("Request timeout") from None

    def _detect_feed_type(self, parsed: Any) -> str:
        """Detect if feed is RSS or Atom.

        Args:
            parsed: Parsed feedparser result

        Returns:
            'rss' or 'atom'
        """
        version = parsed.get("version", "")
        if "atom" in version.lower():
            return "atom"
        return "rss"

    def _extract_icon_url(self, feed_info: dict) -> str | None:
        """Extract icon/favicon URL from feed info.

        Args:
            feed_info: Feed metadata dict from feedparser

        Returns:
            Icon URL if found, None otherwise
        """
        # Try various common locations
        if "icon" in feed_info:
            return feed_info["icon"]
        if "image" in feed_info and "href" in feed_info["image"]:
            return feed_info["image"]["href"]
        if "logo" in feed_info:
            return feed_info["logo"]
        return None

    def _parse_entry(self, entry: Any) -> FeedPost:
        """Parse a feedparser entry into a FeedPost.

        Args:
            entry: Feedparser entry object

        Returns:
            FeedPost instance

        Raises:
            ValueError: If required fields are missing
        """
        # Get unique identifier
        guid = entry.get("id") or entry.get("guid") or entry.get("link")
        if not guid:
            raise ValueError("Entry has no identifier")

        # Get title
        title = entry.get("title", "")
        if not title:
            title = "Untitled"

        # Get link
        link = entry.get("link", "")
        if not link and entry.get("links"):
            for link_info in entry.links:
                if link_info.get("rel") == "alternate":
                    link = link_info.get("href", "")
                    break
        # Fall back to an enclosure URL (e.g. podcast audio) when the entry
        # has no web link of its own.
        if not link:
            for enclosure in entry.get("enclosures") or []:
                href = enclosure.get("href")
                if href:
                    link = href
                    break
        # Last resort: use the guid when it is itself a URL.
        if not link and isinstance(guid, str) and guid.startswith(("http://", "https://")):
            link = guid

        # Get content
        content = None
        if entry.get("content"):
            content = entry.content[0].get("value")
        elif entry.get("summary_detail"):
            content = entry.summary_detail.get("value")

        # Get summary
        summary = entry.get("summary")

        # Get author
        author = entry.get("author")
        if not author and entry.get("authors"):
            author = entry.authors[0].get("name")

        # Get published date (normalized to timezone-aware UTC so it can be
        # compared against stored timestamps on incremental refreshes).
        published = None
        if entry.get("published_parsed"):
            try:
                published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                pass
        if published is None and entry.get("updated_parsed"):
            try:
                published = datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)
            except (TypeError, ValueError):
                pass
        if published is None:
            published = datetime.now(timezone.utc)

        return FeedPost(
            guid=guid,
            title=title,
            content=content,
            summary=summary,
            author=author,
            link=link,
            published_at=published,
        )
