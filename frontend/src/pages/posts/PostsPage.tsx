/**
 * PostsPage - Main page for browsing posts
 */

import React, { useCallback, useMemo } from "react";
import {
    Container,
    Box,
    Typography,
    IconButton,
    Tooltip,
    Button,
} from "@mui/material";
import {
    Refresh as RefreshIcon,
    ArrowUpward as ArrowUpwardIcon,
} from "@mui/icons-material";
import PostList from "../../components/PostList";
import CategoryFilter from "../../components/CategoryFilter";
import { usePostsData, type PostSummary } from "../../hooks/usePostsData";
import { useFeedsData } from "../../hooks/useFeedsData";

/**
 * PostsPage displays posts with filtering and pagination
 */
export const PostsPage: React.FC = () => {
    // Posts data and filters
    const {
        posts,
        loading,
        loadingMore,
        hasMore,
        error,
        categoryId,
        feedId,
        readState,
        newPostsCount,
        setCategoryFilter,
        setFeedFilter,
        setReadStateFilter,
        refresh,
        loadMore,
        markAsRead,
    } = usePostsData();

    // Categories and feeds for filter options
    const {
        categories,
        feeds,
        loading: loadingFeeds,
    } = useFeedsData();

    // Transform categories for filter component
    const categoryOptions = useMemo(
        () =>
            categories.map((cat) => ({
                id: cat.id,
                name: cat.name,
                feedCount: feeds.filter((f) => f.categoryIds.includes(cat.id))
                    .length,
            })),
        [categories, feeds]
    );

    // Transform feeds for filter component
    const feedOptions = useMemo(
        () =>
            feeds
                .filter(
                    (feed) => !categoryId || feed.categoryIds.includes(categoryId)
                )
                .map((feed) => ({
                    id: feed.id,
                    title: feed.title || feed.url,
                })),
        [feeds, categoryId]
    );

    // Handle post click - could navigate to detail page
    const handlePostClick = useCallback((post: PostSummary) => {
        // Auto-mark as read when opening
        if (!post.isRead) {
            markAsRead(post.id, true);
        }
        // Open in new tab (or could navigate to detail page)
        window.open(post.link, "_blank", "noopener,noreferrer");
    }, [markAsRead]);

    // Load newly-ingested posts detected by background polling
    const handleShowNewPosts = useCallback(() => {
        refresh();
        window.scrollTo({ top: 0, behavior: "smooth" });
    }, [refresh]);

    return (
        <Container maxWidth="md" sx={{ py: 3 }}>
            {/* Header */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 3,
                }}
            >
                <Typography variant="h4" component="h1">
                    Posts
                </Typography>
                <Tooltip title="Refresh posts">
                    <IconButton
                        onClick={refresh}
                        disabled={loading}
                        aria-label="Refresh posts"
                    >
                        <RefreshIcon />
                    </IconButton>
                </Tooltip>
            </Box>

            {/* Filters */}
            <CategoryFilter
                categoryId={categoryId}
                feedId={feedId}
                readState={readState}
                categories={categoryOptions}
                feeds={feedOptions}
                loadingCategories={loadingFeeds}
                loadingFeeds={loadingFeeds}
                onCategoryChange={setCategoryFilter}
                onFeedChange={setFeedFilter}
                onReadStateChange={setReadStateFilter}
            />

            {/* New posts indicator */}
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

            {/* Posts list */}
            <PostList
                posts={posts}
                loading={loading}
                loadingMore={loadingMore}
                hasMore={hasMore}
                error={error}
                onLoadMore={loadMore}
                onRefresh={refresh}
                onMarkAsRead={markAsRead}
                onPostClick={handlePostClick}
            />
        </Container>
    );
};

export default PostsPage;
