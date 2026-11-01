import { act, cleanup, render } from "@testing-library/react";
import { useCallback, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useReadAlong } from "../useReadAlong";

const registry = new Map<string, Set<Range>>();
let frames: FrameRequestCallback[] = [];
const timings = ["Hello", "world", "foo", "bar", "baz"].map((text, index) => ({
  text, startMs: index * 1000, durationMs: 1000,
}));

function frame() {
  const pending = frames;
  frames = [];
  act(() => pending.forEach((callback) => callback(0)));
}

function paintedText() {
  return [...registry.values()].flatMap((highlight) => [...highlight].map((range) => range.toString()));
}

function Harness({ audio, mode = "continuous", playing = true, enabled = true, wordTimings = timings, body = "<p>foo <em>bar</em> baz</p>" }: {
  audio: HTMLAudioElement; mode?: "word" | "continuous"; playing?: boolean; enabled?: boolean;
  wordTimings?: typeof timings; body?: string;
}) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const getMediaElement = useCallback(() => audio, [audio]);
  useReadAlong({
    timings: wordTimings, getMediaElement, isPlaying: playing, titleRef, contentRef,
    highlightEnabled: enabled, autoScrollEnabled: false, highlightMode: mode,
    contentVersion: body,
  });
  return <>
    <h1 ref={titleRef}>Hello world</h1>
    <p>Metadata and controls must not be highlighted</p>
    <div ref={contentRef} dangerouslySetInnerHTML={{ __html: body }} />
  </>;
}

beforeEach(() => {
  registry.clear();
  frames = [];
  vi.stubGlobal("CSS", { highlights: registry });
  vi.stubGlobal("Highlight", class extends Set<Range> {
    constructor(...ranges: Range[]) { super(ranges); }
  });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => { frames = []; });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("continuous read-along", () => {
  it("fills part of the current word and paints earlier text including spaces without touching controls", () => {
    const audio = document.createElement("audio");
    audio.currentTime = 3.5;
    render(<Harness audio={audio} />);
    frame();
    expect(paintedText()).toEqual(["Hello world", "foo "]);
    expect(document.querySelector(".ra-progress")?.textContent).toBe("bar");
    expect(document.querySelector<HTMLElement>(".ra-progress")?.style.getPropertyValue("--ra-progress")).toBe("50%");
    expect(document.querySelector(".ra-active")).toBeNull();
    audio.currentTime = 3.75;
    frame();
    expect(document.querySelector<HTMLElement>(".ra-progress")?.style.getPropertyValue("--ra-progress")).toBe("75%");
  });

  it("shrinks while seeking backward even when paused and preserves the paused fill", () => {
    const audio = document.createElement("audio");
    audio.currentTime = 3.5;
    const view = render(<Harness audio={audio} />);
    frame();
    expect(registry.size).toBe(1);
    expect(document.querySelector(".ra-progress")).not.toBeNull();
    view.rerender(<Harness audio={audio} playing={false} />);
    expect(document.querySelector<HTMLElement>(".ra-progress")?.style.getPropertyValue("--ra-progress")).toBe("50%");
    act(() => {
      audio.currentTime = 1.25;
      audio.dispatchEvent(new Event("seeked"));
    });
    expect(paintedText()).toEqual(["Hello ", ""]);
    expect(document.querySelector(".ra-progress")?.textContent).toBe("world");
    expect(document.querySelector<HTMLElement>(".ra-progress")?.style.getPropertyValue("--ra-progress")).toBe("25%");
  });

  it("sweeps a compound display word over all of its spoken parts without restarting", () => {
    const audio = document.createElement("audio");
    audio.currentTime = 3.5;
    render(<Harness audio={audio} body="<p>foo.bar baz</p>" />);
    frame();
    expect(document.querySelector(".ra-progress")?.textContent).toBe("foo.bar");
    expect(document.querySelector<HTMLElement>(".ra-progress")?.style.getPropertyValue("--ra-progress")).toBe("75%");
  });

  it("holds past highlighting across an unmapped punctuation timing", () => {
    const audio = document.createElement("audio");
    audio.currentTime = 2.5;
    const wordTimings = [
      ...timings.slice(0, 2),
      { text: "!!!", startMs: 2000, durationMs: 1000 },
      ...timings.slice(2).map((timing) => ({ ...timing, startMs: timing.startMs + 1000 })),
    ];
    render(<Harness audio={audio} wordTimings={wordTimings} />);
    frame();
    expect(paintedText()).toEqual(["Hello ", ""]);
    expect(document.querySelector(".ra-progress")?.textContent).toBe("world");
    expect(document.querySelector<HTMLElement>(".ra-progress")?.style.getPropertyValue("--ra-progress")).toBe("100%");
  });

  it("does not paint before the first timing and handles a zero-duration word without NaN", () => {
    const audio = document.createElement("audio");
    const wordTimings = timings.map((timing, index) => ({
      ...timing, startMs: timing.startMs + 500, durationMs: index === 0 ? 0 : 1000,
    }));
    render(<Harness audio={audio} playing={false} wordTimings={wordTimings} />);
    expect(paintedText()).toEqual(["", ""]);
    expect(document.querySelector(".ra-progress")).toBeNull();
    act(() => {
      audio.currentTime = 0.75;
      audio.dispatchEvent(new Event("timeupdate"));
    });
    expect(document.querySelector(".ra-progress")?.textContent).toBe("Hello");
    expect(document.querySelector<HTMLElement>(".ra-progress")?.style.getPropertyValue("--ra-progress")).toBe("100%");
  });

  it("repaints replacement article DOM and re-enables highlighting at the paused position", () => {
    const audio = document.createElement("audio");
    audio.currentTime = 3.5;
    const view = render(<Harness audio={audio} playing={false} />);
    const oldSpan = document.querySelector(".ra-progress");
    view.rerender(<Harness audio={audio} playing={false} body="<p>foo bar baz</p>" />);
    expect(document.querySelector(".ra-progress")).not.toBe(oldSpan);
    expect(paintedText()).toEqual(["Hello world", "foo "]);
    const ranges = [...registry.values()][0];
    expect([...ranges].every((range) =>
      range.startContainer.isConnected && range.endContainer.isConnected)).toBe(true);
    view.rerender(<Harness audio={audio} playing={false} body="<p>foo bar baz</p>" enabled={false} />);
    expect(registry.size).toBe(0);
    view.rerender(<Harness audio={audio} playing={false} body="<p>foo bar baz</p>" />);
    expect(paintedText()).toEqual(["Hello world", "foo "]);
    expect(document.querySelector<HTMLElement>(".ra-progress")?.style.getPropertyValue("--ra-progress")).toBe("50%");
  });

  it("keeps completion until replay then rebuilds from the new playback time", () => {
    const audio = document.createElement("audio");
    render(<Harness audio={audio} />);
    act(() => {
      audio.currentTime = 5;
      audio.dispatchEvent(new Event("ended"));
    });
    expect(paintedText()).toEqual(["Hello world", "foo bar baz"]);
    expect(document.querySelector(".ra-progress")).toBeNull();
    act(() => {
      audio.currentTime = 0;
      audio.dispatchEvent(new Event("play"));
    });
    frame();
    expect(paintedText()).toEqual(["", ""]);
    expect(document.querySelector<HTMLElement>(".ra-progress")?.style.getPropertyValue("--ra-progress")).toBe("0%");
  });

  it("cleans continuous paint on mode switch, disabling highlights, and unmount", () => {
    const audio = document.createElement("audio");
    audio.currentTime = 3.5;
    const view = render(<Harness audio={audio} />);
    frame();
    expect(paintedText()).toEqual(["Hello world", "foo "]);
    view.rerender(<Harness audio={audio} mode="word" />);
    frame();
    expect(registry.size).toBe(0);
    expect(document.querySelector(".ra-progress")).toBeNull();
    expect(document.querySelector(".ra-active")?.textContent).toBe("bar");
    view.rerender(<Harness audio={audio} enabled={false} />);
    expect(registry.size).toBe(0);
    expect(document.querySelector(".ra-word")).toBeNull();
    view.unmount();
    expect(registry.size).toBe(0);
  });
});
