import { describe, it, expect } from "vitest";
import { PLAYBACK_SPEEDS } from "../audio";

describe("PLAYBACK_SPEEDS", () => {
    it("lists the supported playback rates including 1x", () => {
        expect([...PLAYBACK_SPEEDS]).toEqual([0.5, 1, 1.2, 1.5, 2, 2.5, 3]);
        expect(PLAYBACK_SPEEDS).toContain(1);
    });
});
