/**
 * CategoryList component - displays list of categories with management actions
 */

import { useState, useCallback } from "react";
import {
    Box,
    List,
    ListItem,
    ListItemButton,
    ListItemIcon,
    ListItemText,
    IconButton,
    Typography,
    CircularProgress,
    Alert,
    Collapse,
    Tooltip,
    Menu,
    MenuItem,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Chip,
} from "@mui/material";
import {
    Folder as FolderIcon,
    FolderOpen as FolderOpenIcon,
    Add as AddIcon,
    MoreVert as MoreVertIcon,
    Edit as EditIcon,
    Delete as DeleteIcon,
    ExpandMore as ExpandMoreIcon,
    ChevronRight as ChevronRightIcon,
    RssFeed as RssFeedIcon,
} from "@mui/icons-material";
import type { Category, Feed } from "../types";
import { CategoryForm } from "./CategoryForm";
import { FeedList } from "./FeedList";
import { AddFeedDialog } from "./AddFeedDialog";
import { ApiError } from "../services/api";

// Sentinel key for the pseudo-group that holds feeds with no categories.
const UNCATEGORIZED_KEY = "__uncategorized__";

interface CategoryListProps {
    categories: Category[];
    feeds: Feed[];
    loading: boolean;
    error: string | null;
    selectedCategoryId: string | null;
    onSelectCategory: (categoryId: string | null) => void;
    onCreateCategory: (name: string) => Promise<Category>;
    onUpdateCategory: (id: string, name: string) => Promise<Category>;
    onDeleteCategory: (id: string) => Promise<void>;
    onAddFeed: (categoryId: string | null, url: string) => Promise<Feed>;
    onDeleteFeed: (feedId: string) => Promise<void>;
    onRefreshFeed: (feedId: string) => Promise<Feed>;
    onSetFeedCategories: (feedId: string, categoryIds: string[]) => Promise<Feed>;
    onSetFeedActive: (feedId: string, isActive: boolean) => Promise<Feed>;
    activeFeedId?: string | null;
    unreadByFeed?: Record<string, number>;
    onSelectFeed?: (feedId: string) => void;
    uncategorizedActive?: boolean;
    onSelectUncategorized?: () => void;
}

export function CategoryList({
    categories,
    feeds,
    loading,
    error,
    selectedCategoryId,
    onSelectCategory,
    onCreateCategory,
    onUpdateCategory,
    onDeleteCategory,
    onAddFeed,
    onDeleteFeed,
    onRefreshFeed,
    onSetFeedCategories,
    onSetFeedActive,
    activeFeedId = null,
    unreadByFeed,
    onSelectFeed,
    uncategorizedActive = false,
    onSelectUncategorized,
}: CategoryListProps) {
    // Local state
    const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
        new Set()
    );
    const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
    const [menuCategoryId, setMenuCategoryId] = useState<string | null>(null);
    const [showCategoryForm, setShowCategoryForm] = useState(false);
    const [editingCategory, setEditingCategory] = useState<Category | null>(
        null
    );
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(
        null
    );
    const [showAddFeedDialog, setShowAddFeedDialog] = useState(false);
    const [addFeedCategoryId, setAddFeedCategoryId] = useState<string | null>(
        null
    );
    const [actionError, setActionError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

    // Toggle category expansion
    const toggleExpand = useCallback((categoryId: string) => {
        setExpandedCategories((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(categoryId)) {
                newSet.delete(categoryId);
            } else {
                newSet.add(categoryId);
            }
            return newSet;
        });
    }, []);

    // Handle category click
    const handleCategoryClick = useCallback(
        (categoryId: string) => {
            toggleExpand(categoryId);
            onSelectCategory(categoryId);
        },
        [toggleExpand, onSelectCategory]
    );

    // Menu handlers
    const handleMenuOpen = useCallback(
        (event: React.MouseEvent<HTMLElement>, categoryId: string) => {
            event.stopPropagation();
            setMenuAnchor(event.currentTarget);
            setMenuCategoryId(categoryId);
        },
        []
    );

    const handleMenuClose = useCallback(() => {
        setMenuAnchor(null);
        setMenuCategoryId(null);
    }, []);

    // Category form handlers
    const handleAddCategory = useCallback(() => {
        setEditingCategory(null);
        setShowCategoryForm(true);
        setActionError(null);
    }, []);

    const handleEditCategory = useCallback(() => {
        const category = categories.find((c) => c.id === menuCategoryId);
        if (category) {
            setEditingCategory(category);
            setShowCategoryForm(true);
            setActionError(null);
        }
        handleMenuClose();
    }, [categories, menuCategoryId, handleMenuClose]);

    const handleCategoryFormSubmit = useCallback(
        async (name: string) => {
            setActionLoading(true);
            setActionError(null);
            try {
                if (editingCategory) {
                    await onUpdateCategory(editingCategory.id, name);
                } else {
                    await onCreateCategory(name);
                }
                setShowCategoryForm(false);
                setEditingCategory(null);
            } catch (err) {
                const message =
                    err instanceof ApiError
                        ? err.message
                        : "Failed to save category";
                setActionError(message);
                throw err; // Re-throw to let form handle it
            } finally {
                setActionLoading(false);
            }
        },
        [editingCategory, onCreateCategory, onUpdateCategory]
    );

    const handleCategoryFormCancel = useCallback(() => {
        setShowCategoryForm(false);
        setEditingCategory(null);
        setActionError(null);
    }, []);

    // Delete handlers
    const handleDeleteClick = useCallback(() => {
        setDeletingCategoryId(menuCategoryId);
        setShowDeleteConfirm(true);
        handleMenuClose();
    }, [menuCategoryId, handleMenuClose]);

    const handleDeleteConfirm = useCallback(async () => {
        if (!deletingCategoryId) return;
        setActionLoading(true);
        setActionError(null);
        try {
            await onDeleteCategory(deletingCategoryId);
            setShowDeleteConfirm(false);
            setDeletingCategoryId(null);
        } catch (err) {
            const message =
                err instanceof ApiError
                    ? err.message
                    : "Failed to delete category";
            setActionError(message);
        } finally {
            setActionLoading(false);
        }
    }, [deletingCategoryId, onDeleteCategory]);

    const handleDeleteCancel = useCallback(() => {
        setShowDeleteConfirm(false);
        setDeletingCategoryId(null);
        setActionError(null);
    }, []);

    // Add feed handlers
    const handleAddFeedClick = useCallback(() => {
        setAddFeedCategoryId(menuCategoryId);
        setShowAddFeedDialog(true);
        handleMenuClose();
    }, [menuCategoryId, handleMenuClose]);

    // Add a feed from the top level (no category required)
    const handleAddFeedTopLevel = useCallback(() => {
        setAddFeedCategoryId(null);
        setShowAddFeedDialog(true);
        setActionError(null);
    }, []);

    const handleAddFeedSubmit = useCallback(
        async (url: string) => {
            setActionLoading(true);
            setActionError(null);
            try {
                await onAddFeed(addFeedCategoryId, url);
                setShowAddFeedDialog(false);
                // Auto-expand the target group (a category or "Uncategorized")
                const expandKey = addFeedCategoryId ?? UNCATEGORIZED_KEY;
                setExpandedCategories((prev) => {
                    const newSet = new Set(prev);
                    newSet.add(expandKey);
                    return newSet;
                });
                setAddFeedCategoryId(null);
            } catch (err) {
                const message =
                    err instanceof ApiError
                        ? err.message
                        : "Failed to add feed";
                setActionError(message);
                throw err;
            } finally {
                setActionLoading(false);
            }
        },
        [addFeedCategoryId, onAddFeed]
    );

    const handleAddFeedCancel = useCallback(() => {
        setShowAddFeedDialog(false);
        setAddFeedCategoryId(null);
        setActionError(null);
    }, []);

    // Get feeds for a category (a feed can belong to several)
    const getFeedsForCategory = useCallback(
        (categoryId: string): Feed[] => {
            return feeds.filter((feed) => feed.categoryIds.includes(categoryId));
        },
        [feeds]
    );

    // Feeds that carry no category at all
    const uncategorizedFeeds = feeds.filter(
        (feed) => feed.categoryIds.length === 0
    );
    const uncategorizedUnread = uncategorizedFeeds.reduce(
        (n, f) => n + (unreadByFeed?.[f.id] ?? 0),
        0
    );

    // Get the category being deleted
    const deletingCategory = deletingCategoryId
        ? categories.find((c) => c.id === deletingCategoryId)
        : null;

    // Loading state
    if (loading) {
        return (
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    p: 4,
                }}
            >
                <CircularProgress />
            </Box>
        );
    }

    // Error state
    if (error) {
        return (
            <Alert severity="error" sx={{ m: 2 }}>
                {error}
            </Alert>
        );
    }

    const isEmpty = categories.length === 0 && uncategorizedFeeds.length === 0;

    return (
        <Box>
            {/* Header with add actions */}
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    p: 2,
                    borderBottom: 1,
                    borderColor: "divider",
                }}
            >
                <Typography variant="h6">Feeds &amp; Categories</Typography>
                <Box sx={{ display: "flex", gap: 0.5 }}>
                    <Tooltip title="Add feed">
                        <IconButton
                            onClick={handleAddFeedTopLevel}
                            color="primary"
                            aria-label="add feed"
                        >
                            <RssFeedIcon />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title="Add category">
                        <IconButton
                            onClick={handleAddCategory}
                            color="primary"
                            aria-label="add category"
                        >
                            <AddIcon />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            {/* Action error */}
            {actionError && !showCategoryForm && !showDeleteConfirm && (
                <Alert severity="error" sx={{ m: 1 }}>
                    {actionError}
                </Alert>
            )}

            {/* Category list */}
            <List sx={{ py: 0 }}>
                {isEmpty && (
                    <Box sx={{ p: 3, textAlign: "center" }}>
                        <Typography color="text.secondary" sx={{ mb: 2 }}>
                            No feeds yet. Add a feed to get started &mdash;
                            categories are optional.
                        </Typography>
                        <Button
                            variant="contained"
                            startIcon={<RssFeedIcon />}
                            onClick={handleAddFeedTopLevel}
                        >
                            Add Feed
                        </Button>
                    </Box>
                )}
                {categories.map((category) => {
                    const isExpanded = expandedCategories.has(category.id);
                    const isSelected = selectedCategoryId === category.id;
                    const categoryFeeds = getFeedsForCategory(category.id);
                    const categoryUnread = categoryFeeds.reduce(
                        (n, f) => n + (unreadByFeed?.[f.id] ?? 0),
                        0
                    );

                    return (
                        <Box key={category.id}>
                            <ListItem
                                disablePadding
                                secondaryAction={
                                    <IconButton
                                        edge="end"
                                        onClick={(e) =>
                                            handleMenuOpen(e, category.id)
                                        }
                                        aria-label="category options"
                                    >
                                        <MoreVertIcon />
                                    </IconButton>
                                }
                            >
                                <ListItemButton
                                    selected={isSelected}
                                    onClick={() =>
                                        handleCategoryClick(category.id)
                                    }
                                >
                                    <ListItemIcon sx={{ minWidth: 36 }}>
                                        {isExpanded ? (
                                            <ExpandMoreIcon />
                                        ) : (
                                            <ChevronRightIcon />
                                        )}
                                    </ListItemIcon>
                                    <ListItemIcon sx={{ minWidth: 36 }}>
                                        {isExpanded ? (
                                            <FolderOpenIcon color="primary" />
                                        ) : (
                                            <FolderIcon />
                                        )}
                                    </ListItemIcon>
                                    <ListItemText
                                        primary={category.name}
                                        secondary={`${category.feedCount} feed${category.feedCount !== 1 ? "s" : ""}`}
                                    />
                                    {categoryUnread > 0 && (
                                        <Chip
                                            label={categoryUnread}
                                            size="small"
                                            color="primary"
                                            sx={{ mr: 1, height: 20 }}
                                        />
                                    )}
                                </ListItemButton>
                            </ListItem>

                            {/* Nested feeds */}
                            <Collapse
                                in={isExpanded}
                                timeout="auto"
                                unmountOnExit
                            >
                                <FeedList
                                    feeds={categoryFeeds}
                                    categories={categories}
                                    onDeleteFeed={onDeleteFeed}
                                    onRefreshFeed={onRefreshFeed}
                                    onSetFeedCategories={onSetFeedCategories}
                                    onSetFeedActive={onSetFeedActive}
                                    activeFeedId={activeFeedId}
                                    unreadByFeed={unreadByFeed}
                                    onSelectFeed={onSelectFeed}
                                    onAddFeed={() => {
                                        setAddFeedCategoryId(category.id);
                                        setShowAddFeedDialog(true);
                                    }}
                                />
                            </Collapse>
                        </Box>
                    );
                })}

                {/* Uncategorized group */}
                {uncategorizedFeeds.length > 0 && (
                    <Box>
                        <ListItem disablePadding>
                            <ListItemButton
                                selected={uncategorizedActive}
                                onClick={() => {
                                    onSelectUncategorized?.();
                                    toggleExpand(UNCATEGORIZED_KEY);
                                }}
                            >
                                <ListItemIcon sx={{ minWidth: 36 }}>
                                    {expandedCategories.has(UNCATEGORIZED_KEY) ? (
                                        <ExpandMoreIcon />
                                    ) : (
                                        <ChevronRightIcon />
                                    )}
                                </ListItemIcon>
                                <ListItemIcon sx={{ minWidth: 36 }}>
                                    <FolderIcon />
                                </ListItemIcon>
                                <ListItemText
                                    primary="Uncategorized"
                                    secondary={`${uncategorizedFeeds.length} feed${uncategorizedFeeds.length !== 1 ? "s" : ""}`}
                                />
                                {uncategorizedUnread > 0 && (
                                    <Chip
                                        label={uncategorizedUnread}
                                        size="small"
                                        color="primary"
                                        sx={{ mr: 1, height: 20 }}
                                    />
                                )}
                            </ListItemButton>
                        </ListItem>
                        <Collapse
                            in={expandedCategories.has(UNCATEGORIZED_KEY)}
                            timeout="auto"
                            unmountOnExit
                        >
                            <FeedList
                                feeds={uncategorizedFeeds}
                                categories={categories}
                                onDeleteFeed={onDeleteFeed}
                                onRefreshFeed={onRefreshFeed}
                                onSetFeedCategories={onSetFeedCategories}
                                onSetFeedActive={onSetFeedActive}
                                activeFeedId={activeFeedId}
                                unreadByFeed={unreadByFeed}
                                onSelectFeed={onSelectFeed}
                                onAddFeed={() => {
                                    setAddFeedCategoryId(null);
                                    setShowAddFeedDialog(true);
                                }}
                            />
                        </Collapse>
                    </Box>
                )}
            </List>

            {/* Context menu */}
            <Menu
                anchorEl={menuAnchor}
                open={Boolean(menuAnchor)}
                onClose={handleMenuClose}
            >
                <MenuItem onClick={handleAddFeedClick}>
                    <ListItemIcon>
                        <AddIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Add Feed</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleEditCategory}>
                    <ListItemIcon>
                        <EditIcon fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Edit Category</ListItemText>
                </MenuItem>
                <MenuItem onClick={handleDeleteClick}>
                    <ListItemIcon>
                        <DeleteIcon fontSize="small" color="error" />
                    </ListItemIcon>
                    <ListItemText sx={{ color: "error.main" }}>
                        Delete Category
                    </ListItemText>
                </MenuItem>
            </Menu>

            {/* Category form dialog */}
            <CategoryForm
                open={showCategoryForm}
                category={editingCategory}
                onSubmit={handleCategoryFormSubmit}
                onCancel={handleCategoryFormCancel}
                error={actionError}
                loading={actionLoading}
            />

            {/* Delete confirmation dialog */}
            <Dialog open={showDeleteConfirm} onClose={handleDeleteCancel}>
                <DialogTitle>Delete Category?</DialogTitle>
                <DialogContent>
                    <Typography>
                        Are you sure you want to delete "{deletingCategory?.name}"?
                        The feeds themselves are kept; they'll just lose this
                        category label.
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

            {/* Add feed dialog */}
            <AddFeedDialog
                open={showAddFeedDialog}
                categoryId={addFeedCategoryId}
                onSubmit={handleAddFeedSubmit}
                onCancel={handleAddFeedCancel}
                error={actionError}
                loading={actionLoading}
            />
        </Box>
    );
}

export default CategoryList;
