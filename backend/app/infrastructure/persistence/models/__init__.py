"""SQLAlchemy models package."""

# Import all models here for Alembic to detect them
from app.infrastructure.persistence.models.user import UserModel
from app.infrastructure.persistence.models.category import CategoryModel
from app.infrastructure.persistence.models.feed import FeedModel
from app.infrastructure.persistence.models.post import PostModel
from app.infrastructure.persistence.models.user_post import UserPostModel
from app.infrastructure.persistence.models.audio import AudioModel
from app.infrastructure.persistence.models.push_subscription import (
    PushSubscriptionModel,
)

__all__ = [
    "UserModel",
    "CategoryModel",
    "FeedModel",
    "PostModel",
    "UserPostModel",
    "AudioModel",
    "PushSubscriptionModel",
]
