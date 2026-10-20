/**
 * ReadStateToggle component - toggle button for marking posts read/unread
 */

import React, { useCallback, useState } from "react";
import {
    IconButton,
    Tooltip,
    CircularProgress,
} from "@mui/material";
import {
    CheckCircle as CheckCircleIcon,
    CheckCircleOutlined as CheckCircleOutlineIcon,
} from "@mui/icons-material";

interface ReadStateToggleProps {
    postId: string;
    isRead: boolean;
    onToggle: (postId: string, isRead: boolean) => Promise<void>;
    size?: "small" | "medium" | "large";
}

/**
 * ReadStateToggle provides a button to toggle post read state
 */
export const ReadStateToggle: React.FC<ReadStateToggleProps> = ({
    postId,
    isRead,
    onToggle,
    size = "medium",
}) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleClick = useCallback(
        async (event: React.MouseEvent) => {
            event.stopPropagation(); // Prevent triggering parent click handlers
            setLoading(true);
            setError(null);
            try {
                await onToggle(postId, !isRead);
            } catch (err) {
                setError("Failed to update read state");
                console.error("Failed to toggle read state:", err);
            } finally {
                setLoading(false);
            }
        },
        [postId, isRead, onToggle]
    );

    const tooltipText = isRead ? "Mark as unread" : "Mark as read";
    const ariaLabel = isRead ? "Mark post as unread" : "Mark post as read";

    return (
        <Tooltip title={error || tooltipText}>
            <span>
                <IconButton
                    onClick={handleClick}
                    disabled={loading}
                    size={size}
                    color={isRead ? "primary" : "default"}
                    aria-label={ariaLabel}
                    data-testid="read-state-toggle"
                    data-is-read={isRead ? "true" : "false"}
                >
                    {loading ? (
                        <CircularProgress size={size === "small" ? 16 : 24} />
                    ) : isRead ? (
                        <CheckCircleIcon />
                    ) : (
                        <CheckCircleOutlineIcon />
                    )}
                </IconButton>
            </span>
        </Tooltip>
    );
};

export default ReadStateToggle;
