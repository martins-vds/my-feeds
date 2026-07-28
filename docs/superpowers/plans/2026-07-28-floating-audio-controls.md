# Floating Audio Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show floating play/resume + speed circles in the lower-right of the Post Detail page whenever the inline audio player is scrolled off-screen and a clip is active, so the reader can control playback without fighting auto-scroll.

**Architecture:** A new self-contained `FloatingAudioControls` component observes the inline player's on-screen visibility with `IntersectionObserver` and renders two fixed-position MUI `Fab`s that drive the *same* `useAudioPlayer` object the inline `AudioPlayer` already uses. No new audio state; `AudioPlayer`'s behavior is unchanged apart from importing a shared speeds constant.

**Tech Stack:** React 18 + TypeScript (strict), Vite, MUI 5, Vitest + @testing-library/react, Playwright. Package manager pnpm. All tests run inside Docker.

## Global Constraints

- Frontend framework/versions: React 18, TypeScript strict, MUI 5, Vite (verbatim from the existing stack — do not add new runtime dependencies).
- Supported playback speeds (verbatim): `0.5, 1, 1.2, 1.5, 2, 2.5, 3`.
- Reuse the existing `useAudioPlayer` element — do NOT create a second `<audio>` or audio session.
- `AudioPlayer.tsx`'s visible behavior/appearance MUST stay unchanged (only its `PLAYBACK_SPEEDS` source moves).
- Visibility rule (verbatim): controls are shown only when `activeClip && !playerOnScreen && !footerOnScreen`, where `activeClip = player.isPlaying || player.status === "paused"`.
- Positioning: `position: fixed`, lower-right, above `env(safe-area-inset-bottom)`, `zIndex: theme.zIndex.speedDial`.
- Accessibility: circles and pills are real buttons with `aria-label`s; speed stack closes on Escape and click-away; AA contrast via the existing `primary`/`background.paper` palette.
- Test commands (run in Docker from repo root):
  - Vitest (one file): `docker compose exec -T frontend pnpm exec vitest run <path>`
  - Typecheck: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
  - Playwright: `docker compose exec -T frontend sh -lc 'npx playwright test read-along.spec.ts --reporter=line'`

---

## File Structure

- `frontend/src/constants/audio.ts` — **new.** Single source of truth for `PLAYBACK_SPEEDS`.
- `frontend/src/components/AudioPlayer.tsx` — **modify.** Import `PLAYBACK_SPEEDS` from the shared constant (remove the local copy). No other change.
- `frontend/src/components/FloatingAudioControls.tsx` — **new.** The floating controls + visibility hook. One responsibility.
- `frontend/src/components/__tests__/FloatingAudioControls.test.tsx` — **new.** Vitest unit tests (mocked `IntersectionObserver`).
- `frontend/src/pages/posts/PostDetailPage.tsx` — **modify.** Add `playerRef`/`footerRef`, render `<FloatingAudioControls />`.
- `frontend/playwright/read-along.spec.ts` — **modify.** Add the floating-controls e2e scenario.

---

## Task 1: Shared `PLAYBACK_SPEEDS` constant

**Files:**
- Create: `frontend/src/constants/audio.ts`
- Create: `frontend/src/constants/__tests__/audio.test.ts`
- Modify: `frontend/src/components/AudioPlayer.tsx` (replace the local `PLAYBACK_SPEEDS` const with an import)

**Interfaces:**
- Produces: `export const PLAYBACK_SPEEDS: readonly number[]` = `[0.5, 1, 1.2, 1.5, 2, 2.5, 3]`

- [ ] **Step 1: Write the failing test**

`frontend/src/constants/__tests__/audio.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { PLAYBACK_SPEEDS } from "../audio";

describe("PLAYBACK_SPEEDS", () => {
    it("lists the supported playback rates including 1x", () => {
        expect([...PLAYBACK_SPEEDS]).toEqual([0.5, 1, 1.2, 1.5, 2, 2.5, 3]);
        expect(PLAYBACK_SPEEDS).toContain(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/constants/__tests__/audio.test.ts`
Expected: FAIL — cannot resolve module `../audio`.

- [ ] **Step 3: Create the constant**

`frontend/src/constants/audio.ts`:
```ts
/** Supported audio playback speeds, shared by the inline and floating players. */
export const PLAYBACK_SPEEDS: readonly number[] = [0.5, 1, 1.2, 1.5, 2, 2.5, 3];
```

- [ ] **Step 4: Point `AudioPlayer` at the shared constant**

In `frontend/src/components/AudioPlayer.tsx`, add the import near the other imports:
```ts
import { PLAYBACK_SPEEDS } from "../constants/audio";
```
Then delete the local declaration line:
```ts
// Available playback speeds for the audio player.
const PLAYBACK_SPEEDS = [0.5, 1, 1.2, 1.5, 2, 2.5, 3];
```

- [ ] **Step 5: Run tests + typecheck to verify green**

Run: `docker compose exec -T frontend pnpm exec vitest run src/constants/__tests__/audio.test.ts src/components/__tests__/AudioPlayer.test.tsx`
Expected: PASS (new constant test + existing AudioPlayer tests, including the speed-menu test).
Run: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/constants/audio.ts frontend/src/constants/__tests__/audio.test.ts frontend/src/components/AudioPlayer.tsx
git commit -m "refactor: extract PLAYBACK_SPEEDS to a shared constant"
```

---

## Task 2: `FloatingAudioControls` — visibility + play/pause

**Files:**
- Create: `frontend/src/components/FloatingAudioControls.tsx`
- Create/Test: `frontend/src/components/__tests__/FloatingAudioControls.test.tsx`

**Interfaces:**
- Consumes: `UseAudioPlayerResult` from `../hooks/useAudioPlayer`; `PLAYBACK_SPEEDS` from `../constants/audio` (used in Task 3).
- Produces:
  - `export interface FloatingAudioControlsProps { player: UseAudioPlayerResult; anchorRef: RefObject<HTMLElement>; footerRef?: RefObject<HTMLElement>; }`
  - `export function FloatingAudioControls(props: FloatingAudioControlsProps): JSX.Element | null`
  - Test ids: `floating-audio-controls`, `floating-play-button`, `floating-speed-button` (Task 3 adds `floating-speed-options`).

- [ ] **Step 1: Write the failing tests (test harness + visibility + play/pause)**

`frontend/src/components/__tests__/FloatingAudioControls.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { useRef } from "react";
import { FloatingAudioControls } from "../FloatingAudioControls";
import type { UseAudioPlayerResult } from "../../hooks/useAudioPlayer";

// ── IntersectionObserver mock (jsdom has none) ─────────────────────────
const observers: { cb: IntersectionObserverCallback; els: Set<Element> }[] = [];

class MockIO implements IntersectionObserver {
    root: Element | null = null;
    rootMargin = "";
    thresholds: ReadonlyArray<number> = [];
    private cb: IntersectionObserverCallback;
    els = new Set<Element>();
    constructor(cb: IntersectionObserverCallback) {
        this.cb = cb;
        observers.push({ cb, els: this.els });
    }
    observe(el: Element) { this.els.add(el); }
    unobserve(el: Element) { this.els.delete(el); }
    disconnect() { this.els.clear(); }
    takeRecords(): IntersectionObserverEntry[] { return []; }
}

/** Fire an intersection change for `target` on every observer watching it. */
function setIntersecting(target: Element, isIntersecting: boolean) {
    act(() => {
        for (const o of observers) {
            if (o.els.has(target)) {
                o.cb(
                    [{ target, isIntersecting } as IntersectionObserverEntry],
                    {} as IntersectionObserver
                );
            }
        }
    });
}

// ── Player mock ────────────────────────────────────────────────────────
function makePlayer(overrides: Partial<UseAudioPlayerResult> = {}): UseAudioPlayerResult {
    return {
        status: "playing",
        audioUrl: "blob:x",
        durationSeconds: 100,
        currentTime: 0,
        progress: 0,
        error: null,
        generateAudio: vi.fn(),
        play: vi.fn(),
        pause: vi.fn(),
        toggle: vi.fn(),
        seek: vi.fn(),
        playbackRate: 1,
        setPlaybackRate: vi.fn(),
        wordTimings: null,
        getMediaElement: () => null,
        isPlaying: true,
        ...overrides,
    };
}

// ── Harness: gives the component real anchor/footer elements ───────────
function Harness({
    player,
    withFooter = true,
}: {
    player: UseAudioPlayerResult;
    withFooter?: boolean;
}) {
    const anchorRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLDivElement>(null);
    return (
        <div>
            <div ref={anchorRef} data-testid="anchor">player</div>
            <div ref={footerRef} data-testid="footer">footer</div>
            <FloatingAudioControls
                player={player}
                anchorRef={anchorRef}
                footerRef={withFooter ? footerRef : undefined}
            />
        </div>
    );
}

beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal("IntersectionObserver", MockIO);
});
afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

/** Render, then scroll the inline player off-screen (active + off-screen). */
function renderOffscreen(player: UseAudioPlayerResult) {
    const view = render(<Harness player={player} />);
    setIntersecting(screen.getByTestId("anchor"), false);
    return view;
}

describe("FloatingAudioControls — visibility", () => {
    it("renders nothing while the inline player is on-screen", () => {
        render(<Harness player={makePlayer()} />);
        expect(screen.queryByTestId("floating-audio-controls")).toBeNull();
    });

    it("renders nothing when no clip is active", () => {
        render(<Harness player={makePlayer({ status: "ready", isPlaying: false })} />);
        setIntersecting(screen.getByTestId("anchor"), false);
        expect(screen.queryByTestId("floating-audio-controls")).toBeNull();
    });

    it("shows the controls when a clip is active and the player is off-screen", () => {
        renderOffscreen(makePlayer());
        expect(screen.queryByTestId("floating-audio-controls")).not.toBeNull();
    });

    it("stays visible for a paused (still active) clip", () => {
        renderOffscreen(makePlayer({ status: "paused", isPlaying: false }));
        expect(screen.queryByTestId("floating-audio-controls")).not.toBeNull();
    });

    it("hides again when the footer scrolls into view", () => {
        renderOffscreen(makePlayer());
        expect(screen.queryByTestId("floating-audio-controls")).not.toBeNull();
        setIntersecting(screen.getByTestId("footer"), true);
        expect(screen.queryByTestId("floating-audio-controls")).toBeNull();
    });
});

describe("FloatingAudioControls — play/pause", () => {
    it("shows Pause while playing and calls toggle on click", () => {
        const player = makePlayer({ isPlaying: true });
        renderOffscreen(player);
        const btn = screen.getByTestId("floating-play-button");
        expect(btn.getAttribute("aria-label")).toBe("Pause");
        fireEvent.click(btn);
        expect(player.toggle).toHaveBeenCalledTimes(1);
    });

    it("shows Play while paused", () => {
        renderOffscreen(makePlayer({ status: "paused", isPlaying: false }));
        expect(
            screen.getByTestId("floating-play-button").getAttribute("aria-label")
        ).toBe("Play");
    });
});

// NOTE: `makePlayer`, `Harness`, `renderOffscreen`, `setIntersecting` are reused by Task 3.
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/FloatingAudioControls.test.tsx`
Expected: FAIL — cannot resolve `../FloatingAudioControls`.

- [ ] **Step 3: Implement the component (visibility + play/pause; speed stub for now)**

`frontend/src/components/FloatingAudioControls.tsx`:
```tsx
import { useEffect, useState, type RefObject } from "react";
import { Box, Fab } from "@mui/material";
import { PlayArrow as PlayIcon, Pause as PauseIcon } from "@mui/icons-material";
import type { UseAudioPlayerResult } from "../hooks/useAudioPlayer";

export interface FloatingAudioControlsProps {
    /** The same player object the inline AudioPlayer receives. */
    player: UseAudioPlayerResult;
    /** The inline player's container; observed for on-screen visibility. */
    anchorRef: RefObject<HTMLElement>;
    /** The article footer actions row; hides the controls when it is in view. */
    footerRef?: RefObject<HTMLElement>;
}

/**
 * Track whether `ref.current` currently intersects the viewport (threshold 0).
 * Returns `initial` until the observer first reports, and when there is no
 * element or no IntersectionObserver support.
 */
function useOnScreen(
    ref: RefObject<HTMLElement> | undefined,
    initial: boolean
): boolean {
    const [onScreen, setOnScreen] = useState(initial);
    useEffect(() => {
        const el = ref?.current;
        if (!el || typeof IntersectionObserver !== "function") return;
        const observer = new IntersectionObserver(
            (entries) => setOnScreen(entries[0]?.isIntersecting ?? false),
            { threshold: 0 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);
    return onScreen;
}

/**
 * Floating play/resume + speed circles shown in the lower-right when the inline
 * audio player is scrolled off-screen and a clip is active. Drives the same
 * player element, so read-along and auto-scroll respond exactly as they do for
 * the inline controls.
 */
export function FloatingAudioControls({
    player,
    anchorRef,
    footerRef,
}: FloatingAudioControlsProps) {
    const playerOnScreen = useOnScreen(anchorRef, true);
    const footerOnScreen = useOnScreen(footerRef, false);

    const activeClip = player.isPlaying || player.status === "paused";
    const visible = activeClip && !playerOnScreen && !footerOnScreen;

    if (!visible) return null;

    return (
        <Box
            data-testid="floating-audio-controls"
            sx={{
                position: "fixed",
                right: 16,
                bottom: "calc(16px + env(safe-area-inset-bottom))",
                zIndex: (theme) => theme.zIndex.speedDial,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
            }}
        >
            <Fab
                color="primary"
                aria-label={player.isPlaying ? "Pause" : "Play"}
                data-testid="floating-play-button"
                onClick={player.toggle}
            >
                {player.isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Fab>
        </Box>
    );
}

export default FloatingAudioControls;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/FloatingAudioControls.test.tsx`
Expected: PASS (visibility + play/pause groups).
Run: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FloatingAudioControls.tsx frontend/src/components/__tests__/FloatingAudioControls.test.tsx
git commit -m "feat: floating audio controls visibility + play/pause"
```

---

## Task 3: `FloatingAudioControls` — speed circle + upward pill stack

**Files:**
- Modify: `frontend/src/components/FloatingAudioControls.tsx`
- Modify: `frontend/src/components/__tests__/FloatingAudioControls.test.tsx` (append a describe block)

**Interfaces:**
- Consumes: `PLAYBACK_SPEEDS` from `../constants/audio`; `player.playbackRate`, `player.setPlaybackRate` from `UseAudioPlayerResult`.
- Produces: adds test id `floating-speed-options`; speed pills expose `aria-label="Set speed <n>x"`.

- [ ] **Step 1: Append the failing speed tests**

Append to `frontend/src/components/__tests__/FloatingAudioControls.test.tsx`:
```tsx
describe("FloatingAudioControls — speed", () => {
    function open(player = makePlayer({ playbackRate: 1 })) {
        renderOffscreen(player);
        fireEvent.click(screen.getByTestId("floating-speed-button"));
        return player;
    }

    it("shows the current playback rate on the speed circle", () => {
        renderOffscreen(makePlayer({ playbackRate: 1.5 }));
        expect(screen.getByTestId("floating-speed-button").textContent).toBe("1.5x");
    });

    it("opens the speed options with all supported rates", () => {
        open();
        const opts = screen.getByTestId("floating-speed-options");
        expect(opts.querySelectorAll("button").length).toBe(7);
    });

    it("selecting a rate calls setPlaybackRate and closes the options", () => {
        const player = open();
        fireEvent.click(screen.getByLabelText("Set speed 2x"));
        expect(player.setPlaybackRate).toHaveBeenCalledWith(2);
        expect(screen.queryByTestId("floating-speed-options")).toBeNull();
    });

    it("closes the options on Escape", () => {
        open();
        fireEvent.keyDown(screen.getByTestId("floating-audio-controls"), { key: "Escape" });
        expect(screen.queryByTestId("floating-speed-options")).toBeNull();
    });

    it("closes the options when clicking away", () => {
        open();
        fireEvent.click(document.body);
        expect(screen.queryByTestId("floating-speed-options")).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify the new group fails**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/FloatingAudioControls.test.tsx`
Expected: FAIL — no `floating-speed-button` / `floating-speed-options` yet.

- [ ] **Step 3: Add the speed control to the component**

Update `frontend/src/components/FloatingAudioControls.tsx`. Replace the import block and the returned JSX so the speed circle + pill stack are added above the play circle:

Imports (replace the top imports):
```tsx
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Box, Fab, Stack, Button, ClickAwayListener } from "@mui/material";
import { PlayArrow as PlayIcon, Pause as PauseIcon } from "@mui/icons-material";
import type { UseAudioPlayerResult } from "../hooks/useAudioPlayer";
import { PLAYBACK_SPEEDS } from "../constants/audio";
```

Inside the component, add speed state above the `visible` computation:
```tsx
    const [speedOpen, setSpeedOpen] = useState(false);
    const speedFabRef = useRef<HTMLButtonElement>(null);
```

After `const visible = ...`, add:
```tsx
    // Collapse the speed stack whenever the controls hide.
    useEffect(() => {
        if (!visible) setSpeedOpen(false);
    }, [visible]);

    const closeSpeed = useCallback(() => {
        setSpeedOpen(false);
        speedFabRef.current?.focus();
    }, []);
```

Replace the returned JSX (the `<Box data-testid="floating-audio-controls">…</Box>`) with:
```tsx
    return (
        <Box
            data-testid="floating-audio-controls"
            onKeyDown={(e) => {
                if (e.key === "Escape" && speedOpen) closeSpeed();
            }}
            sx={{
                position: "fixed",
                right: 16,
                bottom: "calc(16px + env(safe-area-inset-bottom))",
                zIndex: (theme) => theme.zIndex.speedDial,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
            }}
        >
            <ClickAwayListener onClickAway={() => setSpeedOpen(false)}>
                <Box
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: 1,
                    }}
                >
                    {speedOpen && (
                        <Stack
                            spacing={0.5}
                            alignItems="center"
                            data-testid="floating-speed-options"
                        >
                            {PLAYBACK_SPEEDS.map((speed) => (
                                <Button
                                    key={speed}
                                    size="small"
                                    variant={speed === player.playbackRate ? "contained" : "text"}
                                    aria-pressed={speed === player.playbackRate}
                                    aria-label={`Set speed ${speed}x`}
                                    onClick={() => {
                                        player.setPlaybackRate(speed);
                                        closeSpeed();
                                    }}
                                    sx={{
                                        minWidth: 56,
                                        borderRadius: 999,
                                        bgcolor: "background.paper",
                                        boxShadow: 2,
                                    }}
                                >
                                    {speed}x
                                </Button>
                            ))}
                        </Stack>
                    )}
                    <Fab
                        ref={speedFabRef}
                        size="small"
                        color="default"
                        aria-label="Playback speed"
                        aria-expanded={speedOpen}
                        data-testid="floating-speed-button"
                        onClick={() => setSpeedOpen((o) => !o)}
                    >
                        {player.playbackRate}x
                    </Fab>
                </Box>
            </ClickAwayListener>
            <Fab
                color="primary"
                aria-label={player.isPlaying ? "Pause" : "Play"}
                data-testid="floating-play-button"
                onClick={player.toggle}
            >
                {player.isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Fab>
        </Box>
    );
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `docker compose exec -T frontend pnpm exec vitest run src/components/__tests__/FloatingAudioControls.test.tsx`
Expected: PASS (visibility + play/pause + speed groups).
Run: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FloatingAudioControls.tsx frontend/src/components/__tests__/FloatingAudioControls.test.tsx
git commit -m "feat: floating audio speed control with upward pill stack"
```

---

## Task 4: Wire into `PostDetailPage` + Playwright e2e

**Files:**
- Modify: `frontend/src/pages/posts/PostDetailPage.tsx`
- Modify: `frontend/playwright/read-along.spec.ts`

**Interfaces:**
- Consumes: `FloatingAudioControls` from `../../components/FloatingAudioControls`; the existing `player` (`useAudioPlayer`).
- Produces: the integrated feature; e2e coverage of appear/pause/speed/hide.

- [ ] **Step 1: Write the failing e2e**

Append to `frontend/playwright/read-along.spec.ts` (reuses the existing `mockApi`, `makePostDetail`, `makeWav`, `WORD_TIMINGS`, `authedPage` from the file):
```ts
// ── Floating audio controls ─────────────────────────────────────────────
const floatingBody =
    "<p>one two three four five</p>" +
    Array.from(
        { length: 40 },
        (_, i) =>
            `<p>Filler paragraph ${i} with enough text to push the inline audio player well above the viewport so the floating controls take over.</p>`
    ).join("");

const floatingPost = makePostDetail("feed-1", {
    id: "floating-post",
    title: "Floating Controls Test",
    content: floatingBody,
    feedTitle: "Read Along Feed",
    isRead: true,
    hasAudio: false,
});

async function setupFloating(page: Page) {
    await mockApi(page, `**/api/posts/${floatingPost.id}`, floatingPost);
    await mockApi(page, "**/api/categories", { categories: [] });
    await page.route(`**/api/posts/${floatingPost.id}/audio`, (route) =>
        route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                postId: floatingPost.id,
                status: "ready",
                url: "/api/audio/floating-key",
                durationSeconds: 2.2,
                format: "mp3",
                wordTimings: WORD_TIMINGS,
            }),
        })
    );
    const wav = makeWav(2.2);
    await page.route("**/api/audio/**", (route) =>
        route.fulfill({ status: 200, contentType: "audio/wav", body: wav })
    );
}

test.describe("Floating audio controls", () => {
    test("appear off-screen and drive play/pause + speed", async ({
        authedPage: page,
    }) => {
        await setupFloating(page);
        await page.goto(`/posts/${floatingPost.id}`);
        await page.getByTestId("listen-button").click();
        await page.getByTestId("play-pause-button").click();

        // Hidden while the inline player is on-screen.
        await expect(page.getByTestId("floating-audio-controls")).toBeHidden();

        // Scroll the inline player out of view (but not down to the footer).
        await page.evaluate(() => window.scrollTo(0, 1200));
        await expect(page.getByTestId("floating-audio-controls")).toBeVisible();

        // Pause from the floating control → the button flips to Play.
        await page.getByTestId("floating-play-button").click();
        await expect(page.getByTestId("floating-play-button")).toHaveAttribute(
            "aria-label",
            "Play"
        );

        // Change speed to 2x from the floating control.
        await page.getByTestId("floating-speed-button").click();
        await expect(page.getByTestId("floating-speed-options")).toBeVisible();
        await page.getByRole("button", { name: "Set speed 2x" }).click();
        await expect(page.getByTestId("floating-speed-button")).toHaveText("2x");

        // Scroll back to the top → controls hide.
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.getByTestId("floating-audio-controls")).toBeHidden();
    });
});
```

- [ ] **Step 2: Run the e2e to verify it fails**

Run: `docker compose exec -T frontend sh -lc 'npx playwright test read-along.spec.ts -g "Floating audio controls" --reporter=line'`
Expected: FAIL — `floating-audio-controls` never appears (component not wired into the page).

- [ ] **Step 3: Wire the component into `PostDetailPage`**

In `frontend/src/pages/posts/PostDetailPage.tsx`:

Add the import beside the other component imports:
```tsx
import { FloatingAudioControls } from "../../components/FloatingAudioControls";
```

Add the two refs next to `titleRef`/`contentRef`:
```tsx
    const playerRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLDivElement>(null);
```

Attach `playerRef` to the inline audio-player container (the `<Box sx={{ my: 2 }}>` that wraps `<AudioPlayer />` and `<ReadAlongToggles />`):
```tsx
                {readable && (
                    <Box sx={{ my: 2 }} ref={playerRef}>
                        <AudioPlayer player={player} />
                        <ReadAlongToggles
                            highlight={readAlongPrefs.highlight}
                            onHighlightChange={readAlongPrefs.setHighlight}
                            autoScroll={readAlongPrefs.autoScroll}
                            onAutoScrollChange={readAlongPrefs.setAutoScroll}
                        />
                    </Box>
                )}
```

Attach `footerRef` to the footer actions row (the `<Box>` with "Back to Posts" / "Read Original"):
```tsx
                <Box
                    ref={footerRef}
                    sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
```

Render the floating controls once, gated by `readable`, just before the closing `</Container>`:
```tsx
            {readable && (
                <FloatingAudioControls
                    player={player}
                    anchorRef={playerRef}
                    footerRef={footerRef}
                />
            )}
        </Container>
    );
```

- [ ] **Step 4: Run the e2e + typecheck to verify green**

Run: `docker compose exec -T frontend pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.
Run: `docker compose exec -T frontend sh -lc 'npx playwright test read-along.spec.ts -g "Floating audio controls" --reporter=line'`
Expected: PASS.

- [ ] **Step 5: Run the full read-along spec + component unit tests to confirm no regressions**

Run: `docker compose exec -T frontend sh -lc 'npx playwright test read-along.spec.ts --reporter=line'`
Expected: PASS (existing read-along tests + the new floating-controls test).
Run: `docker compose exec -T frontend pnpm test`
Expected: PASS (full Vitest suite).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/posts/PostDetailPage.tsx frontend/playwright/read-along.spec.ts
git commit -m "feat: show floating audio controls when the inline player scrolls off-screen"
```

---

## Self-Review (completed by author)

- **Spec coverage:** trigger/visibility (Task 2), play/resume circle (Task 2), speed circle + upward pills (Task 3), reuse of the shared player element (Tasks 2–4), footer-overlap avoidance (Task 2 `footerRef`), shared `PLAYBACK_SPEEDS` (Task 1), placement/safe-area/z-index (Task 2/3 sx), a11y aria-labels + Escape/click-away (Task 3), Vitest coverage (Tasks 2–3), Playwright coverage (Task 4). End-of-clip behavior (clip returns to `status: "ready"` on `ended`, so `activeClip` is false and the controls disappear) is covered by the visibility rule — no separate task needed.
- **Placeholder scan:** none — every step contains runnable code/commands.
- **Type consistency:** `FloatingAudioControlsProps`, `useOnScreen`, `activeClip`, and the test ids (`floating-audio-controls`, `floating-play-button`, `floating-speed-button`, `floating-speed-options`) and the pill `aria-label` (`Set speed <n>x`) are used identically across tasks and tests.
- **Reduced motion:** the pill stack uses plain conditional rendering (no transition), so it is instant for everyone — trivially satisfying the "instant under `prefers-reduced-motion`" requirement without extra code.
