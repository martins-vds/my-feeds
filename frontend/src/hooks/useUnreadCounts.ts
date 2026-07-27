/**
 * Hook for fetching unread post counts (per feed + total).
 *
 * Used by the sidebar to render unread badges. Counts are refetched on demand
 * (e.g. after a refresh, opening a post, or marking read/unread).
 */

import { useState, useCallback, useEffect } from "react";
import api from "../services/api";
import type { UnreadCounts } from "../types";

const EMPTY: UnreadCounts = { byFeed: {}, total: 0 };

export function useUnreadCounts() {
    const [unread, setUnread] = useState<UnreadCounts>(EMPTY);

    const refetchUnread = useCallback(async () => {
        try {
            const data = await api.get<UnreadCounts>("/posts/unread-counts");
            setUnread({ byFeed: data.byFeed ?? {}, total: data.total ?? 0 });
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
