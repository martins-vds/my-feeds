/**
 * Custom hook for managing posts data with filtering and pagination
 */

import { useState, useCallback, useEffect, useRef } from "react";
import api, { ApiError } from "../services/api";

export interface PostSummary {
    id: string;
    feedId: string;
    feedTitle: string | null;
    feedIconUrl: string | null;
    title: string;
    summary: string | null;
    author: string | null;
    link: string;
    publishedAt: string;
    isRead: boolean;
    hasAudio: boolean;
}

export interface PostDetail extends PostSummary {
    content: string | null;
}

interface PostsResponse {
    posts: PostSummary[];
    hasMore: boolean;
    nextCursor: string | null;
}

export type ReadState = "all" | "unread" | "read";

interface UsePostsDataState {
    posts: PostSummary[];
    hasMore: boolean;
    nextCursor: string | null;
    loading: boolean;
    loadingMore: boolean;
    error: string | null;
    // Count of newly-ingested posts detected by background polling
    newPostsCount: number;
    // Filters
    categoryId: string | null;
    feedId: string | null;
    readState: ReadState;
}

interface UsePostsDataActions {
    // Filter actions
    setCategoryFilter: (categoryId: string | null) => void;
    setFeedFilter: (feedId: string | null) => void;
    setReadStateFilter: (readState: ReadState) => void;

    // Data actions
    refresh: () => Promise<void>;
    loadMore: () => Promise<void>;
    markAsRead: (postId: string, isRead: boolean) => Promise<void>;
}

export type UsePostsDataReturn = UsePostsDataState & UsePostsDataActions;

const DEFAULT_LIMIT = 50;

// How often to poll for newly-ingested posts. Background ingestion means new
// posts can appear after the page has already loaded.
const POLL_INTERVAL_MS = 30000;

/**
 * Hook for managing posts with filtering and pagination
 */
export function usePostsData(
    initialCategoryId?: string,
    initialFeedId?: string
): UsePostsDataReturn {
    const [state, setState] = useState<UsePostsDataState>({
        posts: [],
        hasMore: false,
        nextCursor: null,
        loading: true,
        loadingMore: false,
        error: null,
        newPostsCount: 0,
        categoryId: initialCategoryId || null,
        feedId: initialFeedId || null,
        readState: "all",
    });

    // Track if a fetch is in progress to avoid duplicate requests
    const fetchingRef = useRef(false);

    /**
     * Fetch posts from API
     */
    const fetchPosts = useCallback(
        async (cursor?: string | null): Promise<PostsResponse> => {
            const params = new URLSearchParams();
            params.set("limit", String(DEFAULT_LIMIT));

            if (state.categoryId) {
                params.set("categoryId", state.categoryId);
            }
            if (state.feedId) {
                params.set("feedId", state.feedId);
            }
            if (state.readState !== "all") {
                params.set("readState", state.readState);
            }
            if (cursor) {
                params.set("before", cursor);
            }

            const response = await api.get<PostsResponse>(
                `/posts?${params.toString()}`
            );
            return response;
        },
        [state.categoryId, state.feedId, state.readState]
    );

    /**
     * Load initial posts
     */
    const refresh = useCallback(async () => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;

        setState((prev) => ({
            ...prev,
            loading: true,
            error: null,
            newPostsCount: 0,
        }));
        try {
            const response = await fetchPosts();
            setState((prev) => ({
                ...prev,
                posts: response.posts,
                hasMore: response.hasMore,
                nextCursor: response.nextCursor,
                loading: false,
            }));
        } catch (err) {
            const message =
                err instanceof ApiError ? err.message : "Failed to load posts";
            setState((prev) => ({
                ...prev,
                loading: false,
                error: message,
            }));
        } finally {
            fetchingRef.current = false;
        }
    }, [fetchPosts]);

    /**
     * Load more posts (pagination)
     */
    const loadMore = useCallback(async () => {
        if (fetchingRef.current || !state.hasMore || !state.nextCursor) return;
        fetchingRef.current = true;

        setState((prev) => ({ ...prev, loadingMore: true }));
        try {
            const response = await fetchPosts(state.nextCursor);
            setState((prev) => ({
                ...prev,
                posts: [...prev.posts, ...response.posts],
                hasMore: response.hasMore,
                nextCursor: response.nextCursor,
                loadingMore: false,
            }));
        } catch (err) {
            const message =
                err instanceof ApiError
                    ? err.message
                    : "Failed to load more posts";
            setState((prev) => ({
                ...prev,
                loadingMore: false,
                error: message,
            }));
        } finally {
            fetchingRef.current = false;
        }
    }, [fetchPosts, state.hasMore, state.nextCursor]);

    /**
     * Poll the first page and count posts we don't already have.
     */
    const checkForNewPosts = useCallback(async () => {
        if (fetchingRef.current) return;
        try {
            const response = await fetchPosts();
            setState((prev) => {
                // Don't interfere with an in-flight full load.
                if (prev.loading) return prev;
                const currentIds = new Set(prev.posts.map((p) => p.id));
                const newCount = response.posts.filter(
                    (p) => !currentIds.has(p.id)
                ).length;
                return { ...prev, newPostsCount: newCount };
            });
        } catch {
            // Polling errors are non-fatal; ignore them.
        }
    }, [fetchPosts]);

    /**
     * Mark a post as read/unread
     */
    const markAsRead = useCallback(
        async (postId: string, isRead: boolean) => {
            try {
                await api.put(`/posts/${postId}/read-state`, { isRead });
                // Update local state
                setState((prev) => ({
                    ...prev,
                    posts: prev.posts.map((post) =>
                        post.id === postId ? { ...post, isRead } : post
                    ),
                }));
            } catch (err) {
                const message =
                    err instanceof ApiError
                        ? err.message
                        : "Failed to update read state";
                setState((prev) => ({ ...prev, error: message }));
            }
        },
        []
    );

    /**
     * Set category filter
     */
    const setCategoryFilter = useCallback((categoryId: string | null) => {
        setState((prev) => ({
            ...prev,
            categoryId,
            feedId: null, // Clear feed filter when category changes
            posts: [],
            hasMore: false,
            nextCursor: null,
        }));
    }, []);

    /**
     * Set feed filter
     */
    const setFeedFilter = useCallback((feedId: string | null) => {
        setState((prev) => ({
            ...prev,
            feedId,
            posts: [],
            hasMore: false,
            nextCursor: null,
        }));
    }, []);

    /**
     * Set read state filter
     */
    const setReadStateFilter = useCallback((readState: ReadState) => {
        setState((prev) => ({
            ...prev,
            readState,
            posts: [],
            hasMore: false,
            nextCursor: null,
        }));
    }, []);

    // Load posts on mount and when filters change
    useEffect(() => {
        refresh();
    }, [state.categoryId, state.feedId, state.readState]);

    // Poll for newly-ingested posts while the page is visible.
    useEffect(() => {
        const intervalId = setInterval(() => {
            if (
                typeof document === "undefined" ||
                document.visibilityState === "visible"
            ) {
                checkForNewPosts();
            }
        }, POLL_INTERVAL_MS);
        return () => clearInterval(intervalId);
    }, [checkForNewPosts]);

    // Re-check immediately when the tab regains focus / becomes visible.
    useEffect(() => {
        const check = () => {
            if (
                typeof document === "undefined" ||
                document.visibilityState === "visible"
            ) {
                checkForNewPosts();
            }
        };
        window.addEventListener("focus", check);
        document.addEventListener("visibilitychange", check);
        return () => {
            window.removeEventListener("focus", check);
            document.removeEventListener("visibilitychange", check);
        };
    }, [checkForNewPosts]);

    return {
        // State
        posts: state.posts,
        hasMore: state.hasMore,
        nextCursor: state.nextCursor,
        loading: state.loading,
        loadingMore: state.loadingMore,
        error: state.error,
        newPostsCount: state.newPostsCount,
        categoryId: state.categoryId,
        feedId: state.feedId,
        readState: state.readState,

        // Actions
        setCategoryFilter,
        setFeedFilter,
        setReadStateFilter,
        refresh,
        loadMore,
        markAsRead,
    };
}

export default usePostsData;
