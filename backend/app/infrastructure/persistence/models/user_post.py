"""UserPost (read state) SQLAlchemy model."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.persistence.database import Base

if TYPE_CHECKING:
    from app.infrastructure.persistence.models.post import PostModel
    from app.infrastructure.persistence.models.user import UserModel


class UserPostModel(Base):
    """SQLAlchemy model for UserPost entity (read state).

    Junction table tracking per-user read state for posts.
    """

    __tablename__ = "user_posts"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    user_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    post_id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("posts.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        comment="Whether the user has read this post",
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the post was first read",
    )

    # Relationships
    user: Mapped["UserModel"] = relationship(
        "UserModel",
        back_populates="read_posts",
    )
    post: Mapped["PostModel"] = relationship(
        "PostModel",
        back_populates="read_by_users",
    )

    __table_args__ = (
        # User can only have one read state per post
        {"comment": "Per-user read state for posts"},
    )

    def __repr__(self) -> str:
        return f"<UserPost(user_id={self.user_id}, post_id={self.post_id}, is_read={self.is_read})>"
