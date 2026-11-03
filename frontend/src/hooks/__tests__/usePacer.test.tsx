import { StrictMode, useEffect, useLayoutEffect } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaClock } from "../../utils/mediaClock";
import { usePacer } from "../usePacer";

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "visibilityState");
});

/** Mounts the hook at the given pace and gives it a timeline of `durationMs`. */
function setup(wpm = 250, durationMs = 10_000) {
  const hook = renderHook(({ pace }) => usePacer(pace), { initialProps: { pace: wpm } });
  act(() => hook.result.current.setDurationMs(durationMs));
  return hook;
}

describe("usePacer", () => {
  it("starts paused at the beginning of the timeline", () => {
    const { result } = setup();

    expect(result.current.status).toBe("paused");
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.positionMs).toBe(0);
    expect(result.current.durationMs).toBe(10_000);
    expect(result.current.fraction).toBe(0);
  });

  it("reads in real time at 250 words per minute", () => {
    const { result } = setup();

    act(() => result.current.play());
    expect(result.current.status).toBe("playing");
    expect(result.current.isPlaying).toBe(true);

    act(() => vi.advanceTimersByTime(2000));
    act(() => result.current.pause());

    expect(result.current.status).toBe("paused");
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.positionMs).toBe(2000);
    expect(result.current.fraction).toBeCloseTo(0.2, 10);
  });

  it("follows the position while it reads, not only when it pauses", () => {
    const { result } = setup();

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1000));

    expect(result.current.positionMs).toBeGreaterThan(500);
    expect(result.current.positionMs).toBeLessThanOrEqual(1000);
  });

  it("reports its position in whole milliseconds", () => {
    const { result } = setup();

    act(() => result.current.seekToFraction(1 / 3));

    expect(result.current.positionMs).toBe(3333);
  });

  it("reads twice as fast at 500 words per minute", () => {
    const { result } = setup(500);

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.pause());

    expect(result.current.positionMs).toBe(2000);
  });

  it("uses a pace chosen before it first plays", () => {
    const hook = setup(250);
    hook.rerender({ pace: 500 });

    act(() => hook.result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    act(() => hook.result.current.pause());

    expect(hook.result.current.positionMs).toBe(2000);
  });

  it("follows a pace change made while reading without jumping", () => {
    const hook = setup(250);

    act(() => hook.result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    hook.rerender({ pace: 500 });
    act(() => vi.advanceTimersByTime(1000));
    act(() => hook.result.current.pause());

    expect(hook.result.current.positionMs).toBe(3000);
  });

  it("toggles between reading and paused", () => {
    const { result } = setup();

    act(() => result.current.toggle());
    expect(result.current.status).toBe("playing");

    act(() => result.current.toggle());
    expect(result.current.status).toBe("paused");
  });

  it("seeks to a fraction of the timeline and stays paused", () => {
    const { result } = setup();

    act(() => result.current.seekToFraction(0.5));

    expect(result.current.positionMs).toBe(5000);
    expect(result.current.fraction).toBe(0.5);
    expect(result.current.status).toBe("paused");
  });

  it.each([
    [-0.5, 0],
    [1.5, 10_000],
  ])("clamps a seek to %s into the timeline", (fraction, expectedMs) => {
    const { result } = setup();
    act(() => result.current.seekToFraction(0.5));

    act(() => result.current.seekToFraction(fraction));

    expect(result.current.positionMs).toBe(expectedMs);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("ignores a seek to %s", (fraction) => {
    const { result } = setup();
    act(() => result.current.seekToFraction(0.5));

    act(() => result.current.seekToFraction(fraction));

    expect(result.current.positionMs).toBe(5000);
  });

  it("does not play when there is nothing to read", () => {
    const { result } = setup(250, 0);

    act(() => result.current.play());

    expect(result.current.status).toBe("paused");
    expect(result.current.fraction).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops at the end of the timeline and starts over when played again", () => {
    const { result } = setup(250, 2000);

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(2500));

    expect(result.current.status).toBe("paused");
    expect(result.current.positionMs).toBe(2000);
    expect(result.current.fraction).toBe(1);

    act(() => result.current.play());

    expect(result.current.status).toBe("playing");
    expect(result.current.positionMs).toBe(0);
  });

  it("stops by pausing and going back to the start", () => {
    const { result } = setup();
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1500));

    act(() => result.current.stop());

    expect(result.current.status).toBe("paused");
    expect(result.current.positionMs).toBe(0);
    expect(result.current.fraction).toBe(0);

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(500));
    act(() => result.current.pause());

    expect(result.current.positionMs).toBe(500);
  });

  it("follows a pause the clock makes by itself when the tab is hidden", () => {
    const { result } = setup();
    act(() => result.current.play());

    act(() => setVisibility("hidden"));

    expect(result.current.status).toBe("paused");
  });

  it("hands out the same clock for as long as it is mounted", () => {
    const hook = setup();
    const clock = hook.result.current.getClock();

    hook.rerender({ pace: 300 });

    expect(clock).not.toBeNull();
    expect(hook.result.current.getClock()).toBe(clock);
    expect(clock?.currentTime).toBe(0);
    expect(clock?.paused).toBe(true);
  });

  it("keeps a timeline length that was set before its clock existed", () => {
    const { result } = renderHook(() => {
      const pacer = usePacer(250);
      const { setDurationMs } = pacer;
      // A layout effect runs before any passive effect could have created the clock.
      useLayoutEffect(() => setDurationMs(4000), [setDurationMs]);
      return pacer;
    });

    act(() => result.current.seekToFraction(0.5));

    expect(result.current.positionMs).toBe(2000);
  });

  it("takes a new timeline length after its clock exists", () => {
    const { result } = setup(250, 10_000);
    act(() => result.current.seekToFraction(0.1));

    act(() => result.current.setDurationMs(2000));
    act(() => result.current.seekToFraction(0));
    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(2500));

    expect(result.current.positionMs).toBe(2000);
    expect(result.current.status).toBe("paused");
  });

  it("never reports more than the whole timeline when the timeline gets shorter", () => {
    const { result } = setup();
    act(() => result.current.seekToFraction(0.5));

    act(() => result.current.setDurationMs(2000));

    expect(result.current.fraction).toBe(1);
  });

  it("releases its clock when it unmounts", () => {
    const { result, unmount } = setup();
    act(() => result.current.play());
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
    expect(result.current.getClock()).toBeNull();

    result.current.play();
    result.current.toggle();
    result.current.pause();
    result.current.seekToFraction(0.5);
    result.current.stop();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("replaces its clock after React's strict-mode remount and keeps the new one live", () => {
    const seen: Array<MediaClock | null> = [];
    const { result } = renderHook(
      () => {
        const pacer = usePacer(250);
        const { getClock } = pacer;
        useEffect(() => {
          seen.push(getClock());
        }, [getClock]);
        return pacer;
      },
      { wrapper: StrictMode }
    );
    act(() => result.current.setDurationMs(10_000));

    // Strict mode runs the mount effects, cleans them up and runs them again.
    expect(seen).toHaveLength(2);
    expect(seen[1]).not.toBe(seen[0]);
    expect(result.current.getClock()).toBe(seen[1]);

    act(() => result.current.play());
    act(() => vi.advanceTimersByTime(1000));
    act(() => setVisibility("hidden"));

    expect(result.current.status).toBe("paused");
    expect(result.current.positionMs).toBe(1000);
    expect(seen[1]?.currentTime).toBe(1);
  });
});
