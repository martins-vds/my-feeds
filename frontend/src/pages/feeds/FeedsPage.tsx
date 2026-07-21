/**
 * FeedsPage - main page for managing feed subscriptions and categories
 */

import { Container, Paper, Typography, Box, Alert, Button } from "@mui/material";
import { Refresh as RefreshIcon } from "@mui/icons-material";
import { CategoryList } from "../../components/CategoryList";
import { useFeedsData } from "../../hooks/useFeedsData";

export function FeedsPage() {
    const {
        categories,
        feeds,
        loading,
        error,
        selectedCategoryId,
        selectCategory,
        createCategory,
        updateCategory,
        deleteCategory,
        addFeed,
        setFeedCategories,
        setFeedActive,
        deleteFeed,
        refreshFeed,
        refresh,
    } = useFeedsData();

    return (
        <Container maxWidth="md" sx={{ py: 3 }}>
            {/* Page header */}
            <Box
                sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    mb: 3,
                }}
            >
                <Typography variant="h4" component="h1">
                    My Feeds
                </Typography>
                <Button
                    startIcon={<RefreshIcon />}
                    onClick={() => refresh()}
                    disabled={loading}
                >
                    Refresh
                </Button>
            </Box>

            {/* Info text */}
            <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 3 }}
            >
                Organize your RSS and Atom feed subscriptions into categories.
                You can create up to 25 categories and subscribe to up to 100
                feeds total.
            </Typography>

            {/* Global error */}
            {error && (
                <Alert severity="error" sx={{ mb: 3 }}>
                    {error}
                </Alert>
            )}

            {/* Category list */}
            <Paper elevation={1}>
                <CategoryList
                    categories={categories}
                    feeds={feeds}
                    loading={loading}
                    error={null} // Use global error above
                    selectedCategoryId={selectedCategoryId}
                    onSelectCategory={selectCategory}
                    onCreateCategory={createCategory}
                    onUpdateCategory={updateCategory}
                    onDeleteCategory={deleteCategory}
                    onAddFeed={addFeed}
                    onDeleteFeed={deleteFeed}
                    onRefreshFeed={refreshFeed}
                    onSetFeedCategories={setFeedCategories}
                    onSetFeedActive={setFeedActive}
                />
            </Paper>
        </Container>
    );
}

export default FeedsPage;
