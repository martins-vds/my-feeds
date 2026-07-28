/**
 * PostList Component - Displays a list of posts with pagination
 */

import React from "react";
import {
    Box,
    Button,
    CircularProgress,
    Typography,
    Alert,
    Stack,
} from "@mui/material";
import { Refresh as RefreshIcon } from "@mui/icons-material";
import PostCard from "./PostCard";
import { PostListSkeleton } from "./skeletons/PostListSkeleton";
import type { PostSummary } from "../hooks/usePostsData";

interface PostListProps {
    posts: PostSummary[];
    loading: boolean;
    loadingMore: boolean;
    hasMore: boolean;
    error: string | null;
    onLoadMore?: () => void;
    onRefresh?: () => void;
    onMarkAsRead?: (postId: string, isRead: boolean) => void;
    onPostClick?: (post: PostSummary) => void;
}

/**
 * Empty state when no posts match filters
 */
const EmptyState: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
    <Box
        sx={{
            py: 8,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
        }}
        data-testid="posts-empty"
    >
        <Typography variant="h6" color="text.secondary">
            No posts found
        </Typography>
        <Typography variant="body2" color="text.secondary">
            Try adjusting your filters or add more feeds
        </Typography>
        {onRefresh && (
            <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={onRefresh}
            >
                Refresh
            </Button>
        )}
    </Box>
);

/**
 * Error state with retry option
 */
const ErrorState: React.FC<{ error: string; onRetry?: () => void }> = ({
    error,
    onRetry,
}) => (
    <Alert
        severity="error"
        action={
            onRetry && (
                <Button color="inherit" size="small" onClick={onRetry}>
                    Retry
                </Button>
            )
        }
        sx={{ mb: 2 }}
        data-testid="posts-error"
    >
        {error}
    </Alert>
);

/**
 * PostList displays posts with infinite scroll / load more
 */
export const PostList: React.FC<PostListProps> = ({
    posts,
    loading,
    loadingMore,
    hasMore,
    error,
    onLoadMore,
    onRefresh,
    onMarkAsRead,
    onPostClick,
}) => {
    // Initial loading state
    if (loading && posts.length === 0) {
        return <PostListSkeleton />;
    }

    // Error state with no posts
    if (error && posts.length === 0) {
        return <ErrorState error={error} onRetry={onRefresh} />;
    }

    // Empty state
    if (!loading && posts.length === 0) {
        return <EmptyState onRefresh={onRefresh} />;
    }

    return (
        <Box data-testid="posts-list">
            {/* Error banner (when we have posts but encountered an error) */}
            {error && <ErrorState error={error} onRetry={onRefresh} />}

            {/* Posts */}
            <Stack spacing={1} role="list" aria-label="Posts">
                {posts.map((post) => (
                    <PostCard
                        key={post.id}
                        post={post}
                        onMarkAsRead={onMarkAsRead}
                        onClick={onPostClick}
                    />
                ))}
            </Stack>

            {/* Load more section */}
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "center",
                    py: 3,
                }}
            >
                {loadingMore ? (
                    <CircularProgress size={32} />
                ) : hasMore ? (
                    <Button
                        variant="outlined"
                        onClick={onLoadMore}
                        disabled={loadingMore}
                        data-testid="load-more-button"
                    >
                        Load More
                    </Button>
                ) : posts.length > 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        You've reached the end
                    </Typography>
                ) : null}
            </Box>
        </Box>
    );
};

export default PostList;
