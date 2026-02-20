# my-feeds Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-02-13

## Active Technologies
- Python 3.12+ (backend), TypeScript 5.x (frontend) + Quart, SQLAlchemy, asyncpg, feedparser, azure-cognitiveservices-speech (backend); React 18, Material UI 5, Vite 5 (frontend) (001-rss-feed-reader)
- PostgreSQL (primary data store), file system (audio cache) (001-rss-feed-reader)
- Dependency Injection via ABC + Inheritance (no external library) - Constitution v1.2.0
- Python 3.12+ (backend), TypeScript (frontend via React + Vite) + Quart (backend framework), React + Material UI (frontend), bcrypt (new — password hashing) (002-sign-up)
- PostgreSQL via SQLAlchemy + asyncpg (existing) (002-sign-up)

## Project Structure

```text
backend/
├── app/
│   ├── api/           # Quart routes
│   ├── application/   # Application services
│   ├── config/        # DI composition root, settings
│   ├── domain/        # DDD domain layer (ABCs, entities)
│   └── infrastructure/# Repositories, external services
├── tests/
└── migrations/

frontend/
├── src/
│   ├── components/
│   ├── pages/
│   └── services/
└── playwright/
```

## Commands

```bash
# Backend
cd backend && uv run pytest
cd backend && uv run ruff check .

# Frontend
cd frontend && pnpm test
cd frontend && pnpm lint
```

## Code Style

- Python: ruff format, mypy type checking
- TypeScript: ESLint, Prettier

## Recent Changes
- 002-sign-up: Added Python 3.12+ (backend), TypeScript (frontend via React + Vite) + Quart (backend framework), React + Material UI (frontend), bcrypt (new — password hashing)
- 001-rss-feed-reader: Constitution v1.2.0 - ABC-based DI replaces quart-injector
- 001-rss-feed-reader: Notifications feature removed from scope

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
