import { useEffect, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Typography,
  Tooltip,
  CircularProgress,
  LinearProgress,
  Menu,
  MenuItem,
  Slider,
} from "@mui/material";
import PlayIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import RetryIcon from "@mui/icons-material/Replay";
import VolumeUpIcon from "@mui/icons-material/VolumeUp";
import VolumeOffIcon from "@mui/icons-material/VolumeOff";
import type { AudioStatus, UseAudioPlayerResult } from "../hooks/useAudioPlayer";
import { Waveform } from "./Waveform";
import { PLAYBACK_SPEEDS } from "../constants/audio";

interface AudioPlayerProps {
  /** Player state/handlers, owned by the parent (PostDetailPage) so read-along
   * and the player share one media element. */
  player: UseAudioPlayerResult;
  /** Optional initial URL (renders the player immediately for already-generated audio). */
  audioUrl?: string | null;
  /** Optional initial duration. */
  durationSeconds?: number;
  onSpeedMenuOpenChange?: (open: boolean) => void;
}

/**
 * Format seconds to mm:ss display
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Audio player component for TTS playback.
 *
 * Controlled/presentational: all player state and handlers come from the
 * `player` prop (the parent owns `useAudioPlayer`). Supports:
 * - Lazy audio generation on first listen
 * - Play/pause toggle
 * - Progress bar with current time
 * - Error handling with retry
 */
export function AudioPlayer({
  player,
  audioUrl: initialAudioUrl,
  durationSeconds: initialDuration,
  onSpeedMenuOpenChange,
}: AudioPlayerProps) {
  const {
    status,
    audioUrl,
    durationSeconds,
    currentTime,
    progress,
    // error is available but not currently displayed
    generateAudio,
    toggle,
    seek,
    playbackRate,
    setPlaybackRate,
    volume,
    isMuted,
    setVolume,
    toggleMute,
  } = player;

  const [speedAnchor, setSpeedAnchor] = useState<null | HTMLElement>(null);
  useEffect(() => {
    onSpeedMenuOpenChange?.(Boolean(speedAnchor));
    return () => onSpeedMenuOpenChange?.(false);
  }, [speedAnchor, onSpeedMenuOpenChange]);

  // Count seconds elapsed while audio is being generated so the wait shows
  // visible progress instead of a spinner that looks frozen.
  const [generatingElapsed, setGeneratingElapsed] = useState(0);
  useEffect(() => {
    if (status !== "generating") {
      setGeneratingElapsed(0);
      return;
    }
    const start = Date.now();
    const id = window.setInterval(() => {
      setGeneratingElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [status]);

  // Use initial values if provided and no audio has been generated yet
  const effectiveUrl = audioUrl || initialAudioUrl;
  const effectiveDuration = durationSeconds ?? initialDuration;
  const effectiveStatus: AudioStatus = effectiveUrl && status === "idle" ? "ready" : status;

  const handleListenClick = () => {
    generateAudio();
  };

  const handleRetryClick = () => {
    generateAudio();
  };

  const handleSeek = (fraction: number) => {
    if (effectiveDuration) {
      seek(fraction * effectiveDuration);
    }
  };

  // Idle state - show listen button
  if (effectiveStatus === "idle" || (!effectiveUrl && status === "idle")) {
    return (
      <Button
        onClick={handleListenClick}
        aria-label="Listen to article"
        color="primary"
        variant="outlined"
        size="small"
        startIcon={<PlayIcon />}
        data-testid="listen-button"
      >
        Listen to article
      </Button>
    );
  }

  // Loading state (brief: fetching audio status or an existing file)
  if (status === "loading") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <CircularProgress size={24} />
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
          }}
        >
          Loading audio…
        </Typography>
      </Box>
    );
  }

  // Generating state (slow: server-side TTS synthesis). A moving progress bar
  // plus an elapsed timer keep the wait from looking stuck.
  if (status === "generating") {
    return (
      <Box sx={{ width: "100%" }} data-testid="audio-generating">
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            mb: 0.5,
          }}
        >
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
            }}
          >
            Generating audio…
          </Typography>
          <Typography
            variant="caption"
            data-testid="audio-generating-elapsed"
            sx={{
              color: "text.secondary",
            }}
          >
            {formatTime(generatingElapsed)}
          </Typography>
        </Box>
        <LinearProgress />
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
            display: "block",
            mt: 0.5,
          }}
        >
          This can take a moment for longer articles.
        </Typography>
      </Box>
    );
  }

  // Error state
  if (status === "error") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="body2" color="error">
          Audio failed
        </Typography>
        <Tooltip title="Retry">
          <IconButton
            onClick={handleRetryClick}
            aria-label="Retry audio generation"
            color="primary"
            size="small"
          >
            <RetryIcon />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  // Ready/Playing/Paused state - show player
  const isPlaying = status === "playing";

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "44px minmax(0, 1fr) 44px",
          sm: "44px minmax(80px, 1fr) auto 44px auto",
        },
        alignItems: "center",
        gap: 1,
        width: "100%",
      }}
    >
      <IconButton
        onClick={toggle}
        aria-label={isPlaying ? "Pause" : "Play"}
        color="primary"
        data-testid="play-pause-button"
        sx={{ width: 44, height: 44 }}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </IconButton>

      <Box sx={{ minWidth: 0, gridColumn: { xs: "2 / 4", sm: "auto" } }}>
        <Waveform audioUrl={effectiveUrl} progress={progress} onSeek={handleSeek} />
      </Box>

      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          minWidth: 45,
          gridColumn: { xs: "1 / 3", sm: "auto" },
        }}
      >
        {effectiveDuration
          ? `${formatTime(currentTime)} / ${formatTime(effectiveDuration)}`
          : formatTime(currentTime)}
      </Typography>

      <Tooltip title="Playback speed">
        <Button
          size="small"
          onClick={(e) => setSpeedAnchor(e.currentTarget)}
          aria-label="Playback speed"
          data-testid="speed-button"
          sx={{ minWidth: 44, color: "text.secondary" }}
        >
          {playbackRate}x
        </Button>
      </Tooltip>
      <Menu anchorEl={speedAnchor} open={Boolean(speedAnchor)} onClose={() => setSpeedAnchor(null)}>
        {PLAYBACK_SPEEDS.map((speed) => (
          <MenuItem
            key={speed}
            selected={speed === playbackRate}
            onClick={() => {
              setPlaybackRate(speed);
              setSpeedAnchor(null);
            }}
          >
            {speed}x
          </MenuItem>
        ))}
      </Menu>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, gridColumn: { xs: "1 / -1", sm: "auto" } }}>
        <Tooltip title={isMuted ? "Unmute audio" : "Mute audio"}>
          <IconButton
            onClick={toggleMute}
            aria-label={isMuted ? "Unmute audio" : "Mute audio"}
            aria-pressed={isMuted}
            color="primary"
            sx={{ width: 44, height: 44 }}
          >
            {isMuted ? <VolumeOffIcon /> : <VolumeUpIcon />}
          </IconButton>
        </Tooltip>
        <Slider
          aria-label="Audio volume"
          min={0}
          max={100}
          step={1}
          value={Math.round(volume * 100)}
          onChange={(_, value) => {
            if (typeof value === "number") setVolume(value / 100);
          }}
          getAriaValueText={(value) => `${value}%`}
          valueLabelDisplay="auto"
          valueLabelFormat={(value) => `${value}%`}
          sx={{ width: { xs: "auto", sm: 80 }, flexGrow: { xs: 1, sm: 0 }, mx: 1 }}
        />
      </Box>
    </Box>
  );
}

export default AudioPlayer;
