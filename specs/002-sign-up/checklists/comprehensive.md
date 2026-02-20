# Comprehensive Requirements Quality Checklist: Post-OAuth Sign-Up

**Purpose**: Validate completeness, clarity, and consistency of requirements across spec, plan, research, data model, and API contracts for the post-OAuth sign-up/onboarding feature.
**Created**: 2026-02-20
**Feature**: [spec.md](../spec.md)
**Depth**: Standard (PR review)
**Audience**: Reviewer

## Requirement Completeness

- [ ] CHK001 - Is the lookup key for identifying returning vs new users explicitly defined? Spec says "user exists in the database" but doesn't specify lookup fields (provider + provider_id? email? both?) [Completeness, Gap]
- [ ] CHK002 - Are requirements defined for rejecting OAuth logins when the provider does not return an email? Edge cases mention it but no FR covers this mandatory behavior. [Completeness, Gap]
- [ ] CHK003 - Are session cookie security attributes (HttpOnly, SameSite, Secure, Path, Domain) specified as functional requirements? The OpenAPI doc mentions HttpOnly in a header description but spec.md FRs are silent. [Completeness, Gap]
- [ ] CHK004 - Is the 15-minute TTL on pending sign-up data documented as a spec-level requirement? FR-009 says "store pending OAuth data in the session" but the TTL only appears in research R1. [Completeness, Spec §FR-009]
- [ ] CHK005 - Are loading and submission state requirements defined for the sign-up form (e.g., button disabled during submit, loading indicator)? [Completeness, Gap]
- [ ] CHK006 - Are success/error feedback requirements specified for the sign-up form (inline field errors, form-level banners, toast notifications)? [Completeness, Gap]
- [ ] CHK007 - Are sign-up page layout requirements specified (element ordering, grouping, visual hierarchy)? [Completeness, Gap]
- [ ] CHK008 - Are accessibility requirements (keyboard navigation, screen reader labels, ARIA attributes, focus management) defined for the sign-up form and its interactive elements? [Completeness, Gap]
- [ ] CHK009 - Are mobile/responsive design requirements specified for the sign-up page? [Completeness, Gap]
- [ ] CHK010 - Is the timezone fallback to "UTC" when browser detection fails documented as a requirement? Research R5 mentions it but no FR covers it. [Completeness, Gap]

## Requirement Clarity

- [ ] CHK011 - Is "sign-up page" clarified as a full page, modal, or inline component? [Clarity, Spec §FR-002]
- [ ] CHK012 - Is "timezone (selectable)" quantified with a specific UI pattern (dropdown, searchable autocomplete, grouped list)? With ~400 IANA zones, the widget choice materially affects UX. [Clarity, Spec §FR-003]
- [ ] CHK013 - Is "read-only context" for email and avatar defined with specific visual treatment (greyed-out input, plain text label, info card)? [Clarity, Spec §FR-004]
- [ ] CHK014 - Is the fallback list for `Intl.supportedValuesOf('timeZone')` sufficiently specified? R5 says "static fallback list of ~400 IANA zones" without defining the source, format, or maintenance strategy. [Clarity, Research §R5]
- [ ] CHK015 - Is display name validation trigger defined — on blur, on submit, or real-time keystroke? [Clarity, Spec §FR-005]
- [ ] CHK016 - Are the exact redirect targets after sign-up completion unambiguous? User Story 1 says `/posts`, FR-006 says "establish a full session" without specifying the redirect destination. [Clarity, Spec §FR-006]
- [ ] CHK017 - Is "trimming leading/trailing whitespace" for display name defined in the spec or only in the data model? Is it the frontend's or backend's responsibility (or both)? [Clarity, Spec §FR-005]

## Requirement Consistency

- [ ] CHK018 - FR-009 says "store pending OAuth data in the session (server-side)" but Research R1 decides data is stored in a client-side cookie. Is this a conflict or imprecise language? [Conflict, Spec §FR-009 vs Research §R1]
- [ ] CHK019 - Does the PendingProfile schema in the OpenAPI contract align with the PendingSignUp fields in data-model.md? The contract excludes provider_id and pending_created_at — is this intentional? [Consistency, Contracts vs Data Model]
- [ ] CHK020 - Does the User response schema in the OpenAPI contract align with the User entity in data-model.md? The contract User omits timezone, notifications_enabled, created_at, and updated_at. [Consistency, Contracts vs Data Model]
- [ ] CHK021 - Is the `/auth/me` three-state response documented consistently across spec.md FR-002, research.md R2, and contracts/openapi.yaml? [Consistency]
- [ ] CHK022 - Is the CompleteSignUpRequest schema consistent between the OpenAPI contract (minLength: 1, maxLength: 255) and the data model ("1-255 chars after trimming")? Trimming before or after length validation matters. [Consistency, Contracts vs Data Model]

## Acceptance Criteria Quality

- [ ] CHK023 - Can SC-001 ("must complete sign-up before accessing any protected page") be objectively measured? Is "any protected page" enumerated or defined by a pattern rule? [Measurability, Spec §SC-001]
- [ ] CHK024 - Can SC-003 ("form is pre-populated with OAuth-provided data") be verified when different providers return different fields (e.g., GitHub provides avatar, Google may not provide the same fields)? [Measurability, Spec §SC-003]
- [ ] CHK025 - Does SC-004 ("contract tests cover the modified OAuth callback flow and new sign-up completion endpoint") enumerate the specific contract test scenarios required? [Measurability, Spec §SC-004]
- [ ] CHK026 - Is User Story 3 Scenario 2 ("timezone defaults to browser's detected timezone") testable in CI environments without a real browser timezone? [Measurability]

## Scenario Coverage

- [ ] CHK027 - Are requirements defined for the multi-tab scenario where a user opens the sign-up form in multiple tabs and submits from both? [Coverage, Gap]
- [ ] CHK028 - Are requirements defined for a pending user who navigates to `/signin` and re-authenticates with a DIFFERENT OAuth provider than the original? [Coverage, Gap]
- [ ] CHK029 - Are requirements defined for what the frontend should do when receiving a 409 Conflict from POST /auth/complete-signup (another tab already completed sign-up)? [Coverage, Gap]
- [ ] CHK030 - Are requirements defined for whether a pending user can log out, and what happens to the pending cookie on logout? [Coverage, Gap]
- [ ] CHK031 - Are requirements defined for deep-linking behavior? (User bookmarks a protected URL, signs in for the first time, completes sign-up — do they land on the bookmarked URL or always `/posts`?) [Coverage, Gap]
- [ ] CHK032 - Are requirements defined for what happens when the OAuth provider returns different profile data on re-authentication (e.g., user changed their name on GitHub between two sign-in attempts)? [Coverage, Gap]

## Edge Case Coverage

- [ ] CHK033 - Is the behavior defined when the pending cookie has been tampered with or contains invalid JSON? [Edge Case, Gap]
- [ ] CHK034 - Is the behavior defined when `pending_created_at` has clock skew (timestamp in the future relative to the server)? [Edge Case, Gap]
- [ ] CHK035 - Is the recovery path documented when the unique constraint migration finds duplicate `(provider, provider_id)` rows in existing data? The migration aborts, but are admin recovery steps specified? [Edge Case, Spec §FR-010]
- [ ] CHK036 - Is the avatar placeholder behavior defined when the OAuth provider doesn't return an avatar URL? FR-004 says "avatar (from OAuth if available)" but not what renders when absent. [Edge Case, Spec §FR-004]
- [ ] CHK037 - Is the behavior defined when `Intl.DateTimeFormat().resolvedOptions().timeZone` returns undefined or an unrecognized value? [Edge Case, Research §R5]

## Non-Functional Requirements

- [ ] CHK038 - Are rate limiting requirements specified for POST /auth/complete-signup to prevent automated abuse? [Non-Functional, Gap]
- [ ] CHK039 - Is CSRF protection addressed for the POST /auth/complete-signup endpoint? [Non-Functional, Gap]
- [ ] CHK040 - Are requirements defined for what data should be logged vs redacted during the sign-up flow (PII concerns: email, name, provider_id)? [Non-Functional, Gap]

## Dependencies & Assumptions

- [ ] CHK041 - Is the assumption validated that all three OAuth providers (GitHub, Google, Microsoft) always return an email address? Are there provider configurations or user privacy settings where email may be absent? [Assumption]
- [ ] CHK042 - Is the assumption that `Intl.supportedValuesOf('timeZone')` browser support (Chrome 93+, Firefox 93+, Safari 15.4+) meets the project's target browser matrix documented? [Assumption, Research §R5]
- [ ] CHK043 - Is the dependency on `zoneinfo.available_timezones()` for backend timezone validation documented as a requirement? Research R5 covers only frontend detection. [Dependency, Gap]
- [ ] CHK044 - Is the assumption validated that the session cookie stays under 4,096 bytes with pending data across all OAuth providers (varying name lengths, avatar URL lengths)? [Assumption, Research §R1]
- [ ] CHK045 - Is the requirement traceable that no new Python or JavaScript dependencies are introduced? The quickstart states "zero new dependencies" but this isn't in the FRs. [Traceability, Gap]

## Notes

- Check items off as completed: `[x]`
- Add comments or findings inline beneath each item
- Items marked `[Gap]` indicate missing requirements that should be added to spec.md
- Items marked `[Conflict]` require resolution before implementation
- Items marked `[Assumption]` should be validated and documented
- Reference format: `[Spec §FR-XXX]` = spec.md, `[Research §RX]` = research.md, `[Contracts]` = openapi.yaml, `[Data Model]` = data-model.md
