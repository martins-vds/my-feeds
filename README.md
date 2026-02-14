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

### Prerequisites
- Docker Desktop or Docker Engine with Compose
- VS Code with Dev Containers extension
- Git

### Getting Started

1. **Clone and open in Dev Container**:
   ```bash
   git clone <repository-url>
   cd my-feeds
   code .
   ```
   Click "Reopen in Container" when prompted.

2. **Install dependencies**:
   ```bash
   # Backend
   cd backend && uv sync

   # Frontend
   cd frontend && pnpm install
   ```

3. **Configure environment**:
   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```
   Fill in OAuth credentials and API keys.

4. **Run migrations**:
   ```bash
   cd backend
   uv run alembic upgrade head
   ```

5. **Start development servers**:
   ```bash
   # Terminal 1 - Backend (http://localhost:5000)
   cd backend && uv run quart --app app.main:app run --reload

   # Terminal 2 - Frontend (http://localhost:5173)
   cd frontend && pnpm dev
   ```

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

```bash
# Backend tests
cd backend
uv run pytest                    # All tests
uv run pytest tests/unit/        # Unit tests only
uv run pytest --cov=app          # With coverage

# Frontend tests
cd frontend
pnpm test                        # Vitest unit tests
pnpm playwright test             # Playwright E2E tests
```

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
