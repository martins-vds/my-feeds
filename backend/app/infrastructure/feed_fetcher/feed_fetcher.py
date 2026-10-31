"""Feed fetcher service using feedparser."""

import asyncio
import ipaddress
import socket
import zlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin, urlsplit

import aiohttp
import feedparser
from yarl import URL


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


def _public_address(host: str) -> None:
    address = ipaddress.ip_address(host)
    if not address.is_global or address.is_multicast or getattr(address, "ipv4_mapped", None):
        raise FeedFetchError("Feed destination must be a public IP address")
    if address.version == 6 and address in ipaddress.ip_network("64:ff9b::/96"):
        raise FeedFetchError("Feed destination must not use IPv4 translation")


def validate_feed_url(url: str) -> None:
    """Check syntax and literal destinations; DNS is checked at connection time."""
    try:
        if not isinstance(url, str) or len(url) > 2048 or any(ord(c) <= 32 for c in url):
            raise ValueError("Invalid feed URL")
        parsed = urlsplit(url)
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Feed URL must include an http or https domain")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("Feed URL must not include userinfo")
        if parsed.port not in {None, 80, 443}:
            raise ValueError("Feed URL port must be 80 or 443")
        # Match aiohttp's IDNA normalization before its literal-IP fast path.
        host = URL(url).raw_host.rstrip(".").lower()
        if host == "localhost" or host.endswith(".localhost") or "%" in host:
            raise ValueError("Feed destination must be public")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            return
        _public_address(host)
    except (ValueError, TypeError) as exc:
        raise FeedFetchError(str(exc)) from exc


class SafeFeedResolver(aiohttp.abc.AbstractResolver):
    """Return only checked addresses directly to aiohttp's connector.

    No second DNS lookup occurs between validation and connection; the original
    hostname remains on the HTTP request and TLS SNI/certificate verification.
    """

    async def resolve(self, host: str, port: int = 0, family: int = socket.AF_UNSPEC):
        records = await asyncio.get_running_loop().getaddrinfo(
            host, port, family=family, type=socket.SOCK_STREAM
        )
        if not records:
            raise FeedFetchError("Feed destination has no addresses")
        result = []
        for address_family, _, proto, _, sockaddr in records:
            _public_address(sockaddr[0])
            result.append(
                {
                    "hostname": host,
                    "host": sockaddr[0],
                    "port": port,
                    "family": address_family,
                    "proto": proto,
                    "flags": socket.AI_NUMERICHOST,
                }
            )
        return result

    async def close(self) -> None:
        pass


class FeedFetcher:
    """Service for fetching and parsing RSS/Atom feeds.

    Uses feedparser library for parsing and aiohttp for async HTTP requests.
    """

    DEFAULT_TIMEOUT = 30  # seconds
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024  # 5MB max feed size
    MAX_REDIRECTS = 5
    MAX_ENTRIES = 500
    MAX_POST_CONTENT = 256 * 1024
    MAX_POST_SUMMARY = 32 * 1024

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
        for entry in parsed.entries[: self.MAX_ENTRIES]:
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

    async def _fetch_url(self, url: str) -> bytes:
        """Fetch content from a URL.

        Args:
            url: URL to fetch

        Returns:
            Raw decoded content as bytes (preserving feed encoding)

        Raises:
            FeedFetchError: On network or HTTP errors
        """
        validate_feed_url(url)
        try:
            # Disable automatic decompression: its buffer can grow before the
            # consumer sees any bytes. Our decoder bounds each expansion.
            async with (
                aiohttp.TCPConnector(resolver=SafeFeedResolver(), limit=1) as connector,
                aiohttp.ClientSession(
                    timeout=self._timeout,
                    connector=connector,
                    auto_decompress=False,
                    trust_env=False,
                    headers={"Accept-Encoding": "gzip, deflate"},
                ) as session,
            ):
                for redirect in range(self.MAX_REDIRECTS + 1):
                    validate_feed_url(url)
                    async with session.get(url, allow_redirects=False) as response:
                        if response.status in {301, 302, 303, 307, 308}:
                            location = response.headers.get("Location")
                            if not location or redirect == self.MAX_REDIRECTS:
                                raise FeedFetchError("Invalid or excessive feed redirects")
                            url = urljoin(url, location)
                            continue
                        if response.status != 200:
                            raise FeedFetchError(f"HTTP {response.status}: {response.reason}")
                        return await self._read_content(response)

        except aiohttp.ClientError as e:
            raise FeedFetchError(f"Network error: {e}") from e
        except TimeoutError:
            raise FeedFetchError("Request timeout") from None
        except (OSError, zlib.error) as e:
            raise FeedFetchError(f"Feed transfer failed: {e}") from e
        except ValueError as e:
            raise FeedFetchError(f"Invalid feed redirect: {e}") from e

    async def _read_content(self, response: aiohttp.ClientResponse) -> bytes:
        encoding = response.headers.get("Content-Encoding", "identity").strip().lower()
        if encoding not in {"identity", "gzip", "deflate"}:
            raise FeedFetchError("Unsupported feed content encoding")
        decoder = zlib.decompressobj(31) if encoding == "gzip" else None
        prefix = b""
        content = bytearray()
        wire_size = 0
        async for chunk in response.content.iter_chunked(64 * 1024):
            wire_size += len(chunk)
            if wire_size > self.MAX_CONTENT_LENGTH:
                raise FeedFetchError("Feed too large")
            if encoding == "deflate" and decoder is None:
                prefix += chunk
                if len(prefix) < 2:
                    continue
                has_zlib_header = prefix[0] & 15 == 8 and int.from_bytes(prefix[:2]) % 31 == 0
                decoder = zlib.decompressobj(15 if has_zlib_header else -15)
                chunk, prefix = prefix, b""
            remaining = self.MAX_CONTENT_LENGTH - len(content)
            decoded = decoder.decompress(chunk, remaining + 1) if decoder else chunk
            if len(decoded) > remaining:
                raise FeedFetchError("Feed too large")
            content.extend(decoded)
            if decoder and decoder.unused_data:
                raise FeedFetchError("Unexpected trailing compressed feed data")
        if encoding != "identity" and (decoder is None or not decoder.eof):
            raise FeedFetchError("Incomplete compressed feed")
        return bytes(content)

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
            title=title[:1000],
            content=content[: self.MAX_POST_CONTENT] if content else None,
            summary=summary[: self.MAX_POST_SUMMARY] if summary else None,
            author=author[:255] if author else None,
            link=link,
            published_at=published,
        )
