"""Audio SQLAlchemy model."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.persistence.database import Base

if TYPE_CHECKING:
    from app.infrastructure.persistence.models.post import PostModel


class AudioModel(Base):
    """SQLAlchemy model for Audio entity.

    Represents cached TTS audio for a post.
    """

    __tablename__ = "audio"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    post_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
        comment="Associated post (one-to-one)",
    )
    cache_key: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        index=True,
        comment="Content key shared by posts; authorization uses the owning feed",
    )
    file_path: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
        comment="Server-side file path",
    )
    duration_seconds: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="Audio duration in seconds",
    )
    file_size_bytes: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
        comment="File size in bytes",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="When audio was generated",
    )
    last_accessed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        comment="Last time audio was accessed (for LRU cache)",
    )

    has_timings: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        server_default=text("false"),
        comment="True once a word-timing sidecar has been written (processed at current cache version; may hold zero words)",
    )

    # Relationships
    post: Mapped["PostModel"] = relationship(
        "PostModel",
        back_populates="audio",
    )

    __table_args__ = ({"comment": "Cached TTS audio files"},)

    def __repr__(self) -> str:
        return f"<Audio(id={self.id}, post_id={self.post_id}, cache_key={self.cache_key})>"
