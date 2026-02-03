"""Post SQLAlchemy model."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.persistence.database import Base

if TYPE_CHECKING:
    from app.infrastructure.persistence.models.audio import AudioModel
    from app.infrastructure.persistence.models.feed import FeedModel
    from app.infrastructure.persistence.models.user_post import UserPostModel


class PostModel(Base):
    """SQLAlchemy model for Post entity.

    Represents an individual article/entry from a feed.
    """

    __tablename__ = "posts"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    feed_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("feeds.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    guid: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
        comment="Unique ID from feed (guid/id element)",
    )
    title: Mapped[str] = mapped_column(
        String(1000),
        nullable=False,
        comment="Post title",
    )
    content: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Full post content (HTML)",
    )
    summary: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Post summary/excerpt",
    )
    author: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Author name",
    )
    link: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
        comment="Original article URL",
    )
    published_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        index=True,
        comment="Publication date from feed",
    )
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When we fetched this post",
    )

    # Relationships
    feed: Mapped["FeedModel"] = relationship(
        "FeedModel",
        back_populates="posts",
    )
    audio: Mapped["AudioModel | None"] = relationship(
        "AudioModel",
        back_populates="post",
        uselist=False,
        cascade="all, delete-orphan",
    )
    read_by_users: Mapped[list["UserPostModel"]] = relationship(
        "UserPostModel",
        back_populates="post",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # GUID must be unique per feed (for duplicate detection)
        UniqueConstraint("feed_id", "guid", name="uq_post_feed_guid"),
        # Index for global timeline query
        Index("idx_post_published_desc", published_at.desc()),
        # Index for feed timeline query
        Index("idx_post_feed_published", "feed_id", published_at.desc()),
        {"comment": "Individual articles/entries from feeds"},
    )

    def __repr__(self) -> str:
        return f"<Post(id={self.id}, title={self.title[:50]}...)>"
