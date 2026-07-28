# Floating Audio Controls — Design

**Date:** 2026-07-28
**Status:** Approved (design)
**Area:** Frontend — Post Detail page audio playback

## Problem

On the Post Detail page, the audio player (play/pause, waveform progress bar, and
speed control) is rendered near the top of the article. While a clip plays —
especially with read-along **auto-scroll** enabled — the page scrolls to follow
the highlighted word, pushing the inline player (and all its controls) off-screen.
To pause/resume or change speed, the reader currently has to scroll back up,
fighting the auto-scroll.

## Goal

When the inline player is scrolled out of view and a clip is active, show two
fixed **floating circles** in the lower-right corner — a **play/resume** control
and a **speed** control (which expands a stack of speed options upward) — so the
reader can control playback and speed without scrolling back to the inline player
and without fighting auto-scroll.

## Non-Goals

- No progress bar / scrubbing in the floating controls (play/pause + speed only).
- No new audio session model — the floating controls drive the **existing**
  `<audio>` element via the existing player hook.
- No changes to the inline `AudioPlayer`'s current behavior or appearance.
- Not shown on list/reader pages (audio playback only exists on Post Detail).

## User-Facing Behavior

- **When they appear:** whenever a clip is **active** (playing **or** paused)
  **and** the inline player is fully scrolled off-screen. A generated-but-never-
  played clip shows nothing yet; the first play/pause is what makes a clip active.
- **When they hide:** when the inline player scrolls back into view, when the
  article footer actions scroll into view (so they never overlap "Read Original"),
  or when the clip is no longer active.
- **Play/resume circle** (bottom): shows a Pause icon while playing and a Play
  icon while paused; tapping toggles playback. Pausing here also stops auto-scroll
  (auto-scroll runs only while playing); resuming restarts it.
- **Speed circle** (directly above): shows the current rate as text (e.g. `1.5x`).
  Tapping it expands a vertical stack of speed pills **upward**:
  `0.5, 1, 1.2, 1.5, 2, 2.5, 3×`. The active rate is highlighted. Tapping a pill
  sets the rate and collapses the stack; Escape or a click/tap away also collapses
  it, returning focus to the speed circle.

## Architecture

### New component: `FloatingAudioControls`

Path: `frontend/src/components/FloatingAudioControls.tsx`

Single responsibility: decide visibility and render the floating controls,
forwarding taps to the existing player. It holds no audio state of its own.

```ts
interface FloatingAudioControlsProps {
  /** The same player object the inline AudioPlayer receives. */
  player: UseAudioPlayerResult;
  /** The inline player's container element; observed for on-screen visibility. */
  anchorRef: RefObject<HTMLElement>;
  /** The article footer actions row; hides the controls when it is in view. */
  footerRef?: RefObject<HTMLElement>;
}
```

### Visibility logic

- A single `useEffect` creates an `IntersectionObserver` on `anchorRef.current`
  with `threshold: 0`. `playerOffscreen = !entry.isIntersecting` (true only when
  the inline player is fully out of view). The observer is disconnected on
  cleanup. No scroll listeners.
- When `footerRef` is provided, a second observer tracks `footerVisible` the same
  way.
- `activeClip = player.isPlaying || player.status === "paused"`.
- `visible = activeClip && playerOffscreen && !footerVisible`.

### Data flow / interop

The component calls the same handlers the inline player uses:
`player.toggle()`, `player.playbackRate`, `player.setPlaybackRate(rate)`. Because
it drives the one shared media element:

- Read-along highlighting continues to track normally.
- Pausing from the floating control stops auto-scroll; resuming restarts it — the
  core "don't fight the auto-scroll" outcome.

### Wiring in `PostDetailPage`

Path: `frontend/src/pages/posts/PostDetailPage.tsx`

- Add a `playerRef` on the existing inline-player `Box` (the `<Box sx={{ my: 2 }}>`
  that wraps `<AudioPlayer />`).
- Add a `footerRef` on the footer actions `Box` (the "Back to Posts" / "Read
  Original" row).
- Render `<FloatingAudioControls player={player} anchorRef={playerRef}
  footerRef={footerRef} />` once. `AudioPlayer` itself is unchanged.

### Shared constant

Lift `PLAYBACK_SPEEDS` (currently a private const in `AudioPlayer.tsx`) into a
shared module (`frontend/src/constants/audio.ts`) so the inline player and the
floating control share one source of truth. Update `AudioPlayer.tsx` to import it.

## UI / Placement Details

- Two circular MUI `Fab`s, `position: fixed`, lower-right. The play/resume circle
  sits at the bottom (primary action, most thumb-reachable); the speed circle is
  directly above it; the speed pills expand upward from the speed circle.
- The stack is offset above `env(safe-area-inset-bottom)` (PWA safe area) with a
  comfortable margin from the right edge, and a z-index above page content but
  below modals/menus.
- Fixed positioning means auto-scroll never moves the controls.
- Expansion/fade animations are instant when `prefers-reduced-motion: reduce`.

## Accessibility

- Both circles are real buttons: keyboard-focusable, activated by Enter/Space,
  with `aria-label`s ("Play"/"Pause", "Playback speed").
- Speed pills are buttons labelled e.g. "Set speed 1.5×"; the current rate is
  marked `aria-pressed`.
- The speed stack closes on Escape and on click/tap away, returning focus to the
  speed circle.
- The highlighted/active states meet WCAG AA contrast using the existing primary
  palette.
- The inline player remains in the DOM; the floating buttons are supplementary
  controls for the same audio (duplicate play/pause controls are acceptable).

## Edge Cases

- **End of clip:** on the media `ended` event, `useAudioPlayer` resets to
  `status: "ready"` with `currentTime` back to `0`. `activeClip` therefore becomes
  false and the floating controls disappear (the listening session is over).
  Starting a new playback is done from the inline player.
- **Footer overlap:** avoided by hiding the controls while the footer actions are
  in view (`footerRef`).
- **Idle / loading / error / ready-not-yet-played:** `activeClip` is false, so
  nothing renders.
- **Rapid intersection toggles:** handled natively by `IntersectionObserver`; no
  debounce needed.
- **Desktop:** the article is centered with wide margins; the fixed circles sit in
  the viewport's lower-right corner, clear of the content column.

## Testing

### Vitest — `frontend/src/components/__tests__/FloatingAudioControls.test.tsx` (new)

With a mocked `IntersectionObserver` (jsdom has none) exposed via a small test
helper that lets a test drive intersection callbacks:

- hidden when the inline player is on-screen;
- hidden when no clip is active (idle/ready-not-played);
- hidden when the footer is in view;
- visible when active **and** the player is off-screen;
- play/pause taps call `player.toggle`, and the icon reflects `isPlaying`;
- the speed circle shows the current rate;
- opening shows the pill stack; selecting a pill calls `setPlaybackRate` and
  collapses; Escape and click-away collapse it.

### Playwright — extend `frontend/playwright/read-along.spec.ts`

Reusing that spec's timing-backed audio setup and off-screen scrolling, add a
scenario: on a post with audio, play, scroll the inline player off-screen → the
circles appear; tap pause on the circle → audio pauses; open speed → pick 2× →
the rate changes; scroll back up → the circles disappear.

## Files Touched

- `frontend/src/components/FloatingAudioControls.tsx` — new.
- `frontend/src/constants/audio.ts` — new (shared `PLAYBACK_SPEEDS`).
- `frontend/src/components/AudioPlayer.tsx` — import shared `PLAYBACK_SPEEDS`.
- `frontend/src/pages/posts/PostDetailPage.tsx` — add `playerRef`/`footerRef`,
  render `FloatingAudioControls`.
- `frontend/src/components/__tests__/FloatingAudioControls.test.tsx` — new.
- `frontend/playwright/read-along.spec.ts` — add the floating-controls e2e scenario.
