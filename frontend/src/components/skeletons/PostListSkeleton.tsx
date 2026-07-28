import { Box, Card, CardContent, Skeleton } from "@mui/material";

interface PostListSkeletonProps {
    /** Number of placeholder cards. */
    count?: number;
}

/**
 * Content-shaped placeholder for the post list while the first page loads.
 * Mirrors PostCard: a header row (feed icon + feed name + date), a title line,
 * and two summary lines.
 */
export function PostListSkeleton({ count = 6 }: PostListSkeletonProps) {
    return (
        <Box
            role="status"
            aria-busy="true"
            aria-label="Loading posts"
            data-testid="posts-skeleton"
        >
            {Array.from({ length: count }, (_, i) => (
                <Card key={i} sx={{ mb: 1 }}>
                    <CardContent sx={{ pb: 1 }}>
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                mb: 0.5,
                            }}
                        >
                            <Skeleton variant="circular" width={16} height={16} />
                            <Skeleton variant="text" width={120} />
                            <Box sx={{ flexGrow: 1 }} />
                            <Skeleton variant="text" width={48} />
                        </Box>
                        <Skeleton variant="text" width="80%" height={28} />
                        <Skeleton variant="text" width="95%" />
                        <Skeleton variant="text" width="60%" />
                    </CardContent>
                </Card>
            ))}
        </Box>
    );
}

export default PostListSkeleton;
