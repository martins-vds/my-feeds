/**
 * Unit tests for read-along alignment utilities.
 */

import { describe, it, expect } from "vitest";
import { normalizeToken, alignSpokenToDisplay } from "../alignTimings";

describe("normalizeToken", () => {
    it("lowercases", () => {
        expect(normalizeToken("WORLD")).toBe("world");
    });

    it("strips leading/trailing punctuation", () => {
        expect(normalizeToken("Hello,")).toBe("hello");
        expect(normalizeToken("(word)")).toBe("word");
        expect(normalizeToken("“quote”")).toBe("quote");
    });

    it("keeps internal apostrophes", () => {
        expect(normalizeToken("don't")).toBe("don't");
    });

    it("keeps digits", () => {
        expect(normalizeToken("2024")).toBe("2024");
    });

    it("keeps internal hyphens", () => {
        expect(normalizeToken("well-known")).toBe("well-known");
    });

    it("returns empty string for pure punctuation", () => {
        expect(normalizeToken("…")).toBe("");
        expect(normalizeToken("—")).toBe("");
    });
});

describe("alignSpokenToDisplay", () => {
    it("maps a perfect 1:1 match and enables highlighting", () => {
        const result = alignSpokenToDisplay(["hello", "world"], ["hello", "world"]);
        expect(result.enabled).toBe(true);
        expect(result.matchedRatio).toBe(1);
        expect(Array.from(result.timingToDisplay)).toEqual([0, 1]);
    });

    it("skips extra non-spoken display tokens but still maps spoken tokens", () => {
        // Display has a punctuation-only token (normalized to "") between words.
        const result = alignSpokenToDisplay(
            ["hello", "world"],
            ["hello", "", "world"]
        );
        expect(result.enabled).toBe(true);
        expect(Array.from(result.timingToDisplay)).toEqual([0, 2]);
    });

    it("treats title-then-body as one continuous sequence (no seam marker)", () => {
        // Title words then body words; the synthesized ". " seam is not a display word.
        const spoken = ["hello", "world", "foo", "bar"];
        const display = ["hello", "world", "foo", "bar"];
        const result = alignSpokenToDisplay(spoken, display);
        expect(result.enabled).toBe(true);
        expect(Array.from(result.timingToDisplay)).toEqual([0, 1, 2, 3]);
    });

    it("returns -1 for spoken tokens with no display match", () => {
        const result = alignSpokenToDisplay(["hello", "zzz", "world"], ["hello", "world"]);
        // "zzz" has no match; "hello" and "world" still map in order.
        expect(result.timingToDisplay[0]).toBe(0);
        expect(result.timingToDisplay[1]).toBe(-1);
        expect(result.timingToDisplay[2]).toBe(1);
    });

    it("produces an Int32Array the length of the spoken tokens", () => {
        const result = alignSpokenToDisplay(["a", "b", "c"], ["a", "b", "c"]);
        expect(result.timingToDisplay).toBeInstanceOf(Int32Array);
        expect(result.timingToDisplay.length).toBe(3);
    });

    it("disables highlighting below the 90% alignment threshold", () => {
        const spoken = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]; // 10
        const display = ["a", "b", "c", "d", "e"]; // only 5 align
        const result = alignSpokenToDisplay(spoken, display);
        expect(result.matchedRatio).toBeLessThan(0.9);
        expect(result.enabled).toBe(false);
    });

    it("enables highlighting at exactly the 90% threshold", () => {
        // 9 of 10 spoken tokens align (0.9), single trailing miss (no long run).
        const spoken = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "zzz"];
        const display = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
        const result = alignSpokenToDisplay(spoken, display);
        expect(result.matchedRatio).toBeCloseTo(0.9, 5);
        expect(result.enabled).toBe(true);
    });

    it("disables on a long consecutive-mismatch run even when the ratio is high", () => {
        // 200 tokens; a contiguous block of 10 diverges (overall ratio 0.95).
        const spoken = Array.from({ length: 200 }, (_, i) => `t${i}`);
        const display = spoken.map((t, i) => (i >= 100 && i < 110 ? `x${i}` : t));
        const result = alignSpokenToDisplay(spoken, display);
        expect(result.matchedRatio).toBeGreaterThan(0.9);
        expect(result.enabled).toBe(false);
    });
});
