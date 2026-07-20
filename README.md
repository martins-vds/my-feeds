# my-feeds

RSS Feed Reader Progressive Web App with OAuth authentication, category-based feed organization, text-to-speech reading, and PWA offline support.

## Features

- **OAuth Authentication**: Sign in with GitHub, Google, or Microsoft
- **Category Organization**: Group feeds by topic or interest area
- **Unified Post View**: Browse latest posts across all subscribed feeds
- **Read State Tracking**: Auto-track and manually toggle read/unread status
- **Text-to-Speech**: Listen to posts with lazy-generated, cached audio
- **PWA Support**: Install on mobile, works offline

## Tech Stack

### Backend
- **Python 3.12+** with **Quart** async framework
- **SQLAlchemy** with **asyncpg** for PostgreSQL
- **ABC-based dependency injection** (no external DI library)
- **Authlib** for OAuth2 authentication
- **feedparser** for RSS/Atom parsing
- **Azure Cognitive Services** for TTS

### Frontend
- **React 18** with **TypeScript 5**
- **Vite 5** with PWA plugin
- **Material UI 5** component library
- **React Router 6** for navigation

### Development
- **Dev Containers** for consistent environment
- **pytest** + **pytest-asyncio** for backend testing
- **Vitest** for frontend unit tests
- **Playwright** for E2E testing

## Quick Start

The application runs entirely on Docker Compose — PostgreSQL, Alembic
migrations, the backend API, and the frontend all start together. A dev
container is available but optional; it only provides local tooling (linters,
language servers, test runners) and is not required to run the app.

### Prerequisites
- Docker Engine (or Docker Desktop) with the Compose plugin
- Git

### Run the stack

1. **Clone**:
   ```bash
   git clone <repository-url>
   cd my-feeds
   ```

2. **(Optional) Configure environment**:
   ```bash
   cp .env.example .env                   # compose ports / postgres credentials
   cp backend/.env.example backend/.env   # OAuth, Azure Speech, VAPID, SECRET_KEY
   ```
   Every compose variable has a sensible default, so this is only needed to
   supply real credentials or change ports.

3. **Start everything** (development — hot reload):
   ```bash
   docker compose up --build
   ```
   - Frontend (Vite): http://localhost:5173
   - Backend API (Quart): http://localhost:5000
   - PostgreSQL: localhost:5432

   Migrations run automatically via the one-shot `migrate` service before the
   backend starts. Stop with `Ctrl+C`, or `docker compose down` (add `-v` to
   also drop the database volume).

### Production-style run

`docker compose up` auto-applies `docker-compose.override.yml` (dev servers).
To run the production images instead — multi-stage builds, the frontend served
by nginx with an `/api` reverse proxy, and the backend served by hypercorn —
use only the base file:

```bash
docker compose -f docker-compose.yml up --build
```
The app is then served at http://localhost:8080.

### Dev container (optional)

Open the folder in VS Code and choose "Reopen in Container" for a preconfigured
toolchain (Python 3.12, Node 20, uv, pnpm, Playwright) with Docker available
inside. Run `docker compose up` from the integrated terminal exactly as above.

## Project Structure

```
my-feeds/
├── backend/
│   ├── app/
│   │   ├── domain/           # DDD domain layer
│   │   ├── application/      # Application services
│   │   ├── infrastructure/   # External integrations
│   │   ├── api/              # HTTP routes
│   │   └── config/           # DI container, settings
│   ├── tests/
│   └── migrations/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── hooks/
│   │   └── services/
│   └── playwright/
├── specs/                    # Feature specifications
└── .devcontainer/
```

## Testing

Run the full suite inside the compose services (the stack is started if needed):

```bash
./scripts/test.sh                      # backend (pytest) + frontend (vitest)
./scripts/test.sh tests/unit -k feed   # extra args are forwarded to pytest
```

Or target a single service directly:

```bash
docker compose exec backend pytest --cov=app
docker compose exec frontend pnpm test
docker compose exec frontend pnpm playwright test
```

Inside the dev container you can also run the underlying tools against your
local install (`cd backend && uv run pytest`, `cd frontend && pnpm test`).

## Development Principles

This project follows the [Constitution](/.specify/memory/constitution.md):

1. **Domain-Driven Design** - Clean bounded contexts
2. **Dependency Injection** - ABC-based loose coupling
3. **Test-Driven Development** - Red-Green-Refactor cycle
4. **Modern Toolchain** - uv, pnpm, Dev Containers
5. **PWA-First** - Single codebase for all platforms
6. **Lazy Resource Generation** - TTS on-demand with caching

## License

MIT
