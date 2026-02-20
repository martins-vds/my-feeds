# Feature Specification: User Sign-Up

**Feature Branch**: `002-sign-up`  
**Created**: 2026-02-20  
**Status**: Draft  
**Input**: User description: "i need a sign up feature"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Email/Password Registration (Priority: P1)

A new user visits the app and creates an account using their email address and a password. After signing up, they are immediately logged in and can start using the app (e.g., subscribing to RSS feeds).

**Why this priority**: This is the core sign-up flow — without it, no user can create an account via email/password. Currently only OAuth is available, which limits user acquisition.

**Independent Test**: Can be fully tested by navigating to the sign-up page, filling in email + password + name, submitting, and verifying the user is redirected to `/posts` with an active session.

**Acceptance Scenarios**:

1. **Given** a visitor on the sign-in page, **When** they click "Sign Up", **Then** they see a registration form with email, password, confirm password, and display name fields.
2. **Given** a visitor on the sign-up form, **When** they submit valid email, password (min 8 chars, at least one uppercase, one lowercase, one digit), matching confirm password, and a display name, **Then** an account is created, a session is established, and they are redirected to `/posts`.
3. **Given** a visitor on the sign-up form, **When** they submit an email that is already registered (as a local account), **Then** they see an error message "An account with this email already exists".
4. **Given** a visitor on the sign-up form, **When** they submit a password shorter than 8 characters or missing required character types, **Then** they see inline validation errors describing the password requirements.
5. **Given** a visitor on the sign-up form, **When** the password and confirm password do not match, **Then** they see an error "Passwords do not match".

---

### User Story 2 - Email/Password Login (Priority: P1)

An existing user who registered via email/password can log in using their credentials.

**Why this priority**: Without login, sign-up is useless. This is part of the same critical flow.

**Independent Test**: After creating a local account, log out, navigate to sign-in, enter email/password, and verify successful login.

**Acceptance Scenarios**:

1. **Given** the sign-in page, **When** an existing local user enters their email and password, **Then** a session is established and they are redirected to `/posts`.
2. **Given** the sign-in page, **When** a user enters an incorrect password, **Then** they see "Invalid email or password" (generic to prevent email enumeration).
3. **Given** the sign-in page, **When** a user enters a non-existent email, **Then** they see "Invalid email or password" (same generic message).

---

### User Story 3 - Seamless Coexistence with OAuth (Priority: P2)

The sign-up/sign-in page presents both OAuth buttons and email/password form, allowing users to choose their preferred authentication method.

**Why this priority**: Existing OAuth users must not be disrupted. Both methods must coexist cleanly.

**Independent Test**: Verify the sign-in page shows both OAuth buttons and email/password form. Verify an OAuth user can still log in normally.

**Acceptance Scenarios**:

1. **Given** the sign-in page, **When** a user views it, **Then** they see OAuth buttons (GitHub, Google, Microsoft) AND an email/password sign-in form with a link to sign-up.
2. **Given** a user who previously signed up via OAuth, **When** they try to sign up with the same email via email/password, **Then** they see "An account with this email already exists. Try signing in with GitHub/Google/Microsoft instead."

---

### Edge Cases

- What happens when the database is unreachable during sign-up? → Return HTTP 500 with a generic error.
- What happens if the user's email is mixed-case? → Emails are normalized to lowercase before storage.
- What happens if the session cookie is tampered with after sign-up? → Session validation rejects it (existing behavior).
- What happens if two users try to register the same email concurrently? → Database unique constraint on (provider, provider_id) prevents duplicates; second request gets an error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST allow new users to create an account with email, password, and display name.
- **FR-002**: System MUST validate email format (RFC 5322 basic) and reject duplicates for the "local" provider.
- **FR-003**: System MUST enforce password policy: minimum 8 characters, at least one uppercase letter, one lowercase letter, and one digit.
- **FR-004**: System MUST hash passwords using bcrypt before storage (never store plaintext).
- **FR-005**: System MUST authenticate local users by verifying email + password against stored hash.
- **FR-006**: System MUST issue the same session cookie for local auth as for OAuth (unified session management).
- **FR-007**: System MUST normalize email addresses to lowercase before storage and lookup.
- **FR-008**: System MUST return generic error messages for failed login attempts to prevent email enumeration.
- **FR-009**: System MUST add a `password_hash` field to the User entity for local accounts (nullable, since OAuth users won't have one).
- **FR-010**: System MUST extend the `provider` type to include `"local"` for email/password accounts.
- **FR-011**: Frontend MUST provide a sign-up page/form and integrate email/password login into the existing sign-in page.
- **FR-012**: System MUST add a database unique constraint on `(provider, provider_id)` to prevent duplicate accounts.

### Key Entities *(include if feature involves data)*

- **User**: Extended with `password_hash` (nullable string) and `provider` now includes `"local"`. For local users, `provider_id` is the email address.
- **SignUpRequest**: Value object containing email, password, display name for registration.
- **LoginRequest**: Value object containing email and password for authentication.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can complete email/password account creation and reach the posts page in under 30 seconds.
- **SC-002**: All existing OAuth login flows continue to work without modification.
- **SC-003**: Contract tests cover all new API endpoints (sign-up, local login).
- **SC-004**: Password is never stored or logged in plaintext — only bcrypt hash is persisted.
