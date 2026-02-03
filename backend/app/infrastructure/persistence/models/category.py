"""Category SQLAlchemy model."""

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.persistence.database import Base

if TYPE_CHECKING:
    from app.infrastructure.persistence.models.feed import FeedModel
    from app.infrastructure.persistence.models.user import UserModel


class CategoryModel(Base):
    """SQLAlchemy model for Category entity.

    Represents a named grouping for organizing feeds.
    """

    __tablename__ = "categories"

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
    name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        comment="Category display name",
    )
    position: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        comment="Sort order within user's categories",
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
    user: Mapped["UserModel"] = relationship(
        "UserModel",
        back_populates="categories",
    )
    feeds: Mapped[list["FeedModel"]] = relationship(
        "FeedModel",
        back_populates="category",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # Category name must be unique per user
        UniqueConstraint("user_id", "name", name="uq_category_user_name"),
        {"comment": "Named groupings for organizing feeds"},
    )

    def __repr__(self) -> str:
        return f"<Category(id={self.id}, name={self.name})>"
