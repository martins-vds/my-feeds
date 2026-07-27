/**
 * PostCard Component - Individual post card in the posts list
 */

import React, { useCallback } from "react";
import {
    Card,
    CardContent,
    CardActionArea,
    Typography,
    Box,
    IconButton,
    Chip,
    Tooltip,
} from "@mui/material";
import {
    CheckCircle as ReadIcon,
    RadioButtonUnchecked as UnreadIcon,
    VolumeUp as AudioIcon,
    OpenInNew as ExternalLinkIcon,
} from "@mui/icons-material";
import type { PostSummary } from "../hooks/usePostsData";

interface PostCardProps {
    post: PostSummary;
    onMarkAsRead?: (postId: string, isRead: boolean) => void;
    onClick?: (post: PostSummary) => void;
}

/**
 * Format a date string for display
 */
function formatDate(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) {
        return "Just now";
    }
    if (diffMins < 60) {
        return `${diffMins}m ago`;
    }
    if (diffHours < 24) {
        return `${diffHours}h ago`;
    }
    if (diffDays < 7) {
        return `${diffDays}d ago`;
    }
    return date.toLocaleDateString();
}

/**
 * PostCard displays a single post summary
 */
export const PostCard: React.FC<PostCardProps> = ({
    post,
    onMarkAsRead,
    onClick,
}) => {
    const handleReadToggle = useCallback(
        (event: React.MouseEvent) => {
            event.stopPropagation();
            onMarkAsRead?.(post.id, !post.isRead);
        },
        [post.id, post.isRead, onMarkAsRead]
    );

    const handleExternalLink = useCallback(
        (event: React.MouseEvent) => {
            event.stopPropagation();
            window.open(post.link, "_blank", "noopener,noreferrer");
        },
        [post.link]
    );

    const handleClick = useCallback(() => {
        onClick?.(post);
    }, [post, onClick]);

    return (
        <Card
            sx={{
                mb: 1,
                opacity: post.isRead ? 0.7 : 1,
                transition: "opacity 0.2s ease-in-out",
                "&:hover": {
                    opacity: 1,
                },
            }}
            data-testid={`post-card-${post.id}`}
        >
            <CardActionArea onClick={handleClick} disabled={!onClick}>
                <CardContent sx={{ pb: 1 }}>
                    {/* Header row: Feed info and date */}
                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            mb: 0.5,
                        }}
                    >
                        <Box
                            sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                            }}
                        >
                            {post.feedIconUrl && (
                                <Box
                                    component="img"
                                    src={post.feedIconUrl}
                                    alt=""
                                    sx={{
                                        width: 16,
                                        height: 16,
                                        borderRadius: 0.5,
                                    }}
                                    onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = "none";
                                    }}
                                />
                            )}
                            <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ fontWeight: 500 }}
                            >
                                {post.feedTitle || "Unknown Feed"}
                            </Typography>
                            {post.author && (
                                <Typography variant="caption" color="text.secondary">
                                    • {post.author}
                                </Typography>
                            )}
                        </Box>
                        <Typography variant="caption" color="text.secondary">
                            {formatDate(post.publishedAt)}
                        </Typography>
                    </Box>

                    {/* Title */}
                    <Typography
                        variant="subtitle1"
                        component="h3"
                        sx={{
                            fontWeight: post.isRead ? 400 : 600,
                            lineHeight: 1.3,
                            mb: 0.5,
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            overflow: "hidden",
                        }}
                    >
                        {post.title}
                    </Typography>

                    {/* Summary */}
                    {post.hasContent && post.summary && (
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                                mb: 1,
                            }}
                        >
                            {post.summary}
                        </Typography>
                    )}

                    {/* Footer row: Badges and actions */}
                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            mt: 1,
                        }}
                    >
                        <Box sx={{ display: "flex", gap: 0.5 }}>
                            {post.hasContent && post.hasAudio && (
                                <Chip
                                    icon={<AudioIcon fontSize="small" />}
                                    label="Audio"
                                    size="small"
                                    variant="outlined"
                                    sx={{ fontSize: "0.7rem" }}
                                />
                            )}
                        </Box>
                        <Box sx={{ display: "flex", gap: 0.5 }}>
                            <Tooltip title="Open in new tab">
                                <IconButton
                                    size="small"
                                    onClick={handleExternalLink}
                                    aria-label="Open original article"
                                >
                                    <ExternalLinkIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                            <Tooltip
                                title={post.isRead ? "Mark as unread" : "Mark as read"}
                            >
                                <IconButton
                                    size="small"
                                    onClick={handleReadToggle}
                                    aria-label={
                                        post.isRead ? "Mark as unread" : "Mark as read"
                                    }
                                    color={post.isRead ? "default" : "primary"}
                                >
                                    {post.isRead ? (
                                        <ReadIcon fontSize="small" />
                                    ) : (
                                        <UnreadIcon fontSize="small" />
                                    )}
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Box>
                </CardContent>
            </CardActionArea>
        </Card>
    );
};

export default PostCard;
