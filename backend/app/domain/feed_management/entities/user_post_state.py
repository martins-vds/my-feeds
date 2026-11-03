"""UserPostState value object: a user's read state and reading progress for one post."""

from dataclasses import dataclass
from datetime import datetime

# A reading position at or beyond this fraction counts as having read the post.
READ_COMPLETION_THRESHOLD = 0.95


@dataclass(frozen=True)
class UserPostState:
    """A user's relationship to a single post.

    Attributes:
        is_read: Whether the post counts as read (finished, or marked read by hand)
        read_at: When the post first became read
        read_progress: Furthest reading position reached, from 0.0 to 1.0
        opened_at: When the user first opened the post, if they ever did
    """

    is_read: bool = False
    read_at: datetime | None = None
    read_progress: float = 0.0
    opened_at: datetime | None = None

    @property
    def is_seen(self) -> bool:
        """Whether the user has opened the post."""
        return self.opened_at is not None
