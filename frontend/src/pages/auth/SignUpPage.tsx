/**
 * Sign Up Page component
 * US1: Post-OAuth sign-up form for new users
 *
 * Displays a form to confirm display name and select timezone
 * after first OAuth authentication. Pre-populated from OAuth data (US3).
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Container,
  Divider,
  TextField,
  Typography,
} from "@mui/material";
import { useAuth } from "../../contexts/AuthContext";
import { completeSignup, ApiError } from "../../services/api";

/**
 * Get list of IANA timezones, with fallback for older browsers.
 */
function getTimezones(): string[] {
  try {
    // Modern browsers support Intl.supportedValuesOf
    return Intl.supportedValuesOf("timeZone");
  } catch {
    // Fallback: common timezones
    return [
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "Pacific/Honolulu",
      "America/Toronto",
      "America/Vancouver",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
      "America/Mexico_City",
      "Europe/London",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Moscow",
      "Europe/Istanbul",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Shanghai",
      "Asia/Tokyo",
      "Asia/Seoul",
      "Asia/Singapore",
      "Australia/Sydney",
      "Australia/Melbourne",
      "Pacific/Auckland",
      "Africa/Cairo",
      "Africa/Johannesburg",
      "Africa/Lagos",
    ];
  }
}

/**
 * Detect the user's timezone from the browser.
 */
function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const TIMEZONES = getTimezones();

export function SignUpPage() {
  const navigate = useNavigate();
  const { isPendingSignup, pendingProfile, refreshUser } = useAuth();

  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(detectTimezone());
  const [nameError, setNameError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState("");

  // Guard: redirect if no pending sign-up
  useEffect(() => {
    if (!isPendingSignup) {
      navigate("/signin", { replace: true });
    }
  }, [isPendingSignup, navigate]);

  // Pre-fill name from OAuth profile (US3)
  useEffect(() => {
    if (pendingProfile?.name) {
      setName(pendingProfile.name);
    }
  }, [pendingProfile]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerError("");

    // Validate name
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Display name is required");
      return;
    }
    if (trimmedName.length > 255) {
      setNameError("Display name must be 255 characters or fewer");
      return;
    }
    setNameError("");

    setIsSubmitting(true);
    try {
      await completeSignup(trimmedName, timezone);
      await refreshUser();
      navigate("/posts", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409) {
          setServerError("Account already exists. Redirecting to sign-in...");
          setTimeout(() => navigate("/signin", { replace: true }), 2000);
        } else if (err.status === 401) {
          setServerError("Sign-up session expired. Please sign in again.");
          setTimeout(() => navigate("/signin", { replace: true }), 2000);
        } else {
          setServerError(err.message || "Sign-up failed. Please try again.");
        }
      } else {
        setServerError("An unexpected error occurred. Please try again.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isPendingSignup) {
    return null; // Will redirect via useEffect
  }

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          py: 4,
        }}
      >
        <Card elevation={3}>
          <CardContent sx={{ p: 4 }}>
            {/* Header with avatar */}
            <Box textAlign="center" mb={3}>
              {pendingProfile?.avatarUrl && (
                <Avatar
                  src={pendingProfile.avatarUrl}
                  alt={pendingProfile.name || "Profile"}
                  sx={{ width: 80, height: 80, mx: "auto", mb: 2 }}
                />
              )}
              {!pendingProfile?.avatarUrl && (
                <Avatar
                  sx={{
                    width: 80,
                    height: 80,
                    mx: "auto",
                    mb: 2,
                    bgcolor: "primary.main",
                    fontSize: 32,
                  }}
                >
                  {(pendingProfile?.name || pendingProfile?.email || "?").charAt(0).toUpperCase()}
                </Avatar>
              )}
              <Typography variant="h5" component="h1" gutterBottom fontWeight={600}>
                Complete Your Profile
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Just a few more details to get started
              </Typography>
            </Box>

            {/* Read-only email from OAuth */}
            {pendingProfile?.email && (
              <Typography variant="body2" color="text.secondary" textAlign="center" mb={2}>
                Signing up as <strong>{pendingProfile.email}</strong>
              </Typography>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Server error */}
            {serverError && (
              <Typography color="error" variant="body2" textAlign="center" mb={2}>
                {serverError}
              </Typography>
            )}

            {/* Sign-up form */}
            <Box component="form" onSubmit={handleSubmit}>
              <TextField
                label="Display Name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (nameError) setNameError("");
                }}
                error={!!nameError}
                helperText={nameError}
                fullWidth
                required
                autoFocus
                sx={{ mb: 2 }}
                inputProps={{ maxLength: 255 }}
              />

              <Autocomplete
                options={TIMEZONES}
                value={timezone}
                onChange={(_e, newValue) => {
                  if (newValue) setTimezone(newValue);
                }}
                renderInput={(params) => (
                  <TextField {...params} label="Timezone" required fullWidth />
                )}
                disableClearable
                sx={{ mb: 3 }}
              />

              <Button
                type="submit"
                variant="contained"
                size="large"
                fullWidth
                disabled={isSubmitting}
                startIcon={
                  isSubmitting ? <CircularProgress size={20} color="inherit" /> : undefined
                }
              >
                {isSubmitting ? "Creating Account..." : "Complete Sign Up"}
              </Button>
            </Box>
          </CardContent>
        </Card>
      </Box>
    </Container>
  );
}

export default SignUpPage;
