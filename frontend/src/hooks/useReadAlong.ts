/**
 * useReadAlong — word-by-word or continuous highlighting driven by media time.
 *
 * Given the served word timings and the title/body containers, it:
 *  1. Decides eligibility up-front (aligns spoken tokens to displayed words with
 *     a >=90% gate) so highlighting is either on for the whole post or silently
 *     disabled — never a flash of the wrong word (FR-018/019).
 *  2. Wraps each displayed word once in an indexed `.ra-word` span.
 *  3. On a requestAnimationFrame cadence while playing, reads the media element's
 *     currentTime and toggles `.ra-active` on the single spoken word (O(1) DOM
 *     mutation per change), holding across gaps and clearing at the end.
 *     Continuous mode instead retains completed text in scoped CSS highlights
 *     and fills the current word with a media-time gradient, including paused
 *     seeks and completed playback. Auto-scroll follows active-word changes.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { WordTiming } from "../types";
import { alignSpokenToDisplay, normalizeToken } from "../utils/alignTimings";
import { collectWords, unwrapWords, wrapWords } from "../utils/wrapWords";

export type HighlightMode = "word" | "continuous";

export function supportsContinuousHighlight(): boolean {
  return typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
}

export interface UseReadAlongArgs {
  timings: WordTiming[] | null;
  getMediaElement: () => HTMLAudioElement | null;
  isPlaying: boolean;
  titleRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
  highlightEnabled: boolean;
  autoScrollEnabled: boolean;
  highlightMode?: HighlightMode;
  /** Changes when sanitized article DOM is replaced (e.g. image consent). */
  contentVersion?: string | boolean;
}

export interface UseReadAlongResult {
  /** True when highlighting is eligible and active for this post. */
  highlightingActive: boolean;
}

/** Greatest index whose start <= mediaMs; -1 before the first / after the last ends. */
function activeTimingIndex(timings: WordTiming[], mediaMs: number): number {
  let lo = 0;
  let hi = timings.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timings[mid].startMs <= mediaMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // Clear once the final word has finished (hold across interior gaps only).
  if (ans >= 0 && ans === timings.length - 1) {
    const last = timings[ans];
    if (mediaMs >= last.startMs + last.durationMs) return -1;
  }
  return ans;
}

export function useReadAlong(args: UseReadAlongArgs): UseReadAlongResult {
  const {
    timings,
    getMediaElement,
    isPlaying,
    titleRef,
    contentRef,
    highlightEnabled,
    autoScrollEnabled,
    contentVersion,
    highlightMode = "word",
  } = args;

  const [highlightingActive, setHighlightingActive] = useState(false);

  // Ordered display spans, timing→display map, and the current active index.
  const spansRef = useRef<HTMLElement[]>([]);
  const mapRef = useRef<Int32Array | null>(null);
  const activeRef = useRef<number>(-1);
  const autoScrollRef = useRef(autoScrollEnabled);
  autoScrollRef.current = autoScrollEnabled;
  const reducedMotionRef = useRef(false);

  // Central comfort band (fraction of viewport) — only reposition when the
  // active word drifts outside it, to avoid constant motion at high rates.
  const maybeAutoScroll = useCallback((span: HTMLElement) => {
    if (!autoScrollRef.current) return;
    const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
    if (viewportH <= 0) return;
    const rect = span.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const bandTop = viewportH * 0.25;
    const bandBottom = viewportH * 0.75;
    if (center < bandTop || center > bandBottom) {
      span.scrollIntoView({
        block: "center",
        behavior: reducedMotionRef.current ? "auto" : "smooth",
      });
    }
  }, []);

  const clearActive = useCallback(() => {
    const spans = spansRef.current;
    const prev = activeRef.current;
    if (prev >= 0 && spans[prev]) {
      spans[prev].classList.remove("ra-active", "ra-progress");
      spans[prev].style.removeProperty("--ra-progress");
    }
    activeRef.current = -1;
  }, []);

  const applyActive = useCallback(
    (displayIdx: number, scroll = true) => {
      if (displayIdx === activeRef.current) return;
      const spans = spansRef.current;
      const prev = activeRef.current;
      if (prev >= 0 && spans[prev]) {
        spans[prev].classList.remove("ra-active", "ra-progress");
        spans[prev].style.removeProperty("--ra-progress");
      }
      if (displayIdx >= 0 && spans[displayIdx]) {
        spans[displayIdx].classList.add("ra-active");
        // At most one reposition per active-word change (coalesced per frame).
        if (scroll) maybeAutoScroll(spans[displayIdx]);
      }
      activeRef.current = displayIdx;
    },
    [maybeAutoScroll]
  );

  // 1) Eligibility + one-time wrapping.
  useEffect(() => {
    // Reset any prior state first.
    clearActive();
    spansRef.current = [];
    mapRef.current = null;
    setHighlightingActive(false);

    const title = titleRef.current;
    const content = contentRef.current;
    // Start from a clean, unwrapped DOM so a re-run — toggling "Highlight
    // while playing" off then on (US3), or React StrictMode's mount
    // double-invoke — re-wraps correctly instead of finding every word
    // already inside a `.ra-word` span (which would make collectWords
    // return nothing and silently disable highlighting for good).
    if (title) unwrapWords(title);
    if (content) unwrapWords(content);

    if (!highlightEnabled || !timings || timings.length === 0) return;
    if (!title && !content) return;

    const spoken = timings.map((t) => normalizeToken(t.text));
    const displayWords = [
      ...(title ? collectWords(title) : []),
      ...(content ? collectWords(content) : []),
    ].map(normalizeToken);

    const alignment = alignSpokenToDisplay(spoken, displayWords);
    if (!alignment.enabled) return;

    const spans: HTMLElement[] = [];
    let start = 0;
    if (title) {
      const wrapped = wrapWords(title, start);
      spans.push(...wrapped.elements);
      start += wrapped.count;
    }
    if (content) {
      spans.push(...wrapWords(content, start).elements);
    }

    spansRef.current = spans;
    mapRef.current = alignment.timingToDisplay;
    setHighlightingActive(true);

    return () => {
      clearActive();
      // Unwrap so the next run (or unmount) leaves the sanitized DOM as it
      // was found — keeping the wrap step fully re-entrant.
      if (title) unwrapWords(title);
      if (content) unwrapWords(content);
    };
  }, [timings, highlightEnabled, titleRef, contentRef, clearActive, contentVersion]);

  // 2) Media-clock painting. Ranges connect spaces and nested inline markup
  // without adding layout boxes or painting the controls between title/body.
  useEffect(() => {
    if (!highlightingActive || !timings) return;

    const continuous = highlightMode === "continuous" && supportsContinuousHighlight();
    if (!continuous && !isPlaying) return;
    const map = mapRef.current;
    if (!map) return;
    const spans = spansRef.current;
    const progressTimings: { displayIdx: number; startMs: number; endMs: number }[] = [];
    if (continuous) {
      timings.forEach((timing, index) => {
        const displayIdx = map[index];
        const previous = progressTimings[index - 1];
        if (displayIdx < 0) {
          progressTimings.push(previous ?? { displayIdx: -1, startMs: 0, endMs: 0 });
        } else if (previous?.displayIdx === displayIdx) {
          // One compound display token can have several spoken timings.
          previous.endMs = Math.max(previous.endMs, timing.startMs + timing.durationMs);
          progressTimings.push(previous);
        } else {
          progressTimings.push({ displayIdx, startMs: timing.startMs, endMs: timing.startMs + timing.durationMs });
        }
      });
    }
    const sections = continuous
      ? [titleRef.current, contentRef.current].flatMap((container) => {
          const sectionSpans = spans.filter((span) => container?.contains(span));
          if (!sectionSpans.length) return [];
          const range = document.createRange();
          range.setStart(sectionSpans[0], 0);
          range.collapse(true);
          return [{ range, spans: sectionSpans, start: Number(sectionSpans[0].dataset.raIndex) }];
        })
      : [];
    const highlight = continuous ? new Highlight(...sections.map(({ range }) => range)) : null;
    if (highlight) CSS.highlights.set("read-along-completed", highlight);

    let frame = 0;
    let paintedBoundary = -1;
    const paint = () => {
      const el = getMediaElement();
      if (el) {
        const mediaMs = el.currentTime * 1000;
        const last = timings[timings.length - 1];
        const complete = el.ended || mediaMs >= last.startMs + last.durationMs;
        const ti = activeTimingIndex(timings, mediaMs);
        const step = ti >= 0 ? progressTimings[ti] : undefined;
        const displayIdx = continuous
          ? (complete ? -1 : step?.displayIdx ?? -1)
          : (ti >= 0 ? map[ti] : -1);
        if (continuous) {
          const boundary = complete ? spans.length : Math.max(0, displayIdx);
          if (boundary !== paintedBoundary) {
            for (const section of sections) {
              const local = boundary - section.start;
              if (local >= section.spans.length) {
                const end = section.spans[section.spans.length - 1];
                section.range.setEnd(end, end.childNodes.length);
              } else {
                section.range.setEnd(section.spans[Math.max(0, local)], 0);
              }
            }
            paintedBoundary = boundary;
          }
          applyActive(displayIdx, isPlaying);
          if (displayIdx >= 0 && step) {
            const span = spans[displayIdx];
            const durationMs = step.endMs - step.startMs;
            const fraction = durationMs > 0
              ? Math.min(1, Math.max(0, (mediaMs - step.startMs) / durationMs))
              : 1;
            span.classList.remove("ra-active");
            span.classList.add("ra-progress");
            span.style.setProperty("--ra-progress", `${fraction * 100}%`);
          }
        } else if (el.ended) {
          applyActive(-1);
        } else {
          applyActive(displayIdx);
        }
      }
    };
    const loop = () => {
      paint();
      frame = requestAnimationFrame(loop);
    };
    const el = getMediaElement();
    const events = ["seeking", "seeked", "timeupdate", "ended", "play"];
    if (continuous) {
      clearActive();
      paint();
      events.forEach((event) => el?.addEventListener(event, paint));
    }
    if (isPlaying) frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      if (continuous) {
        events.forEach((event) => el?.removeEventListener(event, paint));
        if (CSS.highlights.get("read-along-completed") === highlight) {
          CSS.highlights.delete("read-along-completed");
        }
        clearActive();
      }
    };
  }, [highlightingActive, isPlaying, timings, getMediaElement, applyActive, clearActive, highlightMode, titleRef, contentRef, contentVersion]);

  // 3) Clear the highlight when the clip ends (distinct from pause, which holds).
  useEffect(() => {
    if (!highlightingActive || (highlightMode === "continuous" && supportsContinuousHighlight())) return;
    const el = getMediaElement();
    if (!el) return;
    const onEnded = () => clearActive();
    el.addEventListener("ended", onEnded);
    return () => el.removeEventListener("ended", onEnded);
  }, [highlightingActive, isPlaying, getMediaElement, clearActive, highlightMode]);

  // 4) Track prefers-reduced-motion live so auto-scroll can pick instant vs smooth.
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reducedMotionRef.current = e.matches;
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  return { highlightingActive };
}
