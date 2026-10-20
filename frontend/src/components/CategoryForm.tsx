/**
 * CategoryForm component - dialog for creating/editing categories
 */

import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Alert,
  CircularProgress,
  Box,
} from "@mui/material";
import type { Category } from "../types";

interface CategoryFormProps {
  open: boolean;
  category: Category | null; // null for create, category for edit
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
  error: string | null;
  loading: boolean;
}

const MAX_NAME_LENGTH = 100;

export function CategoryForm({
  open,
  category,
  onSubmit,
  onCancel,
  error,
  loading,
}: CategoryFormProps) {
  const [name, setName] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  // Reset form when dialog opens/closes or category changes
  useEffect(() => {
    if (open) {
      setName(category?.name || "");
      setLocalError(null);
    }
  }, [open, category]);

  // Validate name
  const validateName = useCallback((value: string): string | null => {
    const trimmed = value.trim();
    if (!trimmed) {
      return "Category name is required";
    }
    if (trimmed.length > MAX_NAME_LENGTH) {
      return `Name must be ${MAX_NAME_LENGTH} characters or less`;
    }
    return null;
  }, []);

  // Handle name change
  const handleNameChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setName(value);
    // Clear local error on change
    setLocalError(null);
  }, []);

  // Handle form submission
  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const validationError = validateName(name);
      if (validationError) {
        setLocalError(validationError);
        return;
      }
      try {
        await onSubmit(name.trim());
      } catch {
        // Error is handled by parent component
      }
    },
    [name, validateName, onSubmit]
  );

  // Handle cancel
  const handleCancel = useCallback(() => {
    setName("");
    setLocalError(null);
    onCancel();
  }, [onCancel]);

  const isEditing = category !== null;
  const displayError = localError || error;

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>{isEditing ? "Edit Category" : "New Category"}</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1 }}>
            <TextField
              autoFocus
              fullWidth
              label="Category Name"
              value={name}
              onChange={handleNameChange}
              error={Boolean(displayError)}
              helperText={displayError || `${name.length}/${MAX_NAME_LENGTH}`}
              disabled={loading}
              slotProps={{
                htmlInput: { maxLength: MAX_NAME_LENGTH + 10 }, // Allow some overflow for proper error display
              }}
              placeholder="e.g., Technology, News, Sports"
            />
          </Box>
          {error && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={loading || !name.trim()}>
            {loading ? <CircularProgress size={24} /> : isEditing ? "Save" : "Create"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default CategoryForm;
