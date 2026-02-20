# Data Model: User Sign-Up

**Feature Branch**: `002-sign-up`  
**Date**: 2026-02-20  
**Purpose**: Define entity changes, new value objects, and validation rules for email/password authentication

## Entity Changes Diagram

```
┌──────────────────────────┐
│         User             │
│  (MODIFIED entity)       │
├──────────────────────────┤
│ id (PK)          UUID    │
│ provider         ENUM    │ ← MODIFIED: added "local"
│ provider_id      VARCHAR │
│ email            VARCHAR │
│ name             VARCHAR │
│ password_hash    VARCHAR │ ← NEW: nullable, bcrypt hash
│ avatar_url       VARCHAR │
│ timezone         VARCHAR │
│ notifications_en BOOLEAN │
│ created_at       TIMESTAMP│
│ updated_at       TIMESTAMP│
├──────────────────────────┤
│ UNIQUE(provider,          │ ← NEW constraint (was missing)
│        provider_id)       │
│ INDEX(email)              │
└──────────────────────────┘

┌──────────────────────────┐       ┌──────────────────────────┐
│    SignUpRequest          │       │    LoginRequest           │
│    (Value Object)        │       │    (Value Object)         │
├──────────────────────────┤       ├──────────────────────────┤
│ email: str               │       │ email: str               │
│ password: str            │       │ password: str            │
│ name: str                │       └──────────────────────────┘
└──────────────────────────┘
```

---

## Modified Entities

### User (MODIFIED)

**Description**: Authenticated individual — now supports both OAuth and local (email/password) authentication.

| Field                    | Type         | Constraints                            | Description                             | Change    |
| ------------------------ | ------------ | -------------------------------------- | --------------------------------------- | --------- |
| `id`                     | UUID         | PK                                     | Internal unique identifier              | Unchanged |
| `provider`               | ENUM         | NOT NULL                               | `github`, `google`, `microsoft`, `local`| **MODIFIED**: added `"local"` |
| `provider_id`            | VARCHAR(255) | NOT NULL, UNIQUE with provider         | OAuth user ID or email (for local)      | Unchanged type, new semantic |
| `email`                  | VARCHAR(255) | NOT NULL                               | User email address                      | Unchanged |
| `name`                   | VARCHAR(255) | NULL                                   | Display name                            | Unchanged |
| `password_hash`          | VARCHAR(255) | NULL                                   | bcrypt hash of password                 | **NEW** |
| `avatar_url`             | VARCHAR(512) | NULL                                   | Profile picture URL                     | Unchanged |
| `timezone`               | VARCHAR(64)  | NOT NULL, DEFAULT 'UTC'                | User timezone                           | Unchanged |
| `notifications_enabled`  | BOOLEAN      | NOT NULL, DEFAULT FALSE                | Push notification preference            | Unchanged |
| `created_at`             | TIMESTAMP    | NOT NULL, DEFAULT NOW()                | Account creation time                   | Unchanged |
| `updated_at`             | TIMESTAMP    | NOT NULL                               | Last profile update                     | Unchanged |

**New Validation Rules**:
- `provider` now accepts `"local"` in addition to OAuth providers
- `password_hash` MUST be non-null when `provider = "local"`
- `password_hash` MUST be null when `provider != "local"`
- For local users: `provider_id` = normalized (lowercase) email
- `provider` + `provider_id` MUST be unique (composite unique constraint — **NEW**)

**New/Modified Indexes**:
- `uq_user_provider_provider_id` UNIQUE on (`provider`, `provider_id`) — **NEW** (was missing, fixes existing gap)
- `idx_user_email` on (`email`) — Unchanged

**State Transitions**:
- No state transitions for users (stateless entity)

---

## New Value Objects

### SignUpRequest

**Description**: Encapsulates and validates registration form input.

| Field      | Type   | Constraints                                                      |
| ---------- | ------ | ---------------------------------------------------------------- |
| `email`    | str    | Valid email format (RFC 5322 basic), normalized to lowercase     |
| `password` | str    | 8-128 chars, ≥1 uppercase, ≥1 lowercase, ≥1 digit               |
| `name`     | str    | 1-255 chars, stripped of leading/trailing whitespace              |

**Validation Rules**:
- Email: must match basic RFC 5322 pattern, normalized to lowercase before use
- Password minimum: 8 characters
- Password maximum: 128 characters (bcrypt 72-byte truncation safety)
- Password complexity: at least one uppercase letter (`[A-Z]`), one lowercase letter (`[a-z]`), one digit (`[0-9]`)
- Name: must not be empty after stripping whitespace, max 255 characters

### LoginRequest

**Description**: Encapsulates login form input.

| Field      | Type   | Constraints                                                  |
| ---------- | ------ | ------------------------------------------------------------ |
| `email`    | str    | Valid email format, normalized to lowercase                  |
| `password` | str    | 1-128 chars (no complexity check on login — only on sign-up) |

**Validation Rules**:
- Email: normalized to lowercase before lookup
- Password: cannot be empty, max 128 characters

---

## Database Migration

### Migration: `add_password_hash_and_unique_constraint`

**Changes**:
1. `ALTER TABLE users ADD COLUMN password_hash VARCHAR(255) NULL`
2. `ALTER TABLE users ADD CONSTRAINT uq_user_provider_provider_id UNIQUE (provider, provider_id)`

**Rollback**:
1. `ALTER TABLE users DROP CONSTRAINT uq_user_provider_provider_id`
2. `ALTER TABLE users DROP COLUMN password_hash`

**Notes**:
- Both operations are non-destructive and backwards compatible
- No data migration needed (existing OAuth users will have `password_hash = NULL`)
- The unique constraint may fail if there are existing duplicate `(provider, provider_id)` pairs — verify before applying

---

## Domain Abstractions (New)

### PasswordHasher (ABC)

**Description**: Abstract interface for password hashing, following Constitution II (DI via ABCs).

```
PasswordHasher (ABC)
├── hash_password(password: str) → str        # Returns bcrypt hash
└── verify_password(password: str, hash: str) → bool  # Timing-safe comparison
```

**Implementation**: `BcryptPasswordHasher` in infrastructure layer using `bcrypt` library with `asyncio.to_thread()`.

### AuthService (Application Service)

**Description**: Orchestrates sign-up and login flows.

```
AuthService
├── Dependencies:
│   ├── user_repository: UserRepository (ABC)
│   └── password_hasher: PasswordHasher (ABC)
├── sign_up(request: SignUpRequest) → User     # Creates local account
└── login(request: LoginRequest) → User | None # Authenticates local user
```

**Business Rules**:
- `sign_up`: Check email uniqueness across all providers, hash password, create user with `provider="local"`
- `login`: Lookup by `("local", email)`, verify password hash, return user or None
- `login`: On user-not-found, still perform dummy bcrypt check (timing attack prevention)
