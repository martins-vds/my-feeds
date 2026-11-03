import { useCallback, useEffect, useRef, useState } from "react";
import type { MediaClock, MediaClockEvent } from "../utils/mediaClock";
import { BASE_WPM } from "../utils/pacedTimings";
import { PacerClock } from "../utils/pacerClock";

export type PacerStatus = "playing" | "paused";

export interface UsePacerResult {
  status: PacerStatus;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  /** How far through the timeline the pacer is, from 0 to 1. */
  fraction: number;
  setDurationMs: (durationMs: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Moves to a fraction of the timeline (0 to 1) without changing play or pause. */
  seekToFraction: (fraction: number) => void;
  /** Pauses and goes back to the start. */
  stop: () => void;
  /** A stable accessor for the clock. It is null once the hook has unmounted. */
  getClock: () => MediaClock | null;
}

// Pausing and reaching the end emit "timeupdate" once the clock has stopped, so
// the mirrored state needs no listener for "pause".
const SYNC_EVENTS: readonly MediaClockEvent[] = ["play", "timeupdate"];

/**
 * Owns the `PacerClock` that paces silent reading and mirrors it as React state.
 * The clock is created on first use, so a strict-mode remount just creates a new
 * one, and it is released when the component unmounts. `wpm` sets how fast it
 * reads: the timeline is built at `BASE_WPM` and the clock rate is `wpm / BASE_WPM`.
 */
export function usePacer(wpm: number): UsePacerResult {
  const [status, setStatus] = useState<PacerStatus>("paused");
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMsState] = useState(0);

  const clockRef = useRef<PacerClock | null>(null);
  const retiredRef = useRef(false);
  const durationRef = useRef(0);
  const rateRef = useRef(wpm / BASE_WPM);

  const ensureClock = useCallback((): PacerClock | null => {
    if (retiredRef.current) return null;
    if (clockRef.current === null) {
      const clock = new PacerClock();
      clock.setDurationMs(durationRef.current);
      clock.setRate(rateRef.current);
      const sync = () => {
        setStatus(clock.paused ? "paused" : "playing");
        setPositionMs(Math.round(clock.currentTime * 1000));
      };
      SYNC_EVENTS.forEach((type) => clock.addEventListener(type, sync));
      clockRef.current = clock;
    }
    return clockRef.current;
  }, []);

  useEffect(() => {
    retiredRef.current = false;
    return () => {
      retiredRef.current = true;
      clockRef.current?.dispose();
      clockRef.current = null;
    };
  }, []);

  useEffect(() => {
    rateRef.current = wpm / BASE_WPM;
    clockRef.current?.setRate(rateRef.current);
  }, [wpm]);

  const setDurationMs = useCallback((next: number) => {
    durationRef.current = next;
    setDurationMsState(next);
    clockRef.current?.setDurationMs(next);
  }, []);

  const play = useCallback(() => ensureClock()?.play(), [ensureClock]);

  const pause = useCallback(() => clockRef.current?.pause(), []);

  const toggle = useCallback(() => {
    const clock = ensureClock();
    if (clock === null) return;
    if (clock.paused) clock.play();
    else clock.pause();
  }, [ensureClock]);

  const seekToFraction = useCallback(
    (fraction: number) => {
      if (!Number.isFinite(fraction)) return;
      ensureClock()?.seek((fraction * durationRef.current) / 1000);
    },
    [ensureClock]
  );

  const stop = useCallback(() => {
    const clock = clockRef.current;
    if (clock === null) return;
    clock.pause();
    clock.seek(0);
  }, []);

  return {
    status,
    isPlaying: status === "playing",
    positionMs,
    durationMs,
    fraction: durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0,
    setDurationMs,
    play,
    pause,
    toggle,
    seekToFraction,
    stop,
    getClock: ensureClock,
  };
}
