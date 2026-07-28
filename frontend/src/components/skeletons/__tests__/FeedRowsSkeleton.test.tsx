import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FeedRowsSkeleton } from "../FeedRowsSkeleton";

describe("FeedRowsSkeleton", () => {
    it("renders `count` feed-row placeholders inside a status region", () => {
        render(<FeedRowsSkeleton count={5} />);
        const region = screen.getByTestId("feed-rows-skeleton");
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-busy")).toBe("true");
        expect(region.getAttribute("aria-label")).toBe("Loading feeds");
        expect(region.querySelectorAll(".MuiListItem-root")).toHaveLength(5);
    });

    it("defaults to 3 rows", () => {
        render(<FeedRowsSkeleton />);
        expect(
            screen.getByTestId("feed-rows-skeleton").querySelectorAll(".MuiListItem-root")
        ).toHaveLength(3);
    });
});
