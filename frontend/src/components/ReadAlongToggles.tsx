/**
 * Two accessible, independent read-along switches ("Highlight while playing"
 * and "Auto-scroll while playing"). Keyboard-operable and screen-reader
 * friendly via MUI Switch; on/off state is exposed to assistive tech.
 */

import { Box, FormControlLabel, Switch } from "@mui/material";

interface ReadAlongTogglesProps {
    highlight: boolean;
    onHighlightChange: (value: boolean) => void;
    autoScroll: boolean;
    onAutoScrollChange: (value: boolean) => void;
}

export function ReadAlongToggles({
    highlight,
    onHighlightChange,
    autoScroll,
    onAutoScrollChange,
}: ReadAlongTogglesProps) {
    return (
        <Box
            data-testid="read-along-toggles"
            sx={{ display: "flex", flexWrap: "wrap", gap: 2, mt: 1 }}
        >
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
        </Box>
    );
}

export default ReadAlongToggles;
