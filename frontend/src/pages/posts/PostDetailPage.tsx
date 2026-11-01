/**
 * PostDetailPage - displays full post content with read state management
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, Link as RouterLink } from "react-router-dom";
import {
  Container,
  Box,
  Typography,
  IconButton,
  Avatar,
  Chip,
  Divider,
  Alert,
  Button,
  Breadcrumbs,
  Link,
  Paper,
  Tooltip,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LaunchIcon from "@mui/icons-material/Launch";
import CalendarIcon from "@mui/icons-material/CalendarToday";
import PersonIcon from "@mui/icons-material/Person";
import RssFeedIcon from "@mui/icons-material/RssFeed";
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
import { PostDetailSkeleton } from "../../components/skeletons/PostDetailSkeleton";
import { usePublisherImages } from "../../hooks/usePublisherImages";

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
  const { allowed: allowPublisherImages } = usePublisherImages();
  const { id: postId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  // The reader stashes its filtered URL here when opening a post. Fall back to
  // the reader root when the post was opened directly (deep link / refresh).
  const backTo = (location.state as { from?: string } | null)?.from ?? "/posts";

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
  const [inlineSpeedOpen, setInlineSpeedOpen] = useState(false);
  const [floatingSpeedOpen, setFloatingSpeedOpen] = useState(false);

  useReadAlong({
    timings: player.wordTimings,
    getMediaElement: player.getMediaElement,
    isPlaying: player.isPlaying,
    titleRef,
    contentRef,
    highlightEnabled: readAlongPrefs.highlight,
    highlightMode: readAlongPrefs.highlightMode,
    autoScrollEnabled: readAlongPrefs.autoScroll && !inlineSpeedOpen && !floatingSpeedOpen,
    contentVersion: allowPublisherImages,
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

  // If the post already has generated audio, load it right away so the player
  // shows the controls instead of the "Listen to article" button. Runs once
  // per post when audio availability is known; generateAudio only fetches the
  // existing file (it does not re-synthesize).
  const audioReady = player.status === "idle";
  useEffect(() => {
    if (post?.hasAudio && audioReady) {
      player.generateAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.hasAudio]);

  // Handle read state toggle
  const handleToggleReadState = useCallback(async (id: string, isRead: boolean) => {
    await api.put(`/posts/${id}/read-state`, { isRead });
    setPost((prev) => (prev ? { ...prev, isRead } : null));
  }, []);

  // Handle back navigation. Prefer a real history pop so the reader restores
  // its previous scroll position and in-memory post list; only fall back to an
  // explicit navigation when there is no app history to return to (e.g. the
  // post was opened via a direct link or a page refresh).
  const handleBack = useCallback(() => {
    if (location.key !== "default") {
      navigate(-1);
    } else {
      navigate(backTo);
    }
  }, [navigate, location.key, backTo]);

  // Loading state
  if (loading) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            mb: 2,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton onClick={handleBack} data-testid="back-button" aria-label="Go back">
              <ArrowBackIcon />
            </IconButton>
            <Breadcrumbs aria-label="breadcrumb">
              <Link component={RouterLink} to={backTo} underline="hover" color="inherit">
                Posts
              </Link>
            </Breadcrumbs>
          </Box>
        </Box>
        <Paper elevation={0} sx={{ p: { xs: 2, md: 4 } }}>
          <PostDetailSkeleton />
        </Paper>
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
          <IconButton onClick={handleBack} data-testid="back-button" aria-label="Go back">
            <ArrowBackIcon />
          </IconButton>
          <Breadcrumbs aria-label="breadcrumb">
            <Link component={RouterLink} to={backTo} underline="hover" color="inherit">
              Posts
            </Link>
            <Typography
              noWrap
              sx={{
                color: "text.primary",
                maxWidth: 200,
              }}
            >
              {post.title}
            </Typography>
          </Breadcrumbs>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ReadStateToggle postId={post.id} isRead={post.isRead} onToggle={handleToggleReadState} />
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
                src={allowPublisherImages ? (post.feedIconUrl ?? undefined) : undefined}
                slotProps={{ img: { referrerPolicy: "no-referrer" } }}
                alt={post.feedTitle || "Feed"}
                sx={{ width: 24, height: 24 }}
              />
            ) : (
              <RssFeedIcon fontSize="small" color="action" />
            )}
            <Typography
              variant="body2"
              data-testid="feed-title"
              sx={{
                color: "text.secondary",
              }}
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
                data-testid="post-author"
                sx={{
                  color: "text.secondary",
                }}
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
              data-testid="post-date"
              sx={{
                color: "text.secondary",
              }}
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
            <AudioPlayer player={player} onSpeedMenuOpenChange={setInlineSpeedOpen} />
            <ReadAlongToggles
              highlight={readAlongPrefs.highlight}
              onHighlightChange={readAlongPrefs.setHighlight}
              autoScroll={readAlongPrefs.autoScroll}
              onAutoScrollChange={readAlongPrefs.setAutoScroll}
              highlightMode={readAlongPrefs.highlightMode}
              onHighlightModeChange={readAlongPrefs.setHighlightMode}
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
          <Button variant="outlined" startIcon={<ArrowBackIcon />} onClick={handleBack}>
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
          onSpeedMenuOpenChange={setFloatingSpeedOpen}
        />
      )}
    </Container>
  );
};

export default PostDetailPage;
