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

    it("disables highlighting for an empty spoken sequence", () => {
        const result = alignSpokenToDisplay([], ["hello", "world"]);
        expect(result.enabled).toBe(false);
        expect(result.matchedRatio).toBe(0);
        expect(result.timingToDisplay.length).toBe(0);
    });

    it("does not match a display token beyond the bounded look-ahead window", () => {
        // LOOKAHEAD is 12: the scan covers display indices [0, 12]. A match at
        // index 13 is out of range, so the spoken token is treated as a miss —
        // proving alignment is bounded rather than a full scan.
        const fillers = Array.from({ length: 13 }, (_, i) => `f${i}`); // indices 0..12
        const beyond = alignSpokenToDisplay(["target"], [...fillers, "target"]); // target at 13
        expect(beyond.timingToDisplay[0]).toBe(-1);
        expect(beyond.enabled).toBe(false);

        // Control: the same token within the window (index 12) is found.
        const within = alignSpokenToDisplay(
            ["target"],
            [...fillers.slice(0, 12), "target"] // target at 12
        );
        expect(within.timingToDisplay[0]).toBe(12);
        expect(within.enabled).toBe(true);
    });

    it("maps a long spoken sub-word onto its compound display word (DALL•E)", () => {
        // The browser shows "DALL•E" as one word; the engine says "dall".
        const spoken = ["the", "dall", "model", "makes", "images"];
        const display = ["the", "dall•e", "model", "makes", "images"];
        const result = alignSpokenToDisplay(spoken, display);
        expect(result.enabled).toBe(true);
        expect(result.timingToDisplay[1]).toBe(1); // "dall" -> the "dall•e" word
    });

    it("aligns spoken URL parts back to the single on-screen URL word", () => {
        // A bare URL is one display token but is spoken part-by-part.
        const spoken = ["visit", "www", "example", "com", "books", "now"];
        const display = ["visit", "www.example.com/books", "now"];
        const result = alignSpokenToDisplay(spoken, display);
        expect(result.enabled).toBe(true);
        // Each URL part (>=3 chars) points at the one URL word (index 1).
        expect(Array.from(result.timingToDisplay)).toEqual([0, 1, 1, 1, 1, 2]);
    });

    it("recovers a post that would diverge on a long spelled-out URL", () => {
        // Nine URL parts spoken consecutively are an 8+ miss run (divergence)
        // without the compound fallback; with it they all map to the URL word.
        const urlParts = [
            "www", "simonandschuster", "com", "books",
            "deep", "utopia", "nick", "bostrom", "home",
        ];
        const spoken = ["read", ...urlParts, "soon"];
        const display = [
            "read",
            "www.simonandschuster.com/books/deep/utopia/nick/bostrom/home",
            "soon",
        ];
        const withFallback = alignSpokenToDisplay(spoken, display);
        expect(withFallback.enabled).toBe(true);
        expect(withFallback.timingToDisplay[0]).toBe(0); // "read"
        expect(withFallback.timingToDisplay[withFallback.timingToDisplay.length - 1]).toBe(2);
        for (let i = 1; i <= urlParts.length; i++) {
            expect(withFallback.timingToDisplay[i]).toBe(1); // each part -> URL word
        }
    });

    it("ignores compound sub-words for short spoken tokens (avoids false matches)", () => {
        // "at" (2 chars) must NOT match the "at" inside "at&t"; too short to be
        // a confident sub-word match, so it is a miss rather than a wrong jump.
        const spoken = ["ring", "at", "home"];
        const display = ["ring", "at&t", "home"]; // "at" exists only inside "at&t"
        const result = alignSpokenToDisplay(spoken, display);
        expect(result.timingToDisplay[1]).toBe(-1);
    });

    it("keeps hyphenated and apostrophe words intact (not treated as compounds)", () => {
        // "well-known"/"don't" are single tokens on both sides; they must match
        // 1:1 and never be split into sub-words.
        const result = alignSpokenToDisplay(
            ["well-known", "don't"],
            ["well-known", "don't"]
        );
        expect(result.enabled).toBe(true);
        expect(Array.from(result.timingToDisplay)).toEqual([0, 1]);
    });

    it("re-anchors after a greedy overshoot on a repeated word", () => {
        // "dup" matches its later copy (index 8), overshooting past x/y/z; the
        // miss run then triggers a confident re-anchor back to them.
        const spoken = ["a", "b", "dup", "m1", "m2", "m3", "m4", "m5", "x", "y", "z"];
        const display = [
            "a", "b", "real", "x", "y", "z",
            "w6", "w7", "dup", "w9", "w10", "w11", "w12",
        ];
        const result = alignSpokenToDisplay(spoken, display);
        expect(result.timingToDisplay[8]).toBe(3); // x re-anchored
        expect(result.timingToDisplay[9]).toBe(4); // y
        expect(result.timingToDisplay[10]).toBe(5); // z
    });

    it("still disables when no confident re-anchor exists", () => {
        // Entirely mismatched sequences: resync must not force-enable garbage.
        const spoken = Array.from({ length: 12 }, (_, i) => `s${i}`);
        const display = Array.from({ length: 12 }, (_, i) => `d${i}`);
        const result = alignSpokenToDisplay(spoken, display);
        expect(result.enabled).toBe(false);
    });
});
