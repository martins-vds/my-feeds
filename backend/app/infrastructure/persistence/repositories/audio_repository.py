"""SQLAlchemy implementation of AudioRepository."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.audio.entities.audio import Audio
from app.domain.audio.repositories.audio_repository import AudioRepository
from app.infrastructure.persistence.models.audio import AudioModel


class SQLAlchemyAudioRepository(AudioRepository):
    """SQLAlchemy implementation of audio repository."""

    def __init__(self, session: AsyncSession):
        """Initialize repository with database session.
        
        Args:
            session: SQLAlchemy async session
        """
        self._session = session

    def _to_entity(self, model: AudioModel) -> Audio:
        """Convert SQLAlchemy model to domain entity.
        
        Args:
            model: AudioModel instance
            
        Returns:
            Audio domain entity
        """
        return Audio(
            id=model.id,
            post_id=model.post_id,
            cache_key=model.cache_key,
            file_path=model.file_path,
            format="mp3",  # Default format
            voice_id="en-US-JennyNeural",  # Default voice
            duration_seconds=model.duration_seconds,
            file_size_bytes=model.file_size_bytes,
            created_at=model.created_at,
            last_accessed_at=model.last_accessed_at,
            access_count=0,  # Not tracked in model currently
        )

    def _to_model(self, entity: Audio) -> AudioModel:
        """Convert domain entity to SQLAlchemy model.
        
        Args:
            entity: Audio domain entity
            
        Returns:
            AudioModel instance
        """
        return AudioModel(
            id=entity.id,
            post_id=entity.post_id,
            cache_key=entity.cache_key,
            file_path=entity.file_path,
            duration_seconds=int(entity.duration_seconds) if entity.duration_seconds else None,
            file_size_bytes=entity.file_size_bytes,
            created_at=entity.created_at,
            last_accessed_at=entity.last_accessed_at,
        )

    async def get_by_id(self, audio_id: UUID) -> Optional[Audio]:
        """Get audio by ID."""
        stmt = select(AudioModel).where(AudioModel.id == audio_id)
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def get_by_post_id(self, post_id: UUID) -> Optional[Audio]:
        """Get audio by post ID."""
        stmt = select(AudioModel).where(AudioModel.post_id == post_id)
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def get_by_cache_key(self, cache_key: str) -> Optional[Audio]:
        """Get audio by cache key."""
        stmt = select(AudioModel).where(AudioModel.cache_key == cache_key)
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        return self._to_entity(model) if model else None

    async def create(self, audio: Audio) -> Audio:
        """Create a new audio record."""
        model = self._to_model(audio)
        self._session.add(model)
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def update(self, audio: Audio) -> Audio:
        """Update an existing audio record."""
        stmt = select(AudioModel).where(AudioModel.id == audio.id)
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        
        if not model:
            raise ValueError(f"Audio {audio.id} not found")
        
        model.cache_key = audio.cache_key
        model.file_path = audio.file_path
        model.duration_seconds = int(audio.duration_seconds) if audio.duration_seconds else None
        model.file_size_bytes = audio.file_size_bytes
        model.last_accessed_at = audio.last_accessed_at
        
        await self._session.flush()
        await self._session.refresh(model)
        return self._to_entity(model)

    async def delete(self, audio_id: UUID) -> bool:
        """Delete an audio record."""
        stmt = select(AudioModel).where(AudioModel.id == audio_id)
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        
        if not model:
            return False
        
        await self._session.delete(model)
        await self._session.flush()
        return True

    async def delete_by_post_id(self, post_id: UUID) -> bool:
        """Delete audio for a post."""
        stmt = select(AudioModel).where(AudioModel.post_id == post_id)
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        
        if not model:
            return False
        
        await self._session.delete(model)
        await self._session.flush()
        return True

    async def record_access(self, audio_id: UUID) -> None:
        """Record an access to audio file."""
        stmt = select(AudioModel).where(AudioModel.id == audio_id)
        result = await self._session.execute(stmt)
        model = result.scalar_one_or_none()
        
        if model:
            model.last_accessed_at = datetime.utcnow()
            await self._session.flush()
