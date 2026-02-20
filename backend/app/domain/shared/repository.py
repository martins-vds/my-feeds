"""Base repository interface for DDD pattern."""

from abc import ABC, abstractmethod
from typing import Generic, TypeVar
from uuid import UUID

# Type variable for entity types
T = TypeVar("T")


class Repository(ABC, Generic[T]):
    """Abstract base repository interface.

    All repository interfaces should inherit from this base class.
    Implementations live in infrastructure/persistence/repositories/.
    """

    @abstractmethod
    async def get_by_id(self, id: UUID) -> T | None:
        """Retrieve an entity by its unique identifier.

        Args:
            id: The UUID of the entity.

        Returns:
            The entity if found, None otherwise.
        """
        ...

    @abstractmethod
    async def save(self, entity: T) -> T:
        """Persist an entity to storage.

        Args:
            entity: The entity to save.

        Returns:
            The saved entity (may have updated fields like timestamps).
        """
        ...

    @abstractmethod
    async def delete(self, id: UUID) -> bool:
        """Remove an entity from storage.

        Args:
            id: The UUID of the entity to delete.

        Returns:
            True if deleted, False if not found.
        """
        ...


class ReadOnlyRepository(ABC, Generic[T]):
    """Read-only repository interface.

    For repositories that only need read access (e.g., reporting, queries).
    """

    @abstractmethod
    async def get_by_id(self, id: UUID) -> T | None:
        """Retrieve an entity by its unique identifier.

        Args:
            id: The UUID of the entity.

        Returns:
            The entity if found, None otherwise.
        """
        ...
