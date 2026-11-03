/**
 * Unit tests for useReadAlongPreferences (US3).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { WPM_OPTIONS } from "../../constants/audio";
import { useReadAlongPreferences } from "../useReadAlongPreferences";

describe("useReadAlongPreferences", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("defaults both toggles to true when storage is empty", () => {
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.highlight).toBe(true);
        expect(result.current.autoScroll).toBe(true);
        expect(result.current.highlightMode).toBe("word");
    });

    it("remembers continuous mode without changing the independent reading toggles", () => {
        const first = renderHook(() => useReadAlongPreferences());
        act(() => first.result.current.setHighlightMode("continuous"));
        expect(first.result.current.highlight).toBe(true);
        expect(first.result.current.autoScroll).toBe(true);
        first.unmount();
        const second = renderHook(() => useReadAlongPreferences());
        expect(second.result.current.highlightMode).toBe("continuous");
    });

    it("uses word mode when a stored mode is invalid", () => {
        localStorage.setItem("readAlong.highlightMode", "invalid");
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.highlightMode).toBe("word");
    });

    it("persists the highlight toggle independently", () => {
        const { result } = renderHook(() => useReadAlongPreferences());
        act(() => result.current.setHighlight(false));

        expect(result.current.highlight).toBe(false);
        expect(result.current.autoScroll).toBe(true);
        expect(localStorage.getItem("readAlong.highlight")).toBe("false");
        // Auto-scroll key remains unset → still reads as default true.
        expect(localStorage.getItem("readAlong.autoScroll")).toBeNull();
    });

    it("persists the auto-scroll toggle independently", () => {
        const { result } = renderHook(() => useReadAlongPreferences());
        act(() => result.current.setAutoScroll(false));

        expect(result.current.autoScroll).toBe(false);
        expect(result.current.highlight).toBe(true);
        expect(localStorage.getItem("readAlong.autoScroll")).toBe("false");
    });

    it("survives a re-mount (new session)", () => {
        const first = renderHook(() => useReadAlongPreferences());
        act(() => {
            first.result.current.setHighlight(false);
            first.result.current.setAutoScroll(false);
        });
        first.unmount();

        const second = renderHook(() => useReadAlongPreferences());
        expect(second.result.current.highlight).toBe(false);
        expect(second.result.current.autoScroll).toBe(false);
    });

    it("reads existing stored values on mount", () => {
        localStorage.setItem("readAlong.highlight", "false");
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.highlight).toBe(false);
        expect(result.current.autoScroll).toBe(true);
    });

    it("falls back to defaults when localStorage reads throw (private mode)", () => {
        const getItem = vi
            .spyOn(Storage.prototype, "getItem")
            .mockImplementation(() => {
                throw new Error("storage disabled");
            });
        try {
            const { result } = renderHook(() => useReadAlongPreferences());
            expect(result.current.highlight).toBe(true);
            expect(result.current.autoScroll).toBe(true);
        } finally {
            getItem.mockRestore();
        }
    });

    it("swallows write failures and still updates in-memory state", () => {
        const setItem = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("storage disabled");
            });
        try {
            const { result } = renderHook(() => useReadAlongPreferences());
            expect(() => act(() => result.current.setHighlight(false))).not.toThrow();
            expect(result.current.highlight).toBe(false);
        } finally {
            setItem.mockRestore();
        }
    });

    it("defaults to silent reading at 250 words per minute", () => {
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.readingMode).toBe("silent");
        expect(result.current.wpm).toBe(250);
    });

    it("remembers the reading mode without touching the other preferences", () => {
        const first = renderHook(() => useReadAlongPreferences());
        act(() => first.result.current.setReadingMode("sound"));

        expect(first.result.current.readingMode).toBe("sound");
        expect(first.result.current.highlight).toBe(true);
        expect(first.result.current.wpm).toBe(250);
        expect(localStorage.getItem("readAlong.readingMode")).toBe("sound");
        expect(localStorage.getItem("readAlong.highlight")).toBeNull();
        expect(localStorage.getItem("readAlong.autoScroll")).toBeNull();
        expect(localStorage.getItem("readAlong.highlightMode")).toBeNull();
        expect(localStorage.getItem("readAlong.wpm")).toBeNull();
        first.unmount();

        const second = renderHook(() => useReadAlongPreferences());
        expect(second.result.current.readingMode).toBe("sound");
    });

    it("switches back to silent reading", () => {
        localStorage.setItem("readAlong.readingMode", "sound");
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.readingMode).toBe("sound");

        act(() => result.current.setReadingMode("silent"));

        expect(result.current.readingMode).toBe("silent");
        expect(localStorage.getItem("readAlong.readingMode")).toBe("silent");
    });

    it("uses silent reading when the stored mode is invalid", () => {
        localStorage.setItem("readAlong.readingMode", "invalid");
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.readingMode).toBe("silent");
    });

    it("remembers the pace without touching the reading mode", () => {
        const first = renderHook(() => useReadAlongPreferences());
        act(() => first.result.current.setWpm(300));

        expect(first.result.current.wpm).toBe(300);
        expect(first.result.current.readingMode).toBe("silent");
        expect(localStorage.getItem("readAlong.wpm")).toBe("300");
        expect(localStorage.getItem("readAlong.readingMode")).toBeNull();
        first.unmount();

        const second = renderHook(() => useReadAlongPreferences());
        expect(second.result.current.wpm).toBe(300);
    });

    it("reads back every pace the speed menu offers", () => {
        for (const wpm of WPM_OPTIONS) {
            localStorage.setItem("readAlong.wpm", String(wpm));
            const { result, unmount } = renderHook(() => useReadAlongPreferences());
            expect(result.current.wpm).toBe(wpm);
            unmount();
        }
    });

    it.each(["fast", "", "0", "-250", "275", "300.5", "Infinity", "NaN"])(
        "uses the default pace when the stored value is %j",
        (stored) => {
            localStorage.setItem("readAlong.wpm", stored);
            const { result } = renderHook(() => useReadAlongPreferences());
            expect(result.current.wpm).toBe(250);
        }
    );

    it("ignores a pace the speed menu does not offer", () => {
        const { result } = renderHook(() => useReadAlongPreferences());
        act(() => result.current.setWpm(275));

        expect(result.current.wpm).toBe(250);
        expect(localStorage.getItem("readAlong.wpm")).toBeNull();
    });

    it("falls back to silent reading at the default pace when storage reads throw", () => {
        const getItem = vi
            .spyOn(Storage.prototype, "getItem")
            .mockImplementation(() => {
                throw new Error("storage disabled");
            });
        try {
            const { result } = renderHook(() => useReadAlongPreferences());
            expect(result.current.readingMode).toBe("silent");
            expect(result.current.wpm).toBe(250);
        } finally {
            getItem.mockRestore();
        }
    });

    it("swallows write failures for the reading mode and the pace", () => {
        const setItem = vi
            .spyOn(Storage.prototype, "setItem")
            .mockImplementation(() => {
                throw new Error("storage disabled");
            });
        try {
            const { result } = renderHook(() => useReadAlongPreferences());
            expect(() => act(() => result.current.setReadingMode("sound"))).not.toThrow();
            expect(() => act(() => result.current.setWpm(400))).not.toThrow();
            expect(result.current.readingMode).toBe("sound");
            expect(result.current.wpm).toBe(400);
        } finally {
            setItem.mockRestore();
        }
    });
});
