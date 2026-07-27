/**
 * FeedSidebar - navigation + filter sidebar for the reader.
 *
 * Combines the read-state filter, an "All items" scope, and the categories/feeds
 * tree (with inline management). Selecting a scope drives the post list filter.
 */

import {
    Box,
    List,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    Chip,
    ToggleButton,
    ToggleButtonGroup,
    Divider,
} from "@mui/material";
import { Inbox as InboxIcon } from "@mui/icons-material";
import { CategoryList } from "./CategoryList";
import type { Category, Feed } from "../types";
import type { ReadState } from "../hooks/usePostsData";

interface FeedSidebarProps {
    categories: Category[];
    feeds: Feed[];
    loading: boolean;
    error: string | null;

    // Active filter
    selectedCategoryId: string | null;
    activeFeedId: string | null;
    readState: ReadState;
    uncategorizedActive: boolean;

    // Unread counts
    totalUnread: number;
    unreadByFeed: Record<string, number>;

    // Filter callbacks
    onSelectAll: () => void;
    onSelectCategory: (categoryId: string | null) => void;
    onSelectFeed: (feedId: string) => void;
    onSelectUncategorized: () => void;
    onReadStateChange: (readState: ReadState) => void;

    // Management passthrough (to CategoryList / FeedList)
    onCreateCategory: (name: string) => Promise<Category>;
    onUpdateCategory: (id: string, name: string) => Promise<Category>;
    onDeleteCategory: (id: string) => Promise<void>;
    onAddFeed: (categoryId: string | null, url: string) => Promise<Feed>;
    onDeleteFeed: (feedId: string) => Promise<void>;
    onRefreshFeed: (feedId: string) => Promise<Feed>;
    onSetFeedCategories: (feedId: string, categoryIds: string[]) => Promise<Feed>;
    onSetFeedActive: (feedId: string, isActive: boolean) => Promise<Feed>;
}

export function FeedSidebar({
    categories,
    feeds,
    loading,
    error,
    selectedCategoryId,
    activeFeedId,
    readState,
    uncategorizedActive,
    totalUnread,
    unreadByFeed,
    onSelectAll,
    onSelectCategory,
    onSelectFeed,
    onSelectUncategorized,
    onReadStateChange,
    onCreateCategory,
    onUpdateCategory,
    onDeleteCategory,
    onAddFeed,
    onDeleteFeed,
    onRefreshFeed,
    onSetFeedCategories,
    onSetFeedActive,
}: FeedSidebarProps) {
    const isAllScope = !selectedCategoryId && !activeFeedId;

    return (
        <Box
            sx={{ display: "flex", flexDirection: "column", height: "100%" }}
            data-testid="feed-sidebar"
        >
            {/* Read-state filter */}
            <Box sx={{ p: 2, pb: 1 }}>
                <ToggleButtonGroup
                    value={readState}
                    exclusive
                    size="small"
                    fullWidth
                    onChange={(_e, value: ReadState | null) =>
                        value && onReadStateChange(value)
                    }
                    aria-label="read state filter"
                >
                    <ToggleButton value="all">All</ToggleButton>
                    <ToggleButton value="unread">Unread</ToggleButton>
                    <ToggleButton value="read">Read</ToggleButton>
                </ToggleButtonGroup>
            </Box>

            {/* All items scope */}
            <List sx={{ py: 0 }}>
                <ListItemButton selected={isAllScope} onClick={onSelectAll}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                        <InboxIcon />
                    </ListItemIcon>
                    <ListItemText primary="All items" />
                    {totalUnread > 0 && (
                        <Chip
                            label={totalUnread}
                            size="small"
                            color="primary"
                            sx={{ height: 20 }}
                        />
                    )}
                </ListItemButton>
            </List>

            <Divider />

            {/* Categories & feeds tree (with inline management) */}
            <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
                <CategoryList
                    categories={categories}
                    feeds={feeds}
                    loading={loading}
                    error={error}
                    selectedCategoryId={selectedCategoryId}
                    onSelectCategory={onSelectCategory}
                    activeFeedId={activeFeedId}
                    unreadByFeed={unreadByFeed}
                    onSelectFeed={onSelectFeed}
                    uncategorizedActive={uncategorizedActive}
                    onSelectUncategorized={onSelectUncategorized}
                    onCreateCategory={onCreateCategory}
                    onUpdateCategory={onUpdateCategory}
                    onDeleteCategory={onDeleteCategory}
                    onAddFeed={onAddFeed}
                    onDeleteFeed={onDeleteFeed}
                    onRefreshFeed={onRefreshFeed}
                    onSetFeedCategories={onSetFeedCategories}
                    onSetFeedActive={onSetFeedActive}
                />
            </Box>
        </Box>
    );
}

export default FeedSidebar;
