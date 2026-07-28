import { useEffect, useState, type RefObject } from "react";
import { Box, Fab } from "@mui/material";
import { PlayArrow as PlayIcon, Pause as PauseIcon } from "@mui/icons-material";
import type { UseAudioPlayerResult } from "../hooks/useAudioPlayer";

export interface FloatingAudioControlsProps {
    /** The same player object the inline AudioPlayer receives. */
    player: UseAudioPlayerResult;
    /** The inline player's container; observed for on-screen visibility. */
    anchorRef: RefObject<HTMLElement>;
    /** The article footer actions row; hides the controls when it is in view. */
    footerRef?: RefObject<HTMLElement>;
}

/**
 * Track whether `ref.current` currently intersects the viewport (threshold 0).
 * Returns `initial` until the observer first reports, and when there is no
 * element or no IntersectionObserver support.
 */
function useOnScreen(
    ref: RefObject<HTMLElement> | undefined,
    initial: boolean
): boolean {
    const [onScreen, setOnScreen] = useState(initial);
    useEffect(() => {
        const el = ref?.current;
        if (!el || typeof IntersectionObserver !== "function") return;
        const observer = new IntersectionObserver(
            (entries) => setOnScreen(entries[0]?.isIntersecting ?? false),
            { threshold: 0 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [ref]);
    return onScreen;
}

/**
 * Floating play/resume + speed circles shown in the lower-right when the inline
 * audio player is scrolled off-screen and a clip is active. Drives the same
 * player element, so read-along and auto-scroll respond exactly as they do for
 * the inline controls.
 */
export function FloatingAudioControls({
    player,
    anchorRef,
    footerRef,
}: FloatingAudioControlsProps) {
    const playerOnScreen = useOnScreen(anchorRef, true);
    const footerOnScreen = useOnScreen(footerRef, false);

    const activeClip = player.isPlaying || player.status === "paused";
    const visible = activeClip && !playerOnScreen && !footerOnScreen;

    if (!visible) return null;

    return (
        <Box
            data-testid="floating-audio-controls"
            sx={{
                position: "fixed",
                right: 16,
                bottom: "calc(16px + env(safe-area-inset-bottom))",
                zIndex: (theme) => theme.zIndex.speedDial,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 1,
            }}
        >
            <Fab
                color="primary"
                aria-label={player.isPlaying ? "Pause" : "Play"}
                data-testid="floating-play-button"
                onClick={player.toggle}
            >
                {player.isPlaying ? <PauseIcon /> : <PlayIcon />}
            </Fab>
        </Box>
    );
}

export default FloatingAudioControls;
