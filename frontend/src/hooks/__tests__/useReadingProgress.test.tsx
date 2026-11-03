import { StrictMode } from "react";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api, { ApiError } from "../../services/api";
import type { MediaClock, MediaClockEvent } from "../../utils/mediaClock";
import { useReadingProgress } from "../useReadingProgress";
import type { UseReadingProgressArgs } from "../useReadingProgress";

vi.mock("../../services/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/api")>()),
  default: { put: vi.fn() },
}));

/** A media clock the test drives by hand. */
class FakeClock implements MediaClock {
  currentTime = 0;
  ended = false;
  paused = true;
  private readonly listeners = new Map<MediaClockEvent, Set<() => void>>();

  addEventListener(type: MediaClockEvent, listener: () => void): void {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: MediaClockEvent, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  listenerCount(type?: MediaClockEvent): number {
    if (type) return this.listeners.get(type)?.size ?? 0;
    let total = 0;
    for (const set of this.listeners.values()) total += set.size;
    return total;
  }

  emit(type: MediaClockEvent): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener();
  }

  /** Plays on by `seconds` and reports it, the way a playing element does. */
  tick(seconds: number): void {
    this.currentTime += seconds;
    this.emit("timeupdate");
  }
}

const put = vi.mocked(api.put);

/** What the server answers for a saved progress. */
const reply = (progress: number) => ({
  postId: "p1",
  isRead: progress >= 0.95,
  readProgress: progress >= 0.95 ? 1 : progress,
  readAt: null,
});

// Lets the tracker's promise callbacks run.
const settle = () => vi.advanceTimersByTimeAsync(0);

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  put.mockReset();
  put.mockImplementation(async (_path, body) => reply((body as { progress: number }).progress));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "visibilityState");
});

/** Mounts the hook on a fake clock, tracking post p1 from zero. */
function setup(overrides: Partial<UseReadingProgressArgs> = {}, clock = new FakeClock()) {
  const props: UseReadingProgressArgs = {
    postId: "p1",
    initialProgress: 0,
    enabled: true,
    clockKey: "audio",
    getClock: () => clock,
    getDurationSeconds: () => 100,
    onUpdate: vi.fn(),
    ...overrides,
  };
  const hook = renderHook((current: UseReadingProgressArgs) => useReadingProgress(current), {
    initialProps: props,
  });
  return { ...hook, clock, props };
}

const endpoint = (postId: string) => `/posts/${postId}/progress`;

describe("useReadingProgress tracking", () => {
  it("does nothing while it is disabled", () => {
    const { clock } = setup({ enabled: false });

    clock.tick(1);

    expect(clock.listenerCount()).toBe(0);
    expect(put).not.toHaveBeenCalled();
  });

  it("sends the first percent to the post's progress endpoint", () => {
    const { clock } = setup();

    clock.tick(1);

    expect(put).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.01 }, { keepalive: false });
  });

  it("hands the saved report to onUpdate", async () => {
    const onUpdate = vi.fn();
    const { clock } = setup({ onUpdate });

    clock.tick(1);
    await settle();

    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith({ readProgress: 0.01, isRead: false });
  });

  it("stops sending once the server says the article is read", async () => {
    const onUpdate = vi.fn();
    const { clock } = setup({ onUpdate });

    clock.currentTime = 95;
    clock.emit("seeked");
    clock.tick(1);
    await settle();
    expect(onUpdate).toHaveBeenCalledWith({ readProgress: 1, isRead: true });

    vi.advanceTimersByTime(10_000);
    clock.tick(1);
    clock.emit("pause");
    expect(put).toHaveBeenCalledOnce();
  });

  it("uses the latest callbacks without rebinding the clock", async () => {
    const { clock, rerender, props } = setup();
    const onUpdate = vi.fn();

    rerender({ ...props, getDurationSeconds: () => 50, onUpdate });
    expect(clock.listenerCount("timeupdate")).toBe(1);

    clock.tick(1);
    expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
    await settle();
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("counts from where an already playing clock is", () => {
    const clock = new FakeClock();
    clock.currentTime = 50;
    setup({}, clock);

    clock.tick(1);

    expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.51 }, { keepalive: false });
  });

  it("takes the first tick of a clock that has not started from the beginning", () => {
    const { clock } = setup();

    clock.emit("timeupdate");

    expect(put).not.toHaveBeenCalled();
  });

  it("survives strict mode's extra mount without doubling up", () => {
    const clock = new FakeClock();
    renderHook(
      () =>
        useReadingProgress({
          postId: "p1",
          initialProgress: 0,
          enabled: true,
          clockKey: "audio",
          getClock: () => clock,
          getDurationSeconds: () => 100,
          onUpdate: vi.fn(),
        }),
      { wrapper: StrictMode }
    );
    expect(clock.listenerCount("timeupdate")).toBe(1);

    clock.tick(1);

    expect(put).toHaveBeenCalledOnce();
  });
});

describe("useReadingProgress baselines", () => {
  it.each<MediaClockEvent>(["play", "seeking", "seeked"])(
    "takes the clock's position as the new baseline on %s",
    (type) => {
      const { clock } = setup();
      clock.currentTime = 3;

      clock.emit(type);
      clock.emit("timeupdate");

      expect(put).not.toHaveBeenCalled();
    }
  );

  it.each<MediaClockEvent>(["play", "seeking", "seeked"])(
    "credits reading from where the clock is after %s",
    (type) => {
      const { clock } = setup();
      clock.currentTime = 60;

      clock.emit(type);
      clock.tick(1);

      expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.61 }, { keepalive: false });
    }
  );
});

describe("useReadingProgress flushing", () => {
  it.each<MediaClockEvent>(["pause", "ended"])(
    "sends what is new on %s, without waiting for the spacing",
    async (type) => {
      const { clock } = setup();
      clock.tick(1);
      await settle();
      clock.tick(1);
      clock.tick(1);
      expect(put).toHaveBeenCalledTimes(1);

      clock.emit(type);

      expect(put).toHaveBeenCalledTimes(2);
      expect(put).toHaveBeenLastCalledWith(
        endpoint("p1"),
        { progress: 0.03 },
        { keepalive: false }
      );
    }
  );

  it("sends what is new, with keepalive, when the tab is hidden", async () => {
    const { clock } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    setVisibility("hidden");

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: true });
  });

  it("sends nothing when the tab becomes visible again", async () => {
    const { clock } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    setVisibility("visible");

    expect(put).toHaveBeenCalledTimes(1);
  });

  it("sends what is new, with keepalive, when the page is being left", async () => {
    const { clock } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    window.dispatchEvent(new Event("pagehide"));

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: true });
  });

  it("sends what is new and lets go of the clock when it unmounts", async () => {
    const { clock, unmount } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    unmount();

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
    expect(clock.listenerCount()).toBe(0);
  });

  it("removes the page listeners it added", () => {
    const addToDocument = vi.spyOn(document, "addEventListener");
    const addToWindow = vi.spyOn(window, "addEventListener");
    const removeFromDocument = vi.spyOn(document, "removeEventListener");
    const removeFromWindow = vi.spyOn(window, "removeEventListener");
    const { unmount } = setup();
    const listenerFor = (spy: { mock: { calls: unknown[][] } }, type: string) =>
      spy.mock.calls.find((call) => call[0] === type)?.[1];
    const onVisibility = listenerFor(addToDocument, "visibilitychange");
    const onPageHide = listenerFor(addToWindow, "pagehide");
    expect(onVisibility).toBeTypeOf("function");
    expect(onPageHide).toBeTypeOf("function");

    unmount();

    expect(removeFromDocument).toHaveBeenCalledWith("visibilitychange", onVisibility);
    expect(removeFromWindow).toHaveBeenCalledWith("pagehide", onPageHide);
  });

  it("sends what is new when it is switched off", async () => {
    const { clock, rerender, props } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    rerender({ ...props, enabled: false });

    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
    expect(clock.listenerCount()).toBe(0);
  });
});

describe("useReadingProgress clocks", () => {
  it("moves to the new clock when the key changes, flushing the old one", async () => {
    const first = new FakeClock();
    const second = new FakeClock();
    second.currentTime = 10;
    let current = first;
    const { rerender, props } = setup({ getClock: () => current }, first);
    first.tick(1);
    await settle();
    first.tick(1);

    current = second;
    rerender({ ...props, getClock: () => current, clockKey: "silent" });

    expect(first.listenerCount()).toBe(0);
    expect(second.listenerCount("timeupdate")).toBe(1);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });

    await settle();
    vi.advanceTimersByTime(10_000);
    second.tick(1);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.11 }, { keepalive: false });
  });

  it("copes with there being no clock yet, and picks one up when the key changes", () => {
    const clock = new FakeClock();
    let current: FakeClock | null = null;
    const { rerender, props } = setup({ getClock: () => current });
    expect(() => setVisibility("hidden")).not.toThrow();

    current = clock;
    rerender({ ...props, getClock: () => current, clockKey: "silent" });
    clock.tick(1);

    expect(put).toHaveBeenCalledOnce();
  });
});

describe("useReadingProgress posts", () => {
  it("sends the old post to its own endpoint and starts the new one from its stored progress", async () => {
    const { clock, rerender, props } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);

    rerender({ ...props, postId: "p2", initialProgress: 0.5 });
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
    expect(put).toHaveBeenCalledTimes(2);

    clock.tick(1);
    vi.advanceTimersByTime(10_000);
    clock.currentTime = 50;
    clock.emit("seeked");
    clock.tick(1);

    expect(put).toHaveBeenCalledTimes(3);
    expect(put).toHaveBeenLastCalledWith(endpoint("p2"), { progress: 0.51 }, { keepalive: false });
  });

  it("ignores the answer for a post the page has moved on from", async () => {
    let answer: (value: unknown) => void = () => undefined;
    put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const onUpdate = vi.fn();
    const { clock, rerender, props } = setup({ onUpdate });
    clock.tick(1);

    rerender({ ...props, postId: "p2" });
    answer(reply(0.01));
    await settle();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("still sends a post's queued progress to that post after the page has moved on", async () => {
    let answer: (value: unknown) => void = () => undefined;
    put.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const { clock, rerender, props } = setup();
    clock.tick(1);
    clock.tick(1);

    rerender({ ...props, postId: "p2" });
    answer(reply(0.01));
    await settle();

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
  });
});

describe("useReadingProgress reset", () => {
  it("forgets what it counted when the article is marked unread", async () => {
    const { clock, result } = setup();
    clock.tick(1);
    await settle();
    clock.tick(1);
    clock.tick(1);

    result.current.reset(0);
    clock.emit("pause");

    expect(put).toHaveBeenCalledTimes(1);
  });

  it("stops sending when the article is marked read", () => {
    const { clock, result } = setup();

    result.current.reset(1);
    clock.tick(1);
    clock.emit("pause");

    expect(put).not.toHaveBeenCalled();
  });

  it("is harmless before tracking has started", () => {
    const { result } = setup({ enabled: false });

    expect(() => result.current.reset(0)).not.toThrow();
  });

  it("keeps the same function across renders", () => {
    const { result, rerender, props } = setup();
    const first = result.current.reset;

    rerender({ ...props, clockKey: "silent" });

    expect(result.current.reset).toBe(first);
  });

  it("applies a reset that arrives while tracking is off", async () => {
    const { clock, result, rerender, props } = setup();
    clock.currentTime = 4;
    clock.emit("seeked");
    clock.tick(1);
    await settle();
    expect(put).toHaveBeenCalledWith(endpoint("p1"), { progress: 0.05 }, { keepalive: false });

    rerender({ ...props, enabled: false });
    result.current.reset(0);
    rerender({ ...props, enabled: true });
    vi.advanceTimersByTime(10_000);
    clock.currentTime = 1;
    clock.emit("seeked");
    clock.tick(1);

    expect(put).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenLastCalledWith(endpoint("p1"), { progress: 0.02 }, { keepalive: false });
  });

  it("keeps what it knows while it is switched off and on again", async () => {
    const { clock, rerender, props } = setup();
    clock.currentTime = 4;
    clock.emit("seeked");
    clock.tick(1);
    await settle();

    rerender({ ...props, enabled: false });
    rerender({ ...props, enabled: true });
    vi.advanceTimersByTime(10_000);
    clock.currentTime = 3;
    clock.emit("seeked");
    clock.tick(1);

    expect(put).toHaveBeenCalledOnce();
  });
});

describe("useReadingProgress when the server pushes back", () => {
  it("waits as long as the server asks after a 429", async () => {
    put.mockRejectedValueOnce(
      new ApiError(429, "RATE_LIMITED", "Too many requests", { retryAfter: 30 })
    );
    const { clock } = setup();
    clock.tick(1);
    await settle();

    vi.advanceTimersByTime(29_999);
    clock.tick(1);
    expect(put).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    clock.tick(1);
    expect(put).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, 0, -5, "30", Number.NaN])(
    "waits a minute after a 429 that gives no usable wait (%s)",
    async (retryAfter) => {
      put.mockRejectedValueOnce(
        new ApiError(
          429,
          "RATE_LIMITED",
          "Too many requests",
          retryAfter === undefined ? undefined : { retryAfter }
        )
      );
      const { clock } = setup();
      clock.tick(1);
      await settle();

      vi.advanceTimersByTime(59_999);
      clock.tick(1);
      expect(put).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(1);
      clock.tick(1);
      expect(put).toHaveBeenCalledTimes(2);
    }
  );

  it.each([401, 403, 404])("gives up for good on a %s", async (status) => {
    put.mockRejectedValueOnce(new ApiError(status, "UNKNOWN_ERROR", "No"));
    const { clock } = setup();
    clock.tick(1);
    await settle();

    vi.advanceTimersByTime(60_000);
    clock.tick(1);
    clock.emit("pause");

    expect(put).toHaveBeenCalledOnce();
  });

  it.each([
    ["a server error", new ApiError(500, "UNKNOWN_ERROR", "Boom")],
    ["a network error", new TypeError("Failed to fetch")],
  ])("tries again after the spacing on %s", async (_name, error) => {
    put.mockRejectedValueOnce(error);
    const { clock } = setup();
    clock.tick(1);
    await settle();

    vi.advanceTimersByTime(9_999);
    clock.tick(1);
    expect(put).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    clock.tick(1);
    expect(put).toHaveBeenCalledTimes(2);
  });
});
