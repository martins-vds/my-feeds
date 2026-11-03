import { act, cleanup, render, screen } from "@testing-library/react";
import { useCallback, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WordTiming } from "../../types";
import type { MediaClock } from "../../utils/mediaClock";
import { BASE_WPM, buildPacedTimings } from "../../utils/pacedTimings";
import { useReadAlong, type HighlightMode } from "../useReadAlong";

// Not an HTMLAudioElement: proves the hook follows any MediaClock.
class FakeClock extends EventTarget implements MediaClock {
  currentTime = 0;
  ended = false;
  paused = true;
}

const registry = new Map<string, Set<Range>>();
let frames: FrameRequestCallback[] = [];

const TITLE = "Hello world";
const BODY = "foo bar baz";
const WORDS = ["Hello", "world", "foo", "bar", "baz"];

const endOf = (timings: WordTiming[]) =>
  timings[timings.length - 1].startMs + timings[timings.length - 1].durationMs;
const PACED = buildPacedTimings(WORDS, BASE_WPM);
const PACED_END_MS = endOf(PACED);
const AUDIO: WordTiming[] = WORDS.map((text, index) => ({
  text,
  startMs: index * 1000,
  durationMs: 1000,
}));

/** Seconds at the middle of the word at `index` on the paced timeline. */
const midpoint = (index: number) => (PACED[index].startMs + PACED[index].durationMs / 2) / 1000;

function frame() {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((callback) => callback(0)));
}

function active() {
  return document.querySelector<HTMLElement>(".ra-active");
}

function paintedText() {
  return [...registry.values()].flatMap((highlight) =>
    [...highlight].map((range) => range.toString())
  );
}

const text = (testId: string) => screen.getByTestId(testId).textContent;

function Harness({
  clock,
  timings = null,
  paced = false,
  playing = true,
  mode = "word",
  enabled = true,
  title = TITLE,
  body = BODY,
  durations,
}: {
  clock: FakeClock;
  timings?: WordTiming[] | null;
  paced?: boolean;
  playing?: boolean;
  mode?: HighlightMode;
  enabled?: boolean;
  title?: string;
  body?: string;
  /** Collects the duration reported by every render. */
  durations?: number[];
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const getMediaElement = useCallback(() => clock, [clock]);
  const { highlightingActive, pacedDurationMs } = useReadAlong({
    timings,
    getMediaElement,
    isPlaying: playing,
    titleRef,
    contentRef,
    highlightEnabled: enabled,
    autoScrollEnabled: false,
    highlightMode: mode,
    paced,
    contentVersion: body,
  });
  durations?.push(pacedDurationMs);
  return (
    <>
      <h1 ref={titleRef}>{title}</h1>
      <div ref={contentRef} dangerouslySetInnerHTML={{ __html: body }} />
      <span data-testid="active">{String(highlightingActive)}</span>
      <span data-testid="duration">{pacedDurationMs}</span>
    </>
  );
}

beforeEach(() => {
  registry.clear();
  frames = [];
  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal(
    "Highlight",
    class extends Set<Range> {
      constructor(...ranges: Range[]) {
        super(ranges);
      }
    }
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useReadAlong paced mode", () => {
  it("wraps the displayed words and activates with no audio timings at all", () => {
    render(<Harness clock={new FakeClock()} paced />);

    expect(text("active")).toBe("true");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(5);
  });

  it("starts pacing when paced is turned on for an article with no audio", () => {
    const clock = new FakeClock();
    const view = render(<Harness clock={clock} />);
    expect(text("active")).toBe("false");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(0);

    view.rerender(<Harness clock={clock} paced />);

    expect(text("active")).toBe("true");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(5);
  });

  it("reports the length of the paced timeline as pacedDurationMs", () => {
    render(<Harness clock={new FakeClock()} paced />);

    expect(text("duration")).toBe(String(PACED_END_MS));
  });

  it("highlights the word the clock is inside, in the title and in the body", () => {
    const clock = new FakeClock();
    render(<Harness clock={clock} paced />);

    clock.currentTime = midpoint(1);
    frame();
    expect(active()?.dataset.raIndex).toBe("1");
    expect(active()?.textContent).toBe("world");

    clock.currentTime = midpoint(3);
    frame();
    expect(active()?.dataset.raIndex).toBe("3");
    expect(active()?.textContent).toBe("bar");
  });

  it("ignores audio timings, even ones that do not match the text", () => {
    const unrelated: WordTiming[] = [
      { text: "completely", startMs: 9000, durationMs: 500 },
      { text: "different", startMs: 9500, durationMs: 500 },
    ];
    const clock = new FakeClock();
    render(<Harness clock={clock} paced timings={unrelated} />);

    clock.currentTime = midpoint(0);
    frame();

    expect(text("active")).toBe("true");
    expect(active()?.textContent).toBe("Hello");
  });

  it("gives a punctuation-only token its own slot on the timeline", () => {
    const words = ["Hello", "world", "foo", "—", "bar"];
    const timeline = buildPacedTimings(words, BASE_WPM);
    const clock = new FakeClock();
    render(<Harness clock={clock} paced body="foo — bar" />);

    clock.currentTime = (timeline[3].startMs + timeline[3].durationMs / 2) / 1000;
    frame();

    expect(active()?.textContent).toBe("—");
    expect(text("duration")).toBe(String(endOf(timeline)));
  });

  it("holds the last word until its time is up, then clears", () => {
    const clock = new FakeClock();
    render(<Harness clock={clock} paced />);

    clock.currentTime = (PACED_END_MS - 10) / 1000;
    frame();
    expect(active()?.textContent).toBe("baz");

    clock.currentTime = (PACED_END_MS + 10) / 1000;
    frame();
    expect(active()).toBeNull();
  });

  it("does not wrap or time anything while highlighting is off", () => {
    render(<Harness clock={new FakeClock()} paced enabled={false} />);

    expect(text("active")).toBe("false");
    expect(text("duration")).toBe("0");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(0);
  });

  it("forgets the paced timeline when highlighting is turned off", () => {
    const clock = new FakeClock();
    const view = render(<Harness clock={clock} paced />);
    expect(text("duration")).toBe(String(PACED_END_MS));

    view.rerender(<Harness clock={clock} paced enabled={false} />);

    expect(text("active")).toBe("false");
    expect(text("duration")).toBe("0");
  });

  it("has nothing to pace when the article has no words", () => {
    render(<Harness clock={new FakeClock()} paced title="" body="" />);

    expect(text("active")).toBe("false");
    expect(text("duration")).toBe("0");
  });

  it("has no paced duration when it follows the audio timings", () => {
    render(<Harness clock={new FakeClock()} timings={AUDIO} />);

    expect(text("active")).toBe("true");
    expect(text("duration")).toBe("0");
  });

  it("switches between the audio and paced timelines as paced is toggled", () => {
    // 1.5 s is inside "world" on the audio timeline but past the end of the paced one.
    expect(PACED_END_MS).toBeLessThan(1500);
    const clock = new FakeClock();
    clock.currentTime = 1.5;
    const view = render(<Harness clock={clock} timings={AUDIO} />);
    frame();
    expect(active()?.textContent).toBe("world");

    view.rerender(<Harness clock={clock} timings={AUDIO} paced />);
    frame();
    expect(text("duration")).toBe(String(PACED_END_MS));
    expect(active()).toBeNull();
    expect(document.querySelectorAll(".ra-word")).toHaveLength(5);

    view.rerender(<Harness clock={clock} timings={AUDIO} />);
    frame();
    expect(text("duration")).toBe("0");
    expect(active()?.textContent).toBe("world");
    expect(document.querySelectorAll(".ra-word")).toHaveLength(5);
  });

  it("keeps its wrapped words when audio timings arrive while paced", () => {
    const clock = new FakeClock();
    const view = render(<Harness clock={clock} paced />);
    const first = document.querySelector(".ra-word");

    view.rerender(<Harness clock={clock} paced timings={AUDIO} />);

    expect(document.querySelector(".ra-word")).toBe(first);
  });

  it("reports no paced duration in any render once paced is off", () => {
    const clock = new FakeClock();
    const durations: number[] = [];
    const view = render(<Harness clock={clock} paced durations={durations} />);
    expect(durations[durations.length - 1]).toBe(PACED_END_MS);

    durations.length = 0;
    view.rerender(<Harness clock={clock} durations={durations} />);

    expect(durations.length).toBeGreaterThan(0);
    expect(durations.every((duration) => duration === 0)).toBe(true);
  });

  it("paces the new text when the article DOM is replaced", () => {
    const clock = new FakeClock();
    const view = render(<Harness clock={clock} paced />);

    view.rerender(<Harness clock={clock} paced body="foo bar baz qux quux" />);

    expect(document.querySelectorAll(".ra-word")).toHaveLength(7);
    const longer = buildPacedTimings([...WORDS, "qux", "quux"], BASE_WPM);
    expect(text("duration")).toBe(String(endOf(longer)));
  });

  it("fills the current word from the paced timeline in continuous mode", () => {
    const clock = new FakeClock();
    clock.currentTime = midpoint(1);

    render(<Harness clock={clock} paced mode="continuous" />);

    expect(paintedText()).toEqual(["Hello ", ""]);
    const current = document.querySelector<HTMLElement>(".ra-progress");
    expect(current?.textContent).toBe("world");
    expect(parseFloat(current?.style.getPropertyValue("--ra-progress") ?? "")).toBeCloseTo(50, 3);
  });

  it("repaints on the clock's own events while paused", () => {
    const clock = new FakeClock();
    clock.currentTime = midpoint(1);
    render(<Harness clock={clock} paced mode="continuous" playing={false} />);
    expect(document.querySelector(".ra-progress")?.textContent).toBe("world");

    act(() => {
      clock.currentTime = midpoint(3);
      clock.dispatchEvent(new Event("seeked"));
    });

    expect(paintedText()).toEqual(["Hello world", "foo "]);
    expect(document.querySelector(".ra-progress")?.textContent).toBe("bar");
  });
});
