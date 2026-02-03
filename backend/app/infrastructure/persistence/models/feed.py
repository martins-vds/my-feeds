"""Feed SQLAlchemy model."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.persistence.database import Base

if TYPE_CHECKING:
    from app.infrastructure.persistence.models.category import CategoryModel
    from app.infrastructure.persistence.models.post import PostModel


class FeedModel(Base):
    """SQLAlchemy model for Feed entity.

    Represents an RSS/Atom subscription with URL, title, and metadata.
    """

    __tablename__ = "feeds"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    category_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
        comment="Feed URL",
    )
    title: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
        comment="Feed title from metadata",
    )
    description: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Feed description",
    )
    site_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
        comment="Website URL",
    )
    icon_url: Mapped[str | None] = mapped_column(
        String(2048),
        nullable=True,
        comment="Feed/site favicon",
    )
    last_fetched_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        index=True,
        comment="Last successful fetch",
    )
    last_error: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        comment="Last fetch error message",
    )
    fetch_error_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Consecutive fetch failures",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )

    # Relationships
    category: Mapped["CategoryModel"] = relationship(
        "CategoryModel",
        back_populates="feeds",
    )
    posts: Mapped[list["PostModel"]] = relationship(
        "PostModel",
        back_populates="feed",
        cascade="all, delete-orphan",
        order_by="PostModel.published_at.desc()",
    )

    __table_args__ = (
        # Feed URL must be unique per category
        UniqueConstraint("category_id", "url", name="uq_feed_category_url"),
        {"comment": "RSS/Atom feed subscriptions"},
    )

    def __repr__(self) -> str:
        return f"<Feed(id={self.id}, title={self.title}, url={self.url[:50]}...)>"
