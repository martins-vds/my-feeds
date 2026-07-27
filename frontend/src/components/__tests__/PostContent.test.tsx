/**
 * Tests for PostContent — verifies untrusted feed HTML is sanitized (DOMPurify)
 * before being rendered via dangerouslySetInnerHTML.
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostContent } from "../PostContent";

describe("PostContent sanitization", () => {
    it("renders safe formatting HTML", () => {
        render(
            <PostContent
                content="<p>Hello <strong>world</strong></p>"
                summary={null}
            />
        );
        expect(screen.getByText("world").tagName).toBe("STRONG");
    });

    it("shows a placeholder for comments-only content", () => {
        render(
            <PostContent
                content='<a href="https://news.ycombinator.com/item?id=1">Comments</a>'
                summary={null}
            />
        );
        expect(
            screen.getByText("This article is only available on the original site.")
        ).toBeInTheDocument();
    });

    it("strips <script> tags", () => {
        const { container } = render(
            <PostContent
                content={"<p>safe</p><script>window.__xss = true;</script>"}
                summary={null}
            />
        );
        expect(container.querySelector("script")).toBeNull();
        expect(container.innerHTML).not.toContain("window.__xss");
    });

    it("strips inline event handlers", () => {
        const { container } = render(
            <PostContent
                content={'<img src="x" onerror="window.__xss = true">'}
                summary={null}
            />
        );
        const img = container.querySelector("img");
        expect(img?.getAttribute("onerror")).toBeNull();
    });

    it("removes javascript: URLs from links", () => {
        const { container } = render(
            <PostContent
                content={'<p>Please <a href="javascript:window.__xss=1">click</a></p>'}
                summary={null}
            />
        );
        const link = container.querySelector("a");
        expect(link?.getAttribute("href") ?? "").not.toContain("javascript:");
    });

    it("opens links in a new tab with noopener noreferrer", () => {
        const { container } = render(
            <PostContent
                content={'<p>Visit <a href="https://example.com">x</a></p>'}
                summary={null}
            />
        );
        const link = container.querySelector("a");
        expect(link?.getAttribute("target")).toBe("_blank");
        expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
    });
});
