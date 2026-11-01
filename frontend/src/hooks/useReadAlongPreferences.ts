/**
 * Per-device read-along preferences persisted in localStorage.
 * Unset keys read as `true` (both default on).
 */

import { useCallback, useState } from "react";
import type { HighlightMode } from "./useReadAlong";

const HIGHLIGHT_KEY = "readAlong.highlight";
const AUTO_SCROLL_KEY = "readAlong.autoScroll";
const MODE_KEY = "readAlong.highlightMode";

function readMode(): HighlightMode {
    try {
        return localStorage.getItem(MODE_KEY) === "continuous" ? "continuous" : "word";
    } catch {
        return "word";
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

function writePref(key: string, value: boolean | HighlightMode): void {
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
}

export function useReadAlongPreferences(): ReadAlongPreferences {
    const [highlight, setHighlightState] = useState(() => readPref(HIGHLIGHT_KEY));
    const [autoScroll, setAutoScrollState] = useState(() =>
        readPref(AUTO_SCROLL_KEY)
    );
    const [highlightMode, setHighlightModeState] = useState(readMode);

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

    return { highlight, setHighlight, autoScroll, setAutoScroll, highlightMode, setHighlightMode };
}
