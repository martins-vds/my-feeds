"""Detect whether feed HTML has real, readable content.

Pure-stdlib helper (no third-party deps) so it can be used from both domain
entities and application services. Used to hide posts whose body is empty or
just a discussion/comments link (e.g. Hacker News items).
"""

from html.parser import HTMLParser

_MEDIA_TAGS = frozenset(
    {"img", "picture", "video", "audio", "iframe", "figure", "svg", "embed", "object"}
)


class _ReadableContentParser(HTMLParser):
    """Collect signals used to decide whether HTML has real, readable content."""

    def __init__(self) -> None:
        super().__init__()
        self.non_link_text: list[str] = []
        self.link_count = 0
        self.has_media = False
        self._link_depth = 0

    def handle_starttag(self, tag, attrs) -> None:
        if tag in _MEDIA_TAGS:
            self.has_media = True
        if tag == "a":
            self.link_count += 1
            self._link_depth += 1

    def handle_startendtag(self, tag, attrs) -> None:
        if tag in _MEDIA_TAGS:
            self.has_media = True

    def handle_endtag(self, tag) -> None:
        if tag == "a" and self._link_depth > 0:
            self._link_depth -= 1

    def handle_data(self, data) -> None:
        # Only text with actual word characters counts as readable; ignore
        # whitespace and pure punctuation separators like "|".
        if self._link_depth == 0 and any(ch.isalnum() for ch in data):
            self.non_link_text.append(data.strip())


def has_readable_content(html: str | None) -> bool:
    """Return True if ``html`` contains real, readable content.

    Content counts as readable when it has media (images/video/etc.) or any
    text outside of links. Content that is empty or consists solely of one or
    two links — e.g. a Hacker News item whose body is just a "Comments" link —
    is treated as not readable.
    """
    if not html or not html.strip():
        return False
    parser = _ReadableContentParser()
    try:
        parser.feed(html)
    except Exception:
        # If we can't parse it, don't hide it.
        return True
    if parser.has_media or parser.non_link_text:
        return True
    # Only links remain: a curated list of several links is still content.
    return parser.link_count >= 3
