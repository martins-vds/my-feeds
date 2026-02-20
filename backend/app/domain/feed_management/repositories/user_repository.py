"""User repository interface."""

from abc import ABC, abstractmethod
from typing import Literal
from uuid import UUID

from app.domain.feed_management.entities.user import User


class UserRepository(ABC):
    """Abstract repository interface for User entities.

    Implementations handle persistence details (e.g., SQLAlchemy).
    """

    @abstractmethod
    async def get_by_id(self, id: UUID) -> User | None:
        """Get a user by their internal ID.

        Args:
            id: The user's UUID

        Returns:
            User if found, None otherwise
        """
        ...

    @abstractmethod
    async def get_by_provider(
        self,
        provider: Literal["github", "google", "microsoft"],
        provider_id: str,
    ) -> User | None:
        """Get a user by their OAuth provider and provider ID.

        Args:
            provider: OAuth provider name
            provider_id: User ID from the OAuth provider

        Returns:
            User if found, None otherwise
        """
        ...

    @abstractmethod
    async def get_by_email(self, email: str) -> User | None:
        """Get a user by their email address.

        Args:
            email: The user's email address

        Returns:
            User if found, None otherwise
        """
        ...

    @abstractmethod
    async def save(self, user: User) -> User:
        """Save a user (create or update).

        Args:
            user: The user to save

        Returns:
            The saved user with any updated fields
        """
        ...

    @abstractmethod
    async def delete(self, id: UUID) -> bool:
        """Delete a user by ID.

        Args:
            id: The user's UUID

        Returns:
            True if deleted, False if not found
        """
        ...
