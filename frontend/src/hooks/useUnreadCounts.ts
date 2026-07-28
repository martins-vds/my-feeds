/**
 * Hook for fetching unread post counts (per feed, per category, uncategorized,
 * and total).
 *
 * Used by the sidebar to render unread badges — including badges for collapsed
 * categories, whose feeds are not loaded, from the per-category totals. Counts
 * are refetched on demand (after a refresh, opening a post, or marking read).
 */

import { useState, useCallback, useEffect } from "react";
import api from "../services/api";
import type { UnreadCounts } from "../types";

const EMPTY: UnreadCounts = { byFeed: {}, byCategory: {}, uncategorized: 0, total: 0 };

export function useUnreadCounts() {
    const [unread, setUnread] = useState<UnreadCounts>(EMPTY);

    const refetchUnread = useCallback(async () => {
        try {
            const data = await api.get<UnreadCounts>("/posts/unread-counts");
            setUnread({
                byFeed: data.byFeed ?? {},
                byCategory: data.byCategory ?? {},
                uncategorized: data.uncategorized ?? 0,
                total: data.total ?? 0,
            });
        } catch {
            // Non-fatal: keep the previous counts rather than clearing badges.
        }
    }, []);

    useEffect(() => {
        refetchUnread();
    }, [refetchUnread]);

    return { unread, refetchUnread };
}

export default useUnreadCounts;
