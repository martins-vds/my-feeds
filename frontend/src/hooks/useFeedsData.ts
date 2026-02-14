/**
 * Custom hook for managing categories and feeds data
 */

import { useState, useCallback, useEffect } from "react";
import api, { ApiError } from "../services/api";
import type { Category, Feed } from "../types";

interface CategoriesResponse {
    categories: Category[];
}

interface CategoryResponse {
    category: Category;
}

interface FeedsResponse {
    feeds: Feed[];
}

interface FeedResponse {
    feed: Feed;
}

interface UseFeedsDataState {
    categories: Category[];
    feeds: Feed[];
    loading: boolean;
    error: string | null;
    selectedCategoryId: string | null;
}

interface UseFeedsDataActions {
    // Category operations
    createCategory: (name: string) => Promise<Category>;
    updateCategory: (id: string, name: string) => Promise<Category>;
    deleteCategory: (id: string) => Promise<void>;

    // Feed operations
    addFeed: (categoryId: string, url: string) => Promise<Feed>;
    moveFeed: (feedId: string, categoryId: string) => Promise<Feed>;
    deleteFeed: (feedId: string) => Promise<void>;
    refreshFeed: (feedId: string) => Promise<Feed>;

    // State management
    selectCategory: (categoryId: string | null) => void;
    refresh: () => Promise<void>;
}

export type UseFeedsDataReturn = UseFeedsDataState & UseFeedsDataActions;

/**
 * Hook for managing categories and feeds with API integration
 */
export function useFeedsData(): UseFeedsDataReturn {
    const [state, setState] = useState<UseFeedsDataState>({
        categories: [],
        feeds: [],
        loading: true,
        error: null,
        selectedCategoryId: null,
    });

    /**
     * Fetch all categories from API
     */
    const fetchCategories = useCallback(async (): Promise<Category[]> => {
        const response = await api.get<CategoriesResponse>("/categories");
        return response.categories;
    }, []);

    /**
     * Fetch feeds for a specific category
     */
    const fetchFeedsForCategory = useCallback(
        async (categoryId: string): Promise<Feed[]> => {
            const response = await api.get<FeedsResponse>(
                `/categories/${categoryId}/feeds`
            );
            return response.feeds;
        },
        []
    );

    /**
     * Fetch all feeds for the user (across all categories)
     */
    const fetchAllFeeds = useCallback(async (categories: Category[]): Promise<Feed[]> => {
        const allFeeds: Feed[] = [];
        for (const category of categories) {
            try {
                const feeds = await fetchFeedsForCategory(category.id);
                allFeeds.push(...feeds);
            } catch {
                // Continue if one category fails
                console.error(`Failed to fetch feeds for category ${category.id}`);
            }
        }
        return allFeeds;
    }, [fetchFeedsForCategory]);

    /**
     * Load initial data
     */
    const refresh = useCallback(async () => {
        setState((prev) => ({ ...prev, loading: true, error: null }));
        try {
            const categories = await fetchCategories();
            const feeds = await fetchAllFeeds(categories);
            setState((prev) => ({
                ...prev,
                categories,
                feeds,
                loading: false,
            }));
        } catch (err) {
            const message =
                err instanceof ApiError ? err.message : "Failed to load data";
            setState((prev) => ({
                ...prev,
                loading: false,
                error: message,
            }));
        }
    }, [fetchCategories, fetchAllFeeds]);

    // Load data on mount
    useEffect(() => {
        refresh();
    }, [refresh]);

    /**
     * Create a new category
     */
    const createCategory = useCallback(
        async (name: string): Promise<Category> => {
            const response = await api.post<CategoryResponse>("/categories", {
                name,
            });
            // Refresh to update the full list
            await refresh();
            return response.category;
        },
        [refresh]
    );

    /**
     * Update an existing category
     */
    const updateCategory = useCallback(
        async (id: string, name: string): Promise<Category> => {
            const response = await api.patch<CategoryResponse>(
                `/categories/${id}`,
                { name }
            );
            // Update local state
            setState((prev) => ({
                ...prev,
                categories: prev.categories.map((cat) =>
                    cat.id === id ? response.category : cat
                ),
            }));
            return response.category;
        },
        []
    );

    /**
     * Delete a category
     */
    const deleteCategory = useCallback(
        async (id: string): Promise<void> => {
            await api.delete(`/categories/${id}`);
            // Update local state
            setState((prev) => ({
                ...prev,
                categories: prev.categories.filter((cat) => cat.id !== id),
                feeds: prev.feeds.filter((feed) => feed.categoryId !== id),
                selectedCategoryId:
                    prev.selectedCategoryId === id
                        ? null
                        : prev.selectedCategoryId,
            }));
        },
        []
    );

    /**
     * Add a feed to a category
     */
    const addFeed = useCallback(
        async (categoryId: string, url: string): Promise<Feed> => {
            const response = await api.post<FeedResponse>(
                `/categories/${categoryId}/feeds`,
                { url }
            );
            // Refresh to update feed counts
            await refresh();
            return response.feed;
        },
        [refresh]
    );

    /**
     * Move a feed to a different category
     */
    const moveFeed = useCallback(
        async (feedId: string, categoryId: string): Promise<Feed> => {
            const response = await api.patch<FeedResponse>(`/feeds/${feedId}`, {
                categoryId,
            });
            // Refresh to update feed counts
            await refresh();
            return response.feed;
        },
        [refresh]
    );

    /**
     * Delete a feed
     */
    const deleteFeed = useCallback(
        async (feedId: string): Promise<void> => {
            await api.delete(`/feeds/${feedId}`);
            // Update local state
            setState((prev) => {
                const deletedFeed = prev.feeds.find((f) => f.id === feedId);
                return {
                    ...prev,
                    feeds: prev.feeds.filter((feed) => feed.id !== feedId),
                    categories: prev.categories.map((cat) =>
                        cat.id === deletedFeed?.categoryId
                            ? { ...cat, feedCount: cat.feedCount - 1 }
                            : cat
                    ),
                };
            });
        },
        []
    );

    /**
     * Refresh feed metadata
     */
    const refreshFeed = useCallback(async (feedId: string): Promise<Feed> => {
        const response = await api.post<FeedResponse>(
            `/feeds/${feedId}/refresh`
        );
        // Update local feed
        setState((prev) => ({
            ...prev,
            feeds: prev.feeds.map((feed) =>
                feed.id === feedId ? response.feed : feed
            ),
        }));
        return response.feed;
    }, []);

    /**
     * Select a category
     */
    const selectCategory = useCallback((categoryId: string | null) => {
        setState((prev) => ({
            ...prev,
            selectedCategoryId: categoryId,
        }));
    }, []);

    return {
        // State
        categories: state.categories,
        feeds: state.feeds,
        loading: state.loading,
        error: state.error,
        selectedCategoryId: state.selectedCategoryId,

        // Actions
        createCategory,
        updateCategory,
        deleteCategory,
        addFeed,
        moveFeed,
        deleteFeed,
        refreshFeed,
        selectCategory,
        refresh,
    };
}

export default useFeedsData;
