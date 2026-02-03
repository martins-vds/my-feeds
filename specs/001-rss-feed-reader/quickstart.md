# Quickstart: my-feeds Development

**Feature Branch**: `001-rss-feed-reader`  
**Date**: 2026-02-03

## Prerequisites

- Docker Desktop or Docker Engine with Compose
- VS Code with Dev Containers extension
- Git

## Getting Started

### 1. Clone and Open in Dev Container

```bash
git clone <repository-url>
cd my-feeds
code .
```

When VS Code opens, click **"Reopen in Container"** when prompted (or use Command Palette: `Dev Containers: Reopen in Container`).

The Dev Container will:
- Install Python 3.12+ with `uv`
- Install Node.js 20+ with `pnpm`
- Start PostgreSQL database
- Configure VS Code extensions

### 2. Install Dependencies

**Backend (Python)**:
```bash
cd backend
uv sync
```

**Frontend (React/TypeScript)**:
```bash
cd frontend
pnpm install
```

### 3. Environment Configuration

Copy environment templates:
```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Required environment variables for local development:

**backend/.env**:
```bash
# Database
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/myfeeds

# OAuth (register apps at each provider)
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
MICROSOFT_CLIENT_ID=your_microsoft_client_id
MICROSOFT_CLIENT_SECRET=your_microsoft_client_secret

# Session
SECRET_KEY=generate_a_secure_random_key

# TTS (Azure)
AZURE_SPEECH_KEY=your_azure_speech_key
AZURE_SPEECH_REGION=eastus

# Push Notifications
VAPID_PRIVATE_KEY=your_vapid_private_key
VAPID_PUBLIC_KEY=your_vapid_public_key
VAPID_CLAIM_EMAIL=mailto:your@email.com
```

**frontend/.env**:
```bash
VITE_API_URL=http://localhost:5000/api
VITE_VAPID_PUBLIC_KEY=your_vapid_public_key
```

### 4. Database Setup

Run migrations:
```bash
cd backend
uv run alembic upgrade head
```

### 5. Start Development Servers

**Terminal 1 - Backend**:
```bash
cd backend
uv run quart --app app.main:app run --reload
```
Backend runs at: http://localhost:5000

**Terminal 2 - Frontend**:
```bash
cd frontend
pnpm dev
```
Frontend runs at: http://localhost:5173

## Project Structure

```
my-feeds/
├── backend/
│   ├── app/
│   │   ├── domain/           # DDD Domain layer
│   │   │   ├── feed_management/
│   │   │   ├── notifications/
│   │   │   └── audio/
│   │   ├── application/      # Application services
│   │   ├── infrastructure/   # Repositories, external services
│   │   ├── api/              # Quart routes
│   │   └── config/           # DI container, settings
│   ├── tests/
│   ├── migrations/           # Alembic migrations
│   └── pyproject.toml
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── hooks/
│   ├── playwright/
│   └── package.json
│
├── specs/                    # Feature specifications
│   └── 001-rss-feed-reader/
│       ├── spec.md
│       ├── plan.md
│       ├── research.md
│       ├── data-model.md
│       └── contracts/
│
└── .devcontainer/
```

## Common Tasks

### Run Backend Tests

```bash
cd backend

# All tests
uv run pytest

# Unit tests only
uv run pytest tests/unit/

# Integration tests
uv run pytest tests/integration/

# With coverage
uv run pytest --cov=app --cov-report=html
```

### Run Frontend Tests

```bash
cd frontend

# Unit tests (Vitest) - TDD workflow
pnpm test              # Run once
pnpm test:watch        # Watch mode for TDD Red-Green-Refactor

# UI tests (Playwright)
pnpm playwright test

# Playwright with UI mode
pnpm playwright test --ui
```

### Database Operations

```bash
cd backend

# Create new migration
uv run alembic revision --autogenerate -m "description"

# Apply migrations
uv run alembic upgrade head

# Rollback one migration
uv run alembic downgrade -1

# View current migration
uv run alembic current
```

### Generate VAPID Keys

```bash
# Using OpenSSL
openssl ecparam -genkey -name prime256v1 -out vapid_private.pem
openssl ec -in vapid_private.pem -pubout -out vapid_public.pem

# Convert to base64 for .env
openssl ec -in vapid_private.pem -outform DER | tail -c +8 | head -c 32 | base64 -w0
openssl ec -in vapid_public.pem -pubin -outform DER | tail -c 65 | base64 -w0
```

### Linting & Formatting

**Backend**:
```bash
cd backend
uv run ruff check .          # Lint
uv run ruff format .         # Format
uv run mypy app/             # Type check
```

**Frontend**:
```bash
cd frontend
pnpm lint                    # ESLint
pnpm format                  # Prettier
pnpm typecheck              # TypeScript
```

## API Documentation

OpenAPI specification: [specs/001-rss-feed-reader/contracts/openapi.yaml](contracts/openapi.yaml)

When backend is running, Swagger UI available at: http://localhost:5000/docs

## Key Architectural Decisions

1. **TDD (Test-Driven Development)**: All code follows Red-Green-Refactor cycle. Write failing test → implement → refactor.

2. **DDD Layers**: Domain logic is framework-independent. See `app/domain/`.

3. **Dependency Injection**: All services use `quart-injector`. Configure in `app/config/container.py`.

4. **OAuth BFF Pattern**: Tokens stay server-side. Frontend uses HttpOnly session cookies.

5. **Lazy TTS**: Audio generated on first listen, cached server-side.

6. **PWA**: Vite PWA plugin with custom service worker for push notifications.

## Troubleshooting

### Database connection failed
- Ensure PostgreSQL is running: `docker compose ps`
- Check DATABASE_URL in `.env`

### OAuth redirect fails
- Verify callback URLs registered with OAuth providers
- GitHub: `http://localhost:5000/api/auth/github/callback`
- Google: `http://localhost:5000/api/auth/google/callback`
- Microsoft: `http://localhost:5000/api/auth/microsoft/callback`

### Frontend can't reach backend
- Check CORS settings in backend
- Verify Vite proxy config in `vite.config.ts`

### Push notifications not working
- Must be served over HTTPS (use ngrok for testing)
- Check VAPID keys match between backend and frontend

## Next Steps

See [spec.md](spec.md) for feature requirements and user stories.
See [plan.md](plan.md) for implementation plan and project structure.
See [data-model.md](data-model.md) for database schema.
