/**
 * CategoryFilter Component - Filter controls for posts
 */

import React, { useCallback } from "react";
import {
    Box,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Chip,
    ToggleButton,
    ToggleButtonGroup,
    Skeleton,
} from "@mui/material";
import type { SelectChangeEvent } from "@mui/material";
import type { ReadState } from "../hooks/usePostsData";

export interface CategoryOption {
    id: string;
    name: string;
    feedCount?: number;
}

export interface FeedOption {
    id: string;
    title: string;
}

interface CategoryFilterProps {
    // Current filter values
    categoryId: string | null;
    feedId: string | null;
    readState: ReadState;

    // Available options
    categories: CategoryOption[];
    feeds: FeedOption[];

    // Loading states
    loadingCategories?: boolean;
    loadingFeeds?: boolean;

    // Callbacks
    onCategoryChange: (categoryId: string | null) => void;
    onFeedChange: (feedId: string | null) => void;
    onReadStateChange: (readState: ReadState) => void;
}

/**
 * CategoryFilter provides filtering controls for posts
 */
export const CategoryFilter: React.FC<CategoryFilterProps> = ({
    categoryId,
    feedId,
    readState,
    categories,
    feeds,
    loadingCategories = false,
    loadingFeeds = false,
    onCategoryChange,
    onFeedChange,
    onReadStateChange,
}) => {
    const handleCategoryChange = useCallback(
        (event: SelectChangeEvent<string>) => {
            const value = event.target.value;
            onCategoryChange(value === "" ? null : value);
        },
        [onCategoryChange]
    );

    const handleFeedChange = useCallback(
        (event: SelectChangeEvent<string>) => {
            const value = event.target.value;
            onFeedChange(value === "" ? null : value);
        },
        [onFeedChange]
    );

    const handleReadStateChange = useCallback(
        (
            _event: React.MouseEvent<HTMLElement>,
            newValue: ReadState | null
        ) => {
            if (newValue !== null) {
                onReadStateChange(newValue);
            }
        },
        [onReadStateChange]
    );

    const handleClearFilters = useCallback(() => {
        onCategoryChange(null);
        onFeedChange(null);
        onReadStateChange("all");
    }, [onCategoryChange, onFeedChange, onReadStateChange]);

    const hasActiveFilters =
        categoryId !== null || feedId !== null || readState !== "all";

    // Filter feeds by selected category
    const filteredFeeds = categoryId
        ? feeds
        : feeds;

    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: { xs: "column", sm: "row" },
                gap: 2,
                alignItems: { xs: "stretch", sm: "center" },
                flexWrap: "wrap",
                mb: 2,
            }}
            data-testid="category-filter"
        >
            {/* Category dropdown */}
            <FormControl size="small" sx={{ minWidth: 150 }}>
                <InputLabel id="category-filter-label">Category</InputLabel>
                {loadingCategories ? (
                    <Skeleton variant="rectangular" height={40} />
                ) : (
                    <Select
                        labelId="category-filter-label"
                        id="category-filter"
                        value={categoryId || ""}
                        label="Category"
                        onChange={handleCategoryChange}
                        data-testid="category-select"
                    >
                        <MenuItem value="">
                            <em>All Categories</em>
                        </MenuItem>
                        {categories.map((cat) => (
                            <MenuItem key={cat.id} value={cat.id}>
                                {cat.name}
                                {cat.feedCount !== undefined && (
                                    <Chip
                                        label={cat.feedCount}
                                        size="small"
                                        sx={{ ml: 1 }}
                                    />
                                )}
                            </MenuItem>
                        ))}
                    </Select>
                )}
            </FormControl>

            {/* Feed dropdown */}
            <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel id="feed-filter-label">Feed</InputLabel>
                {loadingFeeds ? (
                    <Skeleton variant="rectangular" height={40} />
                ) : (
                    <Select
                        labelId="feed-filter-label"
                        id="feed-filter"
                        value={feedId || ""}
                        label="Feed"
                        onChange={handleFeedChange}
                        data-testid="feed-select"
                    >
                        <MenuItem value="">
                            <em>All Feeds</em>
                        </MenuItem>
                        {filteredFeeds.map((feed) => (
                            <MenuItem key={feed.id} value={feed.id}>
                                {feed.title}
                            </MenuItem>
                        ))}
                    </Select>
                )}
            </FormControl>

            {/* Read state toggle */}
            <ToggleButtonGroup
                value={readState}
                exclusive
                onChange={handleReadStateChange}
                aria-label="Read state filter"
                size="small"
                data-testid="read-state-toggle"
            >
                <ToggleButton value="all" aria-label="All posts">
                    All
                </ToggleButton>
                <ToggleButton value="unread" aria-label="Unread posts">
                    Unread
                </ToggleButton>
                <ToggleButton value="read" aria-label="Read posts">
                    Read
                </ToggleButton>
            </ToggleButtonGroup>

            {/* Clear filters button */}
            {hasActiveFilters && (
                <Chip
                    label="Clear filters"
                    onDelete={handleClearFilters}
                    onClick={handleClearFilters}
                    size="small"
                    variant="outlined"
                    sx={{ ml: { xs: 0, sm: "auto" } }}
                    data-testid="clear-filters"
                />
            )}
        </Box>
    );
};

export default CategoryFilter;
