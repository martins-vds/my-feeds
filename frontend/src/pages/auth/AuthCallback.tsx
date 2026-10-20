/**
 * OAuth Callback Page
 * Handles the redirect from OAuth providers
 */

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Box, CircularProgress, Typography, Alert, Container } from "@mui/material";
import { useAuth } from "../../contexts/AuthContext";

export function AuthCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { refreshUser, isAuthenticated } = useAuth();
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        // Check for OAuth error
        const oauthError = searchParams.get("error");
        const errorDescription = searchParams.get("error_description");

        if (oauthError) {
            setError(errorDescription || "Authentication failed. Please try again.");
            return;
        }

        // If no error, refresh user and redirect
        const handleCallback = async () => {
            try {
                await refreshUser();
            } catch (err) {
                setError(err instanceof Error ? err.message : "Authentication failed");
            }
        };

        handleCallback();
    }, [searchParams, refreshUser]);

    // Redirect when authenticated
    useEffect(() => {
        if (isAuthenticated) {
            navigate("/posts", { replace: true });
        }
    }, [isAuthenticated, navigate]);

    if (error) {
        return (
            <Container maxWidth="sm">
                <Box
                    sx={{
                        minHeight: "100vh",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "center",
                        alignItems: "center",
                    }}
                >
                    <Alert
                        severity="error"
                        sx={{ mb: 2 }}
                        action={
                            <Typography
                                component="a"
                                href="/signin"
                                sx={{ cursor: "pointer", textDecoration: "underline" }}
                            >
                                Try again
                            </Typography>
                        }
                    >
                        {error}
                    </Alert>
                </Box>
            </Container>
        );
    }

    return (
        <Container maxWidth="sm">
            <Box
                sx={{
                    minHeight: "100vh",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                }}
            >
                <CircularProgress size={48} sx={{ mb: 2 }} />
                <Typography variant="body1" sx={{
                    color: "text.secondary"
                }}>
                    Completing sign in...
                </Typography>
            </Box>
        </Container>
    );
}

export default AuthCallback;
