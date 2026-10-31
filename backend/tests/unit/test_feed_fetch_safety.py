"""Feed ingress security contracts; all networking uses controlled doubles."""

import asyncio
import socket
import zlib
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.domain.feed_management.services.feed_validator import FeedValidationError, FeedValidator
from app.infrastructure.feed_fetcher.feed_fetcher import (
    FeedFetcher,
    FeedFetchError,
    validate_feed_url,
)


@pytest.mark.parametrize(
    "url",
    [
        42,
        None,
        "ftp://feeds.example/rss",
        "https:///rss",
        "https://feeds.example:444/rss",
        "https://user:password@feeds.example/rss",
        "https://feeds.example/a b",
        "https://feeds.example/\x00",
        "https://feeds.example/\t",
    ],
)
def test_network_boundary_validates_urls_independently_of_domain_validation(url):
    with pytest.raises(FeedFetchError):
        validate_feed_url(url)


def test_network_url_limit_accepts_exactly_2048_characters():
    prefix = "https://feeds.example/"
    url = prefix + "a" * (2048 - len(prefix))
    validate_feed_url(url)
    with pytest.raises(FeedFetchError):
        validate_feed_url(url + "a")


@pytest.mark.parametrize(
    "url",
    [
        "http://user:pass@example.com/rss",
        "http://example.com:8080/rss",
        "http://127.0.0.1/rss",
        "http://10.0.0.1/rss",
        "http://169.254.169.254/rss",
        "http://[::1]/rss",
        "http://[fc00::1]/rss",
        "http://[fe80::1]/rss",
        "http://[::ffff:127.0.0.1]/rss",
        "http://localhost/rss",
        "http://224.0.0.1/rss",
    ],
)
def test_url_format_rejects_unsafe_destinations(url):
    with pytest.raises(FeedValidationError):
        FeedValidator(fetcher=AsyncMock()).validate_url_format(url)


@pytest.mark.parametrize("url", [42, {"url": "https://example.com/rss"}])
def test_non_string_feed_url_is_validation_error(url):
    with pytest.raises(FeedValidationError):
        FeedValidator(fetcher=AsyncMock()).validate_url_format(url)


class Stream:
    def __init__(self, chunks):
        self.chunks = chunks

    async def iter_chunked(self, _size):
        for chunk in self.chunks:
            yield chunk


class Response:
    def __init__(self, chunks=(), status=200, headers=None):
        self.status = status
        self.reason = "test"
        self.headers = headers or {}
        self.content_length = None
        self.content = Stream(chunks)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def text(self):
        return b"".join(self.content.chunks).decode()


class Session:
    def __init__(self, responses):
        self.responses = iter(responses)
        self.urls = []
        self.kwargs = []

    def get(self, url, **kwargs):
        self.urls.append(url)
        self.kwargs.append(kwargs)
        return next(self.responses)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


@pytest.mark.asyncio
async def test_actual_stream_size_is_enforced_without_content_length(monkeypatch):
    session = Session([Response([b"x" * 12, b"y" * 12])])
    monkeypatch.setattr("aiohttp.ClientSession", lambda **_kwargs: session)
    fetcher = FeedFetcher()
    fetcher.MAX_CONTENT_LENGTH = 20
    with pytest.raises(FeedFetchError, match="large"):
        await fetcher._fetch_url("https://example.com/rss")


@pytest.mark.asyncio
async def test_decompression_expansion_is_capped(monkeypatch):
    compressor = zlib.compressobj(wbits=31)
    compressed = compressor.compress(b"x" * 10000) + compressor.flush()
    session = Session([Response([compressed], headers={"Content-Encoding": "gzip"})])
    monkeypatch.setattr("aiohttp.ClientSession", lambda **_kwargs: session)
    fetcher = FeedFetcher()
    fetcher.MAX_CONTENT_LENGTH = 20
    with pytest.raises(FeedFetchError, match="large"):
        await fetcher._fetch_url("https://example.com/rss")


@pytest.mark.asyncio
async def test_raw_deflate_public_feed_remains_supported(monkeypatch):
    compressor = zlib.compressobj(wbits=-15)
    compressed = compressor.compress(b"<rss/>") + compressor.flush()
    session = Session([Response([compressed], headers={"Content-Encoding": "deflate"})])
    monkeypatch.setattr("aiohttp.ClientSession", lambda **_kwargs: session)
    assert await FeedFetcher()._fetch_url("https://example.com/rss") == b"<rss/>"


@pytest.mark.asyncio
async def test_redirect_to_private_host_is_rejected_before_following(monkeypatch):
    session = Session([Response(status=302, headers={"Location": "http://127.0.0.1/"})])
    monkeypatch.setattr("aiohttp.ClientSession", lambda **_kwargs: session)
    with pytest.raises(FeedFetchError):
        await FeedFetcher()._fetch_url("https://example.com/rss")
    assert session.urls == ["https://example.com/rss"]
    assert session.kwargs[0]["allow_redirects"] is False


@pytest.mark.asyncio
async def test_public_http_redirect_and_bytes_are_preserved(monkeypatch):
    session = Session(
        [
            Response(status=302, headers={"Location": "/feed"}),
            Response([b"<rss/>"]),
        ]
    )
    monkeypatch.setattr("aiohttp.ClientSession", lambda **_kwargs: session)
    assert await FeedFetcher()._fetch_url("http://example.com/start") == b"<rss/>"
    assert session.urls == ["http://example.com/start", "http://example.com/feed"]


@pytest.mark.asyncio
async def test_redirect_loop_is_finite(monkeypatch):
    session = Session([Response(status=302, headers={"Location": "/rss"}) for _ in range(10)])
    monkeypatch.setattr("aiohttp.ClientSession", lambda **_kwargs: session)
    with pytest.raises(FeedFetchError, match="redirect"):
        await FeedFetcher()._fetch_url("https://example.com/rss")
    assert len(session.urls) <= 6


@pytest.mark.asyncio
async def test_malformed_redirect_is_a_feed_error(monkeypatch):
    session = Session([Response(status=302, headers={"Location": "http://[invalid/"})])
    monkeypatch.setattr("aiohttp.ClientSession", lambda **_kwargs: session)
    with pytest.raises(FeedFetchError):
        await FeedFetcher()._fetch_url("https://example.com/rss")


@pytest.mark.parametrize(
    "url",
    [
        "http://[2002:7f00:1::]/rss",
        "http://[64:ff9b::7f00:1]/rss",
    ],
)
def test_ipv6_transition_destinations_cannot_embed_private_ipv4(url):
    with pytest.raises(FeedValidationError):
        FeedValidator(fetcher=AsyncMock()).validate_url_format(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://１２７.０.０.１/rss",
        "http://127。0。0。1/rss",
    ],
)
def test_normalized_unicode_ip_is_checked_before_connector_literal_bypass(url):
    with pytest.raises(FeedValidationError):
        FeedValidator(fetcher=AsyncMock()).validate_url_format(url)


@pytest.mark.asyncio
async def test_dns_result_is_validated_and_returned_to_connector(monkeypatch):
    from app.infrastructure.feed_fetcher import feed_fetcher as module

    async def lookup(host, port, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", lookup)
    resolver = module.SafeFeedResolver()
    addresses = await resolver.resolve("example.com", 80)
    assert [address["host"] for address in addresses] == ["93.184.216.34"]

    async def rebound(host, port, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", port))]

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", rebound)
    with pytest.raises(FeedFetchError):
        await resolver.resolve("example.com", 80)


@pytest.mark.asyncio
async def test_connector_uses_validated_dns_snapshot_without_second_lookup(monkeypatch):
    import aiohttp

    lookups, connections = [], []

    async def lookup(host, port, **kwargs):
        lookups.append(host)
        address = "93.184.216.34" if len(lookups) == 1 else "127.0.0.1"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))]

    async def connect(self, *args, addr_infos, req, **kwargs):
        connections.extend(info[4][0] for info in addr_infos)
        assert req.url.host == "example.com"
        assert kwargs["server_hostname"] == "example.com"
        raise FeedFetchError("Connection intercepted")

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", lookup)
    monkeypatch.setattr(aiohttp.TCPConnector, "_wrap_create_connection", connect)
    with pytest.raises(FeedFetchError, match="intercepted"):
        await FeedFetcher()._fetch_url("https://example.com/rss")
    assert lookups == ["example.com"]
    assert connections == ["93.184.216.34"]


@pytest.mark.asyncio
async def test_mixed_public_private_dns_never_connects(monkeypatch):
    import aiohttp

    connections = []

    async def lookup(host, port, **kwargs):
        return [
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
            (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", port)),
        ]

    async def connect(self, *args, **kwargs):
        connections.append(True)
        raise FeedFetchError("Connection should not occur")

    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", lookup)
    monkeypatch.setattr(aiohttp.TCPConnector, "_wrap_create_connection", connect)
    with pytest.raises(FeedFetchError, match="public"):
        await FeedFetcher()._fetch_url("https://example.com/rss")
    assert connections == []


@pytest.mark.parametrize(
    "chunks,headers,expected",
    [
        ([b"a" * 10, b"b" * 10], {}, b"a" * 10 + b"b" * 10),
        ([b"<rss/>"], {"Content-Length": "1"}, b"<rss/>"),
        (
            [zlib.compress(b"<rss/>")[:1], zlib.compress(b"<rss/>")[1:]],
            {"Content-Encoding": "deflate"},
            b"<rss/>",
        ),
    ],
)
@pytest.mark.asyncio
async def test_stream_boundaries_and_split_deflate_are_supported(
    monkeypatch, chunks, headers, expected
):
    session = Session([Response(chunks, headers=headers)])
    monkeypatch.setattr("aiohttp.ClientSession", lambda **_kwargs: session)
    fetcher = FeedFetcher()
    fetcher.MAX_CONTENT_LENGTH = 20
    assert await fetcher._fetch_url("http://example.com/rss") == expected


@pytest.mark.parametrize(
    "chunks,headers",
    [
        ([b"abc"], {"Content-Encoding": "br"}),
        ([b"\x1f\x8b"], {"Content-Encoding": "gzip"}),
        ([b"x" * 21], {}),
    ],
)
@pytest.mark.asyncio
async def test_unsupported_truncated_and_over_limit_transfers_fail(monkeypatch, chunks, headers):
    session = Session([Response(chunks, headers=headers)])
    monkeypatch.setattr("aiohttp.ClientSession", lambda **_kwargs: session)
    fetcher = FeedFetcher()
    fetcher.MAX_CONTENT_LENGTH = 20
    with pytest.raises(FeedFetchError):
        await fetcher._fetch_url("http://example.com/rss")


@pytest.mark.asyncio
async def test_metadata_and_posts_apply_policy_before_network_creation(monkeypatch):
    sessions = []

    def create_session(**kwargs):
        sessions.append(True)
        raise AssertionError("Unsafe destination reached network layer")

    monkeypatch.setattr("aiohttp.ClientSession", create_session)
    fetcher = FeedFetcher()
    for fetch in [fetcher.fetch_metadata, fetcher.fetch_posts]:
        with pytest.raises(FeedFetchError):
            await fetch("http://[::1]/rss")
    assert sessions == []


@pytest.mark.asyncio
async def test_entry_count_and_post_bodies_are_bounded(monkeypatch):
    fetcher = FeedFetcher()
    monkeypatch.setattr(fetcher, "_fetch_url", AsyncMock(return_value=b"rss"))
    entry = {
        "id": "entry",
        "title": "Title",
        "summary": "s" * 100000,
        "content": [{"value": "c" * 1000000}],
    }
    import feedparser

    parsed = SimpleNamespace(
        bozo=False,
        entries=[feedparser.FeedParserDict({**entry, "id": str(index)}) for index in range(1000)],
    )
    monkeypatch.setattr(feedparser, "parse", lambda _content: parsed)
    posts = await fetcher.fetch_posts("https://example.com/rss")
    assert len(posts) == 500
    assert len(posts[0].content) == 262144
    assert len(posts[0].summary) == 32768


@pytest.mark.parametrize(
    "entry,expected",
    [
        (
            {
                "id": "1",
                "title": "Title",
                "link": "https://example.com/1",
                "content": [{"value": "Body"}],
                "author": "Writer",
                "published_parsed": (2026, 1, 1, 1, 2, 3),
            },
            ("Body", None, "Writer", "https://example.com/1"),
        ),
        (
            {
                "guid": "2",
                "summary_detail": {"value": "Summary"},
                "summary": "Summary",
                "links": [{"rel": "alternate", "href": "https://example.com/2"}],
                "authors": [{"name": "Another"}],
                "updated_parsed": (2026, 1, 2, 1, 2, 3),
            },
            ("Summary", "Summary", "Another", "https://example.com/2"),
        ),
        (
            {
                "id": "3",
                "links": [{"rel": "enclosure", "href": "https://example.com/audio.mp3"}],
                "published_parsed": ("invalid",) * 6,
                "updated_parsed": ("invalid",) * 6,
            },
            (None, None, None, "https://example.com/audio.mp3"),
        ),
        ({"id": "https://example.com/4"}, (None, None, None, "https://example.com/4")),
    ],
)
def test_existing_entry_formats_remain_readable(entry, expected):
    import feedparser

    post = FeedFetcher()._parse_entry(feedparser.FeedParserDict(entry))
    assert (post.content, post.summary, post.author, post.link) == expected
    assert post.title in {"Title", "Untitled"}
    assert post.published_at.tzinfo is not None


@pytest.mark.asyncio
async def test_public_gzip_rss_retains_metadata_posts_and_declared_encoding(monkeypatch):
    xml = (
        '<?xml version="1.0" encoding="iso-8859-1"?>'
        '<rss version="2.0"><channel><title>Café Feed</title>'
        "<link>http://example.com/</link><description>News</description>"
        "<item><guid>item-1</guid><title>Café article</title>"
        "<link>http://example.com/article</link><description>Article text</description>"
        "</item></channel></rss>"
    ).encode("iso-8859-1")
    compressor = zlib.compressobj(wbits=31)
    compressed = compressor.compress(xml) + compressor.flush()

    def create_session(**kwargs):
        assert kwargs["auto_decompress"] is False
        assert kwargs["trust_env"] is False
        return Session([Response([compressed], headers={"Content-Encoding": "gzip"})])

    monkeypatch.setattr("aiohttp.ClientSession", create_session)
    fetcher = FeedFetcher()
    metadata = await fetcher.fetch_metadata("http://example.com/rss")
    assert metadata.title == "Café Feed"
    assert metadata.description == "News"
    assert metadata.format == "rss"
    posts = await fetcher.fetch_posts("http://example.com/rss")
    assert len(posts) == 1
    assert posts[0].guid == "item-1"
    assert posts[0].title == "Café article"
    assert posts[0].summary == "Article text"
