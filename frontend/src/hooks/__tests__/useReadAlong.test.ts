/**
 * Unit tests for useReadAlong active-word tracking (US1).
 *
 * requestAnimationFrame and matchMedia are stubbed so frames can be driven
 * deterministically from a fake media element's currentTime.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { createElement as h, useCallback, useRef } from "react";
import { useReadAlong } from "../useReadAlong";
import type { WordTiming } from "../../types";

let rafQueue: FrameRequestCallback[] = [];

function flushFrame() {
    const callbacks = rafQueue;
    rafQueue = [];
    act(() => {
        callbacks.forEach((cb) => cb(0));
    });
}

const TIMINGS: WordTiming[] = [
    { text: "Hello", startMs: 100, durationMs: 100 }, // ends 200
    { text: "world", startMs: 250, durationMs: 100 }, // ends 350
    { text: "foo", startMs: 450, durationMs: 100 }, // ends 550
    { text: "bar", startMs: 600, durationMs: 100 }, // ends 700
    { text: "baz", startMs: 750, durationMs: 100 }, // ends 850 (last)
];

interface FakeMediaEl {
    currentTime: number;
    ended: boolean;
    paused: boolean;
    playbackRate: number;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
}

function makeMediaEl(overrides: Partial<FakeMediaEl> = {}): FakeMediaEl {
    return {
        currentTime: 0,
        ended: false,
        paused: false,
        playbackRate: 1,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        ...overrides,
    };
}

function Harness(props: {
    timings: WordTiming[] | null;
    mediaEl: FakeMediaEl;
    isPlaying?: boolean;
    highlightEnabled?: boolean;
    autoScrollEnabled?: boolean;
}) {
    const titleRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const getMediaElement = useCallback(
        () => props.mediaEl as unknown as HTMLAudioElement,
        [props.mediaEl]
    );
    const { highlightingActive } = useReadAlong({
        timings: props.timings,
        getMediaElement,
        isPlaying: props.isPlaying ?? true,
        titleRef,
        contentRef,
        highlightEnabled: props.highlightEnabled ?? true,
        autoScrollEnabled: props.autoScrollEnabled ?? false,
    });
    return h(
        "div",
        null,
        h("div", { ref: titleRef }, "Hello world"),
        h("div", { ref: contentRef }, "foo bar baz"),
        h("span", { "data-testid": "active-state" }, String(highlightingActive))
    );
}

function activeIndex(): number | null {
    const el = document.querySelector<HTMLElement>(".ra-active");
    return el ? Number(el.dataset.raIndex) : null;
}

beforeEach(() => {
    rafQueue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
        rafQueue.push(cb);
        return rafQueue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => { });
    vi.stubGlobal("matchMedia", (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: () => false,
    }));
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
});

describe("useReadAlong active-word tracking", () => {
    it("re-wraps and re-enables after highlight is toggled off then on (US3)", () => {
        const mediaEl = makeMediaEl();
        const view = render(
            h(Harness, { timings: TIMINGS, mediaEl, highlightEnabled: true })
        );
        // Wrapped and eligible on first enable.
        expect(document.querySelectorAll(".ra-word")).toHaveLength(5);
        expect(view.getByTestId("active-state").textContent).toBe("true");

        // Toggle highlight OFF → spans are unwrapped, highlighting inactive.
        view.rerender(
            h(Harness, { timings: TIMINGS, mediaEl, highlightEnabled: false })
        );
        expect(document.querySelectorAll(".ra-word")).toHaveLength(0);
        expect(view.getByTestId("active-state").textContent).toBe("false");

        // Toggle highlight ON again → re-wraps and re-enables (not dead).
        view.rerender(
            h(Harness, { timings: TIMINGS, mediaEl, highlightEnabled: true })
        );
        expect(document.querySelectorAll(".ra-word")).toHaveLength(5);
        expect(view.getByTestId("active-state").textContent).toBe("true");
    });

    it("enables highlighting for aligned timings and wraps words once", () => {
        const mediaEl = makeMediaEl();
        const { getByTestId } = render(h(Harness, { timings: TIMINGS, mediaEl }));
        expect(getByTestId("active-state").textContent).toBe("true");
        expect(document.querySelectorAll(".ra-word")).toHaveLength(5);
    });

    it("highlights the greatest word whose start <= media time", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.3 }); // 300ms
        render(h(Harness, { timings: TIMINGS, mediaEl }));
        flushFrame();
        expect(activeIndex()).toBe(1); // world(250) <= 300 < foo(450)
    });

    it("shows no active word before the first start", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.05 }); // 50ms < 100
        render(h(Harness, { timings: TIMINGS, mediaEl }));
        flushFrame();
        expect(activeIndex()).toBeNull();
    });

    it("holds the current word across a gap", () => {
        // 380ms: after world ends (350), before foo starts (450).
        const mediaEl = makeMediaEl({ currentTime: 0.38 });
        render(h(Harness, { timings: TIMINGS, mediaEl }));
        flushFrame();
        expect(activeIndex()).toBe(1); // still "world"
    });

    it("clears after the last word ends", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.9 }); // 900ms > baz end 850
        render(h(Harness, { timings: TIMINGS, mediaEl }));
        flushFrame();
        expect(activeIndex()).toBeNull();
    });

    it("clears when the media element reports ended", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.3 });
        render(h(Harness, { timings: TIMINGS, mediaEl }));
        flushFrame();
        expect(activeIndex()).toBe(1);
        mediaEl.ended = true;
        flushFrame();
        expect(activeIndex()).toBeNull();
    });

    it("keeps at most one active span as time advances", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.15 });
        render(h(Harness, { timings: TIMINGS, mediaEl }));
        flushFrame();
        mediaEl.currentTime = 0.7;
        flushFrame();
        mediaEl.currentTime = 0.3;
        flushFrame();
        expect(document.querySelectorAll(".ra-active")).toHaveLength(1);
    });

    it("is media-time based, independent of playback rate", () => {
        for (const rate of [0.5, 1, 3]) {
            cleanup();
            document.body.innerHTML = "";
            const mediaEl = makeMediaEl({ currentTime: 0.3, playbackRate: rate });
            render(h(Harness, { timings: TIMINGS, mediaEl }));
            flushFrame();
            expect(activeIndex()).toBe(1);
        }
    });

    it("does nothing when timings are null (no wrapping, not active)", () => {
        const mediaEl = makeMediaEl();
        const { getByTestId } = render(h(Harness, { timings: null, mediaEl }));
        expect(getByTestId("active-state").textContent).toBe("false");
        expect(document.querySelectorAll(".ra-word")).toHaveLength(0);
    });
});

describe("useReadAlong auto-scroll", () => {
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    let scrollSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        scrollSpy = vi.fn();
        HTMLElement.prototype.scrollIntoView = scrollSpy;
    });

    afterEach(() => {
        HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    });

    // jsdom returns a zeroed rect by default; mock each word's rect so we can
    // place the active word inside or outside the central comfort band. With
    // innerHeight 768 the band is roughly [192, 576].
    function mockAllRects(top: number) {
        document.querySelectorAll<HTMLElement>(".ra-word").forEach((span) => {
            vi.spyOn(span, "getBoundingClientRect").mockReturnValue({
                top,
                bottom: top + 14,
                height: 14,
                left: 0,
                right: 0,
                width: 0,
                x: 0,
                y: top,
                toJSON: () => ({}),
            } as DOMRect);
        });
    }

    it("scrolls the active word into view when it leaves the comfort band", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.3 });
        render(h(Harness, { timings: TIMINGS, mediaEl, autoScrollEnabled: true }));
        mockAllRects(10_000); // far below the viewport → outside band
        flushFrame();
        expect(scrollSpy).toHaveBeenCalledTimes(1);
        expect(scrollSpy.mock.calls[0][0]).toMatchObject({
            block: "center",
            behavior: "smooth",
        });
    });

    it("does not scroll when the active word is within the comfort band", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.3 });
        render(h(Harness, { timings: TIMINGS, mediaEl, autoScrollEnabled: true }));
        mockAllRects(300); // inside [~192, ~576]
        flushFrame();
        expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("uses instant scrolling when prefers-reduced-motion is set", () => {
        vi.stubGlobal("matchMedia", (query: string) => ({
            matches: true,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: () => false,
        }));
        const mediaEl = makeMediaEl({ currentTime: 0.3 });
        render(h(Harness, { timings: TIMINGS, mediaEl, autoScrollEnabled: true }));
        mockAllRects(10_000);
        flushFrame();
        expect(scrollSpy).toHaveBeenCalled();
        expect(scrollSpy.mock.calls[0][0]).toMatchObject({ behavior: "auto" });
    });

    it("does not scroll when auto-scroll is disabled", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.3 });
        render(h(Harness, { timings: TIMINGS, mediaEl, autoScrollEnabled: false }));
        mockAllRects(10_000);
        flushFrame();
        expect(scrollSpy).not.toHaveBeenCalled();
    });

    it("repositions at most once per active-word change", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.3 });
        render(h(Harness, { timings: TIMINGS, mediaEl, autoScrollEnabled: true }));
        mockAllRects(10_000);
        flushFrame(); // active word 1 → one reposition
        flushFrame(); // same active word → no additional reposition
        flushFrame();
        expect(scrollSpy).toHaveBeenCalledTimes(1);
    });
});

describe("useReadAlong graceful fallback", () => {
    it("stays inert for an empty timings array", () => {
        const mediaEl = makeMediaEl();
        const { getByTestId } = render(h(Harness, { timings: [], mediaEl }));
        expect(getByTestId("active-state").textContent).toBe("false");
        expect(document.querySelectorAll(".ra-word")).toHaveLength(0);
    });

    it("stays inert when timings do not align with the displayed words", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.3 });
        const misaligned: WordTiming[] = Array.from({ length: 10 }, (_, i) => ({
            text: `zzz${i}`,
            startMs: i * 100,
            durationMs: 50,
        }));
        const { getByTestId } = render(h(Harness, { timings: misaligned, mediaEl }));

        expect(getByTestId("active-state").textContent).toBe("false");
        // No wrapping and no DOM mutation for a misaligned post.
        expect(document.querySelectorAll(".ra-word")).toHaveLength(0);
        flushFrame();
        expect(document.querySelector(".ra-active")).toBeNull();
    });

    it("does not wrap or highlight when highlightEnabled is false", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.3 });
        const { getByTestId } = render(
            h(Harness, { timings: TIMINGS, mediaEl, highlightEnabled: false })
        );

        expect(getByTestId("active-state").textContent).toBe("false");
        expect(document.querySelectorAll(".ra-word")).toHaveLength(0);
        flushFrame();
        expect(document.querySelector(".ra-active")).toBeNull();
    });

    it("clears immediately when highlight is turned off mid-play", () => {
        const mediaEl = makeMediaEl({ currentTime: 0.3 });
        const { rerender } = render(
            h(Harness, { timings: TIMINGS, mediaEl, highlightEnabled: true })
        );
        flushFrame();
        expect(document.querySelector(".ra-active")).not.toBeNull();

        // Toggle highlight off → the active highlight clears right away.
        rerender(h(Harness, { timings: TIMINGS, mediaEl, highlightEnabled: false }));
        expect(document.querySelector(".ra-active")).toBeNull();
    });
});
