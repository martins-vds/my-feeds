import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { ReactNode } from "react";

/**
 * Almanac Material UI theme.
 *
 * Content-first "reading" aesthetic: an accessible, highly legible typeface
 * (Atkinson Hyperlegible), a warm paper background, and a calm amber accent.
 * Tuned for WCAG AA contrast and reduced-motion friendliness.
 */

const FONT_STACK = [
  '"Atkinson Hyperlegible"',
  "-apple-system",
  "BlinkMacSystemFont",
  '"Segoe UI"',
  "Roboto",
  '"Helvetica Neue"',
  "Arial",
  "sans-serif",
].join(",");

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#B45309", // amber-800 — AA with white text
      light: "#D97706",
      dark: "#92400E",
      contrastText: "#ffffff",
    },
    secondary: {
      main: "#57534E", // stone-600
      light: "#78716C",
      dark: "#44403C",
      contrastText: "#ffffff",
    },
    error: { main: "#DC2626" },
    success: { main: "#15803D" },
    warning: { main: "#B45309" },
    background: {
      default: "#FAF7F0", // warm paper
      paper: "#FFFFFF",
    },
    text: {
      primary: "#1C1917", // stone-900
      secondary: "#57534E",
    },
    divider: "#E7E2D9",
  },
  typography: {
    fontFamily: FONT_STACK,
    fontSize: 15,
    h1: { fontSize: "2.5rem", fontWeight: 700, letterSpacing: "-0.02em" },
    h2: { fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.01em" },
    h3: { fontSize: "1.5rem", fontWeight: 700 },
    h4: { fontSize: "1.25rem", fontWeight: 700 },
    h6: { fontWeight: 700 },
    body1: { lineHeight: 1.7 },
    body2: { lineHeight: 1.6 },
    button: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: "#FAF7F0",
          WebkitFontSmoothing: "antialiased",
        },
        // Respect users who prefer reduced motion.
        "@media (prefers-reduced-motion: reduce)": {
          "*, *::before, *::after": {
            animationDuration: "0.01ms !important",
            animationIterationCount: "1 !important",
            transitionDuration: "0.01ms !important",
            scrollBehavior: "auto !important",
          },
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          border: `1px solid ${t.palette.divider}`,
          boxShadow:
            "0 1px 2px rgba(28,25,23,0.04), 0 2px 6px rgba(28,25,23,0.05)",
          transition: "box-shadow 200ms ease, border-color 200ms ease",
        }),
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          backgroundColor: t.palette.background.paper,
          color: t.palette.text.primary,
          boxShadow: "none",
          borderBottom: `1px solid ${t.palette.divider}`,
        }),
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme: t }) => ({
          borderRadius: t.shape.borderRadius,
          marginInline: 4,
          "&.Mui-selected": {
            backgroundColor: "rgba(180,83,9,0.10)",
            "&:hover": { backgroundColor: "rgba(180,83,9,0.16)" },
          },
        }),
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          textTransform: "none",
          fontWeight: 600,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600 },
      },
    },
  },
});

/**
 * Theme provider wrapper component
 */
interface ThemeWrapperProps {
  children: ReactNode;
}

export function ThemeWrapper({ children }: ThemeWrapperProps) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export default theme;
