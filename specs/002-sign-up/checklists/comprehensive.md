# Comprehensive Requirements Quality Checklist: Post-OAuth Sign-Up

**Purpose**: Validate completeness, clarity, and consistency of requirements across spec, plan, research, data model, and API contracts for the post-OAuth sign-up/onboarding feature.
**Created**: 2026-02-20
**Feature**: [spec.md](../spec.md)
**Depth**: Standard (PR review)
**Audience**: Reviewer

## Requirement Completeness

- [x] CHK001 - Is the lookup key for identifying returning vs new users explicitly defined? ✅ Fixed: FR-007 now specifies `(provider, provider_id)` composite key. US2 AC2.2 also updated.
- [x] CHK002 - Are requirements defined for rejecting OAuth logins when the provider does not return an email? ✅ Fixed: Added FR-012 — reject OAuth login if no email, redirect to `/signin` with error.
- [x] CHK003 - Are session cookie security attributes (HttpOnly, SameSite, Secure, Path, Domain) specified as functional requirements? ✅ Fixed: NFR-002 specifies HttpOnly, SameSite=Lax, Secure (production).
- [x] CHK004 - Is the 15-minute TTL on pending sign-up data documented as a spec-level requirement? ✅ Fixed: FR-009 now includes "with a 15-minute expiration after which the pending data is discarded."
- [x] CHK005 - Are loading and submission state requirements defined for the sign-up form? ✅ Fixed: Added FR-013 — disable submit button and show loading indicator during submission.
- [x] CHK006 - Are success/error feedback requirements specified for the sign-up form? ✅ Resolved: FR-005 specifies inline validation. US1 AC1.3 specifies error message. FR-014 handles 409. Standard MUI TextField error states used.
- [x] CHK007 - Are sign-up page layout requirements specified? ✅ Accepted: Layout is implementation discretion using MUI components. Form elements are defined (FR-003, FR-004). Not a spec-level concern for a standard form.
- [x] CHK008 - Are accessibility requirements defined for the sign-up form? ✅ Accepted: MUI components provide built-in ARIA attributes, keyboard navigation, and focus management. No custom accessibility requirements needed beyond standard MUI usage.
- [x] CHK009 - Are mobile/responsive design requirements specified? ✅ Accepted: Constitution Principle V (PWA-First) applies project-wide. MUI components are responsive by default. No sign-up-specific responsive requirements needed.
- [x] CHK010 - Is the timezone fallback to "UTC" when browser detection fails documented as a requirement? ✅ Fixed: FR-011 now specifies fallback to `"UTC"` if detection returns undefined or unrecognized value.

## Requirement Clarity

- [x] CHK011 - Is "sign-up page" clarified as a full page, modal, or inline component? ✅ Fixed: FR-002 now says "dedicated full-page sign-up form."
- [x] CHK012 - Is "timezone (selectable)" quantified with a specific UI pattern? ✅ Fixed: FR-003 now specifies "searchable `Autocomplete` with ~400 IANA zones."
- [x] CHK013 - Is "read-only context" for email and avatar defined with specific visual treatment? ✅ Fixed: FR-004 now specifies "email (plain text `Typography`), avatar (`Avatar` component; when absent, render MUI default avatar with initials or generic icon)."
- [x] CHK014 - Is the fallback list for `Intl.supportedValuesOf('timeZone')` sufficiently specified? ✅ Accepted: Research R5 documents the approach. Tasks T019-T020 specify implementation. Static fallback sourced from IANA at build time — maintenance is low-risk for a personal app.
- [x] CHK015 - Is display name validation trigger defined? ✅ Fixed: FR-005 now says "validate on form submission." Inline error shown after submit attempt.
- [x] CHK016 - Are the exact redirect targets after sign-up completion unambiguous? ✅ Fixed: FR-006 now says "then redirect to `/posts`."
- [x] CHK017 - Is trimming defined and responsibility assigned? ✅ Fixed: FR-005 now says "Both frontend (inline error) and backend MUST trim and validate." OpenAPI description updated to document server-side trim as authoritative.

## Requirement Consistency

- [x] CHK018 - FR-009 says "server-side" but Research R1 uses client-side cookie. ✅ Fixed: FR-009 reworded to "session cookie" — conflict resolved.
- [x] CHK019 - Does PendingProfile exclude provider_id and pending_created_at intentionally? ✅ Accepted: Yes, intentional. `provider_id` is internal (no frontend use). `pending_created_at` is server TTL validation only. PendingProfile is the frontend-facing projection.
- [x] CHK020 - Does the User response schema align with data-model.md? ✅ Fixed: `timezone` added to OpenAPI User schema. Other omissions (notifications_enabled, created_at, updated_at) are intentional — `/auth/me` returns a lightweight profile, not the full entity.
- [x] CHK021 - Is `/auth/me` three-state response consistent across artifacts? ✅ Verified: spec FR-002 (redirect), research R2 (three-state table), and contracts (oneOf AuthStatus/PendingSignUpStatus + 401) are all consistent.
- [x] CHK022 - Is CompleteSignUpRequest schema consistent re: trimming? ✅ Fixed: OpenAPI name description now documents that server trims before validation and that server-side trim+validate is authoritative.

## Acceptance Criteria Quality

- [x] CHK023 - Can SC-001 be objectively measured? ✅ Fixed: FR-008 now enumerates protected routes: "all routes wrapped in `ProtectedRoute` — currently `/posts`, `/posts/:id`, `/feeds`, `/settings`."
- [x] CHK024 - Can SC-003 be verified across providers? ✅ Accepted: SC-003 tests pre-population from whatever the provider returns. If a provider omits `name`, the field is empty (edge case documented). Provider-specific variations are tested via contract tests with different mock profiles.
- [x] CHK025 - Does SC-004 enumerate specific test scenarios? ✅ Fixed: SC-004 now lists specifics: "new-user → pending cookie, returning-user → full session, valid, empty name, invalid timezone, no pending, expired pending, duplicate user."
- [x] CHK026 - Is timezone default testable in CI? ✅ Accepted: Playwright can mock `Intl.DateTimeFormat` via `page.addInitScript()`. The UTC fallback is testable by mocking undefined return. No real browser timezone needed.

## Scenario Coverage

- [x] CHK027 - Multi-tab sign-up scenario. ✅ Fixed: Edge case added — first submission succeeds, second gets 409. FR-014 added to handle 409 by redirecting to `/signin`.
- [x] CHK028 - Pending user re-authenticates with different provider. ✅ Fixed: Edge case added — new OAuth data overwrites the pending cookie. Sign-up proceeds with the new provider identity.
- [x] CHK029 - Frontend handling of 409 Conflict. ✅ Fixed: FR-014 added — redirect to `/signin`.
- [x] CHK030 - Pending user logout. ✅ Fixed: Edge case added — pending cookie is cleared on logout, user redirected to `/signin`.
- [x] CHK031 - Deep-linking behavior. ✅ Accepted: Out of scope for this feature. Current behavior: all protected routes redirect to `/signin` for unauthenticated users. Post-sign-up always lands on `/posts` (FR-006). Deep-link preservation would be a separate feature.
- [x] CHK032 - Provider returns different data on re-auth. ✅ Accepted: By design, each OAuth callback fetches fresh data from the provider. If user hasn't completed sign-up, the new data overwrites the pending cookie (CHK028). If already signed up, returning-user flow ignores new profile data.

## Edge Case Coverage

- [x] CHK033 - Tampered/invalid JSON pending cookie. ✅ Fixed: Edge case added — treat as no session, discard cookie, redirect to `/signin`. Task T022 covers implementation.
- [x] CHK034 - Clock skew (pending_created_at in the future). ✅ Fixed: Edge case added — treat as expired, discard cookie, redirect to `/signin`.
- [x] CHK035 - Recovery path for duplicate rows in migration. ✅ Fixed: Edge case added — migration aborts with clear error, admin must manually resolve duplicates before re-running.
- [x] CHK036 - Avatar placeholder when provider doesn't return one. ✅ Fixed: FR-004 now specifies "render MUI default avatar with user initials or generic icon."
- [x] CHK037 - `Intl.DateTimeFormat` returns undefined. ✅ Fixed: FR-011 now specifies fallback to `"UTC"` for undefined or unrecognized values.

## Non-Functional Requirements

- [x] CHK038 - Rate limiting for POST /auth/complete-signup. ✅ Accepted: Single-user personal app (per plan.md Scale/Scope). Existing infrastructure has no rate limiting on any endpoint. Adding rate limiting for one endpoint is disproportionate. Can be added later if scale changes.
- [x] CHK039 - CSRF protection for POST /auth/complete-signup. ✅ Accepted: The app uses cookie-based auth with `SameSite=Lax` (NFR-002), which mitigates CSRF for state-changing requests. The endpoint also requires a valid pending cookie that can only be set by the backend callback. No additional CSRF tokens needed for this architecture.
- [x] CHK040 - PII logging requirements. ✅ Fixed: Added NFR-005 — PII (email, name) MUST NOT be logged at INFO or above. Debug may include provider/provider_id but not email/name.

## Dependencies & Assumptions

- [x] CHK041 - Do all three OAuth providers always return email? ✅ Resolved: GitHub may hide email if user sets it private. FR-012 handles this — reject OAuth login if no email. Research R1 states email is required in pending data. Edge case documented.
- [x] CHK042 - Does `Intl.supportedValuesOf` browser support meet target matrix? ✅ Accepted: Research R5 documents support (Chrome 93+, Firefox 93+, Safari 15.4+). Tasks T020 includes a static IANA fallback for older browsers. PWA target (modern evergreen browsers) is well within support range.
- [x] CHK043 - Is `zoneinfo.available_timezones()` backend dependency documented? ✅ Resolved: data-model.md CompleteSignUpRequest validation rules specify `zoneinfo.available_timezones()`. It's Python stdlib (3.9+), not an external dependency. Task T010 references it.
- [x] CHK044 - Cookie stays under 4,096 bytes? ✅ Resolved: NFR-003 sets the limit. Research R1 estimates ~350-400 bytes. Even with long avatar URLs (~200 chars) and names (~100 chars), total remains well under 4KB.
- [x] CHK045 - Zero new dependencies traceable? ✅ Fixed: Added NFR-004 — "Zero new Python or JavaScript dependencies." Quickstart.md also states this. Task T025 validates it.

## Notes

- Check items off as completed: `[x]`
- Add comments or findings inline beneath each item
- Items marked `[Gap]` indicate missing requirements that should be added to spec.md
- Items marked `[Conflict]` require resolution before implementation
- Items marked `[Assumption]` should be validated and documented
- Reference format: `[Spec §FR-XXX]` = spec.md, `[Research §RX]` = research.md, `[Contracts]` = openapi.yaml, `[Data Model]` = data-model.md
