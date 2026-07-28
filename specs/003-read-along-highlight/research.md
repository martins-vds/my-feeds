# Phase 0 Research: Read-Along Audio Highlighting

**Feature**: `003-read-along-highlight` | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

All spec decisions are already made; this document records the grounded technical decisions, their rationale, and the alternatives considered. There are no open `NEEDS CLARIFICATION` items.

---

## 1. Capturing word timings from edge-tts

**Decision**: Replace the fire-and-forget `communicate.save(path)` call with the streaming API: iterate `communicate.stream()` and, for each chunk, write `chunk["data"]` when `chunk["type"] == "audio"` and collect a `WordTiming` when `chunk["type"] == "WordBoundary"`. Each `WordBoundary` chunk provides `offset` and `duration` in **100-nanosecond ticks** and `text` = the original source-text token. Convert ticks → milliseconds (`ms = ticks // 10_000`).

**Rationale**: The current [edge_tts_service.py](../../backend/app/infrastructure/tts/edge_tts_service.py) uses `communicate.save()`, which internally streams but discards `WordBoundary` events. The streaming loop is the only way edge-tts exposes per-word boundaries, and it yields exactly the three fields the spec requires (token text, start offset, duration) with no extra service. `text` being the *source* token (e.g. `2024`, `don't`) is what makes client alignment against displayed words possible even when the spoken form differs.

**Alternatives considered**:
- *Separate forced-alignment / transcription service*: rejected — violates NFR-005 (no new external/paid dependency) and is unnecessary since edge-tts already emits boundaries.
- *Keep `save()` and post-process the MP3*: rejected — no boundary data recoverable after the fact.

**Notes for implementation**: Treat an empty audio result as failure (preserve existing "produced no audio" guard). If the engine emits zero `WordBoundary` events, return an empty timing list — the clip still saves and simply has no sidecar/highlighting.

---

## 2. Timing storage: sidecar JSON vs database column

**Decision**: Persist the ordered timings as a **sidecar JSON file** at `audio_cache/<key[:2]>/<key>.json`, next to the existing `<key>.mp3`. Add a single lightweight boolean **`has_timings`** column to the `audio` row (queryable marker only — not the data).

**Rationale**: The sidecar shares the clip's deterministic cache key, so it is created, replaced, and reclaimed in lockstep with the MP3 (the existing orphan cleanup can delete a stray `.json` the same way it deletes a stray `.mp3`). Keeping the (potentially multi-thousand-entry) timing arrays out of Postgres keeps rows small and avoids a JSON column migration for bulk data. The `has_timings` marker is the minimal DB fact needed so the background job can select timing-less clips with one SQL predicate instead of N filesystem probes.

**Alternatives considered**:
- *JSON column on `audio`*: rejected as the primary store — bloats rows, couples timing data lifecycle to DB writes, and complicates cache cleanup which already operates on files.
- *Sidecar only, no marker*: rejected — the background job's `SELECT` cannot see filesystem state, so timings-aware bulk selection would require per-row `os.path.exists`, which does not scale.
- *Both (column + sidecar for data)*: this is the chosen shape — sidecar holds the data, column holds only the boolean.

---

## 3. Delivering timings to the client

**Decision**: Include the ordered timings **inline** in the existing `GET /posts/{id}/audio` READY response as a `wordTimings` array (`[{ text, startMs, durationMs }]`). Omit the field entirely when no sidecar exists.

**Rationale**: The client already calls this endpoint to obtain the audio URL, so inlining timings needs **one** authenticated round-trip and no extra CORS/auth surface. Payloads are small JSON for typical articles (NFR-004). Omission (rather than `null`/`[]` ambiguity) gives the client a clear "no timings → highlighting disabled" signal.

**Alternatives considered**:
- *Adjacent endpoint `GET /audio/{cache_key}/timings`* keyed by cache key (spec-permitted): viable and browser-cacheable, but adds a second request and route for no benefit at this scale. Kept as a documented future option in [contracts/audio-api.md](contracts/audio-api.md).

**Units**: Wire format is integer **milliseconds** (`startMs`, `durationMs`). The client compares against `audio.currentTime` (seconds) by multiplying current time by 1000, keeping all comparisons in integer ms.

---

## 4. Back-catalog regeneration: version bump + timings-aware, idempotent selection

**Decision**: Two coordinated mechanisms.
1. **Version bump** — add `audio_cache_version` to settings (default `"v2"`) and pass it into `AudioCacheManager` (today the constructor default `"v1"` is never overridden). Because the version is hashed into `generate_cache_key`, every existing clip's key changes, so regenerated clips write to a **new** deterministic path and old files become orphans reclaimed by existing cleanup.
2. **Timings-aware, idempotent selection** —
   - Make the "already have audio" short-circuit in `get_or_generate_audio` / `generate_for_post` require **both** `cache.exists(key)` **and** the timings sidecar to exist; otherwise fall through and regenerate.
   - Broaden the background job `SELECT` from `WHERE audio.id IS NULL` to also include `audio.has_timings = false`.
   - On (re)generation, write MP3 + sidecar and set `has_timings = true`. Re-runs skip `has_timings = true` clips; an interrupted run (MP3 written, sidecar/row not committed) re-derives the **same** deterministic v2 key and overwrites — no duplicates.

**Rationale**: The version bump alone is insufficient: the on-demand short-circuit checks the **stored** cache key from the DB row (still the old v1 key whose file exists), so it would return READY without regenerating. Making the short-circuit and job selection timings-aware is what actually forces regeneration, while the version bump guarantees clean key rotation and a single global trigger. Together they satisfy FR-021 and SC-011 (idempotent, non-disruptive, no duplicates).

**Alternatives considered**:
- *Delete old MP3 files to force regen*: rejected — the job never re-selects posts that still have an audio row, so file deletion alone does not backfill; also races with playback.
- *Regenerate to the same v1 key in place*: simpler (no orphans) but contradicts the spec's chosen version-bump trigger and loses the clean "old key → orphan → cleanup" story.
- *Store `cache_version` on the row instead of `has_timings`*: equivalent for selection, but `has_timings` maps directly to the spec's "clips that already have timings are skipped" wording and to the highlight-eligibility fact.

---

## 5. Preventing word fusion at tag boundaries (strip_html)

**Decision**: Change `TTSService.strip_html` to replace each HTML tag with a **single space** (`re.sub(r'<[^>]+>', ' ', text)`) before collapsing whitespace, instead of replacing with the empty string.

**Rationale**: Today `for<code>x</code>loop` collapses to the single spoken token `forxloop`, which both mis-narrates and breaks countability against displayed words. A space yields `for x loop` (three tokens) matching how the browser renders adjacent text nodes. This changes the synthesized text but **not** the cache key (the key is built from the pre-strip title+content), so the fix reaches existing clips only via the version-bump regeneration (FR-026).

**Alternatives considered**:
- *Fix only on the client side*: rejected — the spoken audio itself would still say "forxloop"; the boundary token must be split at synthesis time.

---

## 6. Client alignment: title-then-body sequence, normalized matching, ≥90% gate

**Decision**: Build a single ordered **display-word** sequence = title words followed by body words in DOM order. Normalize each token (lowercase; strip leading/trailing punctuation; keep internal apostrophes and digits as-is). Sequence-align display tokens to the (identically normalized) timing tokens, allowing the display side to skip non-spoken tokens (pure punctuation/symbols). Compute a `map[timingIndex] → displayIndex`. If fewer than **90%** of timing tokens align in order — or the sequences diverge past a short run of consecutive mismatches — mark the post **highlight-disabled** up-front.

**Rationale**: Backend TTS synthesizes from `post.content` (nh3-sanitized) and the frontend renders the same nh3 HTML (re-sanitized by DOMPurify), so the visible words and spoken tokens derive from the same source and align well in practice. Deciding eligibility up-front (before first highlight) satisfies FR-018's "never briefly appears then disappears". The 90% gate plus consecutive-mismatch guard prevents highlighting the wrong words when structure diverges (FR-019).

**Alternatives considered**:
- *Server-side alignment*: rejected — the server does not know the exact rendered DOM (DOMPurify config, MUI structure), so alignment must run against the actual displayed nodes on the client.
- *Full Needleman–Wunsch DP*: unnecessary; a linear greedy walk with bounded look-ahead handles skip-on-display and detects divergence cheaply for thousands of tokens.

---

## 7. Active-word selection cadence: requestAnimationFrame vs timeupdate

**Decision**: Drive active-word selection from a `requestAnimationFrame` loop that reads `audio.currentTime` directly while playing. Active word = the greatest index `i` with `startMs[i] ≤ currentMs` (hold across gaps; none before the first start; clear after the last word ends or on `ended`). Only mutate the DOM when the index changes.

**Rationale**: The existing hook updates `currentTime` from the `timeupdate` event, which fires ~4×/second — too coarse to stay within the 150 ms tolerance at up to 3x (a word can change several times per second). Reading `currentTime` on the frame cadence is media-time-based, so it stays correct at every playback rate and through seeks with no separate clock (FR-002, NFR-001). Mutating only on index change keeps it jank-free (NFR-002).

**Alternatives considered**:
- *Schedule `setTimeout` per word from the timing list*: rejected — brittle under seeking, pausing, and rate changes; media-time sampling is self-correcting.
- *Keep using `timeupdate`*: rejected — fails the 150 ms tolerance at fast rates.

**Access to the media element**: `useAudioPlayer` currently keeps the `HTMLAudioElement` private in a ref. Surface a stable accessor (e.g. `getMediaElement()` returning the current element) plus the fetched `wordTimings`, so the read-along hook can read `currentTime`/`paused` on each frame without re-plumbing all player state.

---

## 8. Wrapping displayed words for highlighting

**Decision**: After render, walk the title element and the body container with a DOM `TreeWalker` over text nodes and wrap each whitespace-delimited token in `<span class="ra-word" data-ra-index="N">`, assigning sequential indices that match the display sequence used for alignment. Do it once (idempotent — skip if already wrapped), keep an index→element lookup, and on active-index change toggle a highlight class on just the outgoing and incoming spans.

**Rationale**: The body is rendered via `dangerouslySetInnerHTML` (sanitized HTML), so words cannot be wrapped in the React tree without re-implementing HTML rendering. Post-render text-node wrapping preserves the sanitized structure (including links) and produces stable, indexable targets. O(1) class toggling per change avoids re-serializing or re-rendering (NFR-002).

**Alternatives considered**:
- *Parse sanitized HTML into React elements and wrap words in JSX*: heavier, risks diverging from DOMPurify output, and complicates link/attribute handling; rejected for now.
- *CSS `::highlight()` Custom Highlight API*: attractive (no wrapper spans) but browser support is uneven for a PWA target; kept as a possible future optimization.

**Safety**: Wrapping only splits existing text nodes and inserts spans; it never introduces new HTML from untrusted strings, so it does not weaken the existing nh3 + DOMPurify sanitization (no new XSS surface).

---

## 9. Auto-scroll behavior

**Decision**: While playing and with auto-scroll enabled, on each active-word change compare the active span's rect to a central **comfort band** of the scroll viewport; if outside, reposition toward center using `scrollIntoView({ block: "center", behavior })` where `behavior = prefers-reduced-motion ? "auto" : "smooth"`. Coalesce to at most one reposition per frame and guard against redundant scrolls. Never scroll while paused/stopped. Manual scrolling is allowed and auto-scroll resumes on the next advance.

**Rationale**: A comfort band (not every-word centering) avoids constant motion and jank at high rates (FR-006), and per-frame coalescing bounds work at 3x. `prefers-reduced-motion` via `matchMedia('(prefers-reduced-motion: reduce)')` with a change listener honors FR-008/SC-008 dynamically.

**Alternatives considered**:
- *Center on every word*: rejected — visually jittery and wasteful at fast rates.
- *CSS `scroll-behavior: smooth` globally*: rejected — cannot be conditionally disabled per reduced-motion without style thrashing; explicit per-call `behavior` is cleaner.

---

## 10. Persisted, independent toggles

**Decision**: Two `localStorage`-backed booleans (`readAlong.highlight`, `readAlong.autoScroll`), default `true`, exposed via a `useReadAlongPreferences` hook and rendered as two accessible MUI `Switch` controls with labels near the player. Independent: highlight off clears/skreps highlighting; auto-scroll off stops scrolling; both are keyboard-operable and expose on/off state to assistive tech (MUI `Switch` default a11y).

**Rationale**: Client-only per-device preference (FR-011) intentionally separate from any server profile. MUI `Switch` satisfies keyboard + ARIA requirements (FR-013, SC-009) out of the box.

**Alternatives considered**:
- *Server-persisted preferences*: rejected — spec explicitly scopes persistence to the device/browser.
- *Single combined toggle*: rejected — FR-009/FR-012 require independent control.

---

## 11. React coordination: where playback state lives

**Decision**: Lift `useAudioPlayer` from `AudioPlayer.tsx` up to `PostDetailPage.tsx` (the single owner of the title node, the body container, and the player). `AudioPlayer` becomes a controlled presentational component receiving player state via props; `PostDetailPage` instantiates `useReadAlong(player, titleRef, contentRef, prefs)`.

**Rationale**: The highlighter needs playback state (`currentTime`, `isPlaying`, `wordTimings`) **and** the title/body refs together. `PostDetailPage` already renders the title (`<Typography>`), the `AudioPlayer`, and `PostContent`, so it is the natural single source of truth and keeps the hooks unit-testable.

**Alternatives considered**:
- *React context (`ReadAlongContext`) published by `AudioPlayer`, consumed by a controller in `PostDetailPage`*: avoids changing `AudioPlayer`'s internal hook usage but adds context plumbing and two owners of playback truth; documented as the fallback if lifting proves invasive.

---

## Cross-cutting: accessibility & theming

- **Highlight contrast (FR-014/SC-007)**: choose a theme-aware highlight token (background + text) verified to meet WCAG AA (≥4.5:1) in both light and dark MUI themes; validated in the quickstart.
- **Reduced motion (FR-008)**: single `matchMedia` source shared by auto-scroll; changes take effect live.
- **No regression (NFR-003)**: for timing-less posts the player, seek, speed control, and UI are byte-for-byte unchanged — the read-along layer is inert when highlighting is disabled.
