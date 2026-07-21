/**
 * Unit tests for useFeedsData hook
 * Tests that the hook correctly handles API responses (raw arrays)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

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
    // Backend returns raw arrays [] (both /categories and /feeds)
    vi.mocked(api.get).mockResolvedValue([]);

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
        categoryIds: ["cat-1"],
      },
    ];

    // First call: GET /categories returns raw array
    vi.mocked(api.get).mockResolvedValueOnce(mockCategories);
    // Second call: GET /feeds returns raw array (each feed carries categoryIds)
    vi.mocked(api.get).mockResolvedValueOnce(mockFeeds);

    const { result } = renderHook(() => useFeedsData());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.categories).toEqual(mockCategories);
    expect(result.current.feeds).toEqual(mockFeeds);
  });

  it("addFeed posts categoryIds and refreshes", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    vi.mocked(api.post).mockResolvedValue({ id: "feed-9", categoryIds: ["cat-1"] });

    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addFeed("cat-1", "https://new.example/feed");
    });

    expect(api.post).toHaveBeenCalledWith("/feeds", {
      url: "https://new.example/feed",
      categoryIds: ["cat-1"],
    });
  });

  it("addFeed with a null category posts an empty categoryIds array", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    vi.mocked(api.post).mockResolvedValue({ id: "feed-9", categoryIds: [] });

    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addFeed(null, "https://uncat.example/feed");
    });

    expect(api.post).toHaveBeenCalledWith("/feeds", {
      url: "https://uncat.example/feed",
      categoryIds: [],
    });
  });

  it("setFeedCategories patches the feed with the new category ids", async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    vi.mocked(api.patch).mockResolvedValue({ id: "feed-1", categoryIds: ["cat-2"] });

    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setFeedCategories("feed-1", ["cat-2"]);
    });

    expect(api.patch).toHaveBeenCalledWith("/feeds/feed-1", {
      categoryIds: ["cat-2"],
    });
  });

  it("setFeedActive patches the feed's isActive flag and updates local state", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "feed-1",
          title: "TechCrunch",
          url: "https://techcrunch.com/feed",
          categoryIds: [],
          isActive: true,
        },
      ]);
    vi.mocked(api.patch).mockResolvedValue({
      id: "feed-1",
      categoryIds: [],
      isActive: false,
    });

    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.setFeedActive("feed-1", false);
    });

    expect(api.patch).toHaveBeenCalledWith("/feeds/feed-1", {
      isActive: false,
    });
    expect(result.current.feeds[0].isActive).toBe(false);
  });

  it("deleteCategory keeps feeds and only removes the category label", async () => {
    vi.mocked(api.get)
      .mockResolvedValueOnce([{ id: "cat-1", name: "Tech", feedCount: 1, position: 0 }])
      .mockResolvedValueOnce([
        {
          id: "feed-1",
          title: "TechCrunch",
          url: "https://techcrunch.com/feed",
          categoryIds: ["cat-1"],
        },
      ]);
    vi.mocked(api.delete).mockResolvedValue(undefined);

    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteCategory("cat-1");
    });

    expect(api.delete).toHaveBeenCalledWith("/categories/cat-1");
    expect(result.current.categories).toEqual([]);
    expect(result.current.feeds).toHaveLength(1);
    expect(result.current.feeds[0].categoryIds).toEqual([]);
  });
});
