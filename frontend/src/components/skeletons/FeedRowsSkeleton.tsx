import { Box, List, ListItem, ListItemIcon, ListItemText, Skeleton } from "@mui/material";

interface FeedRowsSkeletonProps {
    /** Number of placeholder feed rows. */
    count?: number;
}

/**
 * Content-shaped placeholder rendered beneath a category while its feeds load.
 * Mirrors a FeedList row: a small feed icon and a feed-title line, indented to
 * match the real nested rows.
 */
export function FeedRowsSkeleton({ count = 3 }: FeedRowsSkeletonProps) {
    return (
        <Box
            role="status"
            aria-busy="true"
            aria-label="Loading feeds"
            data-testid="feed-rows-skeleton"
        >
            <List disablePadding sx={{ pl: 4 }}>
                {Array.from({ length: count }, (_, i) => (
                    <ListItem key={i} sx={{ py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                            <Skeleton variant="circular" width={20} height={20} />
                        </ListItemIcon>
                        <ListItemText primary={<Skeleton variant="text" width="70%" />} />
                    </ListItem>
                ))}
            </List>
        </Box>
    );
}

export default FeedRowsSkeleton;
