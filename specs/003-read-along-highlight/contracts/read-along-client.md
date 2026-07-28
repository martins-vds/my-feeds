# Contract: Read-Along Client (hooks, utils, components)

**Feature**: `003-read-along-highlight`
**Owners**: [useAudioPlayer.ts](../../../frontend/src/hooks/useAudioPlayer.ts), new `useReadAlong.ts` / `useReadAlongPreferences.ts`, new `utils/alignTimings.ts` / `utils/wrapWords.ts`, [PostDetailPage.tsx](../../../frontend/src/pages/posts/PostDetailPage.tsx), [PostContent.tsx](../../../frontend/src/components/PostContent.tsx), [AudioPlayer.tsx](../../../frontend/src/components/AudioPlayer.tsx), new `ReadAlongToggles.tsx`

These are internal TypeScript contracts (a PWA, not a public library). Signatures are indicative; tests below are normative.

---

## 1. `useAudioPlayer` — additive surface

Extend the existing result so the read-along layer can read media time on a frame cadence and consume timings (both come from the same `GET /posts/{id}/audio` call the hook already makes):

```ts
interface UseAudioPlayerResult {
  // ...existing fields (status, currentTime, playbackRate, play, pause, seek, ...)
  wordTimings: WordTiming[] | null;      // from READY response; null when omitted
  getMediaElement: () => HTMLAudioElement | null; // stable accessor to the live <audio>
  isPlaying: boolean;                    // convenience; derived from status
}
```
- `wordTimings` mirrors the API field (omitted → `null`).
- `getMediaElement()` returns the current element (or `null`) without forcing re-renders; the read-along hook reads `.currentTime` / `.paused` from it per frame.
- Existing behavior (timeupdate → `currentTime`, seek, rate, ended) is unchanged.

---

## 2. `utils/alignTimings.ts`

```ts
function normalizeToken(raw: string): string;
// lowercase; strip leading/trailing punctuation; keep internal apostrophes & digits.

interface AlignmentResult {
  enabled: boolean;                 // ≥90% aligned in order AND no over-long mismatch run
  timingToDisplay: Int32Array;      // timing index -> display index (-1 if unmapped)
  matchedRatio: number;
}
function alignSpokenToDisplay(
  spoken: string[],                 // normalized timing tokens (spoken order)
  display: string[],                // normalized display tokens (title ++ body, DOM order)
): AlignmentResult;
```
Rules (FR-019/025): linear greedy walk; the **display** side may skip non-spoken tokens; contractions/numbers align via the source token; compute `matchedRatio = matchedSpoken / spoken.length`; `enabled = matchedRatio ≥ 0.9 && !divergedPastRun`.

### Vitest (`utils/alignTimings.test.ts`)
- Normalization: case, edge punctuation, `don't`, `2024`, hyphenates.
- Perfect match → `enabled`, full map.
- Display has extra non-spoken tokens (punctuation nodes) → still `enabled`, spoken tokens mapped.
- <90% aligned or long mismatch run → `enabled === false`.
- Title-then-body concatenation and the `". "` seam produce a single continuous sequence (no seam marker).

---

## 3. `utils/wrapWords.ts`

```ts
interface WrapResult { count: number; elements: HTMLElement[]; } // elements[index] = span
function wrapWords(container: HTMLElement, startIndex: number): WrapResult;
```
- Walks text nodes via `TreeWalker`; wraps each whitespace-delimited token in `<span class="ra-word" data-ra-index="N">`, indices continuing from `startIndex`.
- **Idempotent**: skips nodes already inside a `.ra-word` (safe to call after re-render).
- Preserves sanitized structure and links; inserts **no** HTML from strings (no new XSS surface — only splits existing text nodes).

### Vitest (`utils/wrapWords.test.ts`)
- Wraps N words into N indexed spans; `elements[i].dataset.raIndex === String(i)`.
- Words split across tag boundaries (`for<code>x</code>loop`) count as 3 spans.
- Idempotent second call adds no duplicates.
- Anchor (`<a>`) text is wrapped without losing `href`/`target`/`rel`.

---

## 4. `useReadAlong(player, titleRef, contentRef, prefs)`

Coordinates alignment, wrapping, active-word tracking, highlighting, and auto-scroll.

```ts
function useReadAlong(args: {
  timings: WordTiming[] | null;
  getMediaElement: () => HTMLAudioElement | null;
  isPlaying: boolean;
  titleRef: RefObject<HTMLElement>;
  contentRef: RefObject<HTMLElement>;
  highlightEnabled: boolean;   // toggle
  autoScrollEnabled: boolean;  // toggle
}): { highlightingActive: boolean };  // false when disabled/no-timings/misaligned
```
Behavior:
- **Up-front eligibility (FR-018)**: build display tokens (title ++ body), run `alignSpokenToDisplay`; if `timings` null/empty or `enabled === false`, do nothing (audio still plays). No highlight ever flashes.
- **Wrapping**: wrap title + content once when eligible.
- **Active word (FR-002/024)**: on `requestAnimationFrame` while `isPlaying`, read `mediaMs = el.currentTime * 1000`; `activeTimingIndex` = greatest `i` with `startMs[i] ≤ mediaMs` (hold across gaps; `-1` before first; clear after last end / on `ended`). Map to display index; on change, remove highlight class from the old span and add to the new (O(1)).
- **Pause/seek/rate**: derived from media time — freezes on pause, jumps on seek, correct at 0.5x–3x.
- **Toggle highlight off mid-play**: immediately clears the active span and stops the rAF work.
- **Auto-scroll (FR-006/007/008)**: only while playing and `autoScrollEnabled`; when the active span leaves a central comfort band, `scrollIntoView({ block: "center", behavior })` with `behavior = reducedMotion ? "auto" : "smooth"`; ≤1 reposition/frame; `reducedMotion` from `matchMedia('(prefers-reduced-motion: reduce)')` (live-updating). Manual scroll respected; resumes on next advance.

### Vitest (`hooks/useReadAlong.test.ts`) — with fake timers, mocked rAF & `matchMedia`
- Active index selection: last-start-≤-t; hold across gaps; `-1` before first; clears after last/`ended`.
- Speed independence: same media time → same active word at 0.5x/1x/3x.
- Highlight toggle off clears immediately; on resumes from current position.
- Auto-scroll: triggers only outside comfort band, only while playing; reduced-motion uses instant reposition; disabled toggle → no scroll.
- Not eligible (no timings / <90%) → `highlightingActive === false`, no wrapping, no DOM mutation.

---

## 5. `useReadAlongPreferences()`

```ts
function useReadAlongPreferences(): {
  highlight: boolean; setHighlight: (v: boolean) => void;
  autoScroll: boolean; setAutoScroll: (v: boolean) => void;
};
```
- Backed by `localStorage` keys `readAlong.highlight`, `readAlong.autoScroll`; unset → `true`; independent (FR-009–012).

### Vitest (`hooks/useReadAlongPreferences.test.ts`)
- Defaults to `true/true` when storage empty.
- Persists each toggle independently; survives re-mount (new session).

---

## 6. Components

- **`ReadAlongToggles.tsx`**: two MUI `Switch` controls with visible labels ("Highlight while playing", "Auto-scroll while playing"), keyboard-operable, state exposed to assistive tech (FR-013/SC-009). Rendered near the player on the Post Detail page.
- **`PostContent.tsx`**: expose the body container ref (e.g. `forwardRef` or a `containerRef` prop) so the wrapper can target the rendered article. Sanitization unchanged.
- **`AudioPlayer.tsx`**: becomes controlled — receives player state/handlers via props from `PostDetailPage` (which now owns `useAudioPlayer`). Visual/player behavior unchanged for timing-less posts (NFR-003).
- **`PostDetailPage.tsx`**: owns `useAudioPlayer`, holds `titleRef` (wrap the `<Typography>` title words) and `contentRef`, reads `useReadAlongPreferences`, and mounts `useReadAlong(...)` + `<ReadAlongToggles />`.

### Playwright (`frontend/playwright/read-along.spec.ts`)
- Play a timing-backed post → a single word highlights and advances; pause holds; end clears.
- Toggles persist across reload; highlight-off shows no highlight; auto-scroll-off stops scrolling.
- Auto-scroll keeps the active word visible on a long post; reduced-motion (emulated) uses no smooth scroll.
- Fallback post (no timings) plays normally with **no** highlight and **no** error; toggles keyboard-operable.

---

## Highlight styling
- `.ra-word.ra-active` uses a theme-aware background+text meeting WCAG AA (≥4.5:1) in light and dark themes (FR-014/SC-007). Non-active `.ra-word` spans are visually identical to surrounding text (layout-neutral wrapping).
