/**
 * Unit tests for usePostsData — the "new posts" indicator fed by background
 * polling / focus re-checks.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../../services/api", () => ({
    default: {
        get: vi.fn(),
        put: vi.fn(),
    },
    api: {
        get: vi.fn(),
        put: vi.fn(),
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
import { usePostsData, parseReadState, type PostSummary } from "../usePostsData";

function makePost(id: string, overrides: Partial<PostSummary> = {}): PostSummary {
    return {
        id,
        feedId: "feed-1",
        feedTitle: "Feed",
        feedIconUrl: null,
        title: `Post ${id}`,
        summary: null,
        author: null,
        link: `https://example.com/${id}`,
        publishedAt: "2026-01-01T00:00:00Z",
        isRead: false,
        readProgress: 0,
        isSeen: false,
        hasAudio: false,
        hasContent: true,
        ...overrides,
    };
}

function response(posts: PostSummary[]) {
    return { posts, hasMore: false, nextCursor: null };
}

describe("usePostsData new-posts indicator", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("loads posts on mount with no indicator", async () => {
        vi.mocked(api.get).mockResolvedValue(
            response([makePost("a"), makePost("b")])
        );

        const { result } = renderHook(() => usePostsData());

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.posts).toHaveLength(2);
        expect(result.current.newPostsCount).toBe(0);
    });

    it("counts newly-ingested posts on a re-check without disrupting the list", async () => {
        vi.mocked(api.get).mockResolvedValue(
            response([makePost("a"), makePost("b")])
        );

        const { result } = renderHook(() => usePostsData());
        await waitFor(() => expect(result.current.loading).toBe(false));

        // Two new posts are now returned by the first page.
        vi.mocked(api.get).mockResolvedValue(
            response([makePost("c"), makePost("d"), makePost("a"), makePost("b")])
        );

        await act(async () => {
            window.dispatchEvent(new Event("focus"));
        });

        await waitFor(() => expect(result.current.newPostsCount).toBe(2));
        // The visible list is unchanged until the user chooses to load them.
        expect(result.current.posts).toHaveLength(2);
    });

    it("clears the indicator when the new posts are loaded via refresh", async () => {
        vi.mocked(api.get).mockResolvedValue(response([makePost("a")]));

        const { result } = renderHook(() => usePostsData());
        await waitFor(() => expect(result.current.loading).toBe(false));

        vi.mocked(api.get).mockResolvedValue(
            response([makePost("c"), makePost("a")])
        );
        await act(async () => {
            window.dispatchEvent(new Event("focus"));
        });
        await waitFor(() => expect(result.current.newPostsCount).toBe(1));

        await act(async () => {
            await result.current.refresh();
        });

        expect(result.current.newPostsCount).toBe(0);
        expect(result.current.posts).toHaveLength(2);
    });
});

describe("parseReadState", () => {
    it.each(["all", "unread", "in_progress", "read"] as const)("keeps %s", (value) => {
        expect(parseReadState(value)).toBe(value);
    });

    it.each([null, "", "started", "IN_PROGRESS", "in-progress"])(
        "falls back to all for %j",
        (value) => {
            expect(parseReadState(value)).toBe("all");
        }
    );
});

describe("usePostsData initial read state", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("loads the list once, already filtered by the read state it starts on", async () => {
        vi.mocked(api.get).mockResolvedValue(response([makePost("a", { readProgress: 0.4 })]));

        const { result } = renderHook(() => usePostsData(undefined, undefined, "in_progress"));
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.readState).toBe("in_progress");
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(api.get).toHaveBeenCalledWith(expect.stringContaining("readState=in_progress"));
    });

    it("starts on all, with no read state in the request, when none is given", async () => {
        vi.mocked(api.get).mockResolvedValue(response([makePost("a")]));

        const { result } = renderHook(() => usePostsData());
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.readState).toBe("all");
        expect(api.get).toHaveBeenCalledTimes(1);
        expect(vi.mocked(api.get).mock.calls[0][0]).not.toContain("readState");
    });
});

describe("usePostsData reading progress", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("marking a post read moves its progress to 1", async () => {
        vi.mocked(api.get).mockResolvedValue(
            response([makePost("a", { readProgress: 0.4, isSeen: true })])
        );
        vi.mocked(api.put).mockResolvedValue({});

        const { result } = renderHook(() => usePostsData());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.markAsRead("a", true);
        });

        expect(api.put).toHaveBeenCalledWith("/posts/a/read-state", { isRead: true });
        expect(result.current.posts[0]).toMatchObject({ isRead: true, readProgress: 1 });
    });

    it("marking a post unread resets its progress to 0", async () => {
        vi.mocked(api.get).mockResolvedValue(
            response([makePost("a", { isRead: true, readProgress: 1, isSeen: true })])
        );
        vi.mocked(api.put).mockResolvedValue({});

        const { result } = renderHook(() => usePostsData());
        await waitFor(() => expect(result.current.loading).toBe(false));

        await act(async () => {
            await result.current.markAsRead("a", false);
        });

        expect(result.current.posts[0]).toMatchObject({ isRead: false, readProgress: 0 });
    });
});
