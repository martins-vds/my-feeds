# Research: Post-OAuth Sign-Up Feature

**Feature**: 002-sign-up  
**Date**: 2026-02-20  
**Status**: Complete

## R1: Holding Pending OAuth Data Between Callback and Sign-Up Completion

**Decision**: Store pending data in the session cookie by extending the existing JSON cookie with a `pending_signup` field. No server-side session store needed.

**Rationale**: The app is single-process with no Redis or server-side session store. The cookie is already a plain JSON blob (~120 bytes today). Adding pending OAuth data (provider, provider_id, email, name, avatar_url) brings it to ~350-400 bytes — well under the 4,096-byte browser limit. The data naturally expires with the cookie. A 15-minute effective TTL enforced via `pending_created_at` timestamp prevents stale sign-ups.

**Alternatives considered**:
- Server-side temp store (in-memory dict / Redis / DB table) — overkill for single-process app. In-memory loses data on restart. Redis adds dependency. DB table needs cleanup.
- URL query params — insecure (OAuth data visible in browser history, referer headers, logs).

**Cookie structure for pending state**:
```json
{
  "pending_signup": {
    "provider": "github",
    "provider_id": "12345",
    "email": "user@example.com",
    "name": "Jane Doe",
    "avatar_url": "https://..."
  },
  "pending_created_at": "2026-02-20T12:00:00Z"
}
```

## R2: Frontend Routing for Pending Sign-Up

**Decision**: `GET /auth/me` returns a different response shape for pending users. Backend always redirects to the same frontend URL (`/`). Frontend `AuthContext` detects the pending state and routes accordingly.

**Rationale**: Fits the existing pattern — the SPA already calls `/auth/me` on mount and uses its response to set auth state. Adding a new response shape is the minimal change. Keeps backend decoupled from frontend route names. Single source of truth: backend decides who's pending, frontend reacts.

**Alternatives considered**:
- Backend redirects to `/signup` — couples backend to frontend routing, doesn't work with dev proxy setup.
- Backend redirects with `?pending=true` — leaks state into URL, still needs `/auth/me` for data.

**Three response states for `/auth/me`**:

| State | Cookie | Response | Frontend |
|-------|--------|----------|----------|
| No session | None/invalid | `401` | `isAuthenticated: false` |
| Pending sign-up | `{pending_signup: {...}}` | `200 {pending_signup: true, ...profile}` | `isPendingSignup: true` |
| Fully signed in | `{user_id, provider}` | `200 {authenticated: true, user: {...}}` | `isAuthenticated: true` |

## R3: Protecting Routes During Pending Sign-Up

**Decision**: Three-state auth check. Pending users have `isAuthenticated: false` + `isPendingSignup: true`. `ProtectedRoute` redirects them to `/signup` (not `/signin`). The `/signup` route itself guards against direct access (no pending session → redirect to `/signin`).

**Rationale**: Pending sign-up is NOT "authenticated" — no user_id exists in DB yet. All existing protected API routes already reject pending cookies (no `user_id` field → `get_user_id()` returns None → 401). Only the new `POST /auth/complete-signup` reads the `pending_signup` field from the cookie.

**ProtectedRoute logic**:
- `!isAuthenticated && !isPendingSignup` → redirect to `/signin`
- `!isAuthenticated && isPendingSignup` → redirect to `/signup`
- `isAuthenticated` → render children

## R4: Database Unique Constraint Migration

**Decision**: Two-step Alembic migration — check for duplicates, then add `(provider, provider_id)` unique constraint. Add `UniqueConstraint` to SQLAlchemy model's `__table_args__`.

**Rationale**: The constraint is currently missing despite being referenced in model comments. Checking for duplicates in the migration itself is safer than a separate script — it runs in the same transaction and fails cleanly with a clear message if duplicates exist.

**Alternatives considered**:
- Add constraint without checking — risky if dev/test data has duplicates.
- Separate pre-migration script — adds operational complexity.

**Constraint name**: `uq_user_provider_id` (follows existing project convention: `uq_feed_category_url`, `uq_post_feed_guid`, etc.)

## R5: Browser Timezone Detection

**Decision**: Use `Intl.DateTimeFormat().resolvedOptions().timeZone` — native API, zero dependencies.

**Rationale**: Returns IANA timezone strings (e.g., `"America/New_York"`) which matches the backend's `timezone` field format. Supported by 97%+ of browsers (Chrome 24+, Firefox 29+, Safari 10+). Reads the actual OS timezone setting, not a guess based on IP. Fallback to `"UTC"` for edge cases.

**Alternatives considered**:
- `moment-timezone` — 200KB bundle size just to call the same `Intl` API.
- `jstz` — legacy library for IE11 era, unmaintained.
- IP-based geolocation — unreliable (VPNs), privacy concerns.

**Timezone dropdown**: Use `Intl.supportedValuesOf('timeZone')` where available (Chrome 93+, Firefox 93+, Safari 15.4+), with a static fallback list of ~400 IANA zones.

## Summary of All Decisions

| # | Decision | Key Rationale |
|---|---|---|
| R1 | Pending OAuth data in session cookie | Zero new infrastructure, naturally expires, stateless |
| R2 | `/auth/me` returns different shape for pending | Fits existing SPA pattern, backend decoupled from frontend routes |
| R3 | Three-state auth: none / pending / full | Existing protected routes already reject pending cookies |
| R4 | Alembic migration with duplicate check | Fixes existing gap, safe for dev/prod |
| R5 | `Intl.DateTimeFormat().resolvedOptions().timeZone` | Native, 97%+ support, zero dependencies |
