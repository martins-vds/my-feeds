/**
 * Unit tests for useReadAlongPreferences (US3).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReadAlongPreferences } from "../useReadAlongPreferences";

describe("useReadAlongPreferences", () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("defaults both toggles to true when storage is empty", () => {
        const { result } = renderHook(() => useReadAlongPreferences());
        expect(result.current.highlight).toBe(true);
        expect(result.current.autoScroll).toBe(true);
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
});
