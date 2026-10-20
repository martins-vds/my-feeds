import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Box, Fab, Stack, Button } from "@mui/material";
import PlayIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import type { UseAudioPlayerResult } from "../hooks/useAudioPlayer";
import { PLAYBACK_SPEEDS } from "../constants/audio";

export interface FloatingAudioControlsProps {
  /** The same player object the inline AudioPlayer receives. */
  player: UseAudioPlayerResult;
  /** The inline player's container; observed for on-screen visibility. */
  anchorRef: RefObject<HTMLElement | null>;
  /** The article footer actions row; hides the controls when it is in view. */
  footerRef?: RefObject<HTMLElement | null>;
}

/**
 * Track whether `ref.current` currently intersects the viewport (threshold 0).
 * Returns `initial` until the observer first reports, and when there is no
 * element or no IntersectionObserver support.
 */
function useOnScreen(ref: RefObject<HTMLElement | null> | undefined, initial: boolean): boolean {
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

  const [speedOpen, setSpeedOpen] = useState(false);
  const speedFabRef = useRef<HTMLButtonElement>(null);
  const speedContainerRef = useRef<HTMLDivElement>(null);

  const activeClip = player.isPlaying || player.status === "paused";
  const visible = activeClip && !playerOnScreen && !footerOnScreen;

  // Collapse the speed stack whenever the controls hide.
  useEffect(() => {
    if (!visible) setSpeedOpen(false);
  }, [visible]);

  // Close the speed options when the user clicks or taps outside the speed
  // controls. React 18 batches the state update from this native listener and
  // flushes it before paint, so the stack closes without a visible delay.
  useEffect(() => {
    if (!speedOpen) return;
    const handleDismiss = (e: MouseEvent | TouchEvent) => {
      if (!speedContainerRef.current?.contains(e.target as Node)) {
        setSpeedOpen(false);
      }
    };
    document.addEventListener("click", handleDismiss);
    document.addEventListener("touchend", handleDismiss);
    return () => {
      document.removeEventListener("click", handleDismiss);
      document.removeEventListener("touchend", handleDismiss);
    };
  }, [speedOpen]);

  const closeSpeed = useCallback(() => {
    setSpeedOpen(false);
    speedFabRef.current?.focus();
  }, []);

  if (!visible) return null;

  return (
    <Box
      data-testid="floating-audio-controls"
      onKeyDown={(e) => {
        if (e.key === "Escape" && speedOpen) closeSpeed();
      }}
      sx={{
        position: "fixed",
        right: "calc(16px + env(safe-area-inset-right))",
        bottom: "calc(16px + env(safe-area-inset-bottom))",
        zIndex: (theme) => theme.zIndex.speedDial,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 1,
      }}
    >
      <Box
        ref={speedContainerRef}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1,
        }}
      >
        {speedOpen && (
          <Stack
            id="floating-speed-options"
            role="group"
            aria-label="Playback speed options"
            spacing={0.5}
            data-testid="floating-speed-options"
            sx={{
              alignItems: "center",
            }}
          >
            {PLAYBACK_SPEEDS.map((speed) => {
              const selected = speed === player.playbackRate;
              return (
                <Button
                  key={speed}
                  size="small"
                  variant={selected ? "contained" : "text"}
                  aria-pressed={selected}
                  aria-label={`Set speed ${speed}x`}
                  onClick={() => {
                    player.setPlaybackRate(speed);
                    closeSpeed();
                  }}
                  sx={{
                    minWidth: 56,
                    borderRadius: 999,
                    boxShadow: 2,
                    // Selected is a filled accent pill (contrast text on
                    // primary); unselected are white pills with accent text.
                    // Previously the contained variant kept a paper
                    // background, hiding its white label until hover.
                    bgcolor: selected ? "primary.main" : "background.paper",
                    color: selected ? "primary.contrastText" : "primary.main",
                    "&:hover": {
                      bgcolor: selected ? "primary.dark" : "background.paper",
                    },
                  }}
                >
                  {speed}x
                </Button>
              );
            })}
          </Stack>
        )}
        <Fab
          ref={speedFabRef}
          size="small"
          color="default"
          aria-label="Playback speed"
          aria-haspopup="true"
          aria-expanded={speedOpen}
          aria-controls={speedOpen ? "floating-speed-options" : undefined}
          data-testid="floating-speed-button"
          onClick={() => setSpeedOpen((o) => !o)}
        >
          {player.playbackRate}x
        </Fab>
      </Box>
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
