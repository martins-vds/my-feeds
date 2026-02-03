"""User domain entity."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4


@dataclass
class User:
    """User domain entity representing an authenticated user.

    This is the domain model, independent of persistence concerns.
    """

    id: UUID = field(default_factory=uuid4)
    provider: Literal["github", "google", "microsoft"] = "github"
    provider_id: str = ""
    email: str = ""
    name: str | None = None
    avatar_url: str | None = None
    timezone: str = "UTC"
    notifications_enabled: bool = False
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    def enable_notifications(self) -> None:
        """Enable daily notifications for this user."""
        self.notifications_enabled = True
        self.updated_at = datetime.utcnow()

    def disable_notifications(self) -> None:
        """Disable daily notifications for this user."""
        self.notifications_enabled = False
        self.updated_at = datetime.utcnow()

    def update_timezone(self, timezone: str) -> None:
        """Update user's timezone.

        Args:
            timezone: IANA timezone identifier (e.g., 'America/New_York')
        """
        self.timezone = timezone
        self.updated_at = datetime.utcnow()

    def update_profile(self, name: str | None = None, avatar_url: str | None = None) -> None:
        """Update user profile from OAuth data.

        Args:
            name: Display name
            avatar_url: Profile picture URL
        """
        if name is not None:
            self.name = name
        if avatar_url is not None:
            self.avatar_url = avatar_url
        self.updated_at = datetime.utcnow()

    @classmethod
    def from_oauth(
        cls,
        provider: Literal["github", "google", "microsoft"],
        provider_id: str,
        email: str,
        name: str | None = None,
        avatar_url: str | None = None,
    ) -> "User":
        """Create a new user from OAuth data.

        Args:
            provider: OAuth provider name
            provider_id: User ID from the OAuth provider
            email: User's email address
            name: Display name
            avatar_url: Profile picture URL

        Returns:
            New User instance
        """
        return cls(
            provider=provider,
            provider_id=provider_id,
            email=email,
            name=name,
            avatar_url=avatar_url,
        )
