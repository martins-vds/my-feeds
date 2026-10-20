/**
 * useReadAlong — word-level read-along highlighting driven by media time.
 *
 * Given the served word timings and the title/body containers, it:
 *  1. Decides eligibility up-front (aligns spoken tokens to displayed words with
 *     a >=90% gate) so highlighting is either on for the whole post or silently
 *     disabled — never a flash of the wrong word (FR-018/019).
 *  2. Wraps each displayed word once in an indexed `.ra-word` span.
 *  3. On a requestAnimationFrame cadence while playing, reads the media element's
 *     currentTime and toggles `.ra-active` on the single spoken word (O(1) DOM
 *     mutation per change), holding across gaps and clearing at the end.
 *
 * Auto-scroll (US2) is layered on in a later task; this hook owns the active
 * word tracking and exposes a hook point for it.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { WordTiming } from "../types";
import { alignSpokenToDisplay, normalizeToken } from "../utils/alignTimings";
import { collectWords, unwrapWords, wrapWords } from "../utils/wrapWords";

export interface UseReadAlongArgs {
    timings: WordTiming[] | null;
    getMediaElement: () => HTMLAudioElement | null;
    isPlaying: boolean;
    titleRef: RefObject<HTMLElement | null>;
    contentRef: RefObject<HTMLElement | null>;
    highlightEnabled: boolean;
    autoScrollEnabled: boolean;
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
        const viewportH =
            window.innerHeight || document.documentElement.clientHeight || 0;
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
        if (prev >= 0 && spans[prev]) spans[prev].classList.remove("ra-active");
        activeRef.current = -1;
    }, []);

    const applyActive = useCallback(
        (displayIdx: number) => {
            if (displayIdx === activeRef.current) return;
            const spans = spansRef.current;
            const prev = activeRef.current;
            if (prev >= 0 && spans[prev]) spans[prev].classList.remove("ra-active");
            if (displayIdx >= 0 && spans[displayIdx]) {
                spans[displayIdx].classList.add("ra-active");
                // At most one reposition per active-word change (coalesced per frame).
                maybeAutoScroll(spans[displayIdx]);
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
    }, [timings, highlightEnabled, titleRef, contentRef, clearActive]);

    // 2) rAF active-word tracking while playing.
    useEffect(() => {
        if (!highlightingActive || !isPlaying || !timings) return;

        let frame = 0;
        const loop = () => {
            const el = getMediaElement();
            const map = mapRef.current;
            if (el && map) {
                if (el.ended) {
                    applyActive(-1);
                } else {
                    const mediaMs = el.currentTime * 1000;
                    const ti = activeTimingIndex(timings, mediaMs);
                    applyActive(ti >= 0 ? map[ti] : -1);
                }
            }
            frame = requestAnimationFrame(loop);
        };
        frame = requestAnimationFrame(loop);

        return () => cancelAnimationFrame(frame);
    }, [highlightingActive, isPlaying, timings, getMediaElement, applyActive]);

    // 3) Clear the highlight when the clip ends (distinct from pause, which holds).
    useEffect(() => {
        if (!highlightingActive) return;
        const el = getMediaElement();
        if (!el) return;
        const onEnded = () => clearActive();
        el.addEventListener("ended", onEnded);
        return () => el.removeEventListener("ended", onEnded);
    }, [highlightingActive, isPlaying, getMediaElement, clearActive]);

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
