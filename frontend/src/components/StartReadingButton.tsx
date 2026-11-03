import { useId, useState } from "react";
import { Button, ButtonGroup, Menu, MenuItem } from "@mui/material";
import PlayIcon from "@mui/icons-material/PlayArrow";
import ArrowDropDownIcon from "@mui/icons-material/ArrowDropDown";
import type { ReadingMode } from "../hooks/useReadAlongPreferences";
import { displayPercent } from "../utils/readingProgress";

interface StartReadingButtonProps {
  /** How far through the article the reader is, from 0 to 1. */
  progress: number;
  isRead: boolean;
  /** The remembered mode: what the main button starts and which menu item is marked. */
  mode: ReadingMode;
  /** Called with the mode to start in. The parent also remembers it as the new default. */
  onStart: (mode: ReadingMode) => void;
}

function mainLabel(progress: number, isRead: boolean): string {
  if (isRead) return "Read again";
  if (progress > 0) return `Continue reading · ${displayPercent(progress)}%`;
  return "Start reading";
}

/**
 * The idle reading surface, a split button. The main button starts reading in the remembered
 * mode and its label says where the reader is; the arrow opens a menu to start in either mode.
 */
export function StartReadingButton({ progress, isRead, mode, onStart }: StartReadingButtonProps) {
  const menuId = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = Boolean(anchor);

  const choose = (chosen: ReadingMode) => {
    setAnchor(null);
    onStart(chosen);
  };

  return (
    <>
      <ButtonGroup variant="outlined" size="small">
        <Button
          onClick={() => onStart(mode)}
          startIcon={<PlayIcon />}
          data-testid="start-reading-button"
        >
          {mainLabel(progress, isRead)}
        </Button>
        <Button
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-label="Choose how to read"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          data-testid="start-reading-menu"
        >
          <ArrowDropDownIcon />
        </Button>
      </ButtonGroup>
      <Menu
        anchorEl={anchor}
        open={open}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { id: menuId, "aria-label": "Reading mode" } }}
      >
        <MenuItem
          role="menuitemradio"
          selected={mode === "sound"}
          onClick={() => choose("sound")}
          data-testid="read-with-sound"
        >
          Read with sound
        </MenuItem>
        <MenuItem
          role="menuitemradio"
          selected={mode === "silent"}
          onClick={() => choose("silent")}
          data-testid="read-silently"
        >
          Read silently
        </MenuItem>
      </Menu>
    </>
  );
}

export default StartReadingButton;
