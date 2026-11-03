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
import { PacerControls } from "../../components/PacerControls";
import { ReadAlongToggles } from "../../components/ReadAlongToggles";
import { StartReadingButton } from "../../components/StartReadingButton";
import { WPM_OPTIONS } from "../../constants/audio";
import { useAudioPlayer, type AudioStatus } from "../../hooks/useAudioPlayer";
import { usePacer } from "../../hooks/usePacer";
import { useReadAlong } from "../../hooks/useReadAlong";
import { useReadAlongPreferences, type ReadingMode } from "../../hooks/useReadAlongPreferences";
import { useReadingProgress } from "../../hooks/useReadingProgress";
import { displayPercent } from "../../utils/readingProgress";
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
  readProgress: number;
  hasAudio: boolean;
}

interface PendingStart {
  mode: ReadingMode;
  fraction: number;
}

// The statuses in which the audio element exists, so its clock means something.
const TRACKED_AUDIO_STATUSES: readonly AudioStatus[] = ["ready", "playing", "paused"];

const formatWpm = (value: number) => `${value}`;

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

  // Silent reading is paced by a timer instead of the audio clock. A start request waits in
  // pendingStart until what it needs exists: the paced timeline, or the loaded clip. The slot
  // holds one request, and a newer one replaces it.
  const pacer = usePacer(readAlongPrefs.wpm);
  const [silentActive, setSilentActive] = useState(false);
  const [pendingStart, setPendingStart] = useState<PendingStart | null>(null);
  const {
    getClock: getPacerClock,
    setDurationMs,
    seekToFraction,
    play: playPacer,
    stop: stopPacer,
  } = pacer;
  const {
    status: audioStatus,
    durationSeconds: audioDuration,
    getMediaElement: getAudioClock,
    seek: seekAudio,
    play: playAudio,
  } = player;
  const getClock = useCallback(
    () => (silentActive ? getPacerClock() : getAudioClock()),
    [silentActive, getPacerClock, getAudioClock]
  );

  const { pacedDurationMs } = useReadAlong({
    timings: player.wordTimings,
    getMediaElement: getClock,
    isPlaying: silentActive ? pacer.isPlaying : player.isPlaying,
    titleRef,
    contentRef,
    highlightEnabled: readAlongPrefs.highlight || silentActive,
    highlightMode: readAlongPrefs.highlightMode,
    autoScrollEnabled: readAlongPrefs.autoScroll && !inlineSpeedOpen && !floatingSpeedOpen,
    contentVersion: allowPublisherImages,
    paced: silentActive,
  });

  // The paced timeline exists only once the words are wrapped. Size the pacer from it, and
  // only then let a waiting silent start run.
  useEffect(() => {
    setDurationMs(pacedDurationMs);
  }, [pacedDurationMs, setDurationMs]);

  useEffect(() => {
    if (pendingStart?.mode !== "silent" || pacedDurationMs <= 0) return;
    seekToFraction(pendingStart.fraction);
    playPacer();
    setPendingStart(null);
  }, [pendingStart, pacedDurationMs, seekToFraction, playPacer]);

  useEffect(() => {
    if (pendingStart?.mode !== "sound" || audioStatus !== "ready") return;
    setPendingStart(null);
    if (audioDuration) seekAudio(pendingStart.fraction * audioDuration);
    playAudio();
  }, [pendingStart, audioStatus, audioDuration, seekAudio, playAudio]);

  // Moving to another article ends the reading session.
  useEffect(
    () => () => {
      stopPacer();
      setSilentActive(false);
      setPendingStart(null);
    },
    [postId, stopPacer]
  );

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
  // shows its controls instead of the start button. Runs once per post when
  // audio availability is known; generateAudio only fetches the existing file
  // (it does not re-synthesize).
  const audioReady = player.status === "idle";
  useEffect(() => {
    if (post?.hasAudio && audioReady) {
      player.generateAudio();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.hasAudio]);

  // Progress follows whichever clock is driving the article: the pacer while
  // reading silently, the audio element otherwise.
  const trackedPost = post?.id === postId ? post : null;
  const { reset: resetProgress } = useReadingProgress({
    postId: postId ?? "",
    initialProgress: trackedPost?.readProgress ?? 0,
    enabled:
      trackedPost !== null &&
      !trackedPost.isRead &&
      (silentActive || TRACKED_AUDIO_STATUSES.includes(audioStatus)),
    clockKey: silentActive ? "silent" : "audio",
    getClock,
    getDurationSeconds: () => (silentActive ? pacedDurationMs / 1000 : (audioDuration ?? 0)),
    onUpdate: (report) =>
      setPost((prev) =>
        prev ? { ...prev, readProgress: report.readProgress, isRead: report.isRead } : prev
      ),
  });

  // Handle read state toggle. The reader's choice wins over any save still in flight.
  const handleToggleReadState = useCallback(
    async (id: string, isRead: boolean) => {
      await api.put(`/posts/${id}/read-state`, { isRead });
      setPost((prev) => (prev ? { ...prev, isRead, readProgress: isRead ? 1 : 0 } : null));
      resetProgress(isRead ? 1 : 0);
    },
    [resetProgress]
  );

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

  // A finished article starts over; any other starts where the reader left off.
  const storedFraction = post.isRead ? 0 : post.readProgress;

  const startSilent = (fraction: number) => {
    setPendingStart({ mode: "silent", fraction });
    setSilentActive(true);
  };

  const startSound = (fraction: number) => {
    if (audioStatus === "ready" || audioStatus === "paused") {
      if (audioDuration) seekAudio(fraction * audioDuration);
      playAudio();
      return;
    }
    setPendingStart({ mode: "sound", fraction });
    // The player ignores this while a load is already under way.
    void player.generateAudio();
  };

  const handleStart = (mode: ReadingMode) => {
    readAlongPrefs.setReadingMode(mode);
    if (mode === "silent") startSilent(storedFraction);
    else startSound(storedFraction);
  };

  const stopSilent = () => {
    stopPacer();
    setSilentActive(false);
  };

  // Each switch carries the reader's place over to the other clock.
  const switchToSilent = () => {
    const place =
      player.currentTime > 0 && audioDuration ? player.currentTime / audioDuration : storedFraction;
    player.pause();
    readAlongPrefs.setReadingMode("silent");
    startSilent(place);
  };

  const switchToSound = () => {
    const place = pacer.fraction;
    stopSilent();
    readAlongPrefs.setReadingMode("sound");
    startSound(place);
  };

  // The pacer speaks the audio controls' language so the floating bar can drive either.
  const silentPlayer = {
    isPlaying: pacer.isPlaying,
    status: pacer.status,
    toggle: pacer.toggle,
    playbackRate: readAlongPrefs.wpm,
    setPlaybackRate: readAlongPrefs.setWpm,
    isMuted: false,
    toggleMute: () => {},
  };

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
            data-testid="read-state-chip"
            label={
              post.isRead
                ? "Read"
                : post.readProgress > 0
                  ? `In progress · ${displayPercent(post.readProgress)}%`
                  : "Unread"
            }
            size="small"
            color={post.isRead ? "default" : "primary"}
            variant="outlined"
          />
        </Box>

        {/* Reading controls: the pacer, the start button or the audio player */}
        {readable && (
          <Box sx={{ my: 2 }} ref={playerRef}>
            {silentActive ? (
              <PacerControls
                isPlaying={pacer.isPlaying}
                fraction={pacer.fraction}
                wpm={readAlongPrefs.wpm}
                onToggle={pacer.toggle}
                onSeek={seekToFraction}
                onWpmChange={readAlongPrefs.setWpm}
                onStop={stopSilent}
                onSpeedMenuOpenChange={setInlineSpeedOpen}
              />
            ) : audioStatus === "idle" ? (
              <StartReadingButton
                progress={post.readProgress}
                isRead={post.isRead}
                mode={readAlongPrefs.readingMode}
                onStart={handleStart}
              />
            ) : (
              <AudioPlayer
                player={player}
                onSpeedMenuOpenChange={setInlineSpeedOpen}
                onReadSilently={switchToSilent}
              />
            )}
            <ReadAlongToggles
              highlight={readAlongPrefs.highlight}
              onHighlightChange={readAlongPrefs.setHighlight}
              autoScroll={readAlongPrefs.autoScroll}
              onAutoScrollChange={readAlongPrefs.setAutoScroll}
              highlightMode={readAlongPrefs.highlightMode}
              onHighlightModeChange={readAlongPrefs.setHighlightMode}
              highlightLocked={silentActive}
            />
            {(silentActive || (audioStatus !== "idle" && audioStatus !== "error")) && (
              <Box sx={{ mt: 0.5 }}>
                <Button
                  size="small"
                  onClick={silentActive ? switchToSound : switchToSilent}
                  data-testid="read-mode-switch"
                >
                  {silentActive ? "Listen instead" : "Read silently"}
                </Button>
              </Box>
            )}
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
      {readable && silentActive && (
        <FloatingAudioControls
          player={silentPlayer}
          anchorRef={playerRef}
          footerRef={footerRef}
          onSpeedMenuOpenChange={setFloatingSpeedOpen}
          speeds={WPM_OPTIONS}
          formatSpeed={formatWpm}
          speedLabel="Reading speed"
          hideMute
        />
      )}
      {readable && !silentActive && (
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
