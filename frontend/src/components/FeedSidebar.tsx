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
import InboxIcon from "@mui/icons-material/Inbox";
import { CategoryList } from "./CategoryList";
import type { Category, Feed } from "../types";
import type { ReadState } from "../hooks/usePostsData";

interface FeedSidebarProps {
  categories: Category[];
  feedsByCategory: Record<string, Feed[]>;
  loadingFeeds: Set<string>;
  onExpandCategory: (key: string) => void;
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
  unreadByCategory: Record<string, number>;
  uncategorizedUnread: number;

  // Filter callbacks
  onSelectAll: () => void;
  onSelectCategory: (categoryId: string | null) => void;
  onSelectFeed: (feedId: string) => void;
  onSelectUncategorized: () => void;
  onReadStateChange: (readState: ReadState) => void;
  onMarkCategoryRead: (categoryId: string, isRead: boolean) => void;
  onMarkUncategorizedRead: (isRead: boolean) => void;
  onMarkFeedRead: (feedId: string, isRead: boolean) => void;

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
  feedsByCategory,
  loadingFeeds,
  onExpandCategory,
  loading,
  error,
  selectedCategoryId,
  activeFeedId,
  readState,
  uncategorizedActive,
  totalUnread,
  unreadByFeed,
  unreadByCategory,
  uncategorizedUnread,
  onSelectAll,
  onSelectCategory,
  onSelectFeed,
  onSelectUncategorized,
  onReadStateChange,
  onMarkCategoryRead,
  onMarkUncategorizedRead,
  onMarkFeedRead,
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
          onChange={(_e, value: ReadState | null) => value && onReadStateChange(value)}
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
            <Chip label={totalUnread} size="small" color="primary" sx={{ height: 20 }} />
          )}
        </ListItemButton>
      </List>

      <Divider />

      {/* Categories & feeds tree (with inline management) */}
      <Box sx={{ flexGrow: 1, overflowY: "auto" }}>
        <CategoryList
          categories={categories}
          feedsByCategory={feedsByCategory}
          loadingFeeds={loadingFeeds}
          onExpandCategory={onExpandCategory}
          loading={loading}
          error={error}
          selectedCategoryId={selectedCategoryId}
          onSelectCategory={onSelectCategory}
          activeFeedId={activeFeedId}
          unreadByFeed={unreadByFeed}
          unreadByCategory={unreadByCategory}
          uncategorizedUnread={uncategorizedUnread}
          onSelectFeed={onSelectFeed}
          uncategorizedActive={uncategorizedActive}
          onSelectUncategorized={onSelectUncategorized}
          onMarkCategoryRead={onMarkCategoryRead}
          onMarkUncategorizedRead={onMarkUncategorizedRead}
          onMarkFeedRead={onMarkFeedRead}
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
