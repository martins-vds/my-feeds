/**
 * Per-device read-along preferences persisted in localStorage.
 * Unset toggles read as `true` (both default on), an unset reading mode as `"silent"` and an
 * unset or unknown pace as `DEFAULT_WPM`.
 */

import { useCallback, useState } from "react";
import { DEFAULT_WPM, WPM_OPTIONS } from "../constants/audio";
import type { HighlightMode } from "./useReadAlong";

export type ReadingMode = "sound" | "silent";

const HIGHLIGHT_KEY = "readAlong.highlight";
const AUTO_SCROLL_KEY = "readAlong.autoScroll";
const MODE_KEY = "readAlong.highlightMode";
const READING_MODE_KEY = "readAlong.readingMode";
const WPM_KEY = "readAlong.wpm";

function readMode(): HighlightMode {
    try {
        return localStorage.getItem(MODE_KEY) === "continuous" ? "continuous" : "word";
    } catch {
        return "word";
    }
}

function readReadingMode(): ReadingMode {
    try {
        return localStorage.getItem(READING_MODE_KEY) === "sound" ? "sound" : "silent";
    } catch {
        return "silent";
    }
}

function readWpm(): number {
    try {
        const stored = Number(localStorage.getItem(WPM_KEY));
        return WPM_OPTIONS.includes(stored) ? stored : DEFAULT_WPM;
    } catch {
        return DEFAULT_WPM;
    }
}

function readPref(key: string): boolean {
    try {
        const value = localStorage.getItem(key);
        return value === null ? true : value === "true";
    } catch {
        return true;
    }
}

function writePref(key: string, value: boolean | number | HighlightMode | ReadingMode): void {
    try {
        localStorage.setItem(key, String(value));
    } catch {
        // Ignore storage failures (private mode / disabled storage).
    }
}

export interface ReadAlongPreferences {
    highlight: boolean;
    setHighlight: (value: boolean) => void;
    autoScroll: boolean;
    setAutoScroll: (value: boolean) => void;
    highlightMode: HighlightMode;
    setHighlightMode: (value: HighlightMode) => void;
    readingMode: ReadingMode;
    setReadingMode: (value: ReadingMode) => void;
    /** Silent-reading pace; always one of `WPM_OPTIONS`. */
    wpm: number;
    /** Ignores a pace that is not in `WPM_OPTIONS`, so whatever is stored reads back. */
    setWpm: (value: number) => void;
}

export function useReadAlongPreferences(): ReadAlongPreferences {
    const [highlight, setHighlightState] = useState(() => readPref(HIGHLIGHT_KEY));
    const [autoScroll, setAutoScrollState] = useState(() =>
        readPref(AUTO_SCROLL_KEY)
    );
    const [highlightMode, setHighlightModeState] = useState(readMode);
    const [readingMode, setReadingModeState] = useState(readReadingMode);
    const [wpm, setWpmState] = useState(readWpm);

    const setHighlightMode = useCallback((value: HighlightMode) => {
        setHighlightModeState(value);
        writePref(MODE_KEY, value);
    }, []);

    const setHighlight = useCallback((value: boolean) => {
        setHighlightState(value);
        writePref(HIGHLIGHT_KEY, value);
    }, []);

    const setAutoScroll = useCallback((value: boolean) => {
        setAutoScrollState(value);
        writePref(AUTO_SCROLL_KEY, value);
    }, []);

    const setReadingMode = useCallback((value: ReadingMode) => {
        setReadingModeState(value);
        writePref(READING_MODE_KEY, value);
    }, []);

    const setWpm = useCallback((value: number) => {
        if (!WPM_OPTIONS.includes(value)) return;
        setWpmState(value);
        writePref(WPM_KEY, value);
    }, []);

    return {
        highlight,
        setHighlight,
        autoScroll,
        setAutoScroll,
        highlightMode,
        setHighlightMode,
        readingMode,
        setReadingMode,
        wpm,
        setWpm,
    };
}
