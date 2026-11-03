import { describe, expect, it } from "vitest";
import { displayPercent, wholePercent } from "../readingProgress";

describe("wholePercent", () => {
  it.each([
    [0, 0],
    [0.004, 0],
    [0.42, 42],
    [0.949, 94],
    [1, 100],
  ])("floors %f to %i", (progress, expected) => {
    expect(wholePercent(progress)).toBe(expected);
  });

  it("is not thrown off by floating point noise", () => {
    expect(wholePercent(0.29)).toBe(29);
    expect(wholePercent(0.57)).toBe(57);
  });

  it("clamps to 0..100 and treats NaN as 0", () => {
    expect(wholePercent(-0.5)).toBe(0);
    expect(wholePercent(1.5)).toBe(100);
    expect(wholePercent(Number.NaN)).toBe(0);
  });
});

describe("displayPercent", () => {
  it("never shows 0% for an article that has been started", () => {
    expect(displayPercent(0.004)).toBe(1);
  });

  it("matches wholePercent from 1% upwards", () => {
    expect(displayPercent(0.42)).toBe(42);
    expect(displayPercent(0.949)).toBe(94);
  });
});
