/**
 * Unit tests for wrapWords — DOM text-node word wrapping for highlighting.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { wrapWords, collectWords, unwrapWords } from "../wrapWords";

function container(html: string): HTMLElement {
    const el = document.createElement("div");
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

describe("wrapWords", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("wraps N words into N indexed .ra-word spans", () => {
        const el = container("one two three");
        const { count, elements } = wrapWords(el, 0);

        expect(count).toBe(3);
        expect(elements).toHaveLength(3);
        const spans = el.querySelectorAll(".ra-word");
        expect(spans).toHaveLength(3);
        elements.forEach((span, i) => {
            expect(span.dataset.raIndex).toBe(String(i));
            expect(span.classList.contains("ra-word")).toBe(true);
        });
        expect(el.textContent).toBe("one two three");
    });

    it("continues indices from startIndex", () => {
        const el = container("alpha beta");
        const { elements } = wrapWords(el, 5);
        expect(elements[0].dataset.raIndex).toBe("5");
        expect(elements[1].dataset.raIndex).toBe("6");
    });

    it("counts words split across tag boundaries as separate spans", () => {
        const el = container("for<code>x</code>loop");
        const { count } = wrapWords(el, 0);
        // Three separate text nodes: "for", "x", "loop".
        expect(count).toBe(3);
        expect(el.querySelectorAll(".ra-word")).toHaveLength(3);
    });

    it("is idempotent — a second call adds no duplicate spans", () => {
        const el = container("one two three");
        wrapWords(el, 0);
        const second = wrapWords(el, 0);
        expect(second.count).toBe(0);
        expect(el.querySelectorAll(".ra-word")).toHaveLength(3);
    });

    it("wraps anchor text without losing href/target/rel", () => {
        const el = container(
            '<a href="https://example.com" target="_blank" rel="noopener noreferrer">link text</a>'
        );
        wrapWords(el, 0);
        const anchor = el.querySelector("a")!;
        expect(anchor.getAttribute("href")).toBe("https://example.com");
        expect(anchor.getAttribute("target")).toBe("_blank");
        expect(anchor.getAttribute("rel")).toBe("noopener noreferrer");
        // The anchor's words are wrapped inside it.
        expect(anchor.querySelectorAll(".ra-word")).toHaveLength(2);
    });
});

describe("collectWords", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("returns whitespace-delimited tokens in document order", () => {
        const el = container("one two three");
        expect(collectWords(el)).toEqual(["one", "two", "three"]);
    });

    it("splits tokens across tag boundaries the same way wrapWords does", () => {
        const el = container("for<code>x</code>loop");
        expect(collectWords(el)).toEqual(["for", "x", "loop"]);
    });

    it("skips words already inside .ra-word spans", () => {
        const el = container("one two");
        wrapWords(el, 0);
        // Already wrapped → no fresh tokens to collect.
        expect(collectWords(el)).toEqual([]);
    });
});

describe("unwrapWords", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("restores the original text so words can be collected again", () => {
        const el = container("one two three");
        wrapWords(el, 0);
        expect(el.querySelectorAll(".ra-word")).toHaveLength(3);

        unwrapWords(el);
        expect(el.querySelectorAll(".ra-word")).toHaveLength(0);
        expect(el.textContent).toBe("one two three");
        // No longer inside spans, so the words are collectable again.
        expect(collectWords(el)).toEqual(["one", "two", "three"]);
    });

    it("supports a wrap → unwrap → wrap cycle (re-entrant)", () => {
        const el = container("alpha beta");
        wrapWords(el, 0);
        unwrapWords(el);
        const again = wrapWords(el, 0);
        expect(again.count).toBe(2);
        expect(el.querySelectorAll(".ra-word")).toHaveLength(2);
    });

    it("is a no-op on a container with no .ra-word spans", () => {
        const el = container("plain text");
        unwrapWords(el);
        expect(el.textContent).toBe("plain text");
        expect(el.querySelectorAll(".ra-word")).toHaveLength(0);
    });
});
