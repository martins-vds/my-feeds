import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostListSkeleton } from "../PostListSkeleton";

describe("PostListSkeleton", () => {
    it("renders `count` placeholder cards inside a status region", () => {
        render(<PostListSkeleton count={4} />);
        const region = screen.getByTestId("posts-skeleton");
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-busy")).toBe("true");
        expect(region.getAttribute("aria-label")).toBe("Loading posts");
        expect(region.querySelectorAll(".MuiCard-root")).toHaveLength(4);
    });

    it("defaults to 6 cards", () => {
        render(<PostListSkeleton />);
        expect(
            screen.getByTestId("posts-skeleton").querySelectorAll(".MuiCard-root")
        ).toHaveLength(6);
    });
});
