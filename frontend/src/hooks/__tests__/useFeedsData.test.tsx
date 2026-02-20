/**
 * Unit tests for useFeedsData hook
 * Tests that the hook correctly handles API responses (raw arrays)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Mock the API module
vi.mock("../../services/api", () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
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

import api from "../../services/api";
import { useFeedsData } from "../useFeedsData";

describe("useFeedsData hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should load successfully when API returns empty categories array", async () => {
    // Backend returns a raw array [], not { categories: [] }
    vi.mocked(api.get).mockResolvedValueOnce([]);

    const { result } = renderHook(() => useFeedsData());

    // Initially loading
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Should NOT have an error
    expect(result.current.error).toBeNull();
    expect(result.current.categories).toEqual([]);
    expect(result.current.feeds).toEqual([]);
  });

  it("should load categories and feeds when API returns populated arrays", async () => {
    const mockCategories = [{ id: "cat-1", name: "Tech", feedCount: 1, position: 0 }];
    const mockFeeds = [
      {
        id: "feed-1",
        title: "TechCrunch",
        url: "https://techcrunch.com/feed",
        categoryId: "cat-1",
      },
    ];

    // First call: GET /categories returns raw array
    vi.mocked(api.get).mockResolvedValueOnce(mockCategories);
    // Second call: GET /categories/cat-1/feeds returns raw array
    vi.mocked(api.get).mockResolvedValueOnce(mockFeeds);

    const { result } = renderHook(() => useFeedsData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.categories).toEqual(mockCategories);
    expect(result.current.feeds).toEqual(mockFeeds);
  });
});
