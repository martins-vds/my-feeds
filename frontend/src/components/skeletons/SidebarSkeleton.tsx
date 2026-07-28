import {
    List,
    ListItem,
    ListItemIcon,
    ListItemText,
    Skeleton,
} from "@mui/material";

interface SidebarSkeletonProps {
    /** Number of placeholder category rows. */
    count?: number;
}

/**
 * Content-shaped placeholder for the sidebar category tree while it loads.
 * Mirrors a category row: a folder icon, a name line, and a "N feeds" line.
 */
export function SidebarSkeleton({ count = 4 }: SidebarSkeletonProps) {
    return (
        <List
            role="status"
            aria-busy="true"
            aria-label="Loading feeds"
            data-testid="sidebar-skeleton"
            sx={{ py: 0 }}
        >
            {Array.from({ length: count }, (_, i) => (
                <ListItem key={i} sx={{ py: 1 }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                        <Skeleton variant="circular" width={24} height={24} />
                    </ListItemIcon>
                    <ListItemText
                        primary={<Skeleton variant="text" width="60%" />}
                        secondary={<Skeleton variant="text" width="30%" />}
                    />
                </ListItem>
            ))}
        </List>
    );
}

export default SidebarSkeleton;
