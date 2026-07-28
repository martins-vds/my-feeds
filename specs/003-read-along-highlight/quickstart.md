# Quickstart & Validation: Read-Along Audio Highlighting

**Feature**: `003-read-along-highlight` | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

A run/validation guide proving the feature end-to-end. Implementation details live in the contracts and [data-model.md](data-model.md); this file is the "does it actually work?" checklist. Written test-first: the automated suites below should exist and **fail** before implementation, then pass.

## Prerequisites

- Docker Compose dev stack (backend + Postgres + migrations + frontend), per repo README.
- A signed-in user with at least one feed producing posts that have readable body content (so audio is generated).
- Default voice is edge-tts `en-US-AriaNeural` (no credentials needed).

## One-time setup

```bash
# From repo root — build & start the dev stack
docker compose up -d --build backend frontend

# Apply the new migration (adds audio.has_timings)
docker compose exec backend alembic upgrade head
```

The audio cache version defaults to `v2` (`audio_cache_version` setting, env `AUDIO_CACHE_VERSION`). On a fresh deploy this rotates every clip's cache key so legacy clips regenerate with timings via the background job or on first open. To force a later re-bump, set `AUDIO_CACHE_VERSION=v3` and restart the backend.

---

## Automated test suites (run these first — expect red before implementation)

```bash
# Backend: unit + contract + integration (pytest inside the container)
docker compose exec -T backend pytest tests/unit/test_tts_service.py \
  tests/unit/test_word_timings_store.py \
  tests/unit/test_audio_generation_job.py \
  tests/contract/test_audio.py

# Frontend unit (Vitest)
docker compose exec -T frontend pnpm test

# Frontend e2e (Playwright)
docker compose exec -T frontend pnpm playwright
```

| Suite                                                      | Proves                                                                                     | Refs                                                                  |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `test_tts_service.py`                                      | edge-tts stream → ordered `WordTiming`; `strip_html` tag→space; mock deterministic timings | [contracts/tts-service.md](contracts/tts-service.md) §1               |
| `test_word_timings_store.py`                               | sidecar save/load/exists/delete; corrupt JSON → treated as missing; orphan cleanup         | [contracts/tts-service.md](contracts/tts-service.md) §2               |
| `test_audio_generation_job.py`                             | selects audio-less **and** `has_timings=false`; skips `has_timings=true`; idempotent       | data-model §2, FR-021                                                 |
| `test_audio.py` (contract)                                 | READY response includes `wordTimings` when present, omits when absent/corrupt              | [contracts/audio-api.md](contracts/audio-api.md)                      |
| `alignTimings.test.ts` / `wrapWords.test.ts`               | normalize + ≥90% gate; indexed word spans; fusion split                                    | [contracts/read-along-client.md](contracts/read-along-client.md) §2–3 |
| `useReadAlong.test.ts` / `useReadAlongPreferences.test.ts` | active-word rule, speed independence, auto-scroll band, reduced-motion, persisted toggles  | §4–5                                                                  |
| `read-along.spec.ts` (Playwright)                          | highlight/scroll/toggles/fallback in a real browser                                        | §6                                                                    |

---

## Manual validation scenarios

Map to user stories (US) and success criteria (SC). Open a post with readable content on the Post Detail page.

### V1 — Word-level highlight follows the voice (US1 · SC-001/002/010)
1. Wait until "Listen to article" generates audio, then press play.
2. **Expect**: exactly one word highlights at a time, starting in the **title**, moving through the **body**, matching the spoken word (within ~150 ms at 1x).
3. Pause → highlight **holds** on the current word. Resume → continues. Let it finish → highlight **clears**.
4. During a pause/silence between words, the most recently started word **stays** highlighted (never blanks).
5. Change speed to 0.5x, 2x, 3x → highlight stays aligned with the voice, no drift.
6. Scrub to a new position → the highlighted word **jumps** to that position.

### V2 — Auto-scroll keeps the word in view (US2 · SC-003/008)
1. On a long post, play and don't touch the page → the view **scrolls itself** to keep the active word near center.
2. Pause → **no** auto-scroll while you read/scroll manually.
3. Enable OS/browser **reduce motion**, play again → the word stays visible but repositions **instantly** (no smooth animation).

### V3 — Independent persisted toggles (US3 · SC-004/009)
1. Turn **Auto-scroll while playing** off, leave **Highlight while playing** on → words highlight but the page does **not** auto-scroll.
2. Turn **Highlight** off → no highlighting regardless of auto-scroll.
3. Reload the app → both toggles keep their last values.
4. Operate both toggles with the **keyboard only**; verify state is announced to a screen reader.

### V4 — Graceful fallback (US4 · SC-005)
1. Open a post whose audio has **no** timings yet (not regenerated) → audio plays normally, **no** highlighting, **no** error, player behaves exactly as today.
2. A comments-only / no-readable-content item → no audio and no read-along (unchanged).
3. (If you can craft it) a post whose words align <90% → highlighting stays **off** for the whole post (no wrong-word flashes).

### V5 — Backfill existing audio (US5 · SC-006/011)
1. Identify a pre-feature clip (generated at `v1`). Let the background job run (or open the post) → it regenerates at the new key **with** timings; a `<key>.json` sidecar appears beside the `<key>.mp3`, and `audio.has_timings` becomes `true`.
2. Re-run the backfill (restart backend / let the loop run again) → clips that already have timings are **skipped**; no duplicate clips are created; playback of working clips is never interrupted.
3. Ingest a **new** post → its audio is generated **with** timings automatically (no manual step).

### V6 — No regression for existing playback (NFR-003)
- For any timing-less post, confirm play/pause, seeking, speed control, the waveform, and the player layout are unchanged.

---

## Quick API spot-check

```bash
# READY response should carry wordTimings (ordered) once a clip has a sidecar.
# Replace <post-id> and use an authenticated session cookie.
curl -s -b "$COOKIE" http://localhost:5000/api/posts/<post-id>/audio | jq '.status, (.wordTimings | length), .wordTimings[0]'
# → "ready"  <N>  { "text": "...", "startMs": <int>, "durationMs": <int> }
```

For a timing-less clip, `.wordTimings` is **absent** (not `null`/`[]`) — the client treats that as highlighting disabled. See [contracts/audio-api.md](contracts/audio-api.md).

---

## Definition of done (validation)

- [ ] All automated suites above are green.
- [ ] V1–V6 pass manually in a browser.
- [ ] Highlight color meets WCAG AA in light **and** dark themes (SC-007).
- [ ] Backfill is idempotent and non-disruptive (SC-011); new posts get timings automatically (SC-006).
