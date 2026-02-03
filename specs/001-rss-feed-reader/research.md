# Research: RSS Feed Reader Core

**Feature Branch**: `001-rss-feed-reader`  
**Date**: 2026-02-03  
**Purpose**: Resolve NEEDS CLARIFICATION items and establish best practices

## Table of Contents

1. [Dependency Injection with quart-injector](#1-dependency-injection-with-quart-injector)
2. [OAuth2 Authentication](#2-oauth2-authentication)
3. [Text-to-Speech Implementation](#3-text-to-speech-implementation)
4. [PWA Push Notifications](#4-pwa-push-notifications)

---

## 1. Dependency Injection with quart-injector

### Decision: Use quart-injector with Module classes

**Rationale**: quart-injector integrates seamlessly with Quart's async-first approach. Module classes provide clear organization for DDD bounded contexts.

**Alternatives Considered**:
- Manual DI: Rejected - too verbose, no scope management
- FastAPI Depends: Rejected - wrong framework
- python-inject: Rejected - less async support than quart-injector

### Key Implementation Patterns

**Setup Pattern**:
```python
import quart_injector
from injector import Module, Binder, singleton

class InfrastructureModule(Module):
    def configure(self, binder: Binder) -> None:
        binder.bind(Database, to=AsyncDatabase, scope=singleton)

class RepositoryModule(Module):
    def configure(self, binder: Binder) -> None:
        binder.bind(FeedRepository, to=SQLFeedRepository)

quart_injector.wire(app, [InfrastructureModule(), RepositoryModule()])
```

**Scope Strategy for DDD**:
| Layer                             | Scope               | Rationale                               |
| --------------------------------- | ------------------- | --------------------------------------- |
| Infrastructure (DB, HTTP clients) | Singleton           | Connection pooling, expensive to create |
| Repositories                      | Transient (default) | Stateless, use singleton DB             |
| Application Services              | Transient           | Stateless, orchestrate domain logic     |
| Domain Services                   | Transient           | Pure business logic                     |

**Route Injection**:
```python
@app.route("/feeds")
async def list_feeds(service: Inject[FeedService]) -> Response:
    feeds = await service.get_all()
    return jsonify([f.to_dict() for f in feeds])
```

**Testing Pattern**:
```python
def create_test_app(mock_service: FeedService) -> Quart:
    app = create_app()
    def configure_test(binder: Binder) -> None:
        binder.bind(FeedService, to=mock_service)
    quart_injector.wire(app, configure_test)
    return app
```

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

### Decision: Azure Cognitive Services Speech (initial), migrate to Piper at scale

**Rationale**: Azure offers 0.5M chars/month free tier with high-quality neural voices. Piper provides a cost-effective self-hosted option when usage exceeds free tier.

**Alternatives Considered**:
- Google Cloud TTS: Similar pricing, Azure has better free tier
- AWS Polly: Similar pricing, slightly worse free tier
- ElevenLabs: Too expensive for RSS content ($0.30/1K chars)
- Coqui TTS: Good but requires GPU; Piper is more CPU-friendly

### Provider Comparison

| Provider                | Free Tier                 | Neural Pricing   | Quality        |
| ----------------------- | ------------------------- | ---------------- | -------------- |
| **Azure**               | 0.5M chars/month          | $16/1M chars     | Excellent      |
| Google                  | 1M chars (first 3 months) | $16/1M chars     | Excellent      |
| AWS Polly               | 5M chars (12 months)      | $16/1M chars     | Good           |
| **Piper** (self-hosted) | Unlimited                 | Server cost only | Good-Excellent |

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

| Trigger                         | Action                                           |
| ------------------------------- | ------------------------------------------------ |
| Source content changes          | Regenerate (content hash mismatch)               |
| Voice/quality config changes    | Bump `cache_version`, regenerate on next request |
| Storage limit exceeded          | LRU eviction (30-day access threshold)           |
| Post deleted (90-day retention) | Cascade delete audio                             |

---

## 4. PWA Push Notifications

### Decision: pywebpush + vite-plugin-pwa with injectManifest

**Rationale**: pywebpush is the standard Python library for Web Push. `injectManifest` strategy allows custom service worker logic for push handling.

**Alternatives Considered**:
- Custom service worker without Workbox: Rejected - lose caching benefits
- generateSW strategy: Rejected - less control over push event handling
- Firebase Cloud Messaging: Rejected - adds vendor dependency

### VAPID Keys

```bash
# Generate keys
openssl ecparam -genkey -name prime256v1 -out vapid_private.pem
openssl ec -in vapid_private.pem -pubout -out vapid_public.pem
```

### Subscription Management

**Database Schema**:
```sql
CREATE TABLE push_subscriptions (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    last_success_at TIMESTAMP,
    failure_count INTEGER DEFAULT 0
);
```

### Timezone-Aware Scheduling

**Decision**: Store user IANA timezone, convert 8:00 AM local to UTC for scheduling

```python
from zoneinfo import ZoneInfo
from datetime import datetime, time

def get_next_notification_time(user_timezone: str) -> datetime:
    tz = ZoneInfo(user_timezone)
    now = datetime.now(tz)
    target_time = time(8, 0)  # 8:00 AM local
    
    # Calculate next 8 AM in user's timezone
    if now.time() >= target_time:
        next_day = now.date() + timedelta(days=1)
    else:
        next_day = now.date()
    
    local_dt = datetime.combine(next_day, target_time, tzinfo=tz)
    return local_dt.astimezone(ZoneInfo('UTC'))
```

### Service Worker Events

```javascript
// Handle push event
self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? {};
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icons/icon-192.png',
            badge: '/icons/badge-72.png',
            tag: 'daily-digest',
            data: { url: data.url || '/posts' }
        })
    );
});

// Handle notification click - deep link
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((windowClients) => {
            // Focus existing window or open new
            for (const client of windowClients) {
                if (client.url === url && 'focus' in client) {
                    return client.focus();
                }
            }
            return clients.openWindow(url);
        })
    );
});
```

### Notification Payload

```json
{
    "title": "Your Daily Feed Digest",
    "body": "12 new posts from your subscriptions",
    "icon": "/icons/icon-192.png",
    "badge": "/icons/badge-72.png",
    "tag": "daily-digest",
    "data": {
        "url": "/posts?filter=unread",
        "postCount": 12
    }
}
```

### Browser Support

| Browser | Push Support              | Notes                        |
| ------- | ------------------------- | ---------------------------- |
| Chrome  | ✅ 42+                     | Full support                 |
| Firefox | ✅ 44+                     | Full support                 |
| Safari  | ✅ 16.4+ (iOS Home Screen) | Requires Web Push permission |
| Edge    | ✅ 17+                     | Full support                 |
| WebView | ❌                         | Use native app notifications |

---

## Summary: Technology Decisions

| Area                        | Decision                           | Rationale                                     |
| --------------------------- | ---------------------------------- | --------------------------------------------- |
| **Dependency Injection**    | quart-injector with Module classes | Async support, clean DDD organization         |
| **OAuth2**                  | Authlib + BFF pattern              | Security, tokens stay server-side             |
| **Session**                 | Server-side with HttpOnly cookies  | XSS/CSRF protection                           |
| **TTS Provider**            | Azure (MVP), Piper (scale)         | Free tier, quality, cost optimization         |
| **Audio Format**            | MP3 @ 64kbps                       | Universal support, sufficient for speech      |
| **Audio Storage**           | Filesystem + SQLite metadata       | Simple MVP, migrate to S3 later               |
| **Audio Streaming**         | HTTP Range Requests                | Seeking support, native browser compatibility |
| **Push Notifications**      | pywebpush + vite-plugin-pwa        | Standard, full control                        |
| **Notification Scheduling** | IANA timezone, APScheduler         | Accurate local time delivery                  |

All decisions align with Constitution principles (DDD, DI, Modern Toolchain, PWA-First, Lazy Generation).
