import { useEffect, useId, useState } from "react";
import {
  Box,
  Button,
  IconButton,
  Menu,
  MenuItem,
  Slider,
  Tooltip,
  Typography,
} from "@mui/material";
import PlayIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import StopIcon from "@mui/icons-material/Stop";
import { WPM_OPTIONS } from "../constants/audio";
import { wholePercent } from "../utils/readingProgress";

interface PacerControlsProps {
  isPlaying: boolean;
  /** How far through the article the pacer is, from 0 to 1. */
  fraction: number;
  /** Reading pace in words per minute. */
  wpm: number;
  onToggle: () => void;
  /** Moves the pacer to a fraction of the article, from 0 to 1. */
  onSeek: (fraction: number) => void;
  onWpmChange: (wpm: number) => void;
  onStop: () => void;
  /** Reports whether the pace menu is open, so the page can hold auto-scroll while it is. */
  onSpeedMenuOpenChange?: (open: boolean) => void;
}

/**
 * Controls for silent reading, where the pacer stands in for the audio clock. It uses the same
 * grid as `AudioPlayer`, with a reading position instead of a waveform and a pace in words per
 * minute instead of a playback rate.
 */
export function PacerControls({
  isPlaying,
  fraction,
  wpm,
  onToggle,
  onSeek,
  onWpmChange,
  onStop,
  onSpeedMenuOpenChange,
}: PacerControlsProps) {
  const menuId = useId();
  const [paceAnchor, setPaceAnchor] = useState<HTMLElement | null>(null);
  const paceOpen = Boolean(paceAnchor);
  const percent = wholePercent(fraction);

  useEffect(() => {
    onSpeedMenuOpenChange?.(paceOpen);
    return () => onSpeedMenuOpenChange?.(false);
  }, [paceOpen, onSpeedMenuOpenChange]);

  return (
    <Box
      data-testid="pacer-controls"
      sx={{
        display: "grid",
        gridTemplateColumns: {
          xs: "44px minmax(0, 1fr) auto 44px",
          sm: "44px minmax(80px, 1fr) auto auto 44px",
        },
        alignItems: "center",
        gap: 1,
        width: "100%",
      }}
    >
      <IconButton
        onClick={onToggle}
        aria-label={isPlaying ? "Pause" : "Play"}
        color="primary"
        data-testid="pacer-play-button"
        sx={{ width: 44, height: 44 }}
      >
        {isPlaying ? <PauseIcon /> : <PlayIcon />}
      </IconButton>

      <Box sx={{ minWidth: 0, px: 1, gridColumn: { xs: "2 / -1", sm: "auto" } }}>
        <Slider
          aria-label="Reading position"
          min={0}
          max={100}
          step={1}
          value={percent}
          onChange={(_, value) => {
            if (typeof value === "number") onSeek(value / 100);
          }}
          getAriaValueText={(value) => `${value} percent`}
          data-testid="pacer-position"
        />
      </Box>

      <Typography
        variant="caption"
        data-testid="pacer-percent"
        sx={{ color: "text.secondary", minWidth: 45, gridColumn: { xs: "1 / 3", sm: "auto" } }}
      >
        {percent}%
      </Typography>

      <Tooltip title="Reading speed">
        <Button
          size="small"
          onClick={(e) => setPaceAnchor(e.currentTarget)}
          aria-label="Reading speed"
          aria-haspopup="menu"
          aria-expanded={paceOpen}
          aria-controls={paceOpen ? menuId : undefined}
          data-testid="pacer-speed-button"
          sx={{ color: "text.secondary", whiteSpace: "nowrap" }}
        >
          {wpm} wpm
        </Button>
      </Tooltip>
      <Menu
        anchorEl={paceAnchor}
        open={paceOpen}
        onClose={() => setPaceAnchor(null)}
        slotProps={{ list: { id: menuId, "aria-label": "Reading speed options" } }}
      >
        {WPM_OPTIONS.map((option) => (
          <MenuItem
            key={option}
            role="menuitemradio"
            selected={option === wpm}
            onClick={() => {
              onWpmChange(option);
              setPaceAnchor(null);
            }}
          >
            {option} words per minute
          </MenuItem>
        ))}
      </Menu>

      <Tooltip title="Stop reading">
        <IconButton
          onClick={onStop}
          aria-label="Stop reading"
          color="primary"
          data-testid="pacer-stop-button"
          sx={{ width: 44, height: 44 }}
        >
          <StopIcon />
        </IconButton>
      </Tooltip>
    </Box>
  );
}

export default PacerControls;
