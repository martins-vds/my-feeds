# Quickstart: Post-OAuth Sign-Up Feature Development

**Feature Branch**: `002-sign-up`  
**Date**: 2026-02-20

## Prerequisites

- Dev Container running (from feature 001 setup)
- PostgreSQL database available
- Backend and frontend dependencies installed

## New Dependencies

**None.** This feature uses only existing dependencies. No new backend or frontend packages needed.

## Database Migration

Add the missing `(provider, provider_id)` unique constraint:

```bash
cd backend
uv run alembic revision --autogenerate -m "add_provider_unique_constraint"
uv run alembic upgrade head
```

**What the migration does**:
1. Checks for duplicate `(provider, provider_id)` pairs (aborts with clear message if found)
2. Adds `UNIQUE (provider, provider_id)` constraint named `uq_user_provider_id`

## Key Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/pages/auth/SignUpPage.tsx` | Post-OAuth sign-up form (name + timezone) |
| `backend/tests/unit/test_session.py` | Unit tests for pending sign-up session state |

### Modified Files

| File | Change |
|------|--------|
| `backend/app/infrastructure/oauth/session.py` | Add `create_pending_session()`, `get_pending_signup()`, validate 15-min TTL |
| `backend/app/infrastructure/oauth/oauth_service.py` | Replace `get_or_create_user()` with `get_user()` (lookup only, no auto-create) |
| `backend/app/api/routes/auth.py` | Callback branches new vs returning user; add `POST /auth/complete-signup`; modify `GET /auth/me` for pending state |
| `backend/app/infrastructure/persistence/models/user.py` | Add `UniqueConstraint("provider", "provider_id")` to `__table_args__` |
| `frontend/src/contexts/AuthContext.tsx` | Add `isPendingSignup`, `pendingProfile` state; handle pending response from `/auth/me` |
| `frontend/src/components/ProtectedRoute.tsx` | Redirect pending users to `/signup` instead of `/signin` |
| `frontend/src/App.tsx` | Add `/signup` route |
| `frontend/src/services/api.ts` | Add `completeSignup()` API method |
| `backend/tests/contract/test_auth.py` | Test new/returning user callback behavior, complete-signup endpoint |
| `frontend/playwright/auth.spec.ts` | E2E tests for sign-up flow |

## Running Tests

### Backend Unit Tests

```bash
cd backend
uv run pytest tests/unit/test_session.py -v
```

### Backend Contract Tests

```bash
cd backend
uv run pytest tests/contract/test_auth.py -v
```

### Frontend E2E Tests

```bash
cd frontend
pnpm exec playwright test playwright/auth.spec.ts
```

### All Tests

```bash
cd backend && uv run pytest -v
cd ../frontend && pnpm exec playwright test
```

## Development Flow (TDD)

Follow the Red-Green-Refactor cycle per constitution:

1. **Start with session layer**: Write failing tests for `create_pending_session()` and `get_pending_signup()` in `SessionManager`
2. **Then OAuth service**: Write failing test for `get_user()` (lookup only), modify `get_or_create_user` → `get_user`
3. **Then API routes**: Write contract tests for:
   - OAuth callback → new user → pending cookie set
   - OAuth callback → returning user → full session (unchanged)
   - `GET /auth/me` → pending state → returns `{pending_signup: true, profile: {...}}`
   - `POST /auth/complete-signup` → creates user, returns full session
   - `POST /auth/complete-signup` → no pending session → 401
   - `POST /auth/complete-signup` → expired pending → 401
4. **Then frontend**: Build `SignUpPage`, modify `AuthContext`, modify `ProtectedRoute`
5. **Finally E2E**: Playwright tests for full sign-up flow

## API Endpoints Summary

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| `POST` | `/api/auth/complete-signup` | Complete sign-up form for new user | Pending session |
| `GET`  | `/api/auth/me` | Get user or pending status (MODIFIED) | Session cookie |
| `GET`  | `/api/auth/{provider}/callback` | OAuth callback (MODIFIED behavior) | None |

## Environment Variables

No new environment variables required.

## Key Design Decisions

- **No new DB columns** — User schema unchanged; `name` and `timezone` are now user-confirmed during sign-up instead of auto-filled from OAuth defaults
- **Pending data in cookie** — No server-side session store; pending OAuth data stored in the existing JSON cookie (~400 bytes)
- **15-minute TTL** — Pending sign-up expires after 15 minutes; user must re-authenticate via OAuth
- **Browser timezone detection** — `Intl.DateTimeFormat().resolvedOptions().timeZone` for auto-detection, fallback to `"UTC"`
