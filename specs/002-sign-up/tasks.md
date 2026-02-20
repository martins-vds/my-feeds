# Tasks: Post-OAuth Sign-Up / Onboarding

**Input**: Design documents from `/specs/002-sign-up/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓, quickstart.md ✓

**Tests**: Included — TDD is a constitutional principle (non-negotiable). Contract tests required per SC-004.

**Organization**: Tasks grouped by user story. US1+US2 share backend implementation (same callback code path); US3 is frontend-only enhancement.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story — [US1], [US2], [US3]
- Exact file paths included in every task description

## Path Conventions

- **Backend**: `backend/app/`, `backend/tests/`, `backend/migrations/`
- **Frontend**: `frontend/src/`, `frontend/playwright/`

---

## Phase 1: Setup (Database Constraint)

**Purpose**: Add missing `(provider, provider_id)` unique constraint — prerequisite for safe user creation

- [x] T001 Add `UniqueConstraint("provider", "provider_id", name="uq_user_provider_id")` to `__table_args__` in `backend/app/infrastructure/persistence/models/user.py`
- [x] T002 Generate Alembic migration via `uv run alembic revision --autogenerate -m "add_provider_unique_constraint"`, then customize: add pre-check query for duplicate `(provider, provider_id)` rows that raises a clear error before applying constraint, in `backend/migrations/versions/`

---

## Phase 2: Foundational (Backend Session + Service Layer)

**Purpose**: Core session changes that MUST be complete before any user story implementation

**⚠️ CRITICAL**: No user story work can begin until this phase is complete — the pending session state is the backbone of the entire feature.

### Tests (Red phase — write first, verify they fail)

- [x] T003 [P] Write failing unit tests for `SessionManager` pending session: `create_pending_session()` sets cookie with pending_signup fields, `get_pending_signup()` reads and returns pending data, expired pending (>15 min) returns `None`, `clear_session()` removes pending cookie, in `backend/tests/unit/test_session.py`

### Implementation (Green phase)

- [x] T004 Implement `create_pending_session(response, provider, provider_id, email, name, avatar_url)` and `get_pending_signup(request)` with 15-minute TTL validation on `pending_created_at` in `backend/app/infrastructure/oauth/session.py`
- [x] T005 Add `get_user_by_provider(provider, provider_id)` method to `OAuthService` that looks up user by `(provider, provider_id)` and returns `User | None` (no auto-creation), in `backend/app/infrastructure/oauth/oauth_service.py`

**Checkpoint**: Session layer supports three states (none / pending / full). OAuth service can look up without creating. Unit tests pass.

---

## Phase 3: User Story 1 — New User Completes Sign-Up After First OAuth Login (Priority: P1) 🎯 MVP

**Goal**: First-time OAuth users land on a sign-up form to confirm name and select timezone before account creation.

**Independent Test**: Sign in with a new OAuth identity → verify redirect to `/signup` → fill form → submit → verify landing on `/posts` with correct profile.

### Tests (Red phase)

- [x] T006 [P] [US1] Write failing contract tests for new-user callback flow: callback with unknown `(provider, provider_id)` → sets pending cookie → 302 redirect, in `backend/tests/contract/test_auth.py`
- [x] T007 [P] [US1] Write failing contract tests for `POST /auth/complete-signup`: valid request → 201 with `AuthStatus`, empty name → 400 validation error, invalid timezone → 400, no pending cookie → 401, expired pending → 401, duplicate user → 409, in `backend/tests/contract/test_auth.py`
- [x] T008 [P] [US1] Write failing contract test for `GET /auth/me` with pending cookie: returns `{pending_signup: true, profile: {email, name, avatarUrl, provider}}`, in `backend/tests/contract/test_auth.py`

### Backend Implementation (Green phase)

- [x] T009 [US1] Modify OAuth callback handler to check `get_user_by_provider()` — if user found, set full session (existing behavior); if not found, call `create_pending_session()` with OAuth data, in `backend/app/api/routes/auth.py`
- [x] T010 [US1] Add `POST /auth/complete-signup` endpoint: read pending data via `get_pending_signup()`, validate name (1-255 chars trimmed) and timezone (against `zoneinfo.available_timezones()`), create `User` via repository, replace pending cookie with full session, return `AuthStatus` JSON, in `backend/app/api/routes/auth.py`
- [x] T011 [US1] Modify `GET /auth/me` handler: if `get_pending_signup()` returns data, respond with `{pending_signup: true, profile: {...}}`; if `get_user_id()` returns id, respond with existing `{authenticated: true, user: {...}}`; otherwise 401, in `backend/app/api/routes/auth.py`

### Frontend Implementation

- [x] T012 [P] [US1] Add `completeSignup(name: string, timezone: string): Promise<AuthStatus>` method that POSTs to `/auth/complete-signup` in `frontend/src/services/api.ts`
- [x] T013 [US1] Add `isPendingSignup: boolean` and `pendingProfile: PendingProfile | null` to `AuthState`; update `refreshUser()` to detect `pending_signup: true` response from `/auth/me` and set pending state, in `frontend/src/contexts/AuthContext.tsx`
- [x] T014 [US1] Modify `ProtectedRoute` for three-state routing: loading → spinner, `!isAuthenticated && !isPendingSignup` → `Navigate to="/signin"`, `!isAuthenticated && isPendingSignup` → `Navigate to="/signup"`, `isAuthenticated` → render children, in `frontend/src/components/ProtectedRoute.tsx`
- [x] T015 [US1] Create `SignUpPage` component: form with name `TextField` and timezone `TextField`, submit calls `completeSignup()` then `refreshUser()`, inline validation (name required), guard — if no `isPendingSignup` redirect to `/signin`, on success redirect to `/posts`, in `frontend/src/pages/auth/SignUpPage.tsx`
- [x] T016 [US1] Add `/signup` route pointing to `SignUpPage` (public route, outside `ProtectedRoute`) in `frontend/src/App.tsx`

**Checkpoint**: New users complete sign-up form after OAuth. Returning users unaffected. Contract tests pass. Full MVP flow works end-to-end.

---

## Phase 4: User Story 2 — Returning User Signs In Normally (Priority: P1)

**Goal**: Verify that existing users who have already completed sign-up bypass the form entirely and go straight to `/posts`.

**Independent Test**: Complete sign-up once, log out, sign in again with the same provider → verify direct landing on `/posts` with no sign-up prompt.

> **Note**: The backend implementation for returning users is in the callback modification (T009, Phase 3). This phase adds explicit verification tests.

- [x] T017 [P] [US2] Write contract test verifying returning-user callback: callback with known `(provider, provider_id)` → sets full session cookie (with `user_id`) → 302 redirect, no pending state, in `backend/tests/contract/test_auth.py`
- [x] T018 [US2] Write contract test verifying `GET /auth/me` for fully authenticated user returns `{authenticated: true, user: {...}}` (unchanged from feature 001 behavior), in `backend/tests/contract/test_auth.py`

**Checkpoint**: Returning users confirmed unaffected. Both new-user and returning-user contract tests pass.

---

## Phase 5: User Story 3 — Sign-Up Form Pre-populated from OAuth (Priority: P2)

**Goal**: Reduce friction by pre-filling form fields from OAuth data and auto-detecting timezone.

**Independent Test**: Sign in with GitHub → verify name field pre-filled from GitHub profile, email shown read-only, timezone defaulting to browser's detected timezone.

> **Note**: Pending profile data is already available via `AuthContext.pendingProfile` (from Phase 3). This phase enhances the `SignUpPage` UX.

- [x] T019 [P] [US3] Implement browser timezone auto-detection using `Intl.DateTimeFormat().resolvedOptions().timeZone` with `"UTC"` fallback, set as default timezone value on form mount, in `frontend/src/pages/auth/SignUpPage.tsx`
- [x] T020 [US3] Replace basic timezone input with searchable MUI `Autocomplete` populated via `Intl.supportedValuesOf("timeZone")` with a static IANA fallback array for older browsers, in `frontend/src/pages/auth/SignUpPage.tsx`
- [x] T021 [US3] Pre-fill name `TextField` from `pendingProfile.name`, display `pendingProfile.email` as read-only `Typography`, and show `pendingProfile.avatarUrl` as `Avatar` component on the sign-up form, in `frontend/src/pages/auth/SignUpPage.tsx`

**Checkpoint**: Sign-up form is pre-populated with OAuth data. Timezone auto-detected. User only needs to confirm and submit.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases, E2E coverage, and validation

- [x] T022 [P] Handle edge cases in `POST /auth/complete-signup`: tampered/malformed pending cookie → 401, missing required OAuth fields (email) → 401 with clear message, in `backend/app/api/routes/auth.py`
- [x] T023 [P] Add E2E Playwright tests: new user full sign-up flow, returning user bypass, form validation errors (empty name), expired pending redirect, in `frontend/playwright/auth.spec.ts`
- [x] T024 [P] Add integration test: full sign-up flow across layers — OAuth callback sets pending cookie → `GET /auth/me` returns pending profile → `POST /auth/complete-signup` creates user and returns full session → `GET /auth/me` returns authenticated user, in `backend/tests/integration/test_signup_flow.py`
- [x] T025 Run quickstart.md validation: execute all test commands from quickstart.md, verify all backend unit + contract + integration tests pass, verify E2E tests pass, confirm zero new dependencies in `pyproject.toml` and `package.json`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 — core feature, MVP
- **US2 (Phase 4)**: Depends on Phase 3 (T009 callback implementation) — verification tests
- **US3 (Phase 5)**: Depends on Phase 3 (T013 AuthContext, T015 SignUpPage) — frontend enhancement
- **Polish (Phase 6)**: Depends on Phases 3-5 — all stories complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2). This IS the feature.
- **US2 (P1)**: Depends on US1 callback implementation (T009). Tests verify non-regression.
- **US3 (P2)**: Depends on US1 frontend (T13, T015). Enhances existing `SignUpPage`.
- **US2 and US3** are independent of each other and can run in parallel.

### Within Each Phase

- Tests (T003, T006-T008) MUST be written FIRST and verified to FAIL before implementation
- Session layer (T004) before OAuth service (T005) — service depends on session for pending state
- Backend routes (T009-T011) before frontend (T012-T016) — frontend calls backend endpoints
- AuthContext (T013) before ProtectedRoute (T014) and SignUpPage (T015) — they consume context
- ProtectedRoute (T014) and App.tsx route (T016) can be parallel (different files)

### Parallel Opportunities

Within phases, all tasks marked `[P]` can run simultaneously:

| Phase | Parallel Group | Tasks |
|-------|---------------|-------|
| Phase 2 | Unit tests | T003 (while foundational tests are being written, implementation has not started) |
| Phase 3 | Contract tests | T006, T007, T008 (all in test_auth.py but independent test functions) |
| Phase 3 | Frontend prep | T012 (api.ts) can parallel with backend T009-T011 |
| Phase 4 | Verification tests | T017 (independent of T018) |
| Phase 5 | Timezone detection | T019 (standalone utility, no deps on T020-T021) |
| Phase 6 | Polish | T022 (backend) parallel with T023 (frontend) |

---

## Parallel Example: User Story 1

```
# Phase 3, Step 1 — Launch all contract tests in parallel (Red phase):
Task T006: "Contract test for new-user callback in backend/tests/contract/test_auth.py"
Task T007: "Contract test for complete-signup in backend/tests/contract/test_auth.py"
Task T008: "Contract test for /auth/me pending state in backend/tests/contract/test_auth.py"

# Phase 3, Step 2 — Backend implementation (sequential, same file):
Task T009: "Modify callback handler in backend/app/api/routes/auth.py"
Task T010: "Add complete-signup endpoint in backend/app/api/routes/auth.py"
Task T011: "Modify /auth/me handler in backend/app/api/routes/auth.py"

# Phase 3, Step 3 — Frontend (parallel where possible):
Task T012: "Add completeSignup() in frontend/src/services/api.ts"    ← parallel
Task T013: "Add pending state to frontend/src/contexts/AuthContext.tsx"
Task T014: "Modify frontend/src/components/ProtectedRoute.tsx"        ← after T013
Task T015: "Create frontend/src/pages/auth/SignUpPage.tsx"            ← after T013
Task T016: "Add /signup route in frontend/src/App.tsx"                ← parallel with T014/T015
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (migration + model constraint)
2. Complete Phase 2: Foundational (session layer + OAuth service)
3. Complete Phase 3: User Story 1 (callback branching + complete-signup + sign-up page)
4. **STOP and VALIDATE**: Test full new-user flow end-to-end
5. Deploy — returning users are already handled by T009

### Incremental Delivery

1. Phase 1 + 2 → Foundation ready (migration applied, session supports pending state)
2. Phase 3 (US1) → **MVP deployed** — new users complete sign-up, returning users unaffected
3. Phase 4 (US2) → Verification: explicit contract tests confirm returning-user preservation
4. Phase 5 (US3) → UX polish: pre-population, timezone auto-detect, avatar display
5. Phase 6 → Hardening: edge cases, E2E, final validation

### Key Files Summary

| File | Action | Phase |
|------|--------|-------|
| `backend/app/infrastructure/persistence/models/user.py` | Add UniqueConstraint | 1 |
| `backend/migrations/versions/*_add_provider_unique_constraint.py` | New migration | 1 |
| `backend/tests/unit/test_session.py` | New test file | 2 |
| `backend/app/infrastructure/oauth/session.py` | Add pending session methods | 2 |
| `backend/app/infrastructure/oauth/oauth_service.py` | Add get_user_by_provider() | 2 |
| `backend/tests/contract/test_auth.py` | Extend with 8+ new tests | 3, 4 |
| `backend/app/api/routes/auth.py` | Modify callback, /me; add complete-signup | 3, 6 |
| `frontend/src/services/api.ts` | Add completeSignup() | 3 |
| `frontend/src/contexts/AuthContext.tsx` | Add pending state handling | 3 |
| `frontend/src/components/ProtectedRoute.tsx` | Three-state routing | 3 |
| `frontend/src/pages/auth/SignUpPage.tsx` | New page | 3, 5 |
| `frontend/src/App.tsx` | Add /signup route | 3 |
| `frontend/playwright/auth.spec.ts` | Extend with sign-up E2E | 6 |

---

## Notes

- [P] tasks = different files or independent functions, no blocking dependencies
- [US*] label maps task to specific user story for traceability
- TDD flow: write failing test → implement → verify pass → refactor
- Commit after each task or logical group
- Stop at any checkpoint to validate the story independently
- Total: **25 tasks** across 6 phases
- Zero new backend/frontend dependencies
