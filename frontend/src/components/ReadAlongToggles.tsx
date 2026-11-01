/**
 * Two accessible, independent read-along switches ("Highlight while playing"
 * and "Auto-scroll while playing"). Keyboard-operable and screen-reader
 * friendly via MUI Switch; on/off state is exposed to assistive tech.
 */

import { Box, FormControlLabel, Switch, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { supportsContinuousHighlight, type HighlightMode } from "../hooks/useReadAlong";

interface ReadAlongTogglesProps {
  highlight: boolean;
  onHighlightChange: (value: boolean) => void;
  autoScroll: boolean;
  onAutoScrollChange: (value: boolean) => void;
  highlightMode: HighlightMode;
  onHighlightModeChange: (value: HighlightMode) => void;
}

export function ReadAlongToggles({
  highlight,
  onHighlightChange,
  autoScroll,
  onAutoScrollChange,
  highlightMode,
  onHighlightModeChange,
}: ReadAlongTogglesProps) {
  const continuousSupported = supportsContinuousHighlight();
  return (
    <Box data-testid="read-along-toggles" sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 2, mt: 1 }}>
      <FormControlLabel
        control={
          <Switch
            checked={highlight}
            onChange={(e) => onHighlightChange(e.target.checked)}
            size="small"
            slotProps={{ input: { "aria-label": "Highlight while playing" } }}
            data-testid="toggle-highlight"
          />
        }
        label="Highlight while playing"
      />
      <FormControlLabel
        control={
          <Switch
            checked={autoScroll}
            onChange={(e) => onAutoScrollChange(e.target.checked)}
            size="small"
            slotProps={{ input: { "aria-label": "Auto-scroll while playing" } }}
            data-testid="toggle-autoscroll"
          />
        }
        label="Auto-scroll while playing"
      />
      <ToggleButtonGroup
        size="small"
        exclusive
        value={continuousSupported ? highlightMode : "word"}
        aria-label="Highlight mode"
        onChange={(_, value: HighlightMode | null) => {
          if (value === "word" || value === "continuous") onHighlightModeChange(value);
        }}
      >
        <ToggleButton value="word">Word by word</ToggleButton>
        <ToggleButton value="continuous" disabled={!continuousSupported}>Continuous</ToggleButton>
      </ToggleButtonGroup>
      {!continuousSupported && (
        <Typography variant="caption" color="text.secondary" sx={{ width: "100%" }}>
          Continuous highlighting needs a newer browser. Using word by word.
        </Typography>
      )}
    </Box>
  );
}

export default ReadAlongToggles;
