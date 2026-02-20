"""Category domain entity."""

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID, uuid4


@dataclass
class Category:
    """Category domain entity for organizing feeds.

    This is the domain model, independent of persistence concerns.
    Represents a named grouping for RSS/Atom feed subscriptions.
    """

    id: UUID = field(default_factory=uuid4)
    user_id: UUID = field(default_factory=uuid4)
    name: str = ""
    position: int = 0
    created_at: datetime = field(default_factory=datetime.utcnow)
    updated_at: datetime = field(default_factory=datetime.utcnow)

    # Transient field - not persisted directly, computed from feeds
    feed_count: int = field(default=0, compare=False)

    # Domain validation constants
    MAX_NAME_LENGTH = 100
    MIN_NAME_LENGTH = 1

    def __post_init__(self) -> None:
        """Validate entity invariants after initialization."""
        self._validate_name()

    def _validate_name(self) -> None:
        """Ensure name meets validation rules."""
        if not self.name:
            raise ValueError("Category name is required")
        if len(self.name) > self.MAX_NAME_LENGTH:
            raise ValueError(f"Category name must not exceed {self.MAX_NAME_LENGTH} characters")
        if len(self.name) < self.MIN_NAME_LENGTH:
            raise ValueError(f"Category name must be at least {self.MIN_NAME_LENGTH} character")

    def rename(self, new_name: str) -> None:
        """Change the category name.

        Args:
            new_name: The new name for the category

        Raises:
            ValueError: If name is invalid
        """
        old_name = self.name
        self.name = new_name
        try:
            self._validate_name()
        except ValueError:
            self.name = old_name
            raise
        self.updated_at = datetime.utcnow()

    def reposition(self, new_position: int) -> None:
        """Change the category position for ordering.

        Args:
            new_position: New position index (0-based)

        Raises:
            ValueError: If position is negative
        """
        if new_position < 0:
            raise ValueError("Position must be non-negative")
        self.position = new_position
        self.updated_at = datetime.utcnow()

    @classmethod
    def create(
        cls,
        user_id: UUID,
        name: str,
        position: int = 0,
    ) -> "Category":
        """Factory method to create a new category.

        Args:
            user_id: Owner's user ID
            name: Category display name
            position: Sort order (default 0)

        Returns:
            New Category instance

        Raises:
            ValueError: If validation fails
        """
        return cls(
            user_id=user_id,
            name=name,
            position=position,
        )

    def to_dict(self) -> dict:
        """Convert to dictionary for API responses.

        Returns:
            Dictionary representation suitable for JSON serialization
        """
        return {
            "id": str(self.id),
            "name": self.name,
            "position": self.position,
            "feedCount": self.feed_count,
            "createdAt": self.created_at.isoformat() + "Z",
        }
