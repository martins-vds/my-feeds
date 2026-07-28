# Feature Specification: Read-Along Audio Highlighting (Word-Level Karaoke Sync)

**Feature Branch**: `003-read-along-highlight`  
**Created**: 2026-07-27  
**Status**: Draft  
**Input**: User description: "While a post's TTS audio plays on the Post Detail page, highlight the text word-by-word in sync with the audio and auto-scroll to keep the active word visible, so the reader can follow along without losing their place."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Follow Along With Word-Level Highlighting (Priority: P1)

A reader opens a post on the Post Detail page and presses play on the text-to-speech audio. As the narration speaks, the exact word being spoken lights up in the article — first in the title, then through the body — advancing word by word in step with the voice. When they pause, the highlight holds on the last word; when they resume, it continues from there; when the audio ends, the highlight clears.

**Why this priority**: This is the core of the feature. Without word-accurate highlighting there is no read-along experience — everything else (auto-scroll, toggles) exists to support it.

**Independent Test**: Open a post whose audio has word timings, press play, and watch the article. Verify that a single word is highlighted at a time, that it matches the word being spoken, and that it advances continuously until the audio finishes. Pausing freezes the highlight; resuming continues it.

**Acceptance Scenarios**:

1. **Given** a post whose audio has word-timing data, **When** the reader plays the audio, **Then** the word currently being spoken is visually highlighted in the title/body and the highlight moves from word to word in sync with the narration.
2. **Given** audio is playing with highlighting active, **When** the reader pauses, **Then** the highlight stops on the current word and does not advance until playback resumes.
3. **Given** audio is playing, **When** the reader seeks (scrubs) to a different position, **Then** the highlighted word jumps to the word spoken at that new position.
4. **Given** audio is playing, **When** the reader changes playback speed to any supported rate (0.5x through 3x), **Then** the highlight continues to track the spoken word without drifting ahead of or behind the voice.
5. **Given** the audio reaches the end, **When** playback stops, **Then** the highlight is cleared and no word remains highlighted.
6. **Given** audio is playing across a natural pause or silence between two spoken words, **When** the current media time is past the end of one word but before the next word starts, **Then** the most recently started word stays highlighted (held) until the next word begins — the highlight never blanks mid-narration.

---

### User Story 2 - Auto-Scroll Keeps the Active Word in View (Priority: P2)

For a long article, the reader shouldn't have to manually scroll to keep up with the narration. As the highlighted word approaches the edge of the reading area, the view gently scrolls so the active word stays comfortably visible (toward the center). This happens only while audio is playing, and it respects the reader's "reduce motion" system preference.

**Why this priority**: Highlighting alone is valuable, but on longer posts the reader loses the highlighted word off-screen. Auto-scroll makes the read-along genuinely hands-free. It builds on the active-word tracking from User Story 1.

**Independent Test**: Play a long post's audio and let it run without touching the page. Verify the page scrolls on its own to keep the highlighted word visible. Enable the OS "reduce motion" setting and confirm scrolling still keeps the word visible but without animated motion.

**Acceptance Scenarios**:

1. **Given** audio is playing and the highlighted word is near the bottom of the visible reading area, **When** the highlight advances, **Then** the view scrolls to bring the active word back toward the center of the reading area.
2. **Given** audio is paused or stopped, **When** the reader scrolls or reads at their own pace, **Then** the app does not auto-scroll the page.
3. **Given** the reader has enabled "reduce motion" in their system/browser, **When** auto-scroll keeps the active word in view, **Then** the view repositions without smooth animated scrolling (no motion-based effect).

---

### User Story 3 - Independent, Persisted Toggles (Priority: P2)

The reader has two separate switches on the Post Detail page: "Highlight while playing" and "Auto-scroll while playing." Each can be turned on or off independently. Both are on by default. Whatever the reader chooses is remembered the next time they open the app.

**Why this priority**: Readers have different preferences — some want highlighting but find auto-scroll distracting, or vice versa. Independent, persistent control makes the feature usable for everyone without re-configuring on every visit.

**Independent Test**: Turn off "Auto-scroll while playing" but leave "Highlight while playing" on; play audio and verify words highlight but the page does not auto-scroll. Reload the app and confirm the toggles are in the same state as before.

**Acceptance Scenarios**:

1. **Given** the reader turns off "Highlight while playing", **When** audio plays, **Then** no word highlighting occurs, regardless of the auto-scroll toggle.
2. **Given** the reader turns off "Auto-scroll while playing", **When** audio plays, **Then** words still highlight (if highlighting is on) but the page does not auto-scroll.
3. **Given** both toggles have never been changed, **When** the reader first uses the feature, **Then** both highlighting and auto-scroll are enabled by default.
4. **Given** the reader changes either toggle, **When** they close and reopen the app (new session), **Then** each toggle retains the value they last chose.
5. **Given** a keyboard-only user, **When** they navigate to the toggles, **Then** each toggle can be focused and switched using the keyboard alone.

---

### User Story 4 - Graceful Fallback When Timing Data Is Missing (Priority: P2)

Some posts have audio but no word-timing data yet (for example, older clips awaiting regeneration, or a case where the voice engine produced no word boundaries). The reader can still play the audio normally; the app simply doesn't highlight words for that post and shows no errors.

**Why this priority**: The feature must never degrade the existing listening experience. A missing-timings post must behave exactly as it does today — play normally, just without read-along.

**Independent Test**: Open a post whose audio has no timing data and press play. Verify the audio plays and the player behaves normally, with no highlighting and no error messages or broken UI.

**Acceptance Scenarios**:

1. **Given** a post whose audio has no word-timing data, **When** the reader plays it, **Then** the audio plays normally, no words are highlighted, and no error is shown.
2. **Given** a post with no readable content (e.g., a Hacker News "Comments"-only item that already has no audio), **When** the reader opens it, **Then** there is no audio and no read-along, matching current behavior.
3. **Given** timing data exists but fewer than 90% of the spoken words can be aligned, in order, to the visible words in the rendered article, **When** the reader plays the audio, **Then** the app disables highlighting for the whole post (rather than highlighting the wrong words), and this decision is made up-front so no highlight ever briefly appears.
4. **Given** a post whose timing data is only partial or is corrupt/unparseable, **When** the reader plays the audio, **Then** it is treated exactly like missing timings — audio plays normally, no words highlight, and no error is shown.

---

### User Story 5 - Backfill Word Timings for Existing Audio (Priority: P3)

Audio generated before this feature has no word timings. So that read-along works across the whole library, existing timing-less clips are cleaned up and regenerated (via the existing background audio job) so each gains word-timing data. New audio captures timings automatically going forward.

**Why this priority**: Delivers the feature's value on the reader's back catalog, not just newly ingested posts. It's lower priority because P1–P4 already make the feature correct and safe for any individual post; this is a data-coverage improvement.

**Independent Test**: Identify a post with pre-existing timing-less audio. Trigger the regeneration path (cleanup + background generation). After regeneration completes, open the post and verify read-along now highlights words. Confirm newly ingested posts get timings without manual intervention.

**Acceptance Scenarios**:

1. **Given** audio that was generated before this feature (no timings), **When** the backfill runs (triggered by bumping the audio cache version so every existing clip's cache key changes), **Then** the clip is regenerated through the existing generation path with word-timing data attached.
2. **Given** a newly ingested post, **When** its audio is generated (on demand or by the background job), **Then** word-timing data is captured and stored alongside the audio automatically.
3. **Given** regeneration has not yet reached a particular post, **When** the reader opens it, **Then** it still plays normally with highlighting disabled (per User Story 4) until its timings are available.
4. **Given** the backfill is run more than once (e.g. it was interrupted, or runs again after new posts arrive), **When** it processes a clip that already has word timings, **Then** that clip is left as-is and is not regenerated, so re-running is safe and produces no duplicate clips.
5. **Given** a clip is regenerated with the same text and voice, **When** the new file is written, **Then** it is written to the same deterministic cache path (idempotent overwrite by cache key), and the previous file for that post is superseded and later reclaimed by the existing cache cleanup.

---

### Edge Cases

- **Timing/word mismatch**: The article body is rendered as formatted (HTML) text, while timings correspond to the spoken text sequence (title then body). The client aligns a single ordered sequence of displayed words (title words followed by body words in document order) against the ordered timing words, comparing case- and punctuation-insensitively and treating contractions and numbers as single source tokens. If fewer than 90% of spoken words align in order, highlighting is disabled for that post (no wrong-word highlighting).
- **Words without a boundary event**: Punctuation, whitespace, or symbols that the voice engine does not emit as spoken words are simply never highlighted; the highlight skips to the next real word.
- **Fused words at tag boundaries**: Because inline/block tags are removed during synthesis, text preparation inserts separating whitespace so adjacent words are not fused (e.g. `for<code>x</code>loop` becomes `for x loop`); this keeps spoken-word tokens countable against the displayed words. This takes effect for clips regenerated after the change.
- **Title/body seam**: The synthesized text is the title followed by `". "` then the body, so the injected separator is spoken as a sentence break and produces no timing word; the client's single concatenated title-then-body display sequence absorbs the seam without a special marker.
- **Very fast playback (3x)**: The active word may change several times per second, so the active word is recomputed from the audio's media time on an animation-frame cadence (not the browser's coarser ~4x/second time-update event); auto-scroll coalesces rapid advances into at most one reposition per frame so fast playback does not cause jank.
- **Seeking/scrubbing**: Jumping to any position immediately re-derives the correct active word from the new media position.
- **Reader manually scrolls during playback**: Auto-scroll is driven by playback; manual scrolling is allowed and auto-scroll resumes keeping the active word in view on the next advance while audio is playing.
- **Toggling mid-playback**: Turning "Highlight while playing" off during playback immediately clears any highlight; turning "Auto-scroll while playing" off immediately stops further auto-scrolling. Turning either back on resumes the behavior from the current position.
- **Reduced-motion preference changes**: If the reader changes their reduce-motion preference, auto-scroll respects the new preference.
- **Audio has timings but the post's rendered content is empty/summary-only**: Highlighting applies to whatever text is actually shown; if there are no visible body words, only the title (if shown) is highlighted, or highlighting is disabled if nothing can be matched.
- **Corrupt or partial timing data**: Treated the same as missing timings — play normally with highlighting disabled, no errors.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: While TTS audio is playing on the Post Detail page, the system MUST visually highlight the single word currently being spoken, in both the title and the article body, advancing word by word as playback progresses.
- **FR-002**: The active-word highlight MUST be derived from the audio's media time (playback position), not wall-clock time, so highlighting stays accurate at every supported playback rate (0.5x through 3x) without drift. The current media time MUST be sampled on an animation-frame cadence (rather than only the browser's periodic ~4x/second time-update event) so tracking stays within tolerance at fast rates.
- **FR-003**: At most one word MUST be highlighted at any moment (karaoke-style single active word), not a cumulative range.
- **FR-004**: When playback pauses, the highlight MUST hold on the current word; when playback resumes, it MUST continue from the current position; when playback ends or is stopped, the highlight MUST clear.
- **FR-005**: When the reader seeks to a new position, the highlighted word MUST update to the word spoken at that position.
- **FR-006**: The system MUST auto-scroll the reading view to keep the active word visible (biased toward the center of the reading area) while audio is playing. Auto-scroll MUST trigger only when the active word moves outside a central comfort band (not on every word), and MUST coalesce rapid advances at high playback rates (up to 3x) into at most one reposition per frame to avoid jank.
- **FR-007**: Auto-scroll MUST occur only while audio is playing; when paused or stopped, the system MUST NOT auto-scroll.
- **FR-008**: Auto-scroll MUST respect the reader's reduced-motion preference — when reduce-motion is enabled, the view repositions without animated/smooth scrolling.
- **FR-009**: The system MUST provide two independent reader controls: "Highlight while playing" and "Auto-scroll while playing", each independently enable/disable-able.
- **FR-010**: Both toggles MUST default to on for readers who have not changed them.
- **FR-011**: Each toggle's value MUST persist across sessions on the reader's device (browser local storage) and be applied on subsequent visits.
- **FR-012**: The two toggles MUST be independent — disabling highlighting MUST NOT disable auto-scroll's dependency-free behavior, and disabling auto-scroll MUST NOT stop highlighting. (Note: auto-scroll positions to the active word, which only exists when highlighting logic is running; when highlighting is off, auto-scroll has no active word to follow and therefore does not scroll.)
- **FR-013**: Toggles MUST be operable by keyboard alone and expose their on/off state to assistive technology.
- **FR-014**: The highlight styling MUST provide sufficient color contrast for readability, meeting WCAG AA contrast for the highlighted text against its background.
- **FR-015**: The system MUST capture per-word timing data (word text, start offset, and duration) during audio synthesis, using the voice engine's word-boundary information.
- **FR-016**: Captured word-timing data MUST be stored alongside the cached audio clip so it survives for the life of that clip — persisted as a sidecar record keyed by the clip's cache key (a JSON file beside the `.mp3`) so replacing or removing a clip naturally replaces or removes its timings.
- **FR-017**: The audio API MUST expose a post's word-timing data to the client together with the audio metadata (or an adjacent endpoint keyed by cache key), delivered as an ordered list where each entry carries the source token text, its start offset, and its duration, so the client can drive highlighting.
- **FR-018**: When a post's audio has no timing data (never captured, engine returned none, or data is unusable), the audio MUST still play normally and highlighting MUST be silently disabled for that post, with no errors surfaced to the reader. Missing, partial, and corrupt timings MUST all be treated identically, and the determination MUST be made up-front (at load or first play) so highlighting never briefly appears and then disappears.
- **FR-019**: The spoken words indicated by timing data MUST be mapped to the corresponding visible words in the rendered title and article body; when a reliable mapping cannot be established, highlighting MUST be disabled for that post (graceful fallback) rather than highlighting incorrect words. A mapping is considered unreliable when fewer than 90% of spoken words align, in order, to displayed words (or the sequences diverge past a short run of consecutive mismatches).
- **FR-020**: Posts with no readable content (which already have no audio) MUST continue to have no audio and no read-along — this feature MUST NOT introduce audio or highlighting for them.
- **FR-021**: Existing audio clips generated without timings MUST be regenerated through the existing generation path so that each clip gains word-timing data. Regeneration MUST be triggered by bumping the audio cache version (so every existing clip's deterministic cache key changes and is re-synthesized), MUST select clips in a timings-aware way (a clip lacking a timings record is eligible), and MUST be idempotent: re-running overwrites the same deterministic cache path rather than creating duplicates, and clips that already have timings are skipped. Superseded pre-version-bump files are reclaimed by the existing cache cleanup.
- **FR-022**: Audio generated after this feature (on demand or by the background job) MUST capture and store word timings automatically, with no manual step.
- **FR-023**: Regeneration/backfill MUST NOT disrupt playback of posts that already work; posts not yet regenerated MUST continue to play normally with highlighting disabled until their timings exist.
- **FR-024**: The active word MUST be selected as the last word whose start offset is at or before the current media time; between two spoken words (silence/pauses) the most recently started word MUST remain highlighted until the next word begins; no word MUST be highlighted before the first word's start; and the highlight MUST clear after the final word ends or when playback ends.
- **FR-025**: To map spoken words to displayed words, the client MUST build a single ordered sequence — the title's words followed by the body's words in document order — and align it to the ordered word-timing sequence. Matching MUST ignore case and surrounding punctuation, treat contractions and numbers as single tokens using the engine's source-text token (e.g. "2024" aligns even though it is spoken "twenty twenty-four"), and skip tokens the engine does not speak.
- **FR-026**: Text preparation for synthesis MUST insert separating whitespace where HTML tags are removed, so adjacent words are never fused into a single token (e.g. "for<code>x</code>loop" becomes "for x loop"), keeping spoken-word tokens countable against the displayed words. This applies to clips generated or regenerated after this change.

### Non-Functional Requirements

- **NFR-001**: With word-timing data present, the highlighted word MUST match the spoken word within 150 ms for at least 95% of words at 1x playback, and MUST remain correctly aligned to media time at 0.5x–3x.
- **NFR-002**: Highlighting and auto-scroll MUST NOT cause visible jank in the reading view during playback (updates should feel smooth on a typical mobile PWA device).
- **NFR-003**: The read-along experience MUST NOT degrade or alter existing audio playback, seeking, speed control, or the player UI for posts without timings.
- **NFR-004**: Word-timing data added to the audio API response MUST NOT meaningfully slow the existing audio request for typical article lengths.
- **NFR-005**: The feature MUST reuse the existing TTS engine, audio cache/store, background audio jobs, and player/reader components; it MUST NOT introduce a new external TTS service or paid dependency.

### Key Entities *(include if feature involves data)*

- **Word Timing**: Represents one spoken word within a clip — the source-text token, its start offset from the beginning of the audio, its duration (or, equivalently, an end offset), and its position/order in the sequence. Belongs to exactly one Audio clip; a clip has an ordered list of Word Timings spanning the title then the body, persisted as a sidecar record keyed by the clip's cache key.
- **Audio (existing)**: The cached TTS clip for a post. Associated with an ordered set of Word Timings stored in a sidecar file keyed by the clip's cache key. Clips without Word Timings are valid and simply play without read-along.
- **Read-Along Preferences (client-side)**: The reader's two independent choices — "Highlight while playing" and "Auto-scroll while playing" — each on/off, defaulting to on, persisted per device/browser (local storage). Not stored server-side.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a post with timing data played at 1x, the highlighted word matches the spoken word within 150 ms for at least 95% of words.
- **SC-002**: Highlighting remains correctly aligned to the spoken word across the full supported speed range (0.5x–3x) with no cumulative drift over a full-length article.
- **SC-003**: While audio plays (with auto-scroll on and reduce-motion off), the highlighted word remains visible within the reading area throughout playback without the reader scrolling manually.
- **SC-004**: Each toggle's chosen state is retained across a full app reload/new session 100% of the time.
- **SC-005**: 100% of posts whose audio lacks timing data play with zero errors and simply show no highlighting.
- **SC-006**: After backfill completes, every post that has audio and readable content also has word-timing data available for read-along.
- **SC-007**: The highlighted word meets WCAG AA color-contrast for readability.
- **SC-008**: With reduce-motion enabled, no animated scrolling occurs during playback while the active word is still kept in view.
- **SC-009**: Both toggles are fully operable with the keyboard and their state is announced to assistive technology.
- **SC-010**: During any silence or pause between spoken words, exactly one word (the most recently started) remains highlighted; the highlight never blanks between words while playback continues.
- **SC-011**: Re-running the backfill is safe and idempotent — it creates no duplicate clips, leaves clips that already have timings unchanged, and never interrupts playback of clips that already work.

## Assumptions

- The voice engine used for synthesis exposes per-word boundary information during synthesis (as edge-tts does, via streaming `WordBoundary` events rather than the fire-and-forget save path), which is the source of word text, start offset, and duration; no separate alignment/transcription service is needed. Each boundary's text is the original source-text token (so digits like "2024" and contractions like "don't" appear verbatim and align with the displayed word even when spoken differently).
- The synthesized text is the post title followed by the body content (matching current audio generation), so the ordered word timings cover title-then-body and both regions can be highlighted.
- The player already tracks the audio's current media time and playback rate (existing `useAudioPlayer`); the active word is derived from that current time, so no new clock or timer of record is introduced for synchronization. Because the existing time-update event is too coarse (~4x/second), the highlighter samples the current media time on an animation-frame cadence to meet the 150 ms tolerance at up to 3x.
- Reduced-motion is detected via the standard browser "prefers-reduced-motion" preference.
- Toggle persistence is per device/browser via local storage and is intentionally separate from any server-side user profile settings.
- Backfill/regeneration reuses the existing generation and cleanup paths and is triggered by bumping the audio cache version, which changes every clip's deterministic cache key so each is re-synthesized (capturing timings) on next generation; it is idempotent (same text/voice/version → same cache path → overwrite, and clips that already have timings are skipped), and superseded files are reclaimed by the existing cache cleanup. On-demand generation also produces timings going forward.
- Word timings are persisted as a sidecar JSON file beside the clip's `.mp3`, keyed by the same cache key, and served to the client alongside the audio metadata.
- Word-boundary granularity is whatever the engine emits (typically whole spoken words); tokens the engine does not speak (pure punctuation/whitespace) will not be highlighted.
- Highlighting and read-along are scoped to the Post Detail page's article view (title + rendered body), consistent with where TTS playback lives today.
- Out of scope for this feature: sentence-level-only highlighting, translation of content, and any non-TTS audio.

## Dependencies

- Existing TTS abstraction and edge-tts-based synthesis (word-boundary events).
- Existing cache-backed Audio store and the audio API that serves clips to the client.
- Existing background audio-generation and audio-cleanup jobs (used for backfill/regeneration).
- Existing Post Detail reading view and audio player (title + body rendering, current-time/speed-aware playback UI).
