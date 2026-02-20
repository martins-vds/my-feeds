# Research: User Sign-Up Feature

**Feature**: 002-sign-up  
**Date**: 2026-02-20  
**Status**: Complete

## R1: Password Hashing Library for Async Python

**Decision**: Use `bcrypt==5.0.0` with `asyncio.to_thread()` to avoid blocking the Quart event loop.

**Rationale**: `bcrypt` is actively maintained (Rust-backed since 4.1+), has pre-built wheels for Python 3.12+, and is the industry standard for password hashing. `passlib` is effectively abandoned (last release 2020, throws deprecation warnings on Python 3.12+). `argon2-cffi` is technically superior but adds unnecessary CFFI dependency for this use case.

**Alternatives considered**:
- `passlib[bcrypt]` — abandoned, not viable on Python 3.12+
- `argon2-cffi` — good but overkill; adds CFFI build dependency
- `hashlib.scrypt` — built-in but lacks conveniences (no cost factor in hash, manual salt management)

**Implementation notes**:
- Cost factor: **12** (library default, OWASP-compliant, ~250ms per hash)
- Must use `asyncio.to_thread()` for both hashing and verification to prevent blocking the event loop
- bcrypt truncates input at 72 bytes — enforce max password length of 128 characters at validation layer

## R2: Password Validation Policy

**Decision**: Enforce minimum 8 characters with at least one uppercase, one lowercase, and one digit (per spec FR-003). Cap maximum at 128 characters.

**Rationale**: NIST SP 800-63B (2024) actually recommends against composition rules in favor of length-only + blocklist. However, the spec's FR-003 and acceptance scenarios explicitly require these character class rules. Following the spec as written for MVP; can revisit post-MVP.

**Alternatives considered**:
- NIST-pure approach (length only + blocklist) — better in theory, but contradicts spec
- `zxcvbn` strength estimation — heavy dependency, overkill for MVP
- Common password blocklist (HIBP top 100k) — good idea long-term, deferred

## R3: OAuth and Local Auth Coexistence

**Decision**: Add `provider="local"` with `provider_id=lowercase_email`. No automatic account linking. Show informative error if email already exists under a different provider.

**Rationale**: Using email as `provider_id` for local accounts is natural — it's the login identifier and avoids extra lookups. Automatic account linking is dangerous without email verification (attacker could claim any email). The spec explicitly requires showing "try signing in with [provider] instead" for duplicate emails.

**Alternatives considered**:
- `provider_id = UUID` for local accounts — adds no value; still need email lookup
- Automatic account linking by email — security risk without verification
- Separate `credentials` table — over-engineered for 4 providers; can refactor later
- Allow both OAuth and local for same email — causes confusion, data duplication

## R4: Security — Rate Limiting

**Decision**: Add basic in-memory rate limiting on `/auth/signup` (10/min per IP) and `/auth/login` (5/min per IP).

**Rationale**: The codebase currently has zero rate limiting. Auth endpoints are the most critical to protect. In-memory rate limiting is sufficient for a single-process MVP. Can migrate to `quart-rate-limiter` or Redis-backed solution later.

**Alternatives considered**:
- Redis-backed rate limiting — adds dependency; not warranted for MVP
- CAPTCHA on sign-up — adds UX friction and external dependency; deferred
- No rate limiting — unacceptable for auth endpoints

## R5: Security — Timing Attack Prevention

**Decision**: Perform a dummy `bcrypt.checkpw()` against a pre-computed hash when the user is not found, so login response times are constant regardless of email existence.

**Rationale**: `bcrypt.checkpw()` is already timing-safe for the comparison itself. But skipping bcrypt entirely for nonexistent users creates a measurable timing difference (~250ms) that reveals email existence. The dummy check eliminates this side channel.

**Alternatives considered**:
- Skip the dummy check — creates timing oracle for email enumeration
- Return error before hash check — same timing leak

## R6: Security — Email Enumeration Prevention

**Decision**: Login returns generic "Invalid email or password" for all failures. Sign-up reveals email existence (with provider hint) — acceptable tradeoff per spec.

**Rationale**: Login must not distinguish between wrong email and wrong password (spec Stories 2.2, 2.3). Sign-up inherently reveals email existence when preventing duplicates — this is an accepted tradeoff. OWASP acknowledges this for consumer apps.

**Alternatives considered**:
- Always return 200 on sign-up and send verification email — sophisticated but overkill for MVP
- Hide all email existence — impossible while preventing duplicate accounts

## R7: Session Management

**Decision**: Reuse existing `SessionManager.create_session()` for local auth. Fresh session cookie on sign-up (same pattern as OAuth callback).

**Rationale**: Existing session infrastructure already creates fresh cookies on authentication. No session fixation risk. Unified session management means local and OAuth users are indistinguishable after login.

**Alternatives considered**:
- Separate session mechanism for local auth — unnecessary complexity
- JWT tokens instead of cookies — would require rewriting existing OAuth session handling

## R8: Database Schema Changes

**Decision**: Add nullable `password_hash` column (String 255) to users table. Add composite unique constraint on `(provider, provider_id)`.

**Rationale**: `password_hash` is nullable because OAuth users don't have passwords. The unique constraint on `(provider, provider_id)` is currently missing despite being mentioned in model comments — this is an existing bug that should be fixed regardless. Alembic migration required.

**Alternatives considered**:
- Non-nullable `password_hash` with empty string default — violates DDD (misleading for OAuth users)
- Separate `local_credentials` table — over-engineered for MVP

## Summary of All Decisions

| # | Decision | Key Rationale |
|---|---|---|
| R1 | `bcrypt==5.0.0` + `asyncio.to_thread()` | Active, Rust-backed, spec-mandated |
| R2 | 8+ chars, uppercase, lowercase, digit, max 128 | Matches spec FR-003 |
| R3 | `provider="local"`, `provider_id=email`, no account linking | Simple, secure, spec-aligned |
| R4 | In-memory rate limiting (5/min login, 10/min signup) | Critical gap, minimal dependency |
| R5 | Dummy bcrypt check on user-not-found | Prevents timing-based enumeration |
| R6 | Generic login errors, allow sign-up email hints | Spec-required behavior |
| R7 | Reuse SessionManager, fresh cookie on sign-up | Unified, no fixation risk |
| R8 | Nullable `password_hash`, composite unique constraint | Clean schema extension |
