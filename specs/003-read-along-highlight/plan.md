# Implementation Plan: Read-Along Audio Highlighting (Word-Level Karaoke Sync)

**Branch**: `003-read-along-highlight` | **Date**: 2026-07-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-read-along-highlight/spec.md`

## Summary

While a post's TTS audio plays on the Post Detail page, highlight the exact word being spoken (title first, then body) in step with the voice, auto-scroll to keep the active word visible, and expose two independent persisted toggles ("Highlight while playing", "Auto-scroll while playing").

Technical approach, grounded in the existing code:

- **Backend (capture + persist + serve timings)**: Switch edge-tts synthesis from the fire-and-forget `communicate.save()` path to streaming, collecting `WordBoundary` events into an ordered `WordTiming` value object list. Persist timings as a sidecar `{cache_key}.json` beside the existing `{cache_key}.mp3` (no timings data in Postgres). Deliver the ordered timings inline with the existing `GET /posts/{id}/audio` READY metadata as `wordTimings`. Insert separating whitespace in `TTSService.strip_html` so tag boundaries never fuse words. Trigger back-catalog regeneration by bumping the audio cache version (new deterministic keys) and making generation + background-job selection timings-aware and idempotent (a lightweight `has_timings` marker on the audio row makes selection queryable).
- **Frontend (align + highlight + scroll)**: Surface `wordTimings` and a media-time accessor from `useAudioPlayer`. Build one ordered display-word sequence (title words ++ body DOM words), normalize, and sequence-align it to the timing tokens up-front with a ≥90% gate (below → highlighting silently disabled). Wrap display words in indexed spans once, sample `audio.currentTime` on a `requestAnimationFrame` cadence to pick the active word (last start ≤ media time, held across gaps), and mutate only the active span. Auto-scroll on a central comfort band, coalesced per frame, `prefers-reduced-motion`-aware. Two toggles persist to `localStorage`, default on.

No new external TTS service or paid dependency; reuses the existing engine, cache/store, background jobs, and player/reader components (NFR-005).

## Technical Context

**Language/Version**: Backend Python 3.12+ (Quart, async); Frontend TypeScript 5.x (React 18 + Vite + MUI).

**Primary Dependencies**: Backend — `edge-tts` (existing; use its streaming `WordBoundary` API), SQLAlchemy + asyncpg, Alembic, `nh3` (existing sanitizer). Frontend — React, MUI, native `requestAnimationFrame` / `matchMedia` / DOM `TreeWalker`, `DOMPurify` (existing). No new runtime dependencies.

**Storage**: Audio clip MP3 files on disk (existing `audio_cache/<key[:2]>/<key>.mp3`). Word timings as a sidecar JSON file next to each MP3 (`<key>.json`). PostgreSQL `audio` row gains a single `has_timings` boolean marker for timings-aware selection; timing data itself is not stored in Postgres. Read-along toggles in browser `localStorage`.

**Testing**: Backend — pytest + pytest-asyncio (unit, contract, integration) with `MockTTSService`. Frontend — Vitest (utils/hooks) + Playwright (UI). Test-first per constitution Principle III.

**Target Platform**: PWA (desktop + Android mobile browsers); Quart API on Linux.

**Project Type**: Web application (existing `backend/` + `frontend/` monorepo).

**Performance Goals**: Highlight matches spoken word within 150 ms for ≥95% of words at 1x, correctly aligned to media time across 0.5x–3x with no cumulative drift (NFR-001, SC-001/002). No visible jank during playback (NFR-002): O(1) DOM mutation per active-word change, ≤1 scroll reposition per frame.

**Constraints**: Adding `wordTimings` must not meaningfully slow the audio request for typical articles (NFR-004) — small inline JSON read from a sidecar. Existing playback/seek/speed/player UI unchanged for timing-less posts (NFR-003). Highlight color meets WCAG AA contrast in both themes (FR-014, SC-007). Reduced-motion honored (FR-008, SC-008). Determination of highlight-enabled is up-front to avoid flicker (FR-018).

**Scale/Scope**: One reader per device; articles up to a few thousand words → timing arrays up to low-thousands of entries per clip; whole-library backfill trickled by the existing background job.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle                        | Status | How this plan complies                                                                                                                                                                                                                                                                                                                  |
| -------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I. Domain-Driven Design          | PASS   | New `WordTiming` value object lives in `domain/audio`; the timing-capture contract is added to the `TTSService` domain ABC; sidecar (de)serialization and the `has_timings` marker live in infrastructure; API shaping stays in the API layer; alignment/highlight is a client concern. No framework/persistence leaks into the domain. |
| II. DI via Abstract Base Classes | PASS   | Timing capture is a new method on the existing `TTSService` ABC, implemented by `EdgeTTSService`/`AzureTTSService`/`MockTTSService` and injected via the existing `container.py` factories. No new service locator or hard-coded deps.                                                                                                  |
| III. Test-Driven Development     | PASS   | Every change is specified test-first (Phase 1 contracts + quickstart drive failing tests): edge-tts stream parsing, sidecar store, strip_html spacing, timings-aware job selection, augmented contract test, and Vitest/Playwright suites for alignment, selection, toggles, auto-scroll, and fallback.                                 |
| IV. Modern Toolchain             | PASS   | No new dependencies; uses `uv`/`pnpm` lockfiles as-is. Uses `edge-tts`'s already-installed streaming API and browser-native primitives.                                                                                                                                                                                                 |
| V. PWA-First                     | PASS   | Frontend-only client logic; no change to the single React PWA delivery model.                                                                                                                                                                                                                                                           |
| VI. Lazy Resource Generation     | PASS   | Timings are captured during the existing lazy, cached generation — no speculative pre-generation. Cache invalidation is explicit via the version bump.                                                                                                                                                                                  |

**Result**: No violations. Complexity Tracking is intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/003-read-along-highlight/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output — decisions & rationale
├── data-model.md        # Phase 1 output — entities, sidecar schema, DTOs
├── quickstart.md        # Phase 1 output — end-to-end validation guide
├── contracts/           # Phase 1 output — API, sidecar schema, TTS & client contracts
│   ├── audio-api.md
│   ├── word-timings.schema.json
│   ├── tts-service.md
│   └── read-along-client.md
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

Existing `backend/` (DDD layers) + `frontend/` (React PWA) monorepo. Files touched or added by this feature:

```text
backend/
├── app/
│   ├── domain/audio/
│   │   ├── value_objects/
│   │   │   └── word_timing.py          # NEW: WordTiming value object (text, start_ms, duration_ms)
│   │   ├── services/tts_service.py      # EDIT: add synthesize_with_timings(); strip_html tag→space
│   │   └── entities/audio.py            # EDIT: add has_timings flag
│   ├── application/services/
│   │   └── audio_service.py             # EDIT: capture+persist timings; timings-aware short-circuit
│   ├── infrastructure/
│   │   ├── tts/
│   │   │   ├── edge_tts_service.py      # EDIT: stream WordBoundary → list[WordTiming]
│   │   │   ├── azure_tts.py             # EDIT: synthesis_word_boundary handler (parity)
│   │   │   ├── mock_tts.py              # EDIT: deterministic synthetic timings for tests
│   │   │   └── cache_manager.py         # EDIT: sidecar {key}.json save/load/exists/delete + orphan cleanup
│   │   ├── persistence/
│   │   │   ├── models/audio.py          # EDIT: has_timings column
│   │   │   └── repositories/audio_repository.py  # EDIT: map has_timings
│   │   └── jobs/audio_generation.py     # EDIT: select audio-less OR has_timings=false; idempotent
│   ├── api/routes/audio.py              # EDIT: include wordTimings in READY response
│   └── config/
│       ├── settings.py                  # EDIT: audio_cache_version ("v2")
│       └── container.py                 # EDIT: pass cache_version into AudioCacheManager
├── migrations/                          # NEW: Alembic migration adding audio.has_timings
└── tests/{unit,contract,integration}/   # NEW/EDIT: timings capture, sidecar, job, contract tests

frontend/
├── src/
│   ├── utils/
│   │   ├── alignTimings.ts              # NEW: normalize + sequence-align (≥90% gate)
│   │   └── wrapWords.ts                 # NEW: TreeWalker word-span wrapping (indexed, idempotent)
│   ├── hooks/
│   │   ├── useAudioPlayer.ts            # EDIT: expose wordTimings + media-time/isPlaying accessor
│   │   ├── useReadAlong.ts              # NEW: align + rAF active word + highlight + auto-scroll
│   │   └── useReadAlongPreferences.ts   # NEW: two persisted toggles (default on)
│   ├── components/
│   │   ├── AudioPlayer.tsx              # EDIT: controlled by lifted player state
│   │   ├── PostContent.tsx             # EDIT: expose content container ref for wrapping
│   │   └── ReadAlongToggles.tsx         # NEW: two accessible MUI switches
│   ├── pages/posts/PostDetailPage.tsx   # EDIT: own player + title/content refs; wire useReadAlong
│   └── types/index.ts                   # EDIT: WordTiming type; wordTimings on AudioInfo
└── playwright/                          # NEW: read-along e2e specs
```

**Structure Decision**: Web application (Option 2). Extends the existing `backend/` DDD layers and `frontend/` React PWA in place — no new project or service. The only cross-cutting coordination change is lifting `useAudioPlayer` into `PostDetailPage` so a single owner holds playback state alongside the title and body refs the highlighter needs (see [research.md](research.md) for the considered alternatives).

## Complexity Tracking

> No constitution violations — this section is intentionally empty.
