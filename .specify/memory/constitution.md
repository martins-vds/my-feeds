<!--
  ============================================================================
  SYNC IMPACT REPORT
  ============================================================================
  Version change: 1.1.0 → 1.2.0 (DI mechanism changed)
  
  Modified principles:
    - II. Dependency Injection
      - REMOVED: quart-injector library (no longer viable)
      - ADDED: OOP-based DI using inheritance and abstract classes
      - Services MUST depend on abstract base classes, not concrete implementations
  
  Technology Stack changes:
    - Removed quart-injector row
    - Added "ABC + Inheritance" for Dependency Injection layer
  
  Added sections: None
  
  Removed sections: None
  
  Templates requiring updates:
    ✅ plan-template.md - No changes required (no DI library references)
    ✅ spec-template.md - No changes required (no DI references)
    ✅ tasks-template.md - No changes required (no DI tool references)
  
  Files requiring manual follow-up (not templates):
    ⚠️ README.md - References quart-injector (lines 20, 129)
    ⚠️ .github/agents/copilot-instructions.md - References quart-injector (lines 7, 26)
    ⚠️ backend/pyproject.toml - quart-injector dependency (line 12)
    ⚠️ backend/app/config/container.py - Uses quart-injector (entire file)
    ⚠️ specs/001-rss-feed-reader/research.md - Documents quart-injector decision
    ⚠️ specs/001-rss-feed-reader/plan.md - Lists quart-injector in dependencies
    ⚠️ specs/001-rss-feed-reader/quickstart.md - DI instructions reference quart-injector
    ⚠️ specs/001-rss-feed-reader/tasks.md - Task T012 references quart-injector
  
  Follow-up TODOs:
    - Migrate existing DI container from quart-injector to ABC-based approach
    - Update all affected spec/documentation files listed above
  ============================================================================
-->

# my-feeds Constitution

## Core Principles

### I. Domain-Driven Design (NON-NEGOTIABLE)

All backend code MUST follow Domain-Driven Design principles:
- Clear separation of domain, application, and infrastructure layers
- Domain models MUST be independent of frameworks and persistence
- Use bounded contexts to isolate feed management, notifications, and audio generation
- Repositories abstract data access; services orchestrate domain logic
- Entities and value objects MUST be explicitly defined

**Rationale**: DDD ensures the codebase remains maintainable and refactor-safe over the multi-year project scope. Clean domain boundaries enable independent testing and evolution.

### II. Dependency Injection via Abstract Base Classes

All backend services MUST use dependency injection via OOP inheritance:
- Services MUST depend on abstract base classes (ABCs), not concrete implementations
- All external dependencies (database, TTS, feed fetchers) MUST be injected via constructor
- Concrete implementations inherit from ABCs and are injected at composition root
- No hard-coded dependencies in business logic
- Avoid service locator patterns; prefer explicit constructor injection

**Implementation Pattern**:
```python
from abc import ABC, abstractmethod

class FeedRepository(ABC):
    @abstractmethod
    async def get_feeds(self, user_id: str) -> list[Feed]: ...

class FeedService:
    def __init__(self, repository: FeedRepository):  # Depends on ABC
        self._repository = repository
```

**Rationale**: OOP-based DI using abstract classes provides loose coupling without external dependencies. ABCs are built into Python, require no additional libraries, and integrate naturally with type checkers and IDE tooling.

### III. Test-Driven Development (NON-NEGOTIABLE)

All code MUST be developed using TDD (Test-Driven Development):

**The Red-Green-Refactor Cycle**:
1. **RED**: Write a failing test that defines expected behavior
2. **GREEN**: Write the minimum code to make the test pass
3. **REFACTOR**: Improve code quality while keeping tests green

**TDD Rules**:
- No production code may be written without a failing test
- Tests MUST be written before implementation, not after
- Each test MUST fail for the right reason before implementation
- Keep the Red-Green-Refactor cycle short (minutes, not hours)

**Testing Requirements**:
- **Backend**: pytest + pytest-asyncio for unit and integration tests
- **Frontend**: Playwright for UI tests; Vitest for component/unit tests
- Contract tests MUST exist for all API endpoints
- Integration tests MUST cover cross-layer interactions
- Test coverage SHOULD be tracked but not blindly maximized

**Rationale**: TDD produces better-designed, more testable code with fewer defects. The discipline of writing tests first forces clear thinking about requirements and interfaces before implementation.

### IV. Modern Toolchain

The project MUST use modern, deterministic package managers:
- **Frontend**: pnpm (strict dependency isolation, fast, deterministic)
- **Backend**: uv (replaces pip + virtualenv + pip-tools)
- **Dev Environment**: Dev Containers (VS Code / GitHub Codespaces compatible)
- Lock files (`pnpm-lock.yaml`, `uv.lock`) MUST be committed to version control

**Rationale**: Modern tooling reduces friction, ensures reproducibility across environments, and scales well for long-lived projects.

### V. PWA-First Mobile Strategy

The application MUST be delivered as a Progressive Web App:
- Single React codebase serves both desktop and mobile (Android)
- PWA capabilities (offline, installable, push notifications) MUST be implemented
- Vite PWA plugin handles service worker generation
- Native-like experience without maintaining separate mobile apps

**Rationale**: PWA reduces development overhead while providing broad platform coverage. Single codebase maximizes team efficiency.

### VI. Lazy Resource Generation

Expensive operations MUST be deferred and cached:
- Text-to-Speech audio MUST be generated on first read only
- Generated audio MUST be cached for subsequent reads
- No speculative pre-generation of resources
- Cache invalidation strategy MUST be explicit

**Rationale**: Lazy generation controls costs and improves initial response times. Caching ensures subsequent access is fast.

## Technology Stack

All implementations MUST adhere to the following stack:

| Layer                        | Technology           | Version/Notes             |
| ---------------------------- | -------------------- | ------------------------- |
| **Frontend**                 | React + TypeScript   | Via Vite                  |
| **UI Framework**             | Material UI          | Latest stable             |
| **Frontend Build**           | Vite                 | PWA plugin enabled        |
| **Frontend Package Manager** | pnpm                 | Strict mode               |
| **Backend**                  | Python + Quart       | Python 3.12+              |
| **Dependency Injection**     | ABC + Inheritance    | No external library       |
| **Database**                 | PostgreSQL           | Primary data store        |
| **ORM**                      | SQLAlchemy + asyncpg | Async-first               |
| **Migrations**               | Alembic              | Schema versioning         |
| **Feed Parsing**             | feedparser           | RSS/Atom support          |
| **Backend Package Manager**  | uv                   | Required                  |
| **Authentication**           | OAuth2               | GitHub, Gmail, or Outlook |
| **Dev Environment**          | Dev Containers       | Docker-based              |

**Stack Deviations**: Any deviation from this stack MUST be documented with justification and approved before implementation.

## Development Workflow

### Monorepo Structure

```text
my-feeds/
├── .devcontainer/        # Dev Container configuration
├── backend/              # Quart API (Python)
│   ├── app/              # Application code (DDD layers)
│   ├── tests/            # pytest tests
│   └── pyproject.toml    # uv dependencies
├── frontend/             # React PWA (TypeScript)
│   ├── src/              # Application code
│   ├── playwright/       # UI tests
│   └── package.json      # pnpm dependencies
└── README.md
```

### Development Mode

- Frontend runs on `http://localhost:5173` (Vite dev server)
- Backend runs on `http://localhost:5000` (Quart)
- Vite proxies `/api/*` to backend
- All developers MUST use the Dev Container for consistency

### Production Mode

- Backend serves both API (`/api/*`) and static frontend (`/*`)
- Single deployable unit
- Frontend MUST be built via `pnpm build` before deployment

### Code Review Requirements

- All PRs MUST verify compliance with this constitution
- Tests MUST pass before merge
- Linting and formatting MUST pass (configured per-language)

## Governance

This constitution supersedes all other development practices for the my-feeds project.

**Amendment Process**:
1. Proposed changes MUST be documented with rationale
2. Impact on existing code MUST be assessed
3. Migration plan required for breaking changes
4. Version increment follows semantic versioning

**Versioning Policy**:
- MAJOR: Backward-incompatible governance/principle changes
- MINOR: New principles or materially expanded guidance
- PATCH: Clarifications, wording, non-semantic refinements

**Compliance**: All code contributions MUST be verified against this constitution during review.

**Version**: 1.2.0 | **Ratified**: 2026-01-30 | **Last Amended**: 2026-02-13
