import { Box, IconButton, LinearProgress, Typography, Tooltip, CircularProgress } from "@mui/material";
import {
    PlayArrow as PlayIcon,
    Pause as PauseIcon,
    VolumeUp as ListenIcon,
    Replay as RetryIcon,
} from "@mui/icons-material";
import { useAudioPlayer, type AudioStatus } from "../hooks/useAudioPlayer";

interface AudioPlayerProps {
    postId: string;
    audioUrl?: string | null;
    durationSeconds?: number;
    onGenerateAudio?: (postId: string) => Promise<{ status: string; url?: string }>;
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
 * Supports:
 * - Lazy audio generation on first listen
 * - Play/pause toggle
 * - Progress bar with current time
 * - Error handling with retry
 */
export function AudioPlayer({
    postId,
    audioUrl: initialAudioUrl,
    durationSeconds: initialDuration,
    onGenerateAudio,
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
    } = useAudioPlayer(postId);

    // Use initial values if provided and no audio has been generated yet
    const effectiveUrl = audioUrl || initialAudioUrl;
    const effectiveDuration = durationSeconds ?? initialDuration;
    const effectiveStatus: AudioStatus = effectiveUrl && status === "idle" ? "ready" : status;

    const handleListenClick = async () => {
        if (onGenerateAudio) {
            await onGenerateAudio(postId);
        } else {
            await generateAudio();
        }
    };

    const handleRetryClick = () => {
        generateAudio();
    };

    // Idle state - show listen button
    if (effectiveStatus === "idle" || (!effectiveUrl && status === "idle")) {
        return (
            <Tooltip title="Generate audio">
                <IconButton
                    onClick={handleListenClick}
                    aria-label="Listen to post"
                    color="primary"
                    data-testid="listen-button"
                >
                    <ListenIcon />
                </IconButton>
            </Tooltip>
        );
    }

    // Loading state
    if (status === "loading") {
        return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <CircularProgress size={24} />
                <Typography variant="body2" color="text.secondary">
                    Generating audio...
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
                display: "flex",
                alignItems: "center",
                gap: 1,
                width: "100%",
                maxWidth: 400,
            }}
        >
            <IconButton
                onClick={toggle}
                aria-label={isPlaying ? "Pause" : "Play"}
                color="primary"
                data-testid="play-pause-button"
            >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </IconButton>

            <Box sx={{ flexGrow: 1 }}>
                <LinearProgress
                    variant="determinate"
                    value={progress}
                    role="progressbar"
                    aria-label="Audio progress"
                    aria-valuenow={Math.round(progress)}
                    aria-valuemin={0}
                    aria-valuemax={100}
                />
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ minWidth: 45 }}>
                {effectiveDuration
                    ? `${formatTime(currentTime)} / ${formatTime(effectiveDuration)}`
                    : formatTime(currentTime)}
            </Typography>
        </Box>
    );
}

export default AudioPlayer;
