# Implementation Plan: Post-OAuth Sign-Up / Onboarding

**Branch**: `002-sign-up` | **Date**: 2026-02-20 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/002-sign-up/spec.md`

## Summary

Modify the OAuth authentication flow so that first-time users are **not** auto-created. Instead, OAuth data is held in a temporary "pending sign-up" session state, and the user is redirected to a sign-up page to confirm their display name and set their timezone. Only after submitting the sign-up form is the user record created. Returning users bypass this entirely and go straight to the app.

## Technical Context

**Language/Version**: Python 3.12+ (backend), TypeScript (frontend via React + Vite)
**Primary Dependencies**: Quart (backend framework), React + Material UI (frontend) — no new backend libraries
**Storage**: PostgreSQL via SQLAlchemy + asyncpg (existing)
**Testing**: pytest + pytest-asyncio (backend), Playwright (frontend E2E), Vitest (frontend unit)
**Target Platform**: Web (PWA) — Linux server backend, browser frontend
**Project Type**: Web application (monorepo: backend/ + frontend/)
**Performance Goals**: Sign-up completion < 200ms p95 (no expensive hashing — just a DB insert)
**Constraints**: Must not break existing returning-user OAuth flow. Session mechanism shared. No new backend libraries required.
**Scale/Scope**: Single-user personal app, but architecture should be clean for future growth.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Domain-Driven Design | ✅ PASS | Callback logic change is in infrastructure/oauth. Sign-up completion endpoint is a thin route calling existing `UserRepository.save()`. No domain layer changes needed (User entity unchanged). |
| II. Dependency Injection via ABCs | ✅ PASS | No new services or ABCs needed. Existing `OAuthService` and `UserRepository` are sufficient. |
| III. Test-Driven Development | ✅ PASS | Contract tests for modified callback behavior and new `/auth/complete-signup` endpoint. Unit tests for pending-session logic. |
| IV. Modern Toolchain | ✅ PASS | No new dependencies. Zero package changes. |
| V. PWA-First Mobile Strategy | ✅ PASS | Sign-up page is a standard React + MUI form. |
| VI. Lazy Resource Generation | N/A | No expensive resource generation. |
| Technology Stack | ✅ PASS | Pure existing stack. |

**Gate Result**: ✅ ALL PASS — Proceeding to Phase 0.

### Post-Design Re-evaluation (after Phase 1)

| Principle | Status | Post-Design Notes |
|-----------|--------|-------------------|
| I. Domain-Driven Design | ✅ PASS | No domain entity changes. User schema unchanged. Session cookie logic is infrastructure concern. Route level is API layer. Clean separation confirmed. |
| II. Dependency Injection via ABCs | ✅ PASS | No new ABCs or services needed. Existing `OAuthService` + `UserRepository` handle everything. `SessionManager` remains a standalone utility. |
| III. Test-Driven Development | ✅ PASS | Test plan: unit tests for session pending state, contract tests for modified callback + new complete-signup endpoint, Playwright E2E for full flow. |
| IV. Modern Toolchain | ✅ PASS | Zero new dependencies. Alembic for migration. |
| V. PWA-First Mobile Strategy | ✅ PASS | Sign-up page is a standard React + MUI form, fully PWA-compatible. |
| VI. Lazy Resource Generation | N/A | No expensive resource generation. |
| Technology Stack | ✅ PASS | Pure existing stack. No deviations. |

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
│   ├── infrastructure/
│   │   └── oauth/
│   │       ├── oauth_service.py         # MODIFIED: split get_or_create_user into get_user + hold pending
│   │       └── session.py               # MODIFIED: support pending_signup session state
│   ├── api/
│   │   └── routes/
│   │       └── auth.py                  # MODIFIED: callback branches new vs returning user
│   │                                    # NEW: POST /auth/complete-signup endpoint
│   └── config/
│       └── container.py                 # MINOR: no structural changes expected
├── migrations/
│   └── versions/
│       └── xxx_add_unique_constraint.py # NEW: Alembic migration for (provider, provider_id) unique
└── tests/
    ├── contract/
    │   └── test_auth.py                 # EXTENDED: new/returning user callback tests, complete-signup tests
    └── unit/
        └── test_session.py              # NEW: pending signup session state tests

frontend/
├── src/
│   ├── pages/
│   │   └── auth/
│   │       └── SignUpPage.tsx           # NEW: post-OAuth sign-up form
│   ├── services/
│   │   └── api.ts                       # EXTENDED: completeSignup()
│   ├── contexts/
│   │   └── AuthContext.tsx              # MODIFIED: handle pending-signup state in auth flow
│   ├── components/
│   │   └── ProtectedRoute.tsx           # MODIFIED: redirect pending-signup users to /signup
│   └── App.tsx                          # MODIFIED: add /signup route
├── playwright/
│   └── auth.spec.ts                     # EXTENDED: sign-up flow E2E tests
```

**Structure Decision**: Web application monorepo. Primarily modifying existing files in the auth flow. One new frontend page (`SignUpPage.tsx`), one new backend endpoint. No new domain entities, services, or ABCs.
