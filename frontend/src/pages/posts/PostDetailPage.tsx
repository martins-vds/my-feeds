/**
 * PostDetailPage - displays full post content with read state management
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, Link as RouterLink } from "react-router-dom";
import {
    Container,
    Box,
    Typography,
    IconButton,
    Avatar,
    Chip,
    Divider,
    Alert,
    CircularProgress,
    Button,
    Breadcrumbs,
    Link,
    Paper,
    Tooltip,
} from "@mui/material";
import {
    ArrowBack as ArrowBackIcon,
    Launch as LaunchIcon,
    CalendarToday as CalendarIcon,
    Person as PersonIcon,
    RssFeed as RssFeedIcon,
} from "@mui/icons-material";
import api, { ApiError } from "../../services/api";
import { PostContent } from "../../components/PostContent";
import { ReadStateToggle } from "../../components/ReadStateToggle";
import { AudioPlayer } from "../../components/AudioPlayer";
import { FloatingAudioControls } from "../../components/FloatingAudioControls";
import { ReadAlongToggles } from "../../components/ReadAlongToggles";
import { useAudioPlayer } from "../../hooks/useAudioPlayer";
import { useReadAlong } from "../../hooks/useReadAlong";
import { useReadAlongPreferences } from "../../hooks/useReadAlongPreferences";
import { hasReadableContent } from "../../utils/readableContent";

interface PostDetailResponse {
    id: string;
    feedId: string;
    feedTitle: string | null;
    feedIconUrl: string | null;
    title: string;
    content: string | null;
    summary: string | null;
    author: string | null;
    link: string;
    publishedAt: string;
    isRead: boolean;
    hasAudio: boolean;
}

/**
 * Format date for display
 */
function formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/**
 * PostDetailPage displays full post content
 */
export const PostDetailPage: React.FC = () => {
    const { id: postId } = useParams<{ id: string }>();
    const navigate = useNavigate();

    const [post, setPost] = useState<PostDetailResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Own the audio player here so read-along and the player share one media
    // element. The title and body refs give the highlighter its wrap targets.
    const player = useAudioPlayer(postId ?? "");
    const titleRef = useRef<HTMLHeadingElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const playerRef = useRef<HTMLDivElement>(null);
    const footerRef = useRef<HTMLDivElement>(null);
    const readAlongPrefs = useReadAlongPreferences();

    useReadAlong({
        timings: player.wordTimings,
        getMediaElement: player.getMediaElement,
        isPlaying: player.isPlaying,
        titleRef,
        contentRef,
        highlightEnabled: readAlongPrefs.highlight,
        autoScrollEnabled: readAlongPrefs.autoScroll,
    });

    // Fetch post detail
    useEffect(() => {
        if (!postId) return;

        const fetchPost = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await api.get<PostDetailResponse>(`/posts/${postId}`);
                setPost(response);
            } catch (err) {
                if (err instanceof ApiError) {
                    if (err.status === 404) {
                        setError("Post not found");
                    } else {
                        setError(err.message);
                    }
                } else {
                    setError("Failed to load post");
                }
            } finally {
                setLoading(false);
            }
        };

        fetchPost();
    }, [postId]);

    // Handle read state toggle
    const handleToggleReadState = useCallback(
        async (id: string, isRead: boolean) => {
            await api.put(`/posts/${id}/read-state`, { isRead });
            setPost((prev) => (prev ? { ...prev, isRead } : null));
        },
        []
    );

    // Handle back navigation
    const handleBack = useCallback(() => {
        navigate("/posts");
    }, [navigate]);

    // Loading state
    if (loading) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
                    <CircularProgress />
                </Box>
            </Container>
        );
    }

    // Error state
    if (error) {
        return (
            <Container maxWidth="md" sx={{ py: 4 }}>
                <Box sx={{ mb: 2 }}>
                    <IconButton onClick={handleBack} data-testid="back-button">
                        <ArrowBackIcon />
                    </IconButton>
                </Box>
                <Alert severity="error" data-testid="error-message">
                    {error}
                </Alert>
                <Box sx={{ mt: 2 }}>
                    <Button onClick={handleBack} variant="outlined">
                        Back to Posts
                    </Button>
                </Box>
            </Container>
        );
    }

    // No post state (shouldn't happen normally)
    if (!post) {
        return null;
    }

    // Posts with no readable body (empty, or just a comments link) can't be
    // read here or synthesized to audio.
    const readable = hasReadableContent(post.content || post.summary);

    return (
        <Container maxWidth="md" sx={{ py: 3 }}>
            {/* Header with back button and actions */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    mb: 2,
                }}
            >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <IconButton
                        onClick={handleBack}
                        data-testid="back-button"
                        aria-label="Go back"
                    >
                        <ArrowBackIcon />
                    </IconButton>
                    <Breadcrumbs aria-label="breadcrumb">
                        <Link
                            component={RouterLink}
                            to="/posts"
                            underline="hover"
                            color="inherit"
                        >
                            Posts
                        </Link>
                        <Typography color="text.primary" noWrap sx={{ maxWidth: 200 }}>
                            {post.title}
                        </Typography>
                    </Breadcrumbs>
                </Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <ReadStateToggle
                        postId={post.id}
                        isRead={post.isRead}
                        onToggle={handleToggleReadState}
                    />
                    <Tooltip title="Open original article">
                        <IconButton
                            component="a"
                            href={post.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid="original-link"
                            aria-label="Open original article"
                        >
                            <LaunchIcon />
                        </IconButton>
                    </Tooltip>
                </Box>
            </Box>

            {/* Article */}
            <Paper elevation={0} sx={{ p: { xs: 2, md: 4 } }}>
                {/* Title */}
                <Typography
                    variant="h4"
                    component="h1"
                    gutterBottom
                    data-testid="post-title"
                    ref={titleRef}
                >
                    {post.title}
                </Typography>

                {/* Metadata */}
                <Box
                    sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 2,
                        alignItems: "center",
                        mb: 3,
                    }}
                >
                    {/* Feed info */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        {post.feedIconUrl ? (
                            <Avatar
                                src={post.feedIconUrl}
                                alt={post.feedTitle || "Feed"}
                                sx={{ width: 24, height: 24 }}
                            />
                        ) : (
                            <RssFeedIcon fontSize="small" color="action" />
                        )}
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            data-testid="feed-title"
                        >
                            {post.feedTitle || "Unknown Feed"}
                        </Typography>
                    </Box>

                    {/* Author */}
                    {post.author && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                            <PersonIcon fontSize="small" color="action" />
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                data-testid="post-author"
                            >
                                {post.author}
                            </Typography>
                        </Box>
                    )}

                    {/* Date */}
                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <CalendarIcon fontSize="small" color="action" />
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            data-testid="post-date"
                        >
                            {formatDate(post.publishedAt)}
                        </Typography>
                    </Box>

                    {/* Read state chip */}
                    <Chip
                        label={post.isRead ? "Read" : "Unread"}
                        size="small"
                        color={post.isRead ? "default" : "primary"}
                        variant="outlined"
                    />
                </Box>

                {/* Audio player */}
                {readable && (
                    <Box sx={{ my: 2 }} ref={playerRef}>
                        <AudioPlayer player={player} />
                        <ReadAlongToggles
                            highlight={readAlongPrefs.highlight}
                            onHighlightChange={readAlongPrefs.setHighlight}
                            autoScroll={readAlongPrefs.autoScroll}
                            onAutoScrollChange={readAlongPrefs.setAutoScroll}
                        />
                    </Box>
                )}

                <Divider sx={{ mb: 3 }} />

                {/* Content */}
                <PostContent content={post.content} summary={post.summary} ref={contentRef} />

                <Divider sx={{ my: 3 }} />

                {/* Footer actions */}
                <Box
                    ref={footerRef}
                    sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <Button
                        variant="outlined"
                        startIcon={<ArrowBackIcon />}
                        onClick={handleBack}
                    >
                        Back to Posts
                    </Button>
                    <Button
                        variant="contained"
                        endIcon={<LaunchIcon />}
                        component="a"
                        href={post.link}
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        Read Original
                    </Button>
                </Box>
            </Paper>
            {readable && (
                <FloatingAudioControls
                    player={player}
                    anchorRef={playerRef}
                    footerRef={footerRef}
                />
            )}
        </Container>
    );
};

export default PostDetailPage;
