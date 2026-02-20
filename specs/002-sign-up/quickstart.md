# Quickstart: Sign-Up Feature Development

**Feature Branch**: `002-sign-up`  
**Date**: 2026-02-20

## Prerequisites

- Dev Container running (from feature 001 setup)
- PostgreSQL database available
- Backend and frontend dependencies installed

## New Dependencies

### Backend

```bash
cd backend
uv add bcrypt
```

This adds `bcrypt>=5.0.0` for password hashing. No other new dependencies needed.

### Frontend

No new frontend dependencies — uses existing Material UI components.

## Database Migration

After adding the `password_hash` column and unique constraint to the SQLAlchemy model:

```bash
cd backend
uv run alembic revision --autogenerate -m "add_password_hash_and_unique_constraint"
uv run alembic upgrade head
```

**What the migration does**:
1. Adds nullable `password_hash VARCHAR(255)` column to `users` table
2. Adds composite unique constraint `uq_user_provider_provider_id` on (`provider`, `provider_id`)

## Key Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `backend/app/domain/shared/password_hasher.py` | `PasswordHasher` ABC |
| `backend/app/infrastructure/auth/password_hasher.py` | `BcryptPasswordHasher` implementation |
| `backend/app/application/services/auth_service.py` | `AuthService` (sign-up + login logic) |
| `frontend/src/pages/auth/SignUpPage.tsx` | Registration form page |
| `backend/tests/unit/test_auth_service.py` | Unit tests for AuthService |
| `backend/tests/unit/test_password_hasher.py` | Unit tests for BcryptPasswordHasher |

### Modified Files

| File | Change |
|------|--------|
| `backend/app/domain/feed_management/entities/user.py` | Add `password_hash` field, extend `provider` Literal |
| `backend/app/infrastructure/persistence/models/user.py` | Add `password_hash` column, add unique constraint |
| `backend/app/infrastructure/persistence/repositories/user_repository.py` | Add `get_by_provider_and_id()` method |
| `backend/app/domain/feed_management/repositories/user_repository.py` | Add `get_by_provider_and_id()` to ABC |
| `backend/app/api/routes/auth.py` | Add `POST /signup` and `POST /login` endpoints |
| `backend/app/config/container.py` | Wire `AuthService` + `PasswordHasher` |
| `frontend/src/pages/auth/SignInPage.tsx` | Add email/password form + link to sign-up |
| `frontend/src/services/api.ts` | Add `signup()` and `login()` API methods |
| `frontend/src/contexts/AuthContext.tsx` | Extend `provider` type with `"local"` |
| `frontend/src/App.tsx` | Add `/signup` route |
| `backend/tests/contract/test_auth.py` | Add sign-up and login contract tests |

## Running Tests

### Backend Unit Tests

```bash
cd backend
uv run pytest tests/unit/test_auth_service.py tests/unit/test_password_hasher.py -v
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

1. **Start with domain**: Write failing tests for `PasswordHasher` ABC and `BcryptPasswordHasher`
2. **Then application layer**: Write failing tests for `AuthService.sign_up()` and `AuthService.login()`
3. **Then infrastructure**: Implement repository changes, wire in container
4. **Then API routes**: Write contract tests for `POST /auth/signup` and `POST /auth/login`, implement routes
5. **Then frontend**: Build sign-up page and modify sign-in page
6. **Finally E2E**: Add Playwright tests for full sign-up/login flow

## API Endpoints Summary

| Method | Path | Description | Auth Required |
|--------|------|-------------|---------------|
| `POST` | `/api/auth/signup` | Create local account | No |
| `POST` | `/api/auth/login` | Login with email/password | No |
| `GET` | `/api/auth/me` | Get current user (modified: returns `"local"` provider) | Yes |

## Environment Variables

No new environment variables required. The bcrypt cost factor (12) is hardcoded as a sensible default.

Optional future configuration:
```bash
# Rate limiting (future — currently in-memory defaults)
AUTH_LOGIN_RATE_LIMIT=5/minute
AUTH_SIGNUP_RATE_LIMIT=10/minute
```
