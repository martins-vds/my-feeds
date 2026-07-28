---
description: "Task list for Read-Along Audio Highlighting (Word-Level Karaoke Sync)"
---

# Tasks: Read-Along Audio Highlighting (Word-Level Karaoke Sync)

**Input**: Design documents from `/specs/003-read-along-highlight/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/) (audio-api.md, tts-service.md, read-along-client.md, word-timings.schema.json)

**Tests**: INCLUDED — the constitution mandates Test-Driven Development (Principle III) and [quickstart.md](quickstart.md) is written test-first ("suites should exist and **fail** before implementation"). Write each test task first and confirm it is red before the matching implementation task.

**Organization**: Tasks are grouped by user story. User-story numbering matches [spec.md](spec.md): US1 = word-level highlight sync (P1), US2 = auto-scroll (P2), US3 = persisted toggles (P2), US4 = graceful fallback (P2), US5 = backfill/regenerate existing audio (P3).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: User story the task belongs to (US1–US5). Setup / Foundational / Polish tasks carry no story label.

## Path Conventions

Web app monorepo: `backend/` (Python 3.12 / Quart / DDD layers) + `frontend/` (TypeScript / React 18 / Vite / MUI). All paths below are repository-relative.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared types and styling tokens used by multiple frontend stories.

- [X] T001 [P] Add `WordTiming` interface (`{ text: string; startMs: number; durationMs: number }`) and add optional `wordTimings?: WordTiming[]` to `AudioInfo` in [frontend/src/types/index.ts](../../frontend/src/types/index.ts)
- [X] T002 [P] Add theme-aware `.ra-word` (layout-neutral) and `.ra-active` (WCAG AA ≥4.5:1 background+text in light and dark) highlight rules to the `MuiCssBaseline` `styleOverrides` in [frontend/src/theme.tsx](../../frontend/src/theme.tsx)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend capture → persist → serve pipeline so newly generated audio produces word timings and the audio API delivers them. Blocks US1 (needs served timings), US4 (needs correct omission), and US5 (regeneration reuses this path).

**⚠️ CRITICAL**: No user story work can be validated end-to-end until this phase is complete.

### Tests for Foundational (write first, expect red) ⚠️

- [X] T003 [P] Unit tests for timing capture in [backend/tests/unit/test_tts_service.py](../../backend/tests/unit/test_tts_service.py): mock `edge_tts.Communicate.stream` async iterator → assert `WordBoundary` chunks map to ordered `WordTiming` (source-token text, `offset//10_000` ms, `duration//10_000` ms); empty/whitespace text still raises `TTSError`; zero boundaries → empty list with MP3 still written; `strip_html` inserts a space at tag boundaries (`for<code>x</code>loop` → `for x loop`) and collapses whitespace; `MockTTSService` returns deterministic ordered non-overlapping timings
- [X] T004 [P] Unit tests for the sidecar store in `backend/tests/unit/test_word_timings_store.py` (NEW): `get_timings_path` mirrors the MP3 path with `.json`; `save_timings`/`load_timings`/`exists_timings`/`delete_timings` round-trip; corrupt/invalid-shape JSON → `load_timings` returns `None`; orphan `.json` (no live cache key) is reclaimed by cleanup
- [X] T005 [P] Extend contract tests in [backend/tests/contract/test_audio.py](../../backend/tests/contract/test_audio.py): READY response includes ordered `wordTimings` with `{text, startMs, durationMs}` when a sidecar exists; **omits** `wordTimings` entirely (never `null`/`[]`) when the sidecar is missing or corrupt; existing `status`/`url`/`postId`/`durationSeconds`/`format`, `401`, and `404` assertions still hold

### Implementation for Foundational

- [X] T006 [P] Create `WordTiming` frozen dataclass (`text: str`, `start_ms: int ≥ 0`, `duration_ms: int ≥ 0`, derived `end_ms`) in `backend/app/domain/audio/value_objects/word_timing.py` (NEW; add `value_objects/__init__.py` exporting it)
- [X] T007 Add abstract `synthesize_with_timings(text, output_path) -> list[WordTiming]` to the `TTSService` ABC (keep `synthesize` delegating and discarding timings) and change `strip_html` to replace each tag with a single space before whitespace collapse, in [backend/app/domain/audio/services/tts_service.py](../../backend/app/domain/audio/services/tts_service.py) (depends on T006)
- [X] T008 [P] Implement `synthesize_with_timings` in [backend/app/infrastructure/tts/edge_tts_service.py](../../backend/app/infrastructure/tts/edge_tts_service.py): iterate `communicate.stream()`, write `chunk["data"]` on `type == "audio"`, collect `type == "WordBoundary"` → `WordTiming(text=chunk["text"], start_ms=chunk["offset"]//10_000, duration_ms=chunk["duration"]//10_000)`; preserve the "produced no audio" empty-file guard (depends on T006, T007)
- [X] T009 [P] Implement `synthesize_with_timings` in [backend/app/infrastructure/tts/azure_tts.py](../../backend/app/infrastructure/tts/azure_tts.py): register a `synthesizer.synthesis_word_boundary` handler, collect events into ordered `WordTiming` (100-ns ticks → ms) for engine parity (depends on T006, T007)
- [X] T010 [P] Implement `synthesize_with_timings` in [backend/app/infrastructure/tts/mock_tts.py](../../backend/app/infrastructure/tts/mock_tts.py): produce deterministic synthetic timings from cleaned tokens (e.g. 300 ms/word, 50 ms gaps) while still writing a decodable silent MP3 (depends on T006, T007)
- [X] T011 [P] Add sidecar I/O to `AudioCacheManager` in [backend/app/infrastructure/tts/cache_manager.py](../../backend/app/infrastructure/tts/cache_manager.py): `get_timings_path`, atomic `save_timings` (temp + rename), `load_timings` (return `None` on missing/invalid), `exists_timings`, `delete_timings`; extend `cleanup_old_files`/orphan reclamation to remove `.json` in lockstep with `.mp3` (depends on T006)
- [X] T012 [P] Add `has_timings: bool = False` to the `Audio` domain entity in [backend/app/domain/audio/entities/audio.py](../../backend/app/domain/audio/entities/audio.py)
- [X] T013 [P] Add `has_timings BOOLEAN NOT NULL DEFAULT false` column to the SQLAlchemy audio model in [backend/app/infrastructure/persistence/models/audio.py](../../backend/app/infrastructure/persistence/models/audio.py)
- [X] T014 Create Alembic migration adding `audio.has_timings` (NOT NULL default false; existing rows → false) in `backend/migrations/versions/` (NEW revision; depends on T013)
- [X] T015 Map `has_timings` in `_to_entity` and `_to_model` (read/write from the column, not hard-coded) in [backend/app/infrastructure/persistence/repositories/audio_repository.py](../../backend/app/infrastructure/persistence/repositories/audio_repository.py) (depends on T012, T013)
- [X] T016 Update `AudioService._generate_audio` to call `tts.synthesize_with_timings(...)`, and when timings are non-empty write the sidecar payload `{schemaVersion:1, voiceId, words:[{text,startMs,durationMs}]}` and set `audio.has_timings = True` (else `False`), in [backend/app/application/services/audio_service.py](../../backend/app/application/services/audio_service.py) (depends on T006, T011, T012)
- [X] T017 Include `wordTimings` in the READY response of `GET /api/posts/{postId}/audio` — read the sidecar via `cache.load_timings`, emit the ordered `{text, startMs, durationMs}` array when valid, omit the field entirely otherwise — in [backend/app/api/routes/audio.py](../../backend/app/api/routes/audio.py) (depends on T011, T016)

**Checkpoint**: New audio generation captures and persists timings; the audio API serves `wordTimings` (or omits it). Foundation ready — user stories can begin.

---

## Phase 3: User Story 1 - Follow Along With Word-Level Highlighting (Priority: P1) 🎯 MVP

**Goal**: While TTS audio plays on the Post Detail page, highlight the single spoken word (title then body) derived from media time on a `requestAnimationFrame` cadence; hold across gaps, jump on seek, stay aligned at 0.5x–3x, clear on end.

**Independent Test**: Open a post whose audio has timings, press play → exactly one word highlights at a time, matches the voice, advances continuously; pause freezes, resume continues, end clears; seek/scrub jumps the highlight; speed changes do not drift.

### Tests for User Story 1 (write first, expect red) ⚠️

- [X] T018 [P] [US1] Vitest for alignment in `frontend/src/utils/__tests__/alignTimings.test.ts` (NEW): `normalizeToken` (case, edge punctuation, `don't`, `2024`, hyphenates); perfect match → `enabled` + full map; display with extra non-spoken tokens → still `enabled`, spoken tokens mapped; title-then-body + `". "` seam form one continuous sequence
- [X] T019 [P] [US1] Vitest for word wrapping in `frontend/src/utils/__tests__/wrapWords.test.ts` (NEW): N words → N indexed `.ra-word` spans with `dataset.raIndex === String(i)`; `for<code>x</code>loop` → 3 spans; idempotent second call adds no duplicates; anchor text wrapped without losing `href`/`target`/`rel`
- [X] T020 [P] [US1] Vitest for the highlighter in `frontend/src/hooks/__tests__/useReadAlong.test.ts` (NEW; fake timers, mocked rAF & `matchMedia`): active index = greatest `i` with `startMs[i] ≤ mediaMs`; hold across gaps; `-1` before first; clears after last / on `ended`; same media time → same active word at 0.5x/1x/3x; at most one active span
- [X] T021 [US1] Playwright in `frontend/playwright/read-along.spec.ts` (NEW): play a timing-backed post → a single word highlights and advances through title then body; pause holds; end clears

### Implementation for User Story 1

- [X] T022 [P] [US1] Create `frontend/src/utils/alignTimings.ts` (NEW): `normalizeToken` + `alignSpokenToDisplay(spoken, display)` linear greedy walk (display side may skip non-spoken tokens), returning `{ enabled, timingToDisplay: Int32Array, matchedRatio }` with `enabled = matchedRatio ≥ 0.9 && !divergedPastRun`
- [X] T023 [P] [US1] Create `frontend/src/utils/wrapWords.ts` (NEW): `wrapWords(container, startIndex)` walks text nodes via `TreeWalker`, wraps each whitespace-delimited token in `<span class="ra-word" data-ra-index="N">`, idempotent (skips nodes already inside `.ra-word`), returns `{ count, elements }`; splits text nodes only (no new HTML → no XSS surface)
- [X] T024 [US1] Extend `useAudioPlayer` result with `wordTimings: WordTiming[] | null` (from the READY response, `null` when omitted), `getMediaElement(): HTMLAudioElement | null` (stable accessor, no re-render), and `isPlaying: boolean`, in [frontend/src/hooks/useAudioPlayer.ts](../../frontend/src/hooks/useAudioPlayer.ts)
- [X] T025 [US1] Create `frontend/src/hooks/useReadAlong.ts` (NEW): build title++body display tokens, run `alignSpokenToDisplay` up-front, wrap words once when eligible, and on a `requestAnimationFrame` loop while playing read `getMediaElement().currentTime*1000`, compute the active timing index, map to a display span, and toggle `.ra-active` on only the outgoing/incoming span (O(1)); accept `highlightEnabled`/`autoScrollEnabled` args and return `{ highlightingActive }` (depends on T022, T023, T024)
- [X] T026 [P] [US1] Expose the rendered body container ref (via `forwardRef` or a `containerRef` prop; sanitization unchanged) in [frontend/src/components/PostContent.tsx](../../frontend/src/components/PostContent.tsx)
- [X] T027 [US1] Convert `AudioPlayer` to a controlled presentational component receiving player state/handlers via props (visual/player behavior unchanged for timing-less posts) in [frontend/src/components/AudioPlayer.tsx](../../frontend/src/components/AudioPlayer.tsx) (depends on T024)
- [X] T028 [US1] Lift `useAudioPlayer` into [frontend/src/pages/posts/PostDetailPage.tsx](../../frontend/src/pages/posts/PostDetailPage.tsx): own player state, hold `titleRef` (wrap the `<Typography>` title) and `contentRef`, pass player props to `AudioPlayer`, and mount `useReadAlong({ timings, getMediaElement, isPlaying, titleRef, contentRef, highlightEnabled: true, autoScrollEnabled: false })` (depends on T024, T025, T026, T027)

**Checkpoint**: US1 is fully functional — word-level highlighting tracks the voice through play/pause/seek/speed/end on posts with timings. MVP deliverable.

---

## Phase 4: User Story 2 - Auto-Scroll Keeps the Active Word in View (Priority: P2)

**Goal**: While playing, keep the active word visible toward the center of the reading area using a comfort band, coalesced to ≤1 reposition per frame, respecting `prefers-reduced-motion`; never scroll while paused/stopped.

**Independent Test**: Play a long post without touching the page → it scrolls to keep the highlighted word visible; enable reduce-motion → word stays visible with instant (non-animated) repositioning; pause → no auto-scroll.

### Tests for User Story 2 (write first, expect red) ⚠️

- [X] T029 [P] [US2] Extend `frontend/src/hooks/__tests__/useReadAlong.test.ts`: auto-scroll fires only when the active span leaves the central comfort band, only while playing; `prefers-reduced-motion` → `behavior: "auto"` (instant); `autoScrollEnabled === false` → no `scrollIntoView`; ≤1 reposition per frame
- [X] T030 [US2] Extend `frontend/playwright/read-along.spec.ts`: long post auto-scrolls to keep the active word visible; emulated reduced-motion uses no smooth scroll; paused → no auto-scroll

### Implementation for User Story 2

- [X] T031 [US2] Add auto-scroll to `frontend/src/hooks/useReadAlong.ts`: on active-word change compare the span rect to a central comfort band; if outside, `scrollIntoView({ block: "center", behavior })` with `behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? "auto" : "smooth"` (live-updating listener); coalesce to one reposition per frame; only while playing and `autoScrollEnabled`
- [X] T032 [US2] Pass `autoScrollEnabled: true` into `useReadAlong` from [frontend/src/pages/posts/PostDetailPage.tsx](../../frontend/src/pages/posts/PostDetailPage.tsx)

**Checkpoint**: US1 and US2 both work — highlighting plus hands-free auto-scroll (motion-aware).

---

## Phase 5: User Story 3 - Independent, Persisted Toggles (Priority: P2)

**Goal**: Two independent, keyboard-operable switches ("Highlight while playing", "Auto-scroll while playing"), both default on, persisted per device in `localStorage`.

**Independent Test**: Turn auto-scroll off (highlight on) → words highlight but no scroll; turn highlight off → no highlighting; reload → toggles retain their values; operate both via keyboard with state announced to assistive tech.

### Tests for User Story 3 (write first, expect red) ⚠️

- [X] T033 [P] [US3] Vitest in `frontend/src/hooks/__tests__/useReadAlongPreferences.test.ts` (NEW): defaults to `true/true` when storage empty; persists each toggle independently to `readAlong.highlight` / `readAlong.autoScroll`; values survive re-mount (new session)
- [X] T034 [US3] Extend `frontend/playwright/read-along.spec.ts`: toggles persist across reload; highlight-off → no highlight regardless of auto-scroll; auto-scroll-off → highlight continues but no scroll; both switches keyboard-operable with on/off state exposed

### Implementation for User Story 3

- [X] T035 [P] [US3] Create `frontend/src/hooks/useReadAlongPreferences.ts` (NEW): `localStorage`-backed `highlight`/`autoScroll` booleans with setters, unset keys read as `true`, independent
- [X] T036 [P] [US3] Create `frontend/src/components/ReadAlongToggles.tsx` (NEW): two labelled MUI `Switch` controls ("Highlight while playing", "Auto-scroll while playing"), keyboard-operable, state exposed to assistive tech
- [X] T037 [US3] In [frontend/src/pages/posts/PostDetailPage.tsx](../../frontend/src/pages/posts/PostDetailPage.tsx), read `useReadAlongPreferences`, render `<ReadAlongToggles />` near the player, and pass `highlightEnabled`/`autoScrollEnabled` from prefs into `useReadAlong` (replacing the US1/US2 hardcoded values); toggling highlight off mid-play clears immediately (depends on T035, T036)

**Checkpoint**: US1–US3 work independently — highlighting, auto-scroll, and persistent independent controls.

---

## Phase 6: User Story 4 - Graceful Fallback When Timing Data Is Missing (Priority: P2)

**Goal**: Posts with missing, empty, corrupt, or <90%-aligned timings play normally with highlighting silently disabled up-front (no flash, no error); the player is byte-for-byte unchanged.

**Independent Test**: Open a post whose audio has no timings → audio plays normally, no highlighting, no error; a post that aligns <90% → highlighting stays off for the whole post (no wrong-word flashes).

### Tests for User Story 4 (write first, expect red) ⚠️

- [X] T038 [P] [US4] Extend `frontend/src/utils/__tests__/alignTimings.test.ts`: `<90%` aligned or a long consecutive-mismatch run → `enabled === false`
- [X] T039 [P] [US4] Extend `frontend/src/hooks/__tests__/useReadAlong.test.ts`: `timings` null/empty or `enabled === false` → `highlightingActive === false`, no wrapping performed, no DOM mutation, and no highlight ever appears then disappears
- [X] T040 [US4] Extend `frontend/playwright/read-along.spec.ts`: a no-timings post plays normally with no highlight and no error; player controls (play/pause/seek/speed/waveform) behave as today; toggles remain keyboard-operable

### Implementation for User Story 4

- [X] T041 [US4] In `frontend/src/hooks/useReadAlong.ts`, enforce the up-front eligibility decision: when `timings` is null/empty or `alignSpokenToDisplay` returns `enabled === false`, do no wrapping, run no rAF work, and leave the player inert (audio still plays) so no highlight ever flashes; verify the API-omission path (foundational T017) is treated identically to corrupt/misaligned

**Checkpoint**: US1–US4 work — read-along degrades safely to today's plain playback whenever timings are unusable.

---

## Phase 7: User Story 5 - Backfill Word Timings for Existing Audio (Priority: P3)

**Goal**: Regenerate pre-feature timing-less clips through the existing generation path by bumping the audio cache version and making the on-demand short-circuit and background-job selection timings-aware and idempotent; new audio keeps getting timings automatically.

**Independent Test**: Identify a pre-feature (`v1`) clip → after the version bump, the background job (or opening the post) regenerates it at the new key with a `<key>.json` sidecar and `has_timings = true`; re-running the backfill skips clips that already have timings, creates no duplicates, and never interrupts working playback.

### Tests for User Story 5 (write first, expect red) ⚠️

- [X] T042 [P] [US5] Extend [backend/tests/unit/test_audio_generation_job.py](../../backend/tests/unit/test_audio_generation_job.py): selection includes `audio.id IS NULL OR audio.has_timings = false`; clips with `has_timings = true` are skipped; content-non-empty filter, batch size, per-post commit, and `published_at DESC` ordering preserved; re-running is idempotent (no duplicate rows/files)
- [X] T043 [P] [US5] Extend [backend/tests/unit/test_audio_cache.py](../../backend/tests/unit/test_audio_cache.py): bumping `audio_cache_version` yields a different deterministic `cache_key` for the same text/voice
- [X] T044 [US5] Integration test in `backend/tests/integration/test_audio_backfill.py` (NEW): the timings-aware short-circuit returns cached only when both MP3 and sidecar exist and regenerates otherwise; backfill is idempotent (interrupted run re-derives the same key and overwrites, no duplicates) and does not disrupt a working clip
- [X] T045 [P] [US5] Extend [backend/tests/unit/test_audio_cache.py](../../backend/tests/unit/test_audio_cache.py) (or `test_word_timings_store.py`): orphaned `.json` sidecars from superseded (pre-bump) keys are reclaimed by `cleanup_old_files` in lockstep with orphan `.mp3`

### Implementation for User Story 5

- [X] T046 [US5] Add `audio_cache_version: str = "v2"` (env `AUDIO_CACHE_VERSION`) to [backend/app/config/settings.py](../../backend/app/config/settings.py) and pass it into `AudioCacheManager(cache_version=...)` from `create_cache_manager` in [backend/app/config/container.py](../../backend/app/config/container.py)
- [X] T047 [US5] Make the READY short-circuit timings-aware in `get_or_generate_audio` and `generate_for_post` — return cached only when `existing_audio and cache.exists(key) and cache.exists_timings(key)`, otherwise fall through and regenerate — in [backend/app/application/services/audio_service.py](../../backend/app/application/services/audio_service.py)
- [X] T048 [US5] Broaden the background-job `SELECT` from `WHERE audio.id IS NULL` to `WHERE audio.id IS NULL OR audio.has_timings = false` (keeping content filter, batch, ordering, per-post commit) in [backend/app/infrastructure/jobs/audio_generation.py](../../backend/app/infrastructure/jobs/audio_generation.py)

**Checkpoint**: All user stories functional — the back catalog gains timings idempotently and new posts get them automatically.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Verification and hardening across stories.

- [X] T049 [P] Verify `.ra-active` meets WCAG AA (≥4.5:1) in both light and dark MUI themes (SC-007) in [frontend/src/theme.tsx](../../frontend/src/theme.tsx)
- [X] T050 [P] Note the `AUDIO_CACHE_VERSION` setting and the `<key>.json` sidecar in [backend/README.md](../../backend/README.md)
- [X] T051 Confirm no regression for timing-less posts (play/pause, seek, speed, waveform, layout unchanged — NFR-003) and that highlight/scroll cause no visible jank (O(1) DOM mutation per change, ≤1 reposition/frame — NFR-002)
- [X] T052 Run [quickstart.md](quickstart.md) end-to-end: all automated suites green and manual scenarios V1–V6 pass

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **Blocks US1, US4, US5** (all consume served/persisted timings).
- **US1 (Phase 3)**: Depends on Foundational + Setup. No dependency on other stories.
- **US2 (Phase 4)**: Depends on US1 (extends `useReadAlong` active-word tracking + `PostDetailPage`).
- **US3 (Phase 5)**: Depends on US1 (wires prefs into `useReadAlong`/`PostDetailPage`); independent of US2.
- **US4 (Phase 6)**: Depends on US1 (hardens the up-front eligibility gate) + Foundational (API omission). Independent of US2/US3.
- **US5 (Phase 7)**: Depends on Foundational only (backend backfill). Independent of all frontend stories — can be built in parallel with US1–US4.
- **Polish (Phase 8)**: Depends on the stories it verifies being complete.

### Story-to-Story Notes

- US1 is the only hard prerequisite among frontend stories (US2/US3/US4 build on its hook + page wiring). US5 is backend-only and shares no files with US1–US4, so it can proceed independently once Foundational lands.

### Within Each Story

- Tests are written first and must fail before implementation.
- Value objects/models before services; services before API/route changes.
- Utils (`alignTimings`, `wrapWords`) before `useReadAlong`; hooks before page wiring.

### Parallel Opportunities

- **Setup**: T001, T002 together.
- **Foundational tests**: T003, T004, T005 together. **Foundational impl**: T006, T011, T012, T013 together; then T008/T009/T010 together (after T007); T014/T015/T016/T017 follow their deps.
- **US1**: tests T018/T019/T020 together; impl T022/T023/T026 together, then T024 → T025/T027 → T028.
- **US4**: T038/T039 together.
- **US5**: T042/T043/T045 together; impl T047 and T048 are different files (parallelizable after T046).
- **Cross-story**: an entire second track (US5 backend backfill) can run in parallel with the US1→US4 frontend track once Foundational is done.

---

## Parallel Example: Foundational Phase

```bash
# Foundational tests first (all independent files):
Task: T003 edge-tts/strip_html/mock unit tests in backend/tests/unit/test_tts_service.py
Task: T004 sidecar store unit tests in backend/tests/unit/test_word_timings_store.py
Task: T005 audio contract tests in backend/tests/contract/test_audio.py

# Then independent foundational implementation files:
Task: T006 WordTiming value object
Task: T011 AudioCacheManager sidecar I/O + orphan cleanup
Task: T012 Audio entity has_timings
Task: T013 Audio model has_timings column
```

## Parallel Example: User Story 1

```bash
# US1 tests together:
Task: T018 alignTimings.test.ts
Task: T019 wrapWords.test.ts
Task: T020 useReadAlong.test.ts (active-word)

# US1 independent implementation files:
Task: T022 utils/alignTimings.ts
Task: T023 utils/wrapWords.ts
Task: T026 PostContent.tsx body container ref
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup → 2. Phase 2 Foundational (backend capture/persist/serve) → 3. Phase 3 US1 (highlight sync).
4. **STOP and VALIDATE**: word-level highlighting tracks the voice on a real post with timings (quickstart V1). Deploy/demo.

### Incremental Delivery

1. Setup + Foundational → new audio has timings, API serves them.
2. US1 → word-level highlighting (MVP). 3. US2 → auto-scroll. 4. US3 → persisted toggles. 5. US4 → graceful fallback hardening. 6. US5 → back-catalog backfill.
- Each story is an independently testable increment that never breaks a prior one.

### Parallel Team Strategy

After Foundational: one developer takes the US1→US2→US3→US4 frontend chain; a second developer takes US5 (backend backfill) in parallel — the two tracks share no files.

---

## Notes

- `[P]` = different files, no incomplete dependency. `[Story]` labels map to [spec.md](spec.md) user stories.
- All timing offsets are integer milliseconds on the wire and in the sidecar; the client compares against `audio.currentTime * 1000`.
- The version bump (T046) is only effective for backfill together with the timings-aware short-circuit (T047) and job selection (T048) — the stored old-key MP3 would otherwise short-circuit without regenerating (see [research.md](research.md) §4).
- Verify each test is red before writing its implementation; commit after each task or logical group.

---

## Phase 9: Convergence

**Purpose**: Close the unit-test-coverage gaps surfaced by `/speckit.converge` against the constitution's TDD mandate (Principle III) and this feature's spec — adding happy-path, error-path, and edge-case unit tests for read-along code that currently has no direct or only partial coverage. Assessment basis: backend branch coverage of the feature modules was **78%** (`WordTiming` validation, edge-tts error wrappers, audio-service error/corrupt-timings paths uncovered); the frontend has no coverage provider installed, so its units were assessed by reading source against their existing tests. These are **test-only additions** — no production behavior changes. Each test MUST be written to fail first if the behavior it asserts were broken (red-green per Principle III), then confirmed green against the current implementation.

- [X] T053 Add `backend/tests/unit/test_word_timing.py` (NEW) covering the `WordTiming` value object directly: happy path (`end_ms == start_ms + duration_ms`; `text` preserved verbatim incl. `"2024"`/`"don't"`; immutability via `dataclasses.FrozenInstanceError`), error paths (`start_ms < 0` and `duration_ms < 0` each raise `ValueError` with the documented message), and boundary edges (`start_ms == 0` and `duration_ms == 0` are accepted; `end_ms` correct when duration is 0) per data-model "Word Timing" + FR-015 + Constitution III (partial)
- [X] T054 Extend `backend/tests/unit/test_tts_service.py` to cover `EdgeTTSService.synthesize_with_timings` error paths (currently uncovered lines 55-56, 81-82): a patched missing `edge_tts` import raises `TTSError`; a `communicate.stream()` async iterator that raises mid-iteration is wrapped as `TTSError`; and a stream that yields no audio chunks triggers the "produced no audio" empty-file guard `TTSError`, per FR-015 + Constitution III (partial)
- [X] T055 Add `backend/tests/unit/test_audio_service.py` (NEW) unit-covering the timings error/edge paths with mocked TTS/cache/repositories: `get_or_generate_audio` and `generate_for_post` each return an `ERROR` `AudioResult` (no partial cache write, `has_timings` not set true) when synthesis raises `TTSError`; and `_load_word_timings` returns `None` for a corrupt/empty sidecar payload (missing or empty `words`) so a missing sidecar and a corrupt sidecar are indistinguishable to callers, per FR-018 + Constitution III (partial)
- [X] T056 Extend `frontend/src/hooks/__tests__/useReadAlongPreferences.test.ts` with storage-failure resilience: when `localStorage.getItem`/`setItem` throw (private-mode/disabled storage, mocked to throw), toggles fall back to `true` on read and `setHighlight`/`setAutoScroll` swallow the error without throwing and still update in-memory state, per FR-011 (partial)
- [X] T057 Extend `frontend/src/utils/__tests__/alignTimings.test.ts` with alignment edge cases: an empty `spoken` array yields `enabled === false` and `matchedRatio === 0`; and a display token that matches only beyond the bounded look-ahead window (`LOOKAHEAD`) is treated as a miss (proving alignment is bounded rather than a full scan), per FR-019 + FR-025 (partial)
- [X] T058 Extend the backend sidecar/job unit tests for two uncovered branches: `AudioCacheManager.load_timings` returns `None` for well-formed JSON that is not an object (e.g. a JSON array) in `backend/tests/unit/test_word_timings_store.py`; and `generate_pending_audio` logs a warning and does NOT count a post as generated when `generate_for_post` returns an `ERROR`-status result (a non-exception failure outcome) in `backend/tests/unit/test_audio_generation_job.py`, per FR-016 + FR-021 (partial)
- [X] T059 Pin `AzureTTSService.synthesize_with_timings`' current deferred contract with a unit test in `backend/tests/unit/test_tts_service.py` (delegates synthesis but returns an empty timing list), so the intentional T009 deferral is locked and any accidental behavior change is caught; upgrade this to full `synthesis_word_boundary` parity coverage when T009 is undeferred, per plan engine-parity + T009 (partial)
