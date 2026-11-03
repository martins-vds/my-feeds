import { afterEach, describe, expect, it, vi } from "vitest";
import type { MediaClock, MediaClockEvent } from "../mediaClock";
import { PacerClock, type PacerScheduler } from "../pacerClock";

class FakeScheduler implements PacerScheduler {
  private time = 0;
  private nextHandle = 1;
  private frames = new Map<number, () => void>();

  now() {
    return this.time;
  }

  requestFrame(callback: () => void) {
    const handle = this.nextHandle++;
    this.frames.set(handle, callback);
    return handle;
  }

  cancelFrame(handle: number) {
    this.frames.delete(handle);
  }

  /** Moves time forward without running a frame, like a busy main thread between frames. */
  idle(ms: number) {
    this.time += ms;
  }

  /** Moves time forward `step` ms at a time, running the frames scheduled along the way. */
  advance(ms: number, step = 50) {
    const end = this.time + ms;
    while (this.time < end) {
      this.time = Math.min(end, this.time + step);
      const due = [...this.frames.values()];
      this.frames.clear();
      due.forEach((callback) => callback());
    }
  }
}

const EVENTS: MediaClockEvent[] = ["play", "pause", "seeking", "seeked", "timeupdate", "ended"];
const created: PacerClock[] = [];

function setup(durationMs = 60_000) {
  const scheduler = new FakeScheduler();
  const clock = new PacerClock(scheduler);
  created.push(clock);
  clock.setDurationMs(durationMs);
  const events: MediaClockEvent[] = [];
  EVENTS.forEach((type) => clock.addEventListener(type, () => events.push(type)));
  return { scheduler, clock, events };
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  created.splice(0).forEach((clock) => clock.dispose());
  Reflect.deleteProperty(document, "visibilityState");
  vi.restoreAllMocks();
});

describe("PacerClock", () => {
  it("starts paused at the beginning", () => {
    const { clock } = setup();

    expect(clock.currentTime).toBe(0);
    expect(clock.paused).toBe(true);
    expect(clock.ended).toBe(false);
  });

  it("does not start when there is nothing to read", () => {
    const { clock, events } = setup(0);

    clock.play();

    expect(clock.paused).toBe(true);
    expect(events).toEqual([]);
  });

  it("ignores play while it is already running", () => {
    const { clock, events } = setup();

    clock.play();
    clock.play();

    expect(events).toEqual(["play"]);
  });

  it("advances with real time", () => {
    const { clock, scheduler } = setup();

    clock.play();
    scheduler.advance(2000);

    expect(clock.currentTime).toBeCloseTo(2, 5);
    expect(clock.paused).toBe(false);
  });

  it("multiplies elapsed time by the rate, from the moment the rate changes", () => {
    const { clock, scheduler } = setup();

    clock.play();
    scheduler.advance(1000);
    scheduler.idle(100);
    clock.setRate(2);
    scheduler.advance(1000);

    expect(clock.currentTime).toBeCloseTo(3.1, 5);
  });

  it("fires play, then timeupdate four times a second", () => {
    const { clock, scheduler, events } = setup();

    clock.play();
    scheduler.advance(1000);

    expect(events).toEqual(["play", "timeupdate", "timeupdate", "timeupdate", "timeupdate"]);
  });

  it("holds its position while paused, announcing it with timeupdate then pause", () => {
    const { clock, scheduler, events } = setup();
    clock.play();
    scheduler.advance(1100);
    events.length = 0;

    clock.pause();
    const pausedAt = clock.currentTime;
    scheduler.advance(5000);

    expect(events).toEqual(["timeupdate", "pause"]);
    expect(clock.currentTime).toBe(pausedAt);
    expect(clock.paused).toBe(true);
  });

  it("counts the time since the last frame when it pauses", () => {
    const { clock, scheduler } = setup();
    clock.play();
    scheduler.advance(1000);
    scheduler.idle(30);

    clock.pause();

    expect(clock.currentTime).toBeCloseTo(1.03, 5);
  });

  it("ignores pause while it is not running", () => {
    const { clock, events } = setup();

    clock.pause();

    expect(events).toEqual([]);
  });

  it("resumes from where it paused", () => {
    const { clock, scheduler } = setup();
    clock.play();
    scheduler.advance(1000);
    clock.pause();
    scheduler.advance(3000);

    clock.play();
    scheduler.advance(1000);

    expect(clock.currentTime).toBeCloseTo(2, 5);
  });

  it("moves to the new position first, then fires seeking, timeupdate and seeked", () => {
    const { clock, events } = setup();
    const positions: number[] = [];
    clock.addEventListener("seeking", () => positions.push(clock.currentTime));

    clock.seek(12.5);

    expect(positions).toEqual([12.5]);
    expect(events).toEqual(["seeking", "timeupdate", "seeked"]);
  });

  it("clamps a seek to the readable range", () => {
    const { clock } = setup(10_000);

    clock.seek(-4);
    expect(clock.currentTime).toBe(0);
    clock.seek(99);
    expect(clock.currentTime).toBe(10);
  });

  it("keeps running after a seek, counting from the new position", () => {
    const { clock, scheduler } = setup();
    clock.play();
    scheduler.advance(500);
    scheduler.idle(10);

    clock.seek(20);
    scheduler.advance(1000);

    expect(clock.currentTime).toBeCloseTo(21, 5);
  });

  it("ends exactly at the duration, never past it", () => {
    const { clock, scheduler, events } = setup(1000);
    const positions: number[] = [];
    clock.addEventListener("timeupdate", () => positions.push(clock.currentTime));

    clock.play();
    scheduler.advance(5000, 300);

    expect(events.slice(-3)).toEqual(["timeupdate", "pause", "ended"]);
    expect(positions.at(-1)).toBe(1);
    expect(clock.currentTime).toBe(1);
    expect(clock.ended).toBe(true);
    expect(clock.paused).toBe(true);
  });

  it("treats a seek to the end like reaching it", () => {
    const { clock, events } = setup(10_000);
    clock.play();
    events.length = 0;

    clock.seek(99);

    expect(events.slice(-2)).toEqual(["pause", "ended"]);
    expect(clock.ended).toBe(true);
    expect(clock.paused).toBe(true);
  });

  it("marks a paused seek to the end as ended without announcing an end of playback", () => {
    const { clock, events } = setup(10_000);

    clock.seek(99);

    expect(events).toEqual(["seeking", "timeupdate", "seeked"]);
    expect(clock.ended).toBe(true);
  });

  it("restarts from the beginning when played after the end", () => {
    const { clock, scheduler } = setup(1000);
    clock.play();
    scheduler.advance(2000);

    clock.play();
    expect(clock.ended).toBe(false);
    expect(clock.currentTime).toBe(0);
    scheduler.advance(500);

    expect(clock.currentTime).toBeCloseTo(0.5, 5);
  });

  it("is no longer ended once it is moved back", () => {
    const { clock, scheduler } = setup(1000);
    clock.play();
    scheduler.advance(2000);

    clock.seek(0.2);

    expect(clock.ended).toBe(false);
  });

  it("counts a long stall as one second so a suspended tab cannot jump ahead", () => {
    const { clock, scheduler } = setup();
    clock.play();

    scheduler.advance(60_000, 60_000);

    expect(clock.currentTime).toBeCloseTo(1, 5);
  });

  it("pauses itself when the tab is hidden and does not resume when it is shown again", () => {
    const { clock, scheduler } = setup();
    clock.play();
    scheduler.advance(500);

    setVisibility("hidden");
    expect(clock.paused).toBe(true);
    setVisibility("visible");

    expect(clock.paused).toBe(true);
  });

  it("stops delivering events to a listener that was removed", () => {
    const { clock } = setup();
    const listener = vi.fn();
    clock.addEventListener("seeking", listener);
    clock.removeEventListener("seeking", listener);

    clock.seek(1);

    expect(listener).not.toHaveBeenCalled();
  });

  it("does nothing more once disposed", () => {
    const { clock, scheduler, events } = setup();
    clock.play();
    clock.dispose();
    events.length = 0;

    scheduler.advance(1000);
    setVisibility("hidden");

    expect(events).toEqual([]);
  });

  it("stops listening for the page being hidden once disposed", () => {
    const removeListener = vi.spyOn(document, "removeEventListener");
    const { clock } = setup();

    clock.dispose();

    expect(removeListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });

  it("can stand in for an audio element wherever a MediaClock is expected", () => {
    const pacer = new PacerClock();
    const clocks: MediaClock[] = [pacer, document.createElement("audio")];
    pacer.dispose();

    expect(clocks).toHaveLength(2);
  });
});
