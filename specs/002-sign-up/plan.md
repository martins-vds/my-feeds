# Implementation Plan: User Sign-Up

**Branch**: `002-sign-up` | **Date**: 2026-02-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-sign-up/spec.md`

## Summary

Add email/password sign-up and login to the existing OAuth-only authentication system. This involves extending the User domain entity with a `password_hash` field, adding a `"local"` provider type, creating backend registration and login endpoints, and building frontend sign-up/sign-in forms that coexist with the existing OAuth buttons.

## Technical Context

**Language/Version**: Python 3.12+ (backend), TypeScript (frontend via React + Vite)
**Primary Dependencies**: Quart (backend framework), React + Material UI (frontend), bcrypt (new — password hashing)
**Storage**: PostgreSQL via SQLAlchemy + asyncpg (existing)
**Testing**: pytest + pytest-asyncio (backend), Playwright (frontend E2E), Vitest (frontend unit)
**Target Platform**: Web (PWA) — Linux server backend, browser frontend
**Project Type**: Web application (monorepo: backend/ + frontend/)
**Performance Goals**: Sign-up/login response < 500ms p95 (bcrypt hashing is intentionally slow ~100-300ms)
**Constraints**: Must coexist with existing OAuth flow without breaking changes. Session mechanism shared.
**Scale/Scope**: Single-user personal app, but architecture should be clean for future growth.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Domain-Driven Design | ✅ PASS | New `AuthService` follows DDD layers. Password hashing is infrastructure concern, domain defines the contract via ABCs. |
| II. Dependency Injection via ABCs | ✅ PASS | `AuthService` will depend on `UserRepository` ABC and a `PasswordHasher` ABC. Concrete bcrypt implementation injected at composition root. |
| III. Test-Driven Development | ✅ PASS | All new endpoints will have contract tests. Unit tests for password validation, hashing service. TDD red-green-refactor cycle will be followed. |
| IV. Modern Toolchain | ✅ PASS | bcrypt added via `uv add bcrypt`. Frontend deps via `pnpm add`. |
| V. PWA-First Mobile Strategy | ✅ PASS | Sign-up form is a standard React component, works in PWA context. |
| VI. Lazy Resource Generation | N/A | No expensive resource generation in auth flow. |
| Technology Stack | ✅ PASS | All technologies from the constitution stack. bcrypt is a standard Python library, not a framework deviation. |

**Gate Result**: ✅ ALL PASS — Proceeding to Phase 0.

### Post-Design Re-evaluation (after Phase 1)

| Principle | Status | Post-Design Notes |
|-----------|--------|-------------------|
| I. Domain-Driven Design | ✅ PASS | `PasswordHasher` ABC lives in domain/shared. `AuthService` in application layer. `BcryptPasswordHasher` in infrastructure. Clean layer separation confirmed. |
| II. Dependency Injection via ABCs | ✅ PASS | `AuthService(user_repository: UserRepository, password_hasher: PasswordHasher)` — both dependencies are ABCs. Wired in `container.py`. |
| III. Test-Driven Development | ✅ PASS | Test plan: unit tests for PasswordHasher + AuthService, contract tests for /signup + /login, Playwright E2E for full flow. TDD cycle to be followed during implementation. |
| IV. Modern Toolchain | ✅ PASS | `bcrypt` added via `uv add`. No frontend dependency changes. |
| V. PWA-First Mobile Strategy | ✅ PASS | Sign-up/sign-in forms are standard React + MUI components, fully PWA-compatible. |
| VI. Lazy Resource Generation | N/A | No expensive resource generation. |
| Technology Stack | ✅ PASS | `bcrypt` is a standard Python security library, not a framework deviation. All other tech from existing stack. |

**Post-Design Gate Result**: ✅ ALL PASS — No violations. No complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/002-sign-up/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (OpenAPI for new endpoints)
└── tasks.md             # Phase 2 output (created by /speckit.tasks)
```

### Source Code (repository root)

```text
backend/
├── app/
│   ├── domain/
│   │   └── feed_management/
│   │       ├── entities/
│   │       │   └── user.py              # Extended: password_hash field, "local" provider
│   │       └── repositories/
│   │           └── user_repository.py   # Extended: get_by_provider_and_id()
│   ├── application/
│   │   └── services/
│   │       └── auth_service.py          # NEW: sign-up, login logic
│   ├── infrastructure/
│   │   ├── auth/
│   │   │   └── password_hasher.py       # NEW: bcrypt PasswordHasher implementation
│   │   └── persistence/
│   │       ├── models/
│   │       │   └── user.py              # Extended: password_hash column
│   │       └── repositories/
│   │           └── user_repository.py   # Extended: get_by_provider_and_id()
│   ├── api/
│   │   └── routes/
│   │       └── auth.py                  # Extended: POST /signup, POST /login
│   └── config/
│       └── container.py                 # Extended: wire AuthService + PasswordHasher
├── migrations/
│   └── versions/
│       └── xxx_add_password_hash.py     # NEW: Alembic migration
└── tests/
    ├── contract/
    │   └── test_auth.py                 # Extended: sign-up and login contract tests
    └── unit/
        ├── test_auth_service.py         # NEW: unit tests for AuthService
        └── test_password_hasher.py      # NEW: unit tests for PasswordHasher

frontend/
├── src/
│   ├── pages/
│   │   └── auth/
│   │       ├── SignInPage.tsx           # Extended: add email/password form
│   │       └── SignUpPage.tsx           # NEW: registration form
│   ├── services/
│   │   └── api.ts                      # Extended: signup(), login() API calls
│   ├── contexts/
│   │   └── AuthContext.tsx             # Extended: "local" provider type
│   └── types/
│       └── index.ts                    # Extended: provider union type
├── playwright/
│   └── auth.spec.ts                    # Extended: sign-up E2E tests
└── src/test/
    └── auth.test.ts                    # NEW/Extended: Vitest tests for auth
```

**Structure Decision**: Web application monorepo (Option 2). All changes extend existing files or add new files within the established DDD layer structure. No new top-level directories needed.
