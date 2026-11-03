import { describe, it, expect } from "vitest";
import { DEFAULT_WPM, PLAYBACK_SPEEDS, WPM_OPTIONS } from "../audio";

describe("PLAYBACK_SPEEDS", () => {
    it("lists the supported playback rates including 1x", () => {
        expect([...PLAYBACK_SPEEDS]).toEqual([0.5, 1, 1.2, 1.5, 2, 2.5, 3]);
        expect(PLAYBACK_SPEEDS).toContain(1);
    });
});

describe("WPM_OPTIONS", () => {
    it("lists the silent-reading paces in words per minute", () => {
        expect([...WPM_OPTIONS]).toEqual([150, 200, 250, 300, 400]);
    });

    it("offers the default pace", () => {
        expect(DEFAULT_WPM).toBe(250);
        expect(WPM_OPTIONS).toContain(DEFAULT_WPM);
    });
});
