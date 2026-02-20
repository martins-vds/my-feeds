# Data Model: Post-OAuth Sign-Up

**Feature Branch**: `002-sign-up`  
**Date**: 2026-02-20  
**Purpose**: Define entity changes, session state changes, and validation rules for the post-OAuth sign-up flow

## Overview

This feature does **not** add new database entities. The `User` table schema is unchanged. The key changes are:

1. **Session cookie structure** — new `pending_signup` transient state (not persisted to DB)
2. **Database constraint** — add missing `(provider, provider_id)` unique constraint
3. **Behavioral change** — `get_or_create_user` split into lookup + deferred creation

## Entity Diagram

```
┌──────────────────────────┐
│         User             │
│    (UNCHANGED schema)    │
├──────────────────────────┤
│ id (PK)          UUID    │
│ provider         ENUM    │   github | google | microsoft
│ provider_id      VARCHAR │
│ email            VARCHAR │
│ name             VARCHAR │
│ avatar_url       VARCHAR │
│ timezone         VARCHAR │   ← now set by user during sign-up (was always "UTC")
│ notifications_en BOOLEAN │
│ created_at       TIMESTAMP│
│ updated_at       TIMESTAMP│
├──────────────────────────┤
│ UNIQUE(provider,          │ ← NEW constraint (was missing)
│        provider_id)       │
│ INDEX(email)              │
└──────────────────────────┘

┌─────────────────────────────────┐
│     PendingSignUp               │
│     (Session cookie - transient)│
├─────────────────────────────────┤
│ provider: str                   │   From OAuth
│ provider_id: str                │   From OAuth
│ email: str                      │   From OAuth
│ name: str | None                │   From OAuth (pre-fill)
│ avatar_url: str | None          │   From OAuth
│ pending_created_at: str         │   ISO timestamp, 15-min TTL
└─────────────────────────────────┘

┌──────────────────────────┐
│     CompleteSignUpRequest │
│     (Value Object)       │
├──────────────────────────┤
│ name: str                │   1-255 chars, trimmed
│ timezone: str            │   IANA timezone string
└──────────────────────────┘
```

---

## Existing Entity: User (UNCHANGED schema, NEW constraint)

**Description**: Authenticated individual from an OAuth provider. Schema unchanged — the only database change is adding the missing unique constraint.

| Field                    | Type         | Constraints                            | Description                             | Change    |
| ------------------------ | ------------ | -------------------------------------- | --------------------------------------- | --------- |
| `id`                     | UUID         | PK                                     | Internal unique identifier              | Unchanged |
| `provider`               | ENUM         | NOT NULL                               | `github`, `google`, `microsoft`         | Unchanged |
| `provider_id`            | VARCHAR(255) | NOT NULL, UNIQUE with provider         | User ID from OAuth provider             | Unchanged |
| `email`                  | VARCHAR(255) | NOT NULL                               | Email from OAuth provider               | Unchanged |
| `name`                   | VARCHAR(255) | NULL                                   | Display name                            | Unchanged (now user-confirmed during sign-up) |
| `avatar_url`             | VARCHAR(512) | NULL                                   | Profile picture URL                     | Unchanged |
| `timezone`               | VARCHAR(64)  | NOT NULL, DEFAULT 'UTC'                | User timezone                           | Unchanged (now set to real value during sign-up) |
| `notifications_enabled`  | BOOLEAN      | NOT NULL, DEFAULT FALSE                | Push notification preference            | Unchanged |
| `created_at`             | TIMESTAMP    | NOT NULL, DEFAULT NOW()                | Account creation time                   | Unchanged |
| `updated_at`             | TIMESTAMP    | NOT NULL                               | Last profile update                     | Unchanged |

**New Constraint (database only)**:
- `uq_user_provider_id` UNIQUE on (`provider`, `provider_id`) — **NEW** (fixes existing gap)

**Behavioral Change**:
- Previously: `User` was auto-created during OAuth callback with defaults (`timezone="UTC"`, `name` from OAuth)
- Now: `User` is only created after sign-up form submission, with user-confirmed `name` and user-selected `timezone`

---

## Transient State: PendingSignUp (Session Cookie)

**Description**: Temporary OAuth data stored in the session cookie between OAuth callback and sign-up form submission. NOT persisted to the database.

| Field                | Type         | Source       | Description                             |
| -------------------- | ------------ | ------------ | --------------------------------------- |
| `provider`           | str          | OAuth        | OAuth provider name                     |
| `provider_id`        | str          | OAuth        | User ID from provider                   |
| `email`              | str          | OAuth        | Email from provider                     |
| `name`               | str \| None  | OAuth        | Display name from provider (pre-fill)   |
| `avatar_url`         | str \| None  | OAuth        | Avatar URL from provider                |
| `pending_created_at` | str (ISO)    | Server       | Timestamp of pending creation, 15-min TTL |

**Validation Rules**:
- `pending_created_at` must be within 15 minutes of current time; otherwise, the pending data is discarded and user is redirected to `/signin`
- All fields except `name` and `avatar_url` are required
- No `user_id` field exists in the pending cookie — this is what distinguishes it from a fully-authenticated session

**Lifecycle**:
1. Created: OAuth callback for new user → sets `pending_signup` in cookie
2. Read: `GET /auth/me` detects pending cookie → returns pending profile to frontend
3. Read: `POST /auth/complete-signup` reads pending data → creates User → replaces cookie with normal session
4. Discarded: If expired (>15 min) or if user navigates to `/signin` and re-authenticates

---

## New Value Object: CompleteSignUpRequest

**Description**: Encapsulates the sign-up form submission.

| Field      | Type   | Constraints                                                      |
| ---------- | ------ | ---------------------------------------------------------------- |
| `name`     | str    | 1-255 chars after trimming leading/trailing whitespace           |
| `timezone` | str    | Valid IANA timezone string (e.g., `"America/New_York"`)          |

**Validation Rules**:
- `name`: must not be empty after stripping whitespace, max 255 characters
- `timezone`: must be a valid IANA timezone identifier (validate against `zoneinfo.available_timezones()` in Python stdlib)

---

## Database Migration

### Migration: `add_provider_unique_constraint`

**Changes**:
1. `ALTER TABLE users ADD CONSTRAINT uq_user_provider_id UNIQUE (provider, provider_id)`

**Pre-check** (in migration code):
- Query for duplicate `(provider, provider_id)` pairs
- If duplicates exist, raise a clear error message and abort migration

**Rollback**:
1. `ALTER TABLE users DROP CONSTRAINT uq_user_provider_id`

**Notes**:
- Non-destructive and backwards compatible
- No new columns — just a constraint on existing columns
- This fixes an existing gap regardless of the sign-up feature

---

## Flow Changes Summary

### OAuth Callback (Modified)

```
Before:
  OAuth callback → get_or_create_user() → set session {user_id} → redirect to /

After (returning user):
  OAuth callback → get_user() → found → set session {user_id} → redirect to /

After (new user):
  OAuth callback → get_user() → NOT found → set cookie {pending_signup} → redirect to /
```

### Sign-Up Completion (New)

```
POST /auth/complete-signup {name, timezone}
  → read pending_signup from cookie
  → validate pending not expired
  → validate name + timezone
  → create User(provider, provider_id, email, name, timezone, avatar_url)
  → save to DB
  → replace cookie with {user_id, provider}
  → return AuthStatus with user
```
