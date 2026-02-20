"""PushSubscription SQLAlchemy model."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.persistence.database import Base

if TYPE_CHECKING:
    from app.infrastructure.persistence.models.user import UserModel


class PushSubscriptionModel(Base):
    """SQLAlchemy model for PushSubscription entity.

    Represents a push notification subscription for a user's device.
    """

    __tablename__ = "push_subscriptions"

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
    endpoint: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        unique=True,
        comment="Push service endpoint URL",
    )
    p256dh: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="P-256 Diffie-Hellman public key",
    )
    auth: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
        comment="Authentication secret",
    )
    user_agent: Mapped[str | None] = mapped_column(
        String(512),
        nullable=True,
        comment="User agent string for debugging",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_success_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
        comment="Last successful notification delivery",
    )
    failure_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Consecutive delivery failures",
    )

    # Relationships
    user: Mapped["UserModel"] = relationship(
        "UserModel",
        back_populates="push_subscriptions",
    )

    __table_args__ = ({"comment": "Push notification subscriptions"},)

    def __repr__(self) -> str:
        return f"<PushSubscription(id={self.id}, user_id={self.user_id})>"
