# Implementation Plan: RSS Feed Reader Core

**Branch**: `001-rss-feed-reader` | **Date**: 2026-02-03 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-rss-feed-reader/spec.md`

## Summary

Build an RSS feed reader PWA with OAuth authentication (GitHub/Google/Microsoft), category-based feed organization, unified post viewing with read state tracking, lazy text-to-speech audio generation with server-side caching, and daily push notifications at 8:00 AM user local time. Frontend is React + Material UI + Vite; backend is Python + Quart with DDD architecture and PostgreSQL persistence.

## Technical Context

**Language/Version**: Python 3.12+ (backend), TypeScript 5.x (frontend)  
**Primary Dependencies**: Quart, quart-injector, SQLAlchemy, asyncpg, feedparser (backend); React 18, Material UI 5, Vite 5 (frontend)  
**Storage**: PostgreSQL (primary), server-side file storage (TTS audio cache)  
**Testing**: pytest + pytest-asyncio (backend), Playwright (frontend UI), Vitest (frontend unit)  
**Target Platform**: PWA (modern browsers, Android via PWA installation)  
**Project Type**: Web application (frontend + backend monorepo)  
**Performance Goals**: <2s page load, <5s first TTS playback, <1s cached audio playback  
**Constraints**: Offline-capable (cached content), 90-day post retention, Lighthouse PWA 90+  
**Scale/Scope**: 50+ feeds, 10+ categories per user; multi-year project scope

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle                    | Compliant | Notes                                                              |
| ---------------------------- | --------- | ------------------------------------------------------------------ |
| I. Domain-Driven Design      | ✅         | Bounded contexts: Feed Management, Notifications, Audio Generation |
| II. Dependency Injection     | ✅         | quart-injector for all services (TTS, feed fetcher, repositories)  |
| III. Test-Driven Development | ✅         | TDD with Red-Green-Refactor; pytest, Vitest, Playwright            |
| IV. Modern Toolchain         | ✅         | pnpm (frontend), uv (backend), Dev Containers                      |
| V. PWA-First Mobile Strategy | ✅         | React + Vite PWA plugin; single codebase for desktop/mobile        |
| VI. Lazy Resource Generation | ✅         | TTS on first listen, cached server-side                            |

**Gate Status**: ✅ PASSED - All principles satisfied

### Post-Design Re-evaluation (2026-02-03)

| Principle     | Still Compliant | Verification                                                                                |
| ------------- | --------------- | ------------------------------------------------------------------------------------------- |
| I. DDD        | ✅               | data-model.md defines entities per bounded context; research.md confirms DDD scope strategy |
| II. DI        | ✅               | research.md documents quart-injector Module pattern with singleton/transient scopes         |
| III. TDD      | ✅               | Red-Green-Refactor enforced; pytest, Vitest, Playwright; OpenAPI enables contract testing   |
| IV. Toolchain | ✅               | quickstart.md confirms uv, pnpm, Dev Containers setup                                       |
| V. PWA        | ✅               | research.md documents vite-plugin-pwa with injectManifest for push notifications            |
| VI. Lazy Gen  | ✅               | OpenAPI shows GET /posts/{id}/audio returns 202 for generation-in-progress                  |

**Post-Design Gate Status**: ✅ PASSED - All principles verified in design artifacts

## Project Structure

### Documentation (this feature)

```text
specs/001-rss-feed-reader/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (OpenAPI specs)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── domain/                    # DDD Domain layer
│   │   ├── feed_management/       # Bounded context: feeds, categories
│   │   ├── notifications/         # Bounded context: daily notifications
│   │   └── audio/                 # Bounded context: TTS generation
│   ├── application/               # Application services
│   ├── infrastructure/            # Repositories, external services
│   │   ├── persistence/           # SQLAlchemy models, repositories
│   │   ├── feed_fetcher/          # feedparser integration
│   │   ├── tts/                   # Text-to-speech provider
│   │   └── oauth/                 # OAuth2 providers
│   ├── api/                       # Quart routes
│   └── config/                    # DI container, settings
├── tests/
│   ├── unit/
│   ├── integration/
│   └── contract/
├── migrations/                    # Alembic migrations
├── audio_cache/                   # Server-side TTS audio storage
└── pyproject.toml

frontend/
├── src/
│   ├── components/                # Reusable UI components
│   ├── pages/                     # Route-level components
│   │   ├── auth/                  # Sign-in page
│   │   ├── feeds/                 # Feed management
│   │   ├── posts/                 # Post list and detail
│   │   └── settings/              # Notification preferences
│   ├── services/                  # API client, audio player
│   ├── hooks/                     # Custom React hooks
│   └── types/                     # TypeScript interfaces
├── public/                        # Static assets, manifest
├── playwright/                    # UI tests
├── vite.config.ts
└── package.json

.devcontainer/
├── devcontainer.json
├── docker-compose.yml
└── Dockerfile
```

**Structure Decision**: Web application (Option 2) with backend serving frontend in production. DDD layers within backend/app/ to satisfy Constitution Principle I.

## Complexity Tracking

> No violations to justify - all Constitution principles satisfied.

