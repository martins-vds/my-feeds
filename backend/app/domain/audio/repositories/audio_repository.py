"""Audio repository abstract base class."""

from abc import ABC, abstractmethod
from typing import Optional
from uuid import UUID

from app.domain.audio.entities.audio import Audio


class AudioRepository(ABC):
    """Abstract repository for Audio persistence operations."""

    @abstractmethod
    async def get_by_id(self, audio_id: UUID) -> Optional[Audio]:
        """Get audio by ID.
        
        Args:
            audio_id: Audio UUID
            
        Returns:
            Audio if found, None otherwise
        """
        ...

    @abstractmethod
    async def get_by_post_id(self, post_id: UUID) -> Optional[Audio]:
        """Get audio by post ID.
        
        Args:
            post_id: Post UUID
            
        Returns:
            Audio if found, None otherwise
        """
        ...

    @abstractmethod
    async def get_by_cache_key(self, cache_key: str) -> Optional[Audio]:
        """Get audio by cache key.
        
        Args:
            cache_key: SHA256 cache key
            
        Returns:
            Audio if found, None otherwise
        """
        ...

    @abstractmethod
    async def create(self, audio: Audio) -> Audio:
        """Create a new audio record.
        
        Args:
            audio: Audio entity to create
            
        Returns:
            Created Audio with generated ID
        """
        ...

    @abstractmethod
    async def update(self, audio: Audio) -> Audio:
        """Update an existing audio record.
        
        Args:
            audio: Audio entity with updated fields
            
        Returns:
            Updated Audio
        """
        ...

    @abstractmethod
    async def delete(self, audio_id: UUID) -> bool:
        """Delete an audio record.
        
        Args:
            audio_id: Audio UUID to delete
            
        Returns:
            True if deleted, False if not found
        """
        ...

    @abstractmethod
    async def delete_by_post_id(self, post_id: UUID) -> bool:
        """Delete audio for a post.
        
        Args:
            post_id: Post UUID
            
        Returns:
            True if deleted, False if not found
        """
        ...

    @abstractmethod
    async def record_access(self, audio_id: UUID) -> None:
        """Record an access to audio file (updates last_accessed_at and access_count).
        
        Args:
            audio_id: Audio UUID
        """
        ...
