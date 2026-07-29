/**
 * ReaderPage - unified reader: collapsible sidebar (navigation + filter) plus
 * the post list. Replaces the separate Posts and Feeds pages.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    Box,
    Drawer,
    IconButton,
    Toolbar,
    Typography,
    Button,
    Tooltip,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import {
    Menu as MenuIcon,
    Refresh as RefreshIcon,
    ArrowUpward as ArrowUpwardIcon,
} from "@mui/icons-material";
import PostList from "../../components/PostList";
import { FeedSidebar } from "../../components/FeedSidebar";
import {
    usePostsData,
    type PostSummary,
    type ReadState,
} from "../../hooks/usePostsData";
import { useFeedsData } from "../../hooks/useFeedsData";
import { useUnreadCounts } from "../../hooks/useUnreadCounts";

const DRAWER_WIDTH = 300;
const HEADER_OFFSET = 64; // Sticky AppBar (Toolbar) height on desktop
const SIDEBAR_PREF_KEY = "myfeeds.sidebarOpen";

function readInitialSidebar(isDesktop: boolean): boolean {
    if (typeof window === "undefined") return isDesktop;
    const stored = window.localStorage.getItem(SIDEBAR_PREF_KEY);
    if (stored === null) return isDesktop;
    return stored === "true";
}

function parseReadState(value: string | null): ReadState {
    return value === "unread" || value === "read" ? value : "all";
}

export const ReaderPage: React.FC = () => {
    const navigate = useNavigate();
    const theme = useTheme();
    const isDesktop = useMediaQuery(theme.breakpoints.up("md"));

    const [searchParams, setSearchParams] = useSearchParams();
    const categoryId = searchParams.get("category");
    const feedId = searchParams.get("feed");
    const readState = parseReadState(searchParams.get("read"));
    const isUncategorized = categoryId === "none";
    const realCategoryId = isUncategorized ? null : categoryId;

    const [sidebarOpen, setSidebarOpen] = useState<boolean>(() =>
        readInitialSidebar(isDesktop)
    );

    // Posts (seed initial scope from the URL to avoid a wasted fetch)
    const {
        posts,
        loading,
        loadingMore,
        hasMore,
        error,
        newPostsCount,
        setFilters,
        refresh,
        loadMore,
        markAsRead,
        markAllRead,
    } = usePostsData(categoryId ?? undefined, feedId ?? undefined);

    // Feeds & categories (lazy)
    const {
        categories,
        feedsByCategory,
        loadingFeeds,
        loadFeedsForCategory,
        loading: feedsLoading,
        error: feedsError,
        createCategory,
        updateCategory,
        deleteCategory,
        addFeed,
        setFeedCategories,
        setFeedActive,
        deleteFeed,
        refreshFeed,
        refresh: refreshFeeds,
    } = useFeedsData();

    // Unread counts
    const { unread, refetchUnread } = useUnreadCounts();

    // Keep the post list in sync with the URL filters (single refetch).
    useEffect(() => {
        setFilters({ categoryId, feedId, readState });
    }, [categoryId, feedId, readState, setFilters]);

    // Persist the sidebar open/closed preference.
    useEffect(() => {
        window.localStorage.setItem(SIDEBAR_PREF_KEY, String(sidebarOpen));
    }, [sidebarOpen]);

    // Refresh unread counts when returning to the tab (e.g. after reading).
    useEffect(() => {
        const onFocus = () => refetchUnread();
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [refetchUnread]);

    // --- Filter -> URL helpers ---
    const updateParams = useCallback(
        (mutate: (params: URLSearchParams) => void) => {
            const next = new URLSearchParams(searchParams);
            mutate(next);
            setSearchParams(next);
        },
        [searchParams, setSearchParams]
    );

    const closeSidebarOnMobile = useCallback(() => {
        if (!isDesktop) setSidebarOpen(false);
    }, [isDesktop]);

    const handleSelectAll = useCallback(() => {
        updateParams((p) => {
            p.delete("category");
            p.delete("feed");
        });
        closeSidebarOnMobile();
    }, [updateParams, closeSidebarOnMobile]);

    const handleSelectCategory = useCallback(
        (id: string | null) => {
            updateParams((p) => {
                p.delete("feed");
                if (id) p.set("category", id);
                else p.delete("category");
            });
            closeSidebarOnMobile();
        },
        [updateParams, closeSidebarOnMobile]
    );

    const handleSelectUncategorized = useCallback(() => {
        updateParams((p) => {
            p.delete("feed");
            p.set("category", "none");
        });
        closeSidebarOnMobile();
    }, [updateParams, closeSidebarOnMobile]);

    const handleSelectFeed = useCallback(
        (id: string) => {
            updateParams((p) => {
                p.delete("category");
                p.set("feed", id);
            });
            closeSidebarOnMobile();
        },
        [updateParams, closeSidebarOnMobile]
    );

    const handleReadStateChange = useCallback(
        (rs: ReadState) => {
            updateParams((p) => {
                if (rs === "all") p.delete("read");
                else p.set("read", rs);
            });
        },
        [updateParams]
    );

    // --- Data actions ---
    const handleRefreshAll = useCallback(async () => {
        await Promise.all([refresh(), refreshFeeds(), refetchUnread()]);
    }, [refresh, refreshFeeds, refetchUnread]);

    const handleShowNewPosts = useCallback(() => {
        refresh();
        refetchUnread();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [refresh, refetchUnread]);

    const handleMarkAsRead = useCallback(
        async (postId: string, isRead: boolean) => {
            await markAsRead(postId, isRead);
            refetchUnread();
        },
        [markAsRead, refetchUnread]
    );

    const handleMarkAllRead = useCallback(
        async (
            scope: {
                categoryId?: string | null;
                feedId?: string | null;
                uncategorized?: boolean;
            },
            isRead: boolean
        ) => {
            await markAllRead(scope, isRead);
            refetchUnread();
        },
        [markAllRead, refetchUnread]
    );

    const handlePostClick = useCallback(
        (post: PostSummary) => {
            navigate(`/posts/${post.id}`);
        },
        [navigate]
    );

    const scopeTitle = useMemo(() => {
        if (feedId) {
            const loaded = Object.values(feedsByCategory)
                .flat()
                .find((f) => f.id === feedId);
            const fromPost = posts.find((p) => p.feedId === feedId)?.feedTitle;
            return loaded?.title || loaded?.url || fromPost || "Feed";
        }
        if (isUncategorized) return "Uncategorized";
        if (categoryId) {
            const category = categories.find((c) => c.id === categoryId);
            return category?.name || "Category";
        }
        return "All items";
    }, [feedId, categoryId, isUncategorized, feedsByCategory, categories, posts]);

    const sidebarContent = (
        <FeedSidebar
            categories={categories}
            feedsByCategory={feedsByCategory}
            loadingFeeds={loadingFeeds}
            onExpandCategory={loadFeedsForCategory}
            loading={feedsLoading}
            error={feedsError}
            selectedCategoryId={realCategoryId}
            activeFeedId={feedId}
            readState={readState}
            uncategorizedActive={isUncategorized}
            totalUnread={unread.total}
            unreadByFeed={unread.byFeed}
            unreadByCategory={unread.byCategory}
            uncategorizedUnread={unread.uncategorized}
            onSelectAll={handleSelectAll}
            onSelectCategory={handleSelectCategory}
            onSelectFeed={handleSelectFeed}
            onSelectUncategorized={handleSelectUncategorized}
            onReadStateChange={handleReadStateChange}
            onMarkCategoryRead={(id, isRead) => handleMarkAllRead({ categoryId: id }, isRead)}
            onMarkUncategorizedRead={(isRead) => handleMarkAllRead({ uncategorized: true }, isRead)}
            onMarkFeedRead={(id, isRead) => handleMarkAllRead({ feedId: id }, isRead)}
            onCreateCategory={createCategory}
            onUpdateCategory={updateCategory}
            onDeleteCategory={deleteCategory}
            onAddFeed={addFeed}
            onDeleteFeed={deleteFeed}
            onRefreshFeed={refreshFeed}
            onSetFeedCategories={setFeedCategories}
            onSetFeedActive={setFeedActive}
        />
    );

    return (
        <Box sx={{ display: "flex", alignItems: "flex-start" }}>
            {/* Desktop: sticky inline sidebar */}
            {isDesktop && sidebarOpen && (
                <Box
                    component="nav"
                    sx={{
                        width: DRAWER_WIDTH,
                        flexShrink: 0,
                        position: "sticky",
                        top: HEADER_OFFSET,
                        alignSelf: "flex-start",
                        height: `calc(100vh - ${HEADER_OFFSET}px)`,
                        overflow: "hidden",
                        borderRight: 1,
                        borderColor: "divider",
                    }}
                >
                    {sidebarContent}
                </Box>
            )}

            {/* Mobile: temporary overlay drawer */}
            {!isDesktop && (
                <Drawer
                    variant="temporary"
                    open={sidebarOpen}
                    onClose={() => setSidebarOpen(false)}
                    ModalProps={{ keepMounted: true }}
                    sx={{
                        "& .MuiDrawer-paper": {
                            width: DRAWER_WIDTH,
                            boxSizing: "border-box",
                        },
                    }}
                >
                    {sidebarContent}
                </Drawer>
            )}

            {/* Main content */}
            <Box sx={{ flexGrow: 1, minWidth: 0, px: { xs: 1, sm: 2 } }}>
                <Toolbar disableGutters sx={{ gap: 1, flexWrap: "wrap" }}>
                    <Tooltip title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}>
                        <IconButton
                            onClick={() => setSidebarOpen((o) => !o)}
                            edge="start"
                            aria-label="toggle sidebar"
                        >
                            <MenuIcon />
                        </IconButton>
                    </Tooltip>
                    <Typography
                        variant="h6"
                        component="h1"
                        noWrap
                        sx={{ flexGrow: 1, minWidth: 0 }}
                    >
                        {scopeTitle}
                    </Typography>
                    <Tooltip title="Refresh">
                        <span>
                            <IconButton
                                onClick={handleRefreshAll}
                                disabled={loading}
                                aria-label="Refresh posts"
                            >
                                <RefreshIcon />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Toolbar>

                {newPostsCount > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "center", mb: 2 }}>
                        <Button
                            variant="contained"
                            size="small"
                            startIcon={<ArrowUpwardIcon />}
                            onClick={handleShowNewPosts}
                        >
                            {newPostsCount} new post{newPostsCount === 1 ? "" : "s"}
                        </Button>
                    </Box>
                )}

                <PostList
                    posts={posts}
                    loading={loading}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    error={error}
                    onLoadMore={loadMore}
                    onRefresh={refresh}
                    onMarkAsRead={handleMarkAsRead}
                    onPostClick={handlePostClick}
                />
            </Box>
        </Box>
    );
};

export default ReaderPage;
