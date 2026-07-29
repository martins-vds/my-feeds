"""Post domain entity."""

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

from app.domain.shared.readable_content import has_readable_content


@dataclass
class Post:
    """Post domain entity representing an individual article/entry from a feed.

    Attributes:
        id: Unique identifier
        feed_id: Parent feed ID
        guid: Unique ID from feed (guid/id element)
        title: Post title
        link: Original article URL
        published_at: Publication date from feed
        content: Full post content (HTML), optional
        summary: Post summary/excerpt, optional
        author: Author name, optional
        fetched_at: When we fetched this post
        is_read: Read state for current user (populated dynamically)
        has_audio: Whether audio exists for this post
        feed_title: Title of parent feed (populated for summaries)
        feed_icon_url: Icon URL of parent feed (populated for summaries)
    """

    id: UUID
    feed_id: UUID
    guid: str
    title: str
    link: str
    published_at: datetime
    content: Optional[str] = None
    summary: Optional[str] = None
    author: Optional[str] = None
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    # These are populated dynamically, not stored in Post table
    is_read: bool = False
    has_audio: bool = False
    feed_title: Optional[str] = None
    feed_icon_url: Optional[str] = None

    MAX_TITLE_LENGTH = 1000
    MAX_GUID_LENGTH = 2048
    MAX_LINK_LENGTH = 2048
    MAX_AUTHOR_LENGTH = 255

    @classmethod
    def create(
        cls,
        feed_id: UUID,
        guid: str,
        title: str,
        link: str,
        published_at: datetime,
        content: Optional[str] = None,
        summary: Optional[str] = None,
        author: Optional[str] = None,
    ) -> "Post":
        """Create a new Post entity.

        Args:
            feed_id: Parent feed ID
            guid: Unique ID from feed
            title: Post title
            link: Original article URL
            published_at: Publication date from feed
            content: Full HTML content
            summary: Post summary/excerpt
            author: Author name

        Returns:
            New Post instance

        Raises:
            ValueError: If required fields are invalid
        """
        # Validate required fields
        if not guid or len(guid) > cls.MAX_GUID_LENGTH:
            raise ValueError(f"GUID must be 1-{cls.MAX_GUID_LENGTH} characters")

        title = title.strip() if title else ""
        if not title:
            raise ValueError("Title is required")
        if len(title) > cls.MAX_TITLE_LENGTH:
            title = title[: cls.MAX_TITLE_LENGTH]

        # Link is optional: some feeds (e.g. podcasts) omit a per-item link.
        link = link or ""
        if len(link) > cls.MAX_LINK_LENGTH:
            raise ValueError(f"Link must be at most {cls.MAX_LINK_LENGTH} characters")

        if author and len(author) > cls.MAX_AUTHOR_LENGTH:
            author = author[: cls.MAX_AUTHOR_LENGTH]

        # Normalize published_at to UTC
        if published_at.tzinfo is None:
            published_at = published_at.replace(tzinfo=timezone.utc)

        return cls(
            id=uuid4(),
            feed_id=feed_id,
            guid=guid,
            title=title,
            link=link,
            published_at=published_at,
            content=content,
            summary=summary,
            author=author,
            fetched_at=datetime.now(timezone.utc),
        )

    def get_excerpt(self, max_length: int = 200) -> str:
        """Get a short excerpt from summary or content.

        Args:
            max_length: Maximum length of excerpt

        Returns:
            Excerpt text
        """
        text = self.summary or self.content or ""
        # Strip HTML tags (simple approach)
        import html
        import re

        text = re.sub(r"<[^>]+>", "", text)
        # Decode HTML entities (e.g. &nbsp;, &gt;, &amp;) after removing tags so
        # they display as real characters instead of literal entity text.
        text = html.unescape(text)
        text = text.strip()

        if len(text) <= max_length:
            return text

        # Truncate at word boundary
        truncated = text[:max_length]
        last_space = truncated.rfind(" ")
        if last_space > max_length // 2:
            truncated = truncated[:last_space]
        return truncated.rstrip() + "..."

    def to_summary_dict(self) -> dict:
        """Convert to API summary response format.

        Returns:
            Dictionary with summary fields matching PostSummary schema
        """
        return {
            "id": str(self.id),
            "feedId": str(self.feed_id),
            "feedTitle": self.feed_title,
            "feedIconUrl": self.feed_icon_url,
            "title": self.title,
            "summary": self.get_excerpt(),
            "author": self.author,
            "link": self.link,
            "publishedAt": self.published_at.isoformat(),
            "isRead": self.is_read,
            "hasAudio": self.has_audio,
            "hasContent": has_readable_content(self.content) or has_readable_content(self.summary),
        }

    def to_detail_dict(self) -> dict:
        """Convert to API detail response format.

        Returns:
            Dictionary with full fields matching PostDetail schema
        """
        result = self.to_summary_dict()
        result["content"] = self.content
        return result

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Post):
            return False
        return self.id == other.id

    def __hash__(self) -> int:
        return hash(self.id)
