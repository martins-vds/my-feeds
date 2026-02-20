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
    Select,
    FormControl,
    InputLabel,
    Alert,
    CircularProgress,
    Tooltip,
    Chip,
} from "@mui/material";
import {
    RssFeed as RssFeedIcon,
    MoreVert as MoreVertIcon,
    Delete as DeleteIcon,
    Refresh as RefreshIcon,
    DriveFileMove as MoveIcon,
    Add as AddIcon,
    Error as ErrorIcon,
} from "@mui/icons-material";
import type { Category, Feed } from "../types";
import { ApiError } from "../services/api";

interface FeedListProps {
    feeds: Feed[];
    categoryId: string;
    categories: Category[];
    onDeleteFeed: (feedId: string) => Promise<void>;
    onRefreshFeed: (feedId: string) => Promise<Feed>;
    onMoveFeed: (feedId: string, categoryId: string) => Promise<Feed>;
    onAddFeed: () => void;
}

export function FeedList({
    feeds,
    categoryId,
    categories,
    onDeleteFeed,
    onRefreshFeed,
    onMoveFeed,
    onAddFeed,
}: FeedListProps) {
    // Local state
    const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
    const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [showMoveDialog, setShowMoveDialog] = useState(false);
    const [moveTargetCategory, setMoveTargetCategory] = useState<string>("");
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [refreshingFeedId, setRefreshingFeedId] = useState<string | null>(
        null
    );

    // Get the selected feed
    const selectedFeed = selectedFeedId
        ? feeds.find((f) => f.id === selectedFeedId)
        : null;

    // Menu handlers
    const handleMenuOpen = useCallback(
        (event: React.MouseEvent<HTMLElement>, feedId: string) => {
            event.stopPropagation();
            setMenuAnchor(event.currentTarget);
            setSelectedFeedId(feedId);
            setActionError(null);
        },
        []
    );

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
            const message =
                err instanceof ApiError
                    ? err.message
                    : "Failed to refresh feed";
            setActionError(message);
        } finally {
            setRefreshingFeedId(null);
        }
    }, [selectedFeedId, handleMenuClose, onRefreshFeed]);

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
            const message =
                err instanceof ApiError
                    ? err.message
                    : "Failed to delete feed";
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

    // Move handlers
    const handleMoveClick = useCallback(() => {
        setMoveTargetCategory("");
        setShowMoveDialog(true);
        setMenuAnchor(null); // Close menu but keep selectedFeedId
    }, []);

    const handleMoveConfirm = useCallback(async () => {
        if (!selectedFeedId || !moveTargetCategory) return;
        setActionLoading(true);
        setActionError(null);
        try {
            await onMoveFeed(selectedFeedId, moveTargetCategory);
            setShowMoveDialog(false);
            setSelectedFeedId(null);
            setMoveTargetCategory("");
        } catch (err) {
            const message =
                err instanceof ApiError ? err.message : "Failed to move feed";
            setActionError(message);
        } finally {
            setActionLoading(false);
        }
    }, [selectedFeedId, moveTargetCategory, onMoveFeed]);

    const handleMoveCancel = useCallback(() => {
        setShowMoveDialog(false);
        setSelectedFeedId(null);
        setMoveTargetCategory("");
        setActionError(null);
    }, []);

    // Get other categories (for move dialog)
    const otherCategories = categories.filter((c) => c.id !== categoryId);

    // Empty state
    if (feeds.length === 0) {
        return (
            <Box sx={{ pl: 9, pr: 2, py: 2 }}>
                <Typography color="text.secondary" variant="body2">
                    No feeds in this category
                </Typography>
                <Button
                    size="small"
                    startIcon={<AddIcon />}
                    onClick={onAddFeed}
                    sx={{ mt: 1 }}
                >
                    Add Feed
                </Button>
            </Box>
        );
    }

    return (
        <Box sx={{ pl: 4 }}>
            {/* Action error */}
            {actionError && !showDeleteConfirm && !showMoveDialog && (
                <Alert severity="error" sx={{ mx: 2, my: 1 }}>
                    {actionError}
                </Alert>
            )}

            {/* Feed list */}
            <List dense disablePadding>
                {feeds.map((feed) => {
                    const isRefreshing = refreshingFeedId === feed.id;
                    const hasError = feed.fetchErrorCount > 0;

                    return (
                        <ListItem key={feed.id} disablePadding>
                            <ListItemButton disabled={isRefreshing}>
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
                                    primary={
                                        <Box
                                            sx={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 1,
                                            }}
                                        >
                                            <Typography
                                                variant="body2"
                                                noWrap
                                                sx={{ flexGrow: 1 }}
                                            >
                                                {feed.title || feed.url}
                                            </Typography>
                                            {hasError && (
                                                <Tooltip
                                                    title={`${feed.fetchErrorCount} fetch error(s)`}
                                                >
                                                    <Chip
                                                        icon={
                                                            <ErrorIcon fontSize="small" />
                                                        }
                                                        label={
                                                            feed.fetchErrorCount
                                                        }
                                                        size="small"
                                                        color="error"
                                                        variant="outlined"
                                                    />
                                                </Tooltip>
                                            )}
                                        </Box>
                                    }
                                    secondary={
                                        feed.title
                                            ? new URL(feed.url).hostname
                                            : undefined
                                    }
                                />
                            </ListItemButton>
                            <ListItemSecondaryAction>
                                {isRefreshing ? (
                                    <CircularProgress size={20} />
                                ) : (
                                    <IconButton
                                        edge="end"
                                        onClick={(e) =>
                                            handleMenuOpen(e, feed.id)
                                        }
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
            <Menu
                anchorEl={menuAnchor}
                open={Boolean(menuAnchor)}
                onClose={handleMenuClose}
            >
                <MenuItem onClick={handleRefresh}>
                    <ListItemIcon>
                        <RefreshIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Refresh</ListItemText>
                </MenuItem>
                {otherCategories.length > 0 && (
                    <MenuItem onClick={handleMoveClick}>
                        <ListItemIcon>
                            <MoveIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText>Move to...</ListItemText>
                    </MenuItem>
                )}
                <MenuItem onClick={handleDeleteClick}>
                    <ListItemIcon>
                        <DeleteIcon fontSize="small" color="error" />
                    </ListItemIcon>
                    <ListItemText sx={{ color: "error.main" }}>
                        Delete
                    </ListItemText>
                </MenuItem>
            </Menu>

            {/* Delete confirmation dialog */}
            <Dialog open={showDeleteConfirm} onClose={handleDeleteCancel}>
                <DialogTitle>Delete Feed?</DialogTitle>
                <DialogContent>
                    <Typography>
                        Are you sure you want to delete "
                        {selectedFeed?.title || selectedFeed?.url}"? This will
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
                        {actionLoading ? (
                            <CircularProgress size={24} />
                        ) : (
                            "Delete"
                        )}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Move dialog */}
            <Dialog
                open={showMoveDialog}
                onClose={handleMoveCancel}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle>Move Feed</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 2 }}>
                        Move "{selectedFeed?.title || selectedFeed?.url}" to
                        another category:
                    </Typography>
                    <FormControl fullWidth>
                        <InputLabel>Target Category</InputLabel>
                        <Select
                            value={moveTargetCategory}
                            onChange={(e) =>
                                setMoveTargetCategory(e.target.value)
                            }
                            label="Target Category"
                        >
                            {otherCategories.map((category) => (
                                <MenuItem
                                    key={category.id}
                                    value={category.id}
                                >
                                    {category.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {actionError && (
                        <Alert severity="error" sx={{ mt: 2 }}>
                            {actionError}
                        </Alert>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleMoveCancel} disabled={actionLoading}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleMoveConfirm}
                        variant="contained"
                        disabled={actionLoading || !moveTargetCategory}
                    >
                        {actionLoading ? (
                            <CircularProgress size={24} />
                        ) : (
                            "Move"
                        )}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
}

export default FeedList;
