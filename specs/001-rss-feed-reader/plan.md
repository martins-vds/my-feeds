# Implementation Plan: RSS Feed Reader Core

**Branch**: `001-rss-feed-reader` | **Date**: 2026-02-13 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-rss-feed-reader/spec.md`

## Summary

Build an RSS feed reader PWA with OAuth authentication (GitHub, Google, Microsoft), category-based feed organization, unified post browsing, and text-to-speech audio generation via Azure Cognitive Services. The application uses a Quart backend with DDD architecture and ABC-based dependency injection, React frontend with Material UI, PostgreSQL for persistence, and delivers as an installable PWA with offline capability.

## Technical Context

**Language/Version**: Python 3.12+ (backend), TypeScript 5.x (frontend)  
**Primary Dependencies**: Quart, SQLAlchemy, asyncpg, feedparser, azure-cognitiveservices-speech (backend); React 18, Material UI 5, Vite 5 (frontend)  
**Storage**: PostgreSQL (primary data store), file system (audio cache)  
**Testing**: pytest + pytest-asyncio (backend); Playwright (E2E), Vitest (frontend unit)  
**Target Platform**: Web (PWA), Linux server deployment  
**Project Type**: Web application (frontend + backend monorepo)  
**Performance Goals**: <2s latest posts load, <5s TTS first play, <1s cached audio  
**Constraints**: 100 feeds max per user, 25 categories max, 90-day post/audio retention, offline-capable  
**Scale/Scope**: Personal use, single-user to small teams

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle                                     | Status | Evidence                                                                                                              |
| --------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------- |
| I. Domain-Driven Design (NON-NEGOTIABLE)      | ✅      | DDD layers: domain/ (entities, repositories ABCs), application/ (services), infrastructure/ (persistence, TTS, OAuth) |
| II. Dependency Injection via ABCs             | ✅      | All services depend on abstract base classes; concrete implementations injected at composition root                   |
| III. Test-Driven Development (NON-NEGOTIABLE) | ✅      | pytest + pytest-asyncio (backend), Playwright + Vitest (frontend), contract tests for all endpoints                   |
| IV. Modern Toolchain                          | ✅      | uv (backend), pnpm (frontend), Dev Containers                                                                         |
| V. PWA-First Mobile Strategy                  | ✅      | Vite PWA plugin, service worker, installable, offline-capable (notifications removed from scope)                      |
| VI. Lazy Resource Generation                  | ✅      | TTS audio generated on first listen via Azure Cognitive Services, cached 90 days                                      |

**Pre-Phase 0 Gate**: ✅ PASS - All principles satisfied

**Post-Phase 1 Re-check**: ✅ PASS - Design artifacts align with constitution v1.2.0
- research.md: ABC-based DI documented with patterns
- data-model.md: Entities defined, PushSubscription removed (out of scope)
- contracts/openapi.yaml: REST API defined, notification endpoints removed
- quickstart.md: Developer guide updated for ABC-based DI

## Project Structure

### Documentation (this feature)

```text
specs/001-rss-feed-reader/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── openapi.yaml
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── api/
│   │   ├── middleware/
│   │   │   └── error_handler.py
│   │   └── routes/
│   │       └── auth.py
│   ├── application/
│   │   └── services/           # Application-layer services
│   ├── config/
│   │   ├── container.py        # DI composition root (ABC wiring)
│   │   ├── logging.py
│   │   ├── settings.py
│   │   └── modules/
│   ├── domain/
│   │   ├── audio/
│   │   │   ├── entities/
│   │   │   ├── repositories/   # ABC definitions
│   │   │   └── services/
│   │   ├── feed_management/
│   │   │   ├── entities/
│   │   │   │   └── user.py
│   │   │   ├── repositories/
│   │   │   │   └── user_repository.py  # ABC
│   │   │   └── services/
│   │   ├── notifications/      # (empty - feature removed)
│   │   └── shared/
│   │       └── repository.py   # Base ABC
│   └── infrastructure/
│       ├── feed_fetcher/
│       ├── notifications/      # (empty - feature removed)
│       ├── oauth/
│       │   ├── oauth_service.py
│       │   ├── providers.py
│       │   └── session.py
│       ├── persistence/
│       │   ├── database.py
│       │   ├── models/
│       │   └── repositories/   # Concrete implementations
│       └── tts/
├── migrations/
├── tests/
│   ├── contract/
│   ├── integration/
│   └── unit/
└── pyproject.toml

frontend/
├── src/
│   ├── components/
│   │   ├── Header.tsx
│   │   └── ProtectedRoute.tsx
│   ├── contexts/
│   │   └── AuthContext.tsx
│   ├── hooks/
│   │   └── useAuth.ts
│   ├── pages/
│   │   ├── auth/
│   │   ├── feeds/
│   │   ├── posts/
│   │   └── settings/
│   ├── services/
│   │   └── api.ts
│   └── types/
├── playwright/
│   └── auth.spec.ts
├── package.json
└── vite.config.ts
```

**Structure Decision**: Web application structure (Option 2) - monorepo with separate backend/ and frontend/ directories as required by constitution.

## Complexity Tracking

> No constitution violations requiring justification.

All design decisions align with constitution principles. No complexity exceptions needed.
