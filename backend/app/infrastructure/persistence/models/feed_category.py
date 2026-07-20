"""Association table for the many-to-many Feed <-> Category relationship.

A feed can carry zero or many categories, and a category can be applied to zero
or many feeds. Categories are labels and do NOT own feeds: deleting a category
only removes its association rows (via the ``category_id`` FK cascade), leaving
the feeds themselves intact. Deleting a feed likewise removes its association
rows via the ``feed_id`` FK cascade.
"""

from sqlalchemy import Column, ForeignKey, Table
from sqlalchemy.dialects.postgresql import UUID

from app.infrastructure.persistence.database import Base

feed_categories = Table(
    "feed_categories",
    Base.metadata,
    Column(
        "feed_id",
        UUID(as_uuid=True),
        ForeignKey("feeds.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "category_id",
        UUID(as_uuid=True),
        ForeignKey("categories.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    comment="Many-to-many link between feeds and categories",
)
