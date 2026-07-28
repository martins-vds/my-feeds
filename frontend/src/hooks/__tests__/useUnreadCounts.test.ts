import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { api } = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
  },
}));

vi.mock("../../services/api", () => ({
  default: api,
}));

import { useUnreadCounts } from "../useUnreadCounts";

describe("useUnreadCounts", () => {
  // @ts-expect-error vitest/testing-library type inference issue
  beforeEach(() => vi.clearAllMocks());

  it("exposes byFeed, byCategory, uncategorized and total from the API", async () => {
    vi.mocked(api.get).mockResolvedValue({
      byFeed: { "feed-1": 3 },
      byCategory: { "cat-1": 5 },
      uncategorized: 2,
      total: 3,
    });

    const { result } = renderHook(() => useUnreadCounts());

    await waitFor(() => {
      expect(result.current.unread.total).toBe(3);
    });
    expect(result.current.unread.byFeed).toEqual({ "feed-1": 3 });
    expect(result.current.unread.byCategory).toEqual({ "cat-1": 5 });
    expect(result.current.unread.uncategorized).toBe(2);
  });

  it("falls back to empty counts on error", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useUnreadCounts());

    await waitFor(() => {
      expect(api.get).toHaveBeenCalled();
    });
    expect(result.current.unread).toEqual({
      byFeed: {},
      byCategory: {},
      uncategorized: 0,
      total: 0,
    });
  });
});
