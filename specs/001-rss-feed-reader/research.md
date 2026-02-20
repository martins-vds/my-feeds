# Research: RSS Feed Reader Core

**Feature Branch**: `001-rss-feed-reader`  
**Date**: 2026-02-13  
**Purpose**: Resolve NEEDS CLARIFICATION items and establish best practices

## Table of Contents

1. [Dependency Injection with Abstract Base Classes](#1-dependency-injection-with-abstract-base-classes)
2. [OAuth2 Authentication](#2-oauth2-authentication)
3. [Text-to-Speech Implementation](#3-text-to-speech-implementation)
4. ~~[PWA Push Notifications](#4-pwa-push-notifications)~~ - OUT OF SCOPE

---

## 1. Dependency Injection with Abstract Base Classes

### Decision: Use Python's built-in `abc` module for DI via inheritance

**Rationale**: ABC-based DI provides loose coupling without external dependencies. ABCs are built into Python, require no additional libraries, and integrate naturally with type checkers and IDE tooling. The constitution mandates this approach as of v1.2.0.

**Alternatives Considered**:
- quart-injector: Rejected - library no longer viable per constitution v1.2.0
- Manual DI without ABCs: Rejected - loses type safety and clear contracts
- python-inject: Rejected - external dependency not needed
- FastAPI Depends: Rejected - wrong framework

### Key Implementation Patterns

**Abstract Base Class Definition (Domain Layer)**:
```python
from abc import ABC, abstractmethod
from typing import Optional

class FeedRepository(ABC):
    """Abstract base class for feed persistence operations."""
    
    @abstractmethod
    async def get_by_id(self, feed_id: str) -> Optional[Feed]:
        """Retrieve a feed by its ID."""
        ...
    
    @abstractmethod
    async def get_by_user(self, user_id: str) -> list[Feed]:
        """Retrieve all feeds for a user."""
        ...
    
    @abstractmethod
    async def save(self, feed: Feed) -> Feed:
        """Persist a feed entity."""
        ...
    
    @abstractmethod
    async def delete(self, feed_id: str) -> bool:
        """Delete a feed by ID."""
        ...
```

**Concrete Implementation (Infrastructure Layer)**:
```python
from sqlalchemy.ext.asyncio import AsyncSession
from app.domain.feed_management.repositories import FeedRepository
from app.domain.feed_management.entities import Feed

class SQLFeedRepository(FeedRepository):
    """SQLAlchemy implementation of FeedRepository."""
    
    def __init__(self, session: AsyncSession):
        self._session = session
    
    async def get_by_id(self, feed_id: str) -> Optional[Feed]:
        result = await self._session.get(FeedModel, feed_id)
        return result.to_entity() if result else None
    
    async def get_by_user(self, user_id: str) -> list[Feed]:
        stmt = select(FeedModel).where(FeedModel.user_id == user_id)
        result = await self._session.scalars(stmt)
        return [r.to_entity() for r in result]
    
    async def save(self, feed: Feed) -> Feed:
        model = FeedModel.from_entity(feed)
        self._session.add(model)
        await self._session.flush()
        return model.to_entity()
    
    async def delete(self, feed_id: str) -> bool:
        stmt = delete(FeedModel).where(FeedModel.id == feed_id)
        result = await self._session.execute(stmt)
        return result.rowcount > 0
```

**Service with Injected Dependencies**:
```python
from app.domain.feed_management.repositories import FeedRepository
from app.domain.feed_management.entities import Feed

class FeedService:
    """Application service for feed operations."""
    
    def __init__(self, repository: FeedRepository):  # Depends on ABC
        self._repository = repository
    
    async def get_feeds_for_user(self, user_id: str) -> list[Feed]:
        return await self._repository.get_by_user(user_id)
    
    async def add_feed(self, user_id: str, url: str, category_id: str) -> Feed:
        feed = Feed.create(user_id=user_id, url=url, category_id=category_id)
        return await self._repository.save(feed)
```

**Composition Root (container.py)**:
```python
from sqlalchemy.ext.asyncio import AsyncSession
from app.domain.feed_management.repositories import FeedRepository
from app.infrastructure.persistence.repositories import SQLFeedRepository
from app.application.services import FeedService

class Container:
    """DI composition root - wires ABCs to concrete implementations."""
    
    def __init__(self, session: AsyncSession):
        self._session = session
    
    def feed_repository(self) -> FeedRepository:
        return SQLFeedRepository(self._session)
    
    def feed_service(self) -> FeedService:
        return FeedService(self.feed_repository())
```

**Route Integration**:
```python
from quart import Blueprint, g
from app.config.container import Container

feeds_bp = Blueprint('feeds', __name__)

def get_container() -> Container:
    return Container(g.db_session)

@feeds_bp.route("/feeds")
async def list_feeds():
    service = get_container().feed_service()
    feeds = await service.get_feeds_for_user(g.current_user.id)
    return [f.to_dict() for f in feeds]
```

**Testing Pattern (Mock via ABC)**:
```python
import pytest
from unittest.mock import AsyncMock
from app.domain.feed_management.repositories import FeedRepository
from app.application.services import FeedService
from app.domain.feed_management.entities import Feed

@pytest.fixture
def mock_repository():
    repo = AsyncMock(spec=FeedRepository)
    return repo

@pytest.fixture
def feed_service(mock_repository):
    return FeedService(mock_repository)

async def test_get_feeds_for_user(feed_service, mock_repository):
    # Arrange
    expected_feeds = [Feed.create(user_id="u1", url="https://example.com/feed", category_id="c1")]
    mock_repository.get_by_user.return_value = expected_feeds
    
    # Act
    result = await feed_service.get_feeds_for_user("u1")
    
    # Assert
    assert result == expected_feeds
    mock_repository.get_by_user.assert_called_once_with("u1")
```

**Scope Strategy for DDD**:
| Layer                       | Lifecycle      | Rationale                           |
| --------------------------- | -------------- | ----------------------------------- |
| Infrastructure (DB session) | Request-scoped | Managed by middleware               |
| Repositories                | Per-request    | Stateless, receive session          |
| Application Services        | Per-request    | Stateless, orchestrate domain logic |
| Domain Services             | Per-request    | Pure business logic                 |

---

## 2. OAuth2 Authentication

### Decision: Authlib with BFF (Backend-For-Frontend) Pattern

**Rationale**: Authlib supports async ASGI applications via `starlette_client`. BFF pattern keeps OAuth tokens server-side, maximizing security for a PWA.

**Alternatives Considered**:
- python-social-auth: Rejected - sync-focused, Flask/Django oriented
- Browser-only OAuth: Rejected - insecure for SPAs per IETF best practices
- JWT tokens to frontend: Rejected - XSS vulnerable, tokens should stay server-side

### Provider Configuration

| Provider  | Authorize URL                                            | Token URL                             | Scopes                           |
| --------- | -------------------------------------------------------- | ------------------------------------- | -------------------------------- |
| GitHub    | `github.com/login/oauth/authorize`                       | `github.com/login/oauth/access_token` | `user:email read:user`           |
| Google    | OIDC discovery                                           | OIDC discovery                        | `openid email profile`           |
| Microsoft | `login.microsoftonline.com/common/oauth2/v2.0/authorize` | `.../token`                           | `openid email profile User.Read` |

### Session Management

**Decision**: Server-side sessions with HttpOnly cookies

```python
# Session configuration
app.config.update(
    SESSION_COOKIE_SECURE=True,
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax',
    PERMANENT_SESSION_LIFETIME=3600,  # 1 hour
)
```

### Security Checklist

- [x] PKCE enabled (`code_challenge_method: 'S256'`)
- [x] State parameter for CSRF protection
- [x] HttpOnly cookies (XSS protection)
- [x] SameSite=Lax (CSRF protection)
- [x] Tokens never exposed to frontend
- [x] Refresh token rotation when available

### Frontend Flow

1. React calls `GET /api/auth/login/{provider}`
2. Quart redirects to OAuth provider
3. Provider redirects to `GET /api/auth/{provider}/callback`
4. Quart exchanges code for tokens, stores server-side, sets session cookie
5. Quart redirects to React app
6. React calls `GET /api/auth/me` to get user info

---

## 3. Text-to-Speech Implementation

### Decision: Azure Cognitive Services Speech

**Rationale**: Azure offers 0.5M chars/month free tier with high-quality neural voices. This aligns with the constitution's requirement to minimize costs. Selected per spec clarification session 2026-02-13.

**Alternatives Considered**:
- Google Cloud TTS: Similar pricing, Azure has better free tier
- AWS Polly: Similar pricing, slightly worse free tier
- ElevenLabs: Too expensive for RSS content ($0.30/1K chars)
- Piper (self-hosted): Good CPU-friendly option for future scale, but Azure sufficient for MVP

### Provider Comparison

| Provider             | Free Tier                 | Neural Pricing   | Quality        |
| -------------------- | ------------------------- | ---------------- | -------------- |
| **Azure** (selected) | 0.5M chars/month          | $16/1M chars     | Excellent      |
| Google               | 1M chars (first 3 months) | $16/1M chars     | Excellent      |
| AWS Polly            | 5M chars (12 months)      | $16/1M chars     | Good           |
| Piper (self-hosted)  | Unlimited                 | Server cost only | Good-Excellent |

### Azure SDK Implementation

**Package**: `azure-cognitiveservices-speech` (Python SDK)

**Installation**:
```bash
uv add azure-cognitiveservices-speech
```

**Configuration** (environment variables):
```bash
AZURE_SPEECH_KEY=your_subscription_key
AZURE_SPEECH_REGION=eastus  # or other region
```

**Implementation Pattern**:
```python
import azure.cognitiveservices.speech as speechsdk
from pathlib import Path

class AzureTTSService(TTSService):
    """Azure Cognitive Services TTS implementation."""
    
    def __init__(self, speech_key: str, speech_region: str):
        self._config = speechsdk.SpeechConfig(
            subscription=speech_key,
            region=speech_region
        )
        # Neural voice for natural speech
        self._config.speech_synthesis_voice_name = "en-US-JennyNeural"
        # MP3 output at 64kbps
        self._config.set_speech_synthesis_output_format(
            speechsdk.SpeechSynthesisOutputFormat.Audio16Khz64KBitRateMonoMp3
        )
    
    async def synthesize(self, text: str, output_path: Path) -> None:
        """Generate audio file from text."""
        audio_config = speechsdk.audio.AudioOutputConfig(filename=str(output_path))
        synthesizer = speechsdk.SpeechSynthesizer(
            speech_config=self._config,
            audio_config=audio_config
        )
        
        # Run synthesis (blocking - wrap in asyncio.to_thread for async)
        result = synthesizer.speak_text_async(text).get()
        
        if result.reason == speechsdk.ResultReason.Canceled:
            cancellation = result.cancellation_details
            raise TTSError(f"Speech synthesis canceled: {cancellation.reason}")
```

**Voice Options** (neural voices):
| Voice               | Style          | Use Case               |
| ------------------- | -------------- | ---------------------- |
| `en-US-JennyNeural` | Conversational | Default for articles   |
| `en-US-GuyNeural`   | News           | Alternative male voice |
| `en-GB-SoniaNeural` | British        | UK content             |

**Rate Limiting**:
- Free tier: 20 concurrent requests
- Standard tier: 200 concurrent requests
- Implement queue with max 10 concurrent requests for safety margin

### Audio Format

**Decision**: MP3 at 64kbps

**Rationale**: Speech content doesn't require high bitrate. 64kbps provides clear audio at ~0.5MB/minute. Universal browser support.

### Storage Architecture

**Decision**: Server-side filesystem with SQLite metadata (MVP), migrate to S3 + PostgreSQL (production)

```
backend/
├── audio_cache/
│   ├── metadata.db          # SQLite: cache_key, source_id, file_path, created_at
│   ├── 00/                  # Prefix directories (256 total)
│   │   ├── 00a1b2c3....mp3
│   │   └── 00d4e5f6....mp3
│   └── ff/
```

### Cache Key Strategy

```python
cache_key = sha256(f"{text}:{voice_id}:{format}:{cache_version}")
```

### Streaming

**Decision**: HTTP Range Requests

**Rationale**: Enables seeking, partial downloads, and works with browser `<audio>` element natively.

### Cache Invalidation

| Trigger                      | Action                                           |
| ---------------------------- | ------------------------------------------------ |
| Source content changes       | Regenerate (content hash mismatch)               |
| Voice/quality config changes | Bump `cache_version`, regenerate on next request |
| 90-day retention exceeded    | Cascade delete audio with post                   |
| Post deleted                 | Cascade delete audio                             |

---

## 4. PWA Push Notifications

**Status**: OUT OF SCOPE - Removed per spec clarification session 2026-02-13

Daily notification feature was removed from scope. Push notification infrastructure is not required for this feature.

---

## Summary: Technology Decisions

| Area                     | Decision                          | Rationale                                     |
| ------------------------ | --------------------------------- | --------------------------------------------- |
| **Dependency Injection** | ABC + Inheritance (no library)    | Built-in Python, type-safe, IDE integration   |
| **OAuth2**               | Authlib + BFF pattern             | Security, tokens stay server-side             |
| **Session**              | Server-side with HttpOnly cookies | XSS/CSRF protection                           |
| **TTS Provider**         | Azure Cognitive Services          | Free tier, neural quality                     |
| **Audio Format**         | MP3 @ 64kbps                      | Universal support, sufficient for speech      |
| **Audio Storage**        | Filesystem + SQLite metadata      | Simple MVP, migrate to S3 later               |
| **Audio Streaming**      | HTTP Range Requests               | Seeking support, native browser compatibility |
| ~~Push Notifications~~   | ~~N/A~~                           | OUT OF SCOPE                                  |

All decisions align with Constitution v1.2.0 principles (DDD, ABC-based DI, TDD, Modern Toolchain, PWA-First, Lazy Generation).
