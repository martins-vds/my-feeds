import type { MediaClock, MediaClockEvent } from "./mediaClock";

/** Spacing of `timeupdate` events while running, close to what an audio element fires. */
export const PACER_TIMEUPDATE_INTERVAL_MS = 250;

/**
 * The longest gap between two frames that still counts as reading time. A
 * suspended or stalled tab then slows the clock down instead of jumping it ahead.
 */
export const PACER_MAX_FRAME_GAP_MS = 1000;

export interface PacerScheduler {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

const browserScheduler: PacerScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
};

/**
 * A virtual media clock for silent reading. It advances with real time scaled by
 * `rate` instead of with an audio file, and it speaks the same events as an audio
 * element, so highlighting and reading progress run on it unchanged.
 */
export class PacerClock implements MediaClock {
  private readonly scheduler: PacerScheduler;
  private readonly listeners = new Map<MediaClockEvent, Set<() => void>>();
  private positionMs = 0;
  private durationMs = 0;
  private rate = 1;
  private running = false;
  private finished = false;
  private lastFrameAt = 0;
  private lastTimeupdateAt = 0;
  private frame = 0;

  constructor(scheduler: PacerScheduler = browserScheduler) {
    this.scheduler = scheduler;
    document.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  get currentTime(): number {
    return this.positionMs / 1000;
  }

  get ended(): boolean {
    return this.finished;
  }

  get paused(): boolean {
    return !this.running;
  }

  setDurationMs(durationMs: number): void {
    this.durationMs = durationMs;
  }

  setRate(rate: number): void {
    this.advance();
    this.rate = rate;
  }

  play(): void {
    if (this.running || this.durationMs <= 0) return;
    if (this.finished) {
      this.positionMs = 0;
      this.finished = false;
    }
    this.running = true;
    this.lastFrameAt = this.scheduler.now();
    this.frame = this.scheduler.requestFrame(this.tick);
    this.emit("play");
  }

  pause(): void {
    if (!this.running) return;
    this.advance();
    this.halt();
    this.emit("timeupdate");
    this.emit("pause");
  }

  seek(seconds: number): void {
    this.positionMs = Math.min(this.durationMs, Math.max(0, seconds * 1000));
    this.finished = false;
    if (this.running) this.lastFrameAt = this.scheduler.now();
    this.emit("seeking");
    this.emit("timeupdate");
    this.emit("seeked");
    if (this.durationMs > 0 && this.positionMs >= this.durationMs) this.finish();
  }

  dispose(): void {
    this.halt();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
  }

  addEventListener(type: MediaClockEvent, listener: () => void): void {
    const listeners = this.listeners.get(type) ?? new Set<() => void>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: MediaClockEvent, listener: () => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  private readonly tick = (): void => {
    this.advance();
    if (this.positionMs >= this.durationMs) {
      this.finish();
      return;
    }
    const now = this.scheduler.now();
    if (now - this.lastTimeupdateAt >= PACER_TIMEUPDATE_INTERVAL_MS) {
      this.lastTimeupdateAt = now;
      this.emit("timeupdate");
    }
    this.frame = this.scheduler.requestFrame(this.tick);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") this.pause();
  };

  /** Moves the position forward by the time since the last frame, scaled by the rate. */
  private advance(): void {
    if (!this.running) return;
    const now = this.scheduler.now();
    const elapsed = Math.min(now - this.lastFrameAt, PACER_MAX_FRAME_GAP_MS);
    this.lastFrameAt = now;
    this.positionMs = Math.min(this.durationMs, this.positionMs + elapsed * this.rate);
  }

  private halt(): void {
    this.running = false;
    this.scheduler.cancelFrame(this.frame);
  }

  private finish(): void {
    const wasRunning = this.running;
    this.halt();
    this.finished = true;
    if (wasRunning) {
      this.emit("timeupdate");
      this.emit("pause");
      this.emit("ended");
    }
  }

  private emit(type: MediaClockEvent): void {
    // A copy, so a listener can unsubscribe while the event is being delivered.
    [...(this.listeners.get(type) ?? [])].forEach((listener) => listener());
  }
}
