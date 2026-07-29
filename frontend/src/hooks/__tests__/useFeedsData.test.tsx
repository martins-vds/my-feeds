/**
 * Unit tests for the lazy useFeedsData hook.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../services/api", () => ({
  default: {
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
import { useFeedsData, UNCATEGORIZED_KEY } from "../useFeedsData";

const mockCategories = [{ id: "cat-1", name: "Tech", feedCount: 1, position: 0 }];
const mockUncategorized = [
  { id: "feed-u", title: "Bare Feed", url: "https://bare/feed", categoryIds: [] },
];
const mockCat1Feeds = [
  { id: "feed-1", title: "TechCrunch", url: "https://tc/feed", categoryIds: ["cat-1"] },
];

function mockRoutes() {
  vi.mocked(api.get).mockImplementation(async (url: string) => {
    if (url === "/categories") return mockCategories as never;
    if (url === "/feeds?uncategorized=true") return mockUncategorized as never;
    if (url === "/categories/cat-1/feeds") return mockCat1Feeds as never;
    return [] as never;
  });
}

describe("useFeedsData (lazy)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("fetches categories + uncategorized on mount, but not category feeds", async () => {
    mockRoutes();
    const { result } = renderHook(() => useFeedsData());

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.categories).toEqual(mockCategories);
    expect(result.current.feedsByCategory[UNCATEGORIZED_KEY]).toEqual(mockUncategorized);
    // Category feeds are NOT eagerly loaded.
    expect("cat-1" in result.current.feedsByCategory).toBe(false);
    expect(vi.mocked(api.get)).not.toHaveBeenCalledWith("/categories/cat-1/feeds");
  });

  it("loads a category's feeds on first expand and caches them", async () => {
    mockRoutes();
    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadFeedsForCategory("cat-1");
    });

    expect(result.current.feedsByCategory["cat-1"]).toEqual(mockCat1Feeds);
    const callsAfterFirst = vi.mocked(api.get).mock.calls.filter(
      (c) => c[0] === "/categories/cat-1/feeds"
    ).length;
    expect(callsAfterFirst).toBe(1);

    // Second call is a no-op (already cached).
    await act(async () => {
      await result.current.loadFeedsForCategory("cat-1");
    });
    const callsAfterSecond = vi.mocked(api.get).mock.calls.filter(
      (c) => c[0] === "/categories/cat-1/feeds"
    ).length;
    expect(callsAfterSecond).toBe(1);
  });

  it("sets an error message when the initial load fails", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("network"));
    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).not.toBeNull();
  });

  it("caches an empty category and does not refetch", async () => {
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/categories") return mockCategories as never;
      if (url === "/feeds?uncategorized=true") return [] as never;
      if (url === "/categories/cat-1/feeds") return [] as never;
      return [] as never;
    });
    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.loadFeedsForCategory("cat-1");
    });
    expect(result.current.feedsByCategory["cat-1"]).toEqual([]);
    const callsBefore = vi
      .mocked(api.get)
      .mock.calls.filter((c) => c[0] === "/categories/cat-1/feeds").length;

    await act(async () => {
      await result.current.loadFeedsForCategory("cat-1");
    });
    const callsAfter = vi
      .mocked(api.get)
      .mock.calls.filter((c) => c[0] === "/categories/cat-1/feeds").length;
    expect(callsAfter).toBe(callsBefore); // empty array is "loaded" → no refetch
  });

  it("discards a stale in-flight category load after refresh() resets the cache", async () => {
    let resolveCat1: (feeds: unknown) => void = () => {};
    const cat1Pending = new Promise<unknown>((r) => {
      resolveCat1 = r;
    });
    vi.mocked(api.get).mockImplementation(async (url: string) => {
      if (url === "/categories") return mockCategories as never;
      if (url === "/feeds?uncategorized=true") return [] as never;
      if (url === "/categories/cat-1/feeds") return (cat1Pending as never);
      return [] as never;
    });

    const { result } = renderHook(() => useFeedsData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    // Start a category load; its fetch stays pending.
    let loadPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      loadPromise = result.current.loadFeedsForCategory("cat-1");
    });
    expect(result.current.loadingFeeds.has("cat-1")).toBe(true);

    // A full refresh() completes, resetting the cache and clearing loadingFeeds.
    await act(async () => {
      await result.current.refresh();
    });

    // Now the stale fetch resolves — its write MUST be discarded.
    await act(async () => {
      resolveCat1([{ id: "stale-feed", categoryIds: ["cat-1"] }]);
      await loadPromise;
    });

    expect("cat-1" in result.current.feedsByCategory).toBe(false);
  });
});
