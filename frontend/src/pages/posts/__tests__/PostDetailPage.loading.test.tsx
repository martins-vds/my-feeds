import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { PostDetailPage } from "../PostDetailPage";
import api from "../../../services/api";

// Keep the fetch pending so the component stays in its initial loading state.
vi.mock("../../../services/api", () => ({
    default: { get: vi.fn(() => new Promise(() => {})), put: vi.fn() },
    ApiError: class ApiError extends Error {},
}));

describe("PostDetailPage loading", () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it("shows the article skeleton while the post loads", () => {
        render(
            <MemoryRouter initialEntries={["/posts/p1"]}>
                <Routes>
                    <Route path="/posts/:id" element={<PostDetailPage />} />
                </Routes>
            </MemoryRouter>
        );
        expect(api.get).toHaveBeenCalled();
        expect(screen.queryByTestId("post-detail-skeleton")).not.toBeNull();
    });
});
