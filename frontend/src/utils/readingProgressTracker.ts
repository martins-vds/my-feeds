import { wholePercent } from "./readingProgress";

/** Regular updates go out at most this often. Forced flushes (pause, hide, leave) ignore it. */
export const PROGRESS_FLUSH_INTERVAL_MS = 10_000;

/** A clock step bigger than this is a seek or a stall, not reading, so it earns no credit. */
export const MAX_CREDIT_STEP_SECONDS = 5;

export interface ProgressReport {
  readProgress: number;
  isRead: boolean;
}

export type SendOutcome =
  | { kind: "saved"; report: ProgressReport }
  | { kind: "rate-limited"; retryAfterSeconds: number }
  | { kind: "stop" }
  | { kind: "failed" };

export type SendProgress = (
  progress: number,
  options: { keepalive: boolean }
) => Promise<SendOutcome>;

export interface ReadingProgressTrackerOptions {
  /** What the server already holds for this reader, 0..1. */
  initialProgress: number;
  send: SendProgress;
  /** Called with every report the server accepted for the current state. */
  onUpdate: (report: ProgressReport) => void;
  /** Milliseconds on any monotonic clock. Defaults to performance.now. */
  now?: () => number;
}

/**
 * Decides how much of an article has been read and when to tell the server.
 * It knows nothing about React, audio elements or HTTP: the hook feeds it clock
 * positions and supplies `send`.
 */
export class ReadingProgressTracker {
  private highWater: number;
  private sentPercent: number;
  private lastTime: number | null = null;
  private lastAttemptAt = Number.NEGATIVE_INFINITY;
  private blockedUntil = 0;
  private inFlight = false;
  private queued = false;
  private halted = false;
  private generation = 0;
  private readonly send: SendProgress;
  private readonly onUpdate: (report: ProgressReport) => void;
  private readonly now: () => number;

  constructor(options: ReadingProgressTrackerOptions) {
    this.highWater = options.initialProgress;
    this.sentPercent = wholePercent(options.initialProgress);
    this.send = options.send;
    this.onUpdate = options.onUpdate;
    this.now = options.now ?? (() => performance.now());
  }

  /** Moves the baseline without crediting anything: play, a seek, or attaching to a running clock. */
  rebase(timeSeconds: number): void {
    this.lastTime = timeSeconds;
  }

  /** The clock ticked. Credits the position when the step since the last tick looks like reading. */
  advance(timeSeconds: number, durationSeconds: number): void {
    const step = this.lastTime === null ? 0 : timeSeconds - this.lastTime;
    this.lastTime = timeSeconds;
    if (step > 0 && step <= MAX_CREDIT_STEP_SECONDS && durationSeconds > 0) {
      this.highWater = Math.max(this.highWater, Math.min(1, timeSeconds / durationSeconds));
    }
    this.attempt(false, false);
  }

  /** Sends now if there is something new, ignoring the spacing. For pause, hide and leave. */
  flush(options: { keepalive?: boolean } = {}): void {
    this.attempt(true, options.keepalive ?? false);
  }

  /** The reader marked the article read (1) or unread (0) by hand. */
  reset(next: 0 | 1): void {
    this.generation += 1;
    this.highWater = next;
    this.sentPercent = wholePercent(next);
    this.halted = false;
    this.queued = false;
  }

  private attempt(forced: boolean, keepalive: boolean): void {
    if (this.halted) return;
    if (wholePercent(this.highWater) <= this.sentPercent) return;
    const now = this.now();
    if (now < this.blockedUntil) return;
    if (!forced && now - this.lastAttemptAt < PROGRESS_FLUSH_INTERVAL_MS) return;
    if (this.inFlight) {
      if (forced) this.queued = true;
      return;
    }

    this.inFlight = true;
    this.lastAttemptAt = now;
    const generation = this.generation;
    this.send(this.highWater, { keepalive }).then(
      (outcome) => this.settle(generation, outcome),
      () => this.settle(generation, { kind: "failed" })
    );
  }

  private settle(generation: number, outcome: SendOutcome): void {
    this.inFlight = false;
    if (outcome.kind === "rate-limited") {
      this.blockedUntil = this.now() + outcome.retryAfterSeconds * 1000;
    } else if (outcome.kind === "stop") {
      this.halted = true;
    } else if (outcome.kind === "saved" && generation === this.generation) {
      this.sentPercent = wholePercent(outcome.report.readProgress);
      if (outcome.report.isRead) this.halted = true;
      this.onUpdate(outcome.report);
    }
    // A failed attempt changes nothing: the next regular update retries after the spacing.

    if (this.queued) {
      this.queued = false;
      this.attempt(true, false);
    }
  }
}
