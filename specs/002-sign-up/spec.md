# Feature Specification: Post-OAuth Sign-Up / Onboarding

**Feature Branch**: `002-sign-up`  
**Created**: 2026-02-20  
**Status**: Draft  
**Input**: User description: "when the user signs in, the user must complete a signup process if that user doesn't exist in the database"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New User Completes Sign-Up After First OAuth Login (Priority: P1)

A new user clicks an OAuth button (GitHub, Google, or Microsoft) on the sign-in page. After authenticating with the provider, the system detects this is their first visit. Instead of going straight to the app, the user is redirected to a sign-up form where they confirm/edit their display name and set their timezone. Once submitted, their account is fully created and they land on the posts page.

**Why this priority**: This is the entire feature — without it, new users are auto-created with defaults and get no onboarding.

**Independent Test**: Sign in with a new OAuth identity. Verify the user is redirected to the sign-up page (not `/posts`). Fill out the form and submit. Verify the user is now on `/posts` and their profile reflects the submitted values.

**Acceptance Scenarios**:

1. **Given** a new user who has never signed in, **When** they complete OAuth authentication, **Then** they are redirected to a sign-up page showing their OAuth-provided name and email, with editable display name and timezone fields.
2. **Given** the sign-up page after first OAuth login, **When** the user confirms/edits their display name, selects a timezone, and clicks "Complete Sign-Up", **Then** their user record is created in the database with the submitted values and they are redirected to `/posts`.
3. **Given** the sign-up page, **When** the user submits an empty display name, **Then** they see a validation error "Display name is required".
4. **Given** a new user on the sign-up page, **When** they try to navigate directly to `/posts` or any protected route, **Then** they are redirected back to the sign-up page because their account is not yet complete.

---

### User Story 2 - Returning User Signs In Normally (Priority: P1)

An existing user who has already completed sign-up clicks an OAuth button. The system finds their account in the database and sends them straight to the posts page — no sign-up form.

**Why this priority**: Existing users must not be disrupted. The sign-up flow should only appear for genuinely new users.

**Independent Test**: After completing sign-up once, log out. Sign in again with the same OAuth provider. Verify the user goes directly to `/posts` with no sign-up prompt.

**Acceptance Scenarios**:

1. **Given** a user who has previously completed sign-up, **When** they sign in via OAuth, **Then** they are redirected directly to `/posts` with no sign-up step.
2. **Given** a user who has previously completed sign-up, **When** the system processes their OAuth callback, **Then** the system looks up the existing record by `(provider, provider_id)` and returns it without modification.

---

### User Story 3 - Sign-Up Form Pre-populated from OAuth (Priority: P2)

The sign-up form is pre-populated with data from the OAuth provider (name, email) so the user doesn't have to retype information the provider already shared.

**Why this priority**: Improves UX by reducing friction. The sign-up should feel like a confirmation step, not a full form fill.

**Independent Test**: Sign in with GitHub (which provides name + email + avatar). Verify the sign-up form shows the name pre-filled and the email displayed (read-only). The user only needs to pick a timezone and optionally edit their name.

**Acceptance Scenarios**:

1. **Given** a new user who authenticated via GitHub, **When** the sign-up page loads, **Then** the display name field is pre-filled with the name from GitHub, and the email is shown as read-only context.
2. **Given** a new user who authenticated via Google, **When** the sign-up page loads, **Then** the timezone selector defaults to the browser's detected timezone.
3. **Given** a new user, **When** they edit the pre-filled display name to something different, **Then** the edited name is saved (not the OAuth-provided name).

---

### Edge Cases

- What happens if the user closes the browser during sign-up? → On next OAuth login, the system still doesn't find a user → sign-up form appears again (OAuth data is re-fetched from provider).
- What happens if the OAuth provider doesn't return a name? → Display name field is empty; user must fill it in.
- What happens if the OAuth provider doesn't return an email? → The system should reject the OAuth login and show an error (email is required).
- What happens if the user navigates to `/signup` without an active OAuth session? → Redirect to `/signin`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST NOT auto-create a user record on first OAuth login. Instead, OAuth data MUST be held temporarily until sign-up is complete.
- **FR-002**: System MUST redirect new users to a sign-up page after OAuth callback where they confirm their profile.
- **FR-003**: Sign-up form MUST collect: display name (editable, pre-filled from OAuth), timezone (selectable, defaulting to browser-detected).
- **FR-004**: Sign-up form MUST display as read-only context: email (from OAuth), avatar (from OAuth if available).
- **FR-005**: System MUST validate that display name is non-empty (1-255 chars after trimming).
- **FR-006**: After sign-up form submission, system MUST create the user record and establish a full session.
- **FR-007**: System MUST redirect returning users (who exist in DB) directly to the app — no sign-up step.
- **FR-008**: Protected routes MUST block access for users who have not completed sign-up (i.e., no user record in DB yet).
- **FR-009**: System MUST store pending OAuth data in the session cookie between OAuth callback and sign-up completion, with a 15-minute expiration after which the pending data is discarded.
- **FR-010**: System MUST add a database unique constraint on `(provider, provider_id)` to prevent duplicate accounts.
- **FR-011**: Frontend MUST detect the browser timezone and pre-select it in the sign-up form.

### Non-Functional Requirements

- **NFR-001**: Sign-up completion (`POST /auth/complete-signup`) MUST respond within 200ms at p95 (single DB insert, no expensive hashing).
- **NFR-002**: Session cookie attributes MUST include `HttpOnly`, `SameSite=Lax`, and `Secure` (in production) — inherited from existing session mechanism.
- **NFR-003**: All cookie data MUST remain under 4,096 bytes including pending OAuth fields (~400 bytes).

### Key Entities *(include if feature involves data)*

- **User**: Unchanged schema. Created only after sign-up form submission (not during OAuth callback).
- **PendingSignUp**: Temporary session data holding OAuth info (provider, provider_id, email, name, avatar_url) until sign-up is completed. Not persisted to database.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: New users must complete sign-up (confirm name + pick timezone) before accessing any protected page.
- **SC-002**: Returning users experience zero change — OAuth login goes straight to `/posts`.
- **SC-003**: Sign-up form is pre-populated with OAuth-provided data; user only needs to confirm/edit and submit.
- **SC-004**: Contract tests cover the modified OAuth callback flow and new sign-up completion endpoint.
