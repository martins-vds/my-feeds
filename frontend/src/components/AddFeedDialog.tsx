/**
 * AddFeedDialog component - dialog for adding a new feed URL
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
  Typography,
} from "@mui/material";
import RssFeedIcon from "@mui/icons-material/RssFeed";

interface AddFeedDialogProps {
  open: boolean;
  categoryId: string | null;
  onSubmit: (url: string) => Promise<void>;
  onCancel: () => void;
  error: string | null;
  loading: boolean;
}

const MAX_URL_LENGTH = 2048;

/**
 * Validate URL format
 */
function validateUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) {
    return "URL is required";
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    return `URL must be ${MAX_URL_LENGTH} characters or less`;
  }

  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "URL must use http or https protocol";
    }
  } catch {
    return "Please enter a valid URL";
  }

  return null;
}

export function AddFeedDialog({ open, onSubmit, onCancel, error, loading }: AddFeedDialogProps) {
  const [url, setUrl] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setUrl("");
      setLocalError(null);
      setTouched(false);
    }
  }, [open]);

  // Handle URL change
  const handleUrlChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setUrl(value);
    setTouched(true);
    // Clear local error on change
    setLocalError(null);
  }, []);

  // Handle blur for validation
  const handleUrlBlur = useCallback(() => {
    if (touched && url) {
      const validationError = validateUrl(url);
      if (validationError) {
        setLocalError(validationError);
      }
    }
  }, [touched, url]);

  // Handle form submission
  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      const validationError = validateUrl(url);
      if (validationError) {
        setLocalError(validationError);
        return;
      }
      try {
        await onSubmit(url.trim());
      } catch {
        // Error is handled by parent component
      }
    },
    [url, onSubmit]
  );

  // Handle cancel
  const handleCancel = useCallback(() => {
    setUrl("");
    setLocalError(null);
    setTouched(false);
    onCancel();
  }, [onCancel]);

  const displayError = localError || error;

  return (
    <Dialog open={open} onClose={handleCancel} maxWidth="sm" fullWidth>
      <form onSubmit={handleSubmit}>
        <DialogTitle>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <RssFeedIcon color="primary" />
            Add Feed
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 2,
            }}
          >
            Enter the URL of an RSS or Atom feed. We'll fetch the feed metadata and add it to your
            feeds. Categories are optional and can be assigned later.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            label="Feed URL"
            type="url"
            value={url}
            onChange={handleUrlChange}
            onBlur={handleUrlBlur}
            error={Boolean(displayError)}
            helperText={displayError || " "}
            disabled={loading}
            placeholder="https://example.com/feed.xml"
            slotProps={{
              htmlInput: { maxLength: MAX_URL_LENGTH + 10 },
            }}
          />
          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={loading || !url.trim()}>
            {loading ? <CircularProgress size={24} /> : "Add Feed"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default AddFeedDialog;
