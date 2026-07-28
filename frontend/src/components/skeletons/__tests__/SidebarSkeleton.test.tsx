import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SidebarSkeleton } from "../SidebarSkeleton";

describe("SidebarSkeleton", () => {
    it("renders `count` placeholder rows inside a status region", () => {
        render(<SidebarSkeleton count={3} />);
        const region = screen.getByTestId("sidebar-skeleton");
        expect(region.getAttribute("role")).toBe("status");
        expect(region.getAttribute("aria-busy")).toBe("true");
        expect(region.querySelectorAll(".MuiListItem-root")).toHaveLength(3);
    });

    it("defaults to 4 rows", () => {
        render(<SidebarSkeleton />);
        expect(
            screen.getByTestId("sidebar-skeleton").querySelectorAll(".MuiListItem-root")
        ).toHaveLength(4);
    });
});
