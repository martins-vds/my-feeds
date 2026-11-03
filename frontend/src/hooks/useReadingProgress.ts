import { useCallback, useEffect, useRef } from "react";
import api, { ApiError } from "../services/api";
import type { MediaClock, MediaClockEvent } from "../utils/mediaClock";
import { ReadingProgressTracker } from "../utils/readingProgressTracker";
import type { ProgressReport, SendOutcome } from "../utils/readingProgressTracker";

/** The wait after a 429 that does not say how long to wait. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

interface ProgressResponse {
  postId: string;
  isRead: boolean;
  readProgress: number;
  readAt: string | null;
}

/** Sends one progress update and sorts the answer into what the tracker needs to know. */
async function sendProgress(
  postId: string,
  progress: number,
  options: { keepalive: boolean }
): Promise<SendOutcome> {
  try {
    const saved = await api.put<ProgressResponse>(
      `/posts/${postId}/progress`,
      { progress },
      { keepalive: options.keepalive }
    );
    return { kind: "saved", report: { readProgress: saved.readProgress, isRead: saved.isRead } };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 429) {
        const retryAfter = error.details?.retryAfter;
        return {
          kind: "rate-limited",
          retryAfterSeconds:
            typeof retryAfter === "number" && retryAfter > 0
              ? retryAfter
              : DEFAULT_RETRY_AFTER_SECONDS,
        };
      }
      // The session ended, or the post is not this reader's to track: asking again will not help.
      if (error.status === 401 || error.status === 403 || error.status === 404) {
        return { kind: "stop" };
      }
    }
    return { kind: "failed" };
  }
}

export interface UseReadingProgressArgs {
  postId: string;
  /** What the server holds for this reader and post. Read once, when tracking starts for the post. */
  initialProgress: number;
  /** Tracking runs only while this is true. */
  enabled: boolean;
  /** Must change whenever `getClock` would now return a different clock. */
  clockKey: string;
  getClock: () => MediaClock | null;
  getDurationSeconds: () => number;
  /** Called with every report the server accepted for the post being tracked. */
  onUpdate: (report: ProgressReport) => void;
}

export interface UseReadingProgressResult {
  /** The reader marked the article read (1) or unread (0) by hand. */
  reset: (next: 0 | 1) => void;
}

/**
 * Turns a media clock's playback into reading progress for one post and reports it to the server.
 * The counting and the timing live in ReadingProgressTracker; this hook wires it to a clock, to
 * page visibility and to the API.
 */
export function useReadingProgress(args: UseReadingProgressArgs): UseReadingProgressResult {
  const { postId, enabled, clockKey } = args;

  // Declared first, so it is fresh before the effect below reads it in the same commit.
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });

  const trackerRef = useRef<{ postId: string; tracker: ReadingProgressTracker } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let entry = trackerRef.current;
    if (!entry || entry.postId !== postId) {
      entry = {
        postId,
        tracker: new ReadingProgressTracker({
          initialProgress: latest.current.initialProgress,
          send: (progress, options) => sendProgress(postId, progress, options),
          onUpdate: (report) => {
            if (latest.current.postId === postId) latest.current.onUpdate(report);
          },
        }),
      };
      trackerRef.current = entry;
    }
    const { tracker } = entry;

    const clock = latest.current.getClock();
    const clockListeners: Array<[MediaClockEvent, () => void]> = [];
    if (clock) {
      tracker.rebase(clock.currentTime);
      const rebase = () => tracker.rebase(clock.currentTime);
      const advance = () => tracker.advance(clock.currentTime, latest.current.getDurationSeconds());
      const flush = () => tracker.flush();
      clockListeners.push(
        ["play", rebase],
        ["seeking", rebase],
        ["seeked", rebase],
        ["timeupdate", advance],
        ["pause", flush],
        ["ended", flush]
      );
      for (const [type, listener] of clockListeners) clock.addEventListener(type, listener);
    }

    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") tracker.flush({ keepalive: true });
    };
    const flushWhenLeaving = () => tracker.flush({ keepalive: true });
    document.addEventListener("visibilitychange", flushWhenHidden);
    window.addEventListener("pagehide", flushWhenLeaving);

    return () => {
      document.removeEventListener("visibilitychange", flushWhenHidden);
      window.removeEventListener("pagehide", flushWhenLeaving);
      if (clock) {
        for (const [type, listener] of clockListeners) clock.removeEventListener(type, listener);
      }
      tracker.flush();
    };
  }, [enabled, postId, clockKey]);

  const reset = useCallback((next: 0 | 1) => {
    trackerRef.current?.tracker.reset(next);
  }, []);

  return { reset };
}
