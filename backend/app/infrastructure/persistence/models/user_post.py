"""UserPost (read state and reading progress) SQLAlchemy model."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.persistence.database import Base

if TYPE_CHECKING:
    from app.infrastructure.persistence.models.post import PostModel
    from app.infrastructure.persistence.models.user import UserModel


class UserPostModel(Base):
    """SQLAlchemy model for UserPost entity (read state).

    Junction table tracking per-user read state and reading progress for posts.
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
        default=False,
        comment="Whether the user has read this post",
    )
    read_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the post was first read",
    )
    opened_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="When the user first opened this post",
    )
    read_progress: Mapped[float] = mapped_column(
        Float,
        nullable=False,
        default=0.0,
        server_default="0",
        comment="Furthest reading position reached, from 0.0 to 1.0",
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
        UniqueConstraint("user_id", "post_id", name="uq_user_posts_user_id_post_id"),
        CheckConstraint(
            "read_progress >= 0 AND read_progress <= 1",
            name="ck_user_posts_read_progress_range",
        ),
        {"comment": "Per-user read state and reading progress for posts"},
    )

    def __repr__(self) -> str:
        return f"<UserPost(user_id={self.user_id}, post_id={self.post_id}, is_read={self.is_read})>"
