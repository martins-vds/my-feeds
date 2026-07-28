import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostDetailSkeleton } from "../PostDetailSkeleton";

describe("PostDetailSkeleton", () => {
    it("renders an accessible article placeholder", () => {
        render(<PostDetailSkeleton />);
        const region = screen.getByTestId("post-detail-skeleton");
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-busy")).toBe("true");
        expect(region.getAttribute("aria-label")).toBe("Loading article");
        // Title + metadata + body lines → several skeletons.
        expect(
            region.querySelectorAll(".MuiSkeleton-root").length
        ).toBeGreaterThanOrEqual(8);
    });
});
