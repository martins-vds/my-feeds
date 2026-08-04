import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { api, ApiError } from "./services/api";

vi.mock("./services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

vi.mock("./pages/posts", () => ({
  ReaderPage: () => <div>Reader route</div>,
  PostDetailPage: () => <div>Post detail route</div>,
}));

describe("App root route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("shows the landing page to signed-out visitors", async () => {
    vi.mocked(api.get).mockRejectedValue(
      new ApiError(401, "UNAUTHORIZED", "Not authenticated")
    );

    render(<App />);

    expect(
      await screen.findByRole("heading", {
        name: /a calmer way to follow the web/i,
      })
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/");
  });

  it("redirects authenticated visitors from the root to the reader", async () => {
    vi.mocked(api.get).mockResolvedValue({
      id: "user-1",
      email: "reader@example.com",
      name: "Reader",
      avatarUrl: null,
      provider: "github",
      timezone: "UTC",
      notificationsEnabled: false,
    });

    render(<App />);

    await waitFor(() => {
      expect(window.location.pathname).toBe("/posts");
    });
    expect(await screen.findByText("Reader route")).toBeInTheDocument();
  });
});
