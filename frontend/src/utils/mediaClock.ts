export type MediaClockEvent = "play" | "pause" | "seeking" | "seeked" | "timeupdate" | "ended";

/**
 * The minimal surface the read-along highlighter and the reading-progress
 * tracker need from a clock. An HTMLAudioElement satisfies it, and so does the
 * timer-driven PacerClock used for silent reading.
 */
export interface MediaClock {
  /** Seconds. */
  readonly currentTime: number;
  readonly ended: boolean;
  readonly paused: boolean;
  addEventListener(type: MediaClockEvent, listener: () => void): void;
  removeEventListener(type: MediaClockEvent, listener: () => void): void;
}
