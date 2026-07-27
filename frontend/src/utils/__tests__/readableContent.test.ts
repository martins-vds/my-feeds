import { describe, it, expect } from "vitest";
import { hasReadableContent } from "../readableContent";

describe("hasReadableContent", () => {
    it("treats empty content as not readable", () => {
        expect(hasReadableContent(null)).toBe(false);
        expect(hasReadableContent("")).toBe(false);
        expect(hasReadableContent("   ")).toBe(false);
    });

    it("treats a lone comments link as not readable", () => {
        expect(hasReadableContent('<a href="https://hn/1">Comments</a>')).toBe(false);
        expect(hasReadableContent('<p><a href="https://hn/1">Comments</a></p>')).toBe(false);
    });

    it("treats two links with a separator as not readable", () => {
        expect(
            hasReadableContent('<a href="/a">Article</a> | <a href="/c">Comments</a>')
        ).toBe(false);
    });

    it("treats prose as readable", () => {
        expect(hasReadableContent("<p>This is a real article body.</p>")).toBe(true);
    });

    it("treats text with a link as readable", () => {
        expect(hasReadableContent('<p>Read <a href="/x">this</a> today.</p>')).toBe(true);
    });

    it("treats media as readable", () => {
        expect(hasReadableContent('<p><img src="/x.jpg" alt="x"></p>')).toBe(true);
    });

    it("treats a curated link list as readable", () => {
        expect(
            hasReadableContent(
                "<ul><li><a href='/1'>One</a></li><li><a href='/2'>Two</a></li><li><a href='/3'>Three</a></li></ul>"
            )
        ).toBe(true);
    });
});
