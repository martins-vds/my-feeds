import { Box, Skeleton } from "@mui/material";

/**
 * Content-shaped placeholder for the Post Detail article while it loads.
 * Mirrors the article: a title, a metadata row, a lead media block, and body
 * paragraph lines.
 */
export function PostDetailSkeleton() {
    return (
        <Box
            role="status"
            aria-busy="true"
            aria-label="Loading article"
            data-testid="post-detail-skeleton"
        >
            <Skeleton variant="text" width="70%" height={48} sx={{ mb: 2 }} />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 3 }}>
                <Skeleton variant="text" width={120} />
                <Skeleton variant="text" width={100} />
                <Skeleton variant="text" width={80} />
            </Box>
            <Skeleton variant="rectangular" height={180} sx={{ mb: 3, borderRadius: 1 }} />
            {Array.from({ length: 8 }, (_, i) => (
                <Skeleton key={i} variant="text" width={i % 4 === 3 ? "60%" : "100%"} />
            ))}
        </Box>
    );
}

export default PostDetailSkeleton;
