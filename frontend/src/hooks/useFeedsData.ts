/**
 * Custom hook for managing categories and feeds data — lazily.
 *
 * On mount it fetches only the shallow category list plus the uncategorized
 * feeds. A category's feeds are fetched on first expand via
 * loadFeedsForCategory and cached in feedsByCategory. This avoids pulling every
 * feed across every category up front.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import api, { ApiError } from "../services/api";
import type { Category, Feed } from "../types";

/** Sentinel key for the pseudo-group holding feeds with no category. */
export const UNCATEGORIZED_KEY = "__uncategorized__";

interface CategoryResponse {
  category: Category;
}

interface UseFeedsDataState {
  categories: Category[];
  feedsByCategory: Record<string, Feed[]>;
  loadingFeeds: Set<string>;
  loading: boolean;
  error: string | null;
}

interface UseFeedsDataActions {
  createCategory: (name: string) => Promise<Category>;
  updateCategory: (id: string, name: string) => Promise<Category>;
  deleteCategory: (id: string) => Promise<void>;
  addFeed: (categoryId: string | null, url: string) => Promise<Feed>;
  setFeedCategories: (feedId: string, categoryIds: string[]) => Promise<Feed>;
  setFeedActive: (feedId: string, isActive: boolean) => Promise<Feed>;
  deleteFeed: (feedId: string) => Promise<void>;
  refreshFeed: (feedId: string) => Promise<Feed>;
  loadFeedsForCategory: (key: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export type UseFeedsDataReturn = UseFeedsDataState & UseFeedsDataActions;

export function useFeedsData(): UseFeedsDataReturn {
  const [state, setState] = useState<UseFeedsDataState>({
    categories: [],
    feedsByCategory: {},
    loadingFeeds: new Set(),
    loading: true,
    error: null,
  });

  // Mutable ref so loadFeedsForCategory can read current state synchronously
  // without needing to be recreated on every state change.
  const stateRef = useRef(state);
  stateRef.current = state;

  // Bumped on every refresh() so an in-flight loadFeedsForCategory whose fetch
  // resolves AFTER a cache reset can detect it is stale and discard its write.
  const generationRef = useRef(0);

  const fetchCategories = useCallback(
    async (): Promise<Category[]> => api.get<Category[]>("/categories"),
    []
  );

  const fetchUncategorized = useCallback(
    async (): Promise<Feed[]> => api.get<Feed[]>("/feeds?uncategorized=true"),
    []
  );

  /**
   * Initial (and full-refresh) load: shallow categories + uncategorized feeds.
   * Category feed caches are dropped so expanded groups reload lazily.
   */
  const refresh = useCallback(async () => {
    // Invalidate any in-flight per-category loads: their writes must not land
    // after this reset.
    generationRef.current += 1;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [categories, uncategorized] = await Promise.all([
        fetchCategories(),
        fetchUncategorized(),
      ]);
      setState((prev) => ({
        ...prev,
        categories,
        feedsByCategory: { [UNCATEGORIZED_KEY]: uncategorized },
        loadingFeeds: new Set(),
        loading: false,
      }));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to load data";
      setState((prev) => ({ ...prev, loading: false, error: message }));
    }
  }, [fetchCategories, fetchUncategorized]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * Lazily load a category's feeds (or the uncategorized set). Idempotent:
   * skips when the key is already loaded or in flight.
   */
  const loadFeedsForCategory = useCallback(async (key: string) => {
    // Read current state via ref to avoid stale closures and unreliable
    // setState-updater-as-synchronous-side-effect patterns.
    const current = stateRef.current;
    if (key in current.feedsByCategory || current.loadingFeeds.has(key)) return;

    // Capture the generation so a refresh() during this fetch invalidates it.
    // (Two synchronous calls for the same key before re-render can both pass the
    // guard and double-fetch; the writes are identical data, so that is benign.)
    const gen = generationRef.current;

    setState((prev) => {
      const loadingFeeds = new Set(prev.loadingFeeds);
      loadingFeeds.add(key);
      return { ...prev, loadingFeeds };
    });

    try {
      const feeds =
        key === UNCATEGORIZED_KEY
          ? await api.get<Feed[]>("/feeds?uncategorized=true")
          : await api.get<Feed[]>(`/categories/${key}/feeds`);
      setState((prev) => {
        if (generationRef.current !== gen) return prev; // a refresh() superseded us
        const loadingFeeds = new Set(prev.loadingFeeds);
        loadingFeeds.delete(key);
        return {
          ...prev,
          feedsByCategory: { ...prev.feedsByCategory, [key]: feeds },
          loadingFeeds,
        };
      });
    } catch {
      setState((prev) => {
        if (generationRef.current !== gen) return prev; // a refresh() superseded us
        const loadingFeeds = new Set(prev.loadingFeeds);
        loadingFeeds.delete(key);
        return { ...prev, loadingFeeds };
      });
    }
  // stateRef/generationRef are ref objects — stable, no need in deps
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createCategory = useCallback(
    async (name: string): Promise<Category> => {
      const response = await api.post<CategoryResponse>("/categories", { name });
      await refresh();
      return response.category;
    },
    [refresh]
  );

  const updateCategory = useCallback(async (id: string, name: string): Promise<Category> => {
    const response = await api.patch<CategoryResponse>(`/categories/${id}`, { name });
    setState((prev) => ({
      ...prev,
      categories: prev.categories.map((cat) => (cat.id === id ? response.category : cat)),
    }));
    return response.category;
  }, []);

  const deleteCategory = useCallback(async (id: string): Promise<void> => {
    await api.delete(`/categories/${id}`);
    await refresh();
  }, [refresh]);

  const addFeed = useCallback(
    async (categoryId: string | null, url: string): Promise<Feed> => {
      const feed = await api.post<Feed>("/feeds", {
        url,
        categoryIds: categoryId ? [categoryId] : [],
      });
      await refresh();
      return feed;
    },
    [refresh]
  );

  const setFeedCategories = useCallback(
    async (feedId: string, categoryIds: string[]): Promise<Feed> => {
      const feed = await api.patch<Feed>(`/feeds/${feedId}`, { categoryIds });
      await refresh();
      return feed;
    },
    [refresh]
  );

  const deleteFeed = useCallback(async (feedId: string): Promise<void> => {
    await api.delete(`/feeds/${feedId}`);
    setState((prev) => {
      const affected = new Set<string>();
      const feedsByCategory: Record<string, Feed[]> = {};
      for (const [key, feeds] of Object.entries(prev.feedsByCategory)) {
        if (key !== UNCATEGORIZED_KEY && feeds.some((f) => f.id === feedId)) {
          affected.add(key);
        }
        feedsByCategory[key] = feeds.filter((f) => f.id !== feedId);
      }
      return {
        ...prev,
        feedsByCategory,
        categories: prev.categories.map((cat) =>
          affected.has(cat.id)
            ? { ...cat, feedCount: Math.max(0, cat.feedCount - 1) }
            : cat
        ),
      };
    });
  }, []);

  const replaceFeedInGroups = useCallback((updated: Feed) => {
    setState((prev) => {
      const feedsByCategory: Record<string, Feed[]> = {};
      for (const [key, feeds] of Object.entries(prev.feedsByCategory)) {
        feedsByCategory[key] = feeds.map((f) => (f.id === updated.id ? updated : f));
      }
      return { ...prev, feedsByCategory };
    });
  }, []);

  const refreshFeed = useCallback(
    async (feedId: string): Promise<Feed> => {
      const updated = await api.post<Feed>(`/feeds/${feedId}/refresh`);
      replaceFeedInGroups(updated);
      return updated;
    },
    [replaceFeedInGroups]
  );

  const setFeedActive = useCallback(
    async (feedId: string, isActive: boolean): Promise<Feed> => {
      const updated = await api.patch<Feed>(`/feeds/${feedId}`, { isActive });
      replaceFeedInGroups(updated);
      return updated;
    },
    [replaceFeedInGroups]
  );

  return {
    categories: state.categories,
    feedsByCategory: state.feedsByCategory,
    loadingFeeds: state.loadingFeeds,
    loading: state.loading,
    error: state.error,
    createCategory,
    updateCategory,
    deleteCategory,
    addFeed,
    setFeedCategories,
    setFeedActive,
    deleteFeed,
    refreshFeed,
    loadFeedsForCategory,
    refresh,
  };
}

export default useFeedsData;
