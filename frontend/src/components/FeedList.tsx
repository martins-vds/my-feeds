/**
 * FeedList component - displays feeds within a category
 */

import { useState, useCallback } from "react";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Typography,
  Avatar,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Checkbox,
  FormGroup,
  FormControlLabel,
  Alert,
  CircularProgress,
  Tooltip,
  Chip,
  Divider,
} from "@mui/material";
import RssFeedIcon from "@mui/icons-material/RssFeed";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import CategoriesIcon from "@mui/icons-material/LocalOffer";
import AddIcon from "@mui/icons-material/Add";
import ErrorIcon from "@mui/icons-material/Error";
import PauseIcon from "@mui/icons-material/Pause";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import MarkReadIcon from "@mui/icons-material/DoneAll";
import MarkUnreadIcon from "@mui/icons-material/RemoveDone";
import type { Category, Feed } from "../types";
import { ApiError } from "../services/api";

interface FeedListProps {
  feeds: Feed[];
  categories: Category[];
  onDeleteFeed: (feedId: string) => Promise<void>;
  onRefreshFeed: (feedId: string) => Promise<Feed>;
  onSetFeedCategories: (feedId: string, categoryIds: string[]) => Promise<Feed>;
  onSetFeedActive: (feedId: string, isActive: boolean) => Promise<Feed>;
  onAddFeed: () => void;
  activeFeedId?: string | null;
  unreadByFeed?: Record<string, number>;
  onSelectFeed?: (feedId: string) => void;
  onMarkFeedRead?: (feedId: string, isRead: boolean) => void;
}

export function FeedList({
  feeds,
  categories,
  onDeleteFeed,
  onRefreshFeed,
  onSetFeedCategories,
  onSetFeedActive,
  onAddFeed,
  activeFeedId = null,
  unreadByFeed,
  onSelectFeed,
  onMarkFeedRead,
}: FeedListProps) {
  // Local state
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(null);

  // Get the selected feed
  const selectedFeed = selectedFeedId ? feeds.find((f) => f.id === selectedFeedId) : null;

  // Menu handlers
  const handleMenuOpen = useCallback((event: React.MouseEvent<HTMLElement>, feedId: string) => {
    event.stopPropagation();
    setMenuAnchor(event.currentTarget);
    setSelectedFeedId(feedId);
    setActionError(null);
  }, []);

  const handleMenuClose = useCallback(() => {
    setMenuAnchor(null);
    setSelectedFeedId(null);
  }, []);

  // Refresh handler
  const handleRefresh = useCallback(async () => {
    if (!selectedFeedId) return;
    const feedId = selectedFeedId;
    handleMenuClose();
    setRefreshingFeedId(feedId);
    try {
      await onRefreshFeed(feedId);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to refresh feed";
      setActionError(message);
    } finally {
      setRefreshingFeedId(null);
    }
  }, [selectedFeedId, handleMenuClose, onRefreshFeed]);

  // Pause/resume handler
  const handleToggleActive = useCallback(async () => {
    if (!selectedFeedId) return;
    const feed = feeds.find((f) => f.id === selectedFeedId);
    if (!feed) return;
    const feedId = selectedFeedId;
    const nextActive = !feed.isActive;
    handleMenuClose();
    try {
      await onSetFeedActive(feedId, nextActive);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to update feed";
      setActionError(message);
    }
  }, [selectedFeedId, feeds, handleMenuClose, onSetFeedActive]);

  // Mark every post in the feed read/unread
  const handleMarkRead = useCallback(
    (isRead: boolean) => {
      if (!selectedFeedId) return;
      const feedId = selectedFeedId;
      handleMenuClose();
      onMarkFeedRead?.(feedId, isRead);
    },
    [selectedFeedId, handleMenuClose, onMarkFeedRead]
  );

  // Delete handlers
  const handleDeleteClick = useCallback(() => {
    setShowDeleteConfirm(true);
    setMenuAnchor(null); // Close menu but keep selectedFeedId
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (!selectedFeedId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await onDeleteFeed(selectedFeedId);
      setShowDeleteConfirm(false);
      setSelectedFeedId(null);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to delete feed";
      setActionError(message);
    } finally {
      setActionLoading(false);
    }
  }, [selectedFeedId, onDeleteFeed]);

  const handleDeleteCancel = useCallback(() => {
    setShowDeleteConfirm(false);
    setSelectedFeedId(null);
    setActionError(null);
  }, []);

  // Edit-categories handlers
  const handleEditCategoriesClick = useCallback(() => {
    const feed = selectedFeedId ? feeds.find((f) => f.id === selectedFeedId) : null;
    setSelectedCategoryIds(feed ? [...feed.categoryIds] : []);
    setShowEditDialog(true);
    setMenuAnchor(null); // Close menu but keep selectedFeedId
  }, [selectedFeedId, feeds]);

  const toggleCategory = useCallback((id: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }, []);

  const handleEditConfirm = useCallback(async () => {
    if (!selectedFeedId) return;
    setActionLoading(true);
    setActionError(null);
    try {
      await onSetFeedCategories(selectedFeedId, selectedCategoryIds);
      setShowEditDialog(false);
      setSelectedFeedId(null);
      setSelectedCategoryIds([]);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Failed to update categories";
      setActionError(message);
    } finally {
      setActionLoading(false);
    }
  }, [selectedFeedId, selectedCategoryIds, onSetFeedCategories]);

  const handleEditCancel = useCallback(() => {
    setShowEditDialog(false);
    setSelectedFeedId(null);
    setSelectedCategoryIds([]);
    setActionError(null);
  }, []);

  // Empty state
  if (feeds.length === 0) {
    return (
      <Box sx={{ pl: 9, pr: 2, py: 2 }}>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
          }}
        >
          No feeds in this category
        </Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={onAddFeed} sx={{ mt: 1 }}>
          Add Feed
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={{ pl: 4 }}>
      {/* Action error */}
      {actionError && !showDeleteConfirm && !showEditDialog && (
        <Alert severity="error" sx={{ mx: 2, my: 1 }}>
          {actionError}
        </Alert>
      )}

      {/* Feed list */}
      <List dense disablePadding>
        {feeds.map((feed) => {
          const isRefreshing = refreshingFeedId === feed.id;
          const hasError = feed.fetchErrorCount > 0;
          const isPaused = !feed.isActive;
          const unreadCount = unreadByFeed?.[feed.id] ?? 0;

          return (
            <ListItem key={feed.id} disablePadding>
              <ListItemButton
                disabled={isRefreshing}
                selected={activeFeedId === feed.id}
                onClick={onSelectFeed ? () => onSelectFeed(feed.id) : undefined}
                sx={{ opacity: isPaused ? 0.6 : 1, pr: 6 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {feed.iconUrl ? (
                    <Avatar
                      src={feed.iconUrl}
                      alt={feed.title || "Feed"}
                      sx={{ width: 24, height: 24 }}
                    />
                  ) : (
                    <RssFeedIcon fontSize="small" />
                  )}
                </ListItemIcon>
                <ListItemText
                  sx={{ minWidth: 0 }}
                  slotProps={{
                    primary: {
                      component: "div",
                      sx: {
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                        minWidth: 0,
                      },
                    },
                    secondary: { noWrap: true },
                  }}
                  primary={
                    <>
                      <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                        {feed.title || feed.url}
                      </Typography>
                      {hasError && (
                        <Tooltip title={`${feed.fetchErrorCount} fetch error(s)`}>
                          <Chip
                            icon={<ErrorIcon fontSize="small" />}
                            label={feed.fetchErrorCount}
                            size="small"
                            color="error"
                            variant="outlined"
                            sx={{ flexShrink: 0 }}
                          />
                        </Tooltip>
                      )}
                      {isPaused && (
                        <Tooltip title="Paused — not auto-refreshed">
                          <Chip
                            icon={<PauseIcon fontSize="small" />}
                            label="Paused"
                            size="small"
                            variant="outlined"
                            sx={{ flexShrink: 0 }}
                          />
                        </Tooltip>
                      )}
                      {unreadCount > 0 && (
                        <Chip
                          label={unreadCount}
                          size="small"
                          color="primary"
                          sx={{ height: 20, flexShrink: 0 }}
                        />
                      )}
                    </>
                  }
                  secondary={feed.title ? new URL(feed.url).hostname : undefined}
                />
              </ListItemButton>
              <ListItemSecondaryAction>
                {isRefreshing ? (
                  <CircularProgress size={20} />
                ) : (
                  <IconButton
                    edge="end"
                    onClick={(e) => handleMenuOpen(e, feed.id)}
                    aria-label="feed options"
                  >
                    <MoreVertIcon />
                  </IconButton>
                )}
              </ListItemSecondaryAction>
            </ListItem>
          );
        })}
      </List>

      {/* Context menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={handleMenuClose}>
        <MenuItem onClick={() => handleMarkRead(true)}>
          <ListItemIcon>
            <MarkReadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Mark all as read</ListItemText>
        </MenuItem>
        <MenuItem onClick={() => handleMarkRead(false)}>
          <ListItemIcon>
            <MarkUnreadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Mark all as unread</ListItemText>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleRefresh} disabled={selectedFeed ? !selectedFeed.isActive : false}>
          <ListItemIcon>
            <RefreshIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Refresh</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleToggleActive}>
          <ListItemIcon>
            {selectedFeed?.isActive ? (
              <PauseIcon fontSize="small" />
            ) : (
              <PlayArrowIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText>{selectedFeed?.isActive ? "Pause" : "Resume"}</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleEditCategoriesClick}>
          <ListItemIcon>
            <CategoriesIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Edit categories</ListItemText>
        </MenuItem>
        <MenuItem onClick={handleDeleteClick}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" color="error" />
          </ListItemIcon>
          <ListItemText sx={{ color: "error.main" }}>Delete</ListItemText>
        </MenuItem>
      </Menu>

      {/* Delete confirmation dialog */}
      <Dialog open={showDeleteConfirm} onClose={handleDeleteCancel}>
        <DialogTitle>Delete Feed?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete "{selectedFeed?.title || selectedFeed?.url}"? This will
            also delete all posts from this feed.
          </Typography>
          {actionError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {actionError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={actionLoading}>
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
            disabled={actionLoading}
          >
            {actionLoading ? <CircularProgress size={24} /> : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit categories dialog */}
      <Dialog open={showEditDialog} onClose={handleEditCancel} maxWidth="sm" fullWidth>
        <DialogTitle>Edit categories</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2 }}>
            Choose the categories for "{selectedFeed?.title || selectedFeed?.url}". A feed can
            belong to any number of categories, or none.
          </Typography>
          {categories.length === 0 ? (
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
              }}
            >
              No categories yet. Create one first.
            </Typography>
          ) : (
            <FormGroup>
              {categories.map((category) => (
                <FormControlLabel
                  key={category.id}
                  control={
                    <Checkbox
                      checked={selectedCategoryIds.includes(category.id)}
                      onChange={() => toggleCategory(category.id)}
                    />
                  }
                  label={category.name}
                />
              ))}
            </FormGroup>
          )}
          {actionError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {actionError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleEditCancel} disabled={actionLoading}>
            Cancel
          </Button>
          <Button onClick={handleEditConfirm} variant="contained" disabled={actionLoading}>
            {actionLoading ? <CircularProgress size={24} /> : "Save"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default FeedList;
