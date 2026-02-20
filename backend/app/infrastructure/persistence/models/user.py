"""User SQLAlchemy model."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Enum, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.persistence.database import Base

if TYPE_CHECKING:
    from app.infrastructure.persistence.models.category import CategoryModel
    from app.infrastructure.persistence.models.push_subscription import (
        PushSubscriptionModel,
    )
    from app.infrastructure.persistence.models.user_post import UserPostModel


class OAuthProvider(str, Enum):
    """OAuth provider enumeration."""

    GITHUB = "github"
    GOOGLE = "google"
    MICROSOFT = "microsoft"


class UserModel(Base):
    """SQLAlchemy model for User entity.

    Represents an authenticated user from OAuth provider.
    """

    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    provider: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        comment="OAuth provider: github, google, microsoft",
    )
    provider_id: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="User ID from OAuth provider",
    )
    email: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        index=True,
    )
    name: Mapped[str | None] = mapped_column(
        String(255),
        nullable=True,
        comment="Display name from OAuth",
    )
    avatar_url: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
        comment="Profile picture URL",
    )
    timezone: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="UTC",
        comment="IANA timezone for notifications",
    )
    notifications_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        comment="Daily notification preference",
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
    categories: Mapped[list["CategoryModel"]] = relationship(
        "CategoryModel",
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="CategoryModel.position",
    )
    push_subscriptions: Mapped[list["PushSubscriptionModel"]] = relationship(
        "PushSubscriptionModel",
        back_populates="user",
        cascade="all, delete-orphan",
    )
    read_posts: Mapped[list["UserPostModel"]] = relationship(
        "UserPostModel",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        UniqueConstraint("provider", "provider_id", name="uq_user_provider_id"),
        {"comment": "Authenticated users from OAuth providers"},
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email}, provider={self.provider})>"
