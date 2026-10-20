/**
 * Sign In Page component
 * US1: OAuth authentication with GitHub, Google, Microsoft
 */

import {
    Box,
    Button,
    Card,
    CardContent,
    Container,
    Divider,
    Stack,
    Typography,
} from "@mui/material";
import GitHubIcon from "@mui/icons-material/GitHub";
import GoogleIcon from "@mui/icons-material/Google";
import { useAuth } from "../../contexts/AuthContext";

// Microsoft icon (not in MUI by default)
function MicrosoftIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="currentColor"
        >
            <path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z" />
        </svg>
    );
}

export function SignInPage() {
    const { login, isLoading } = useAuth();

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
                        {/* Header */}
                        <Box
                            sx={{
                                textAlign: "center",
                                mb: 4
                            }}>
                            <Typography variant="h4" component="h1" gutterBottom sx={{
                                fontWeight: 600
                            }}>
                                Almanac
                            </Typography>
                            <Typography variant="body1" sx={{
                                color: "text.secondary"
                            }}>
                                Sign in to access your personalized RSS feeds
                            </Typography>
                        </Box>

                        <Divider sx={{ my: 3 }} />

                        {/* OAuth Buttons */}
                        <Stack spacing={2}>
                            <Button
                                variant="contained"
                                size="large"
                                fullWidth
                                startIcon={<GitHubIcon />}
                                onClick={() => login("github")}
                                disabled={isLoading}
                                sx={{
                                    backgroundColor: "#24292e",
                                    "&:hover": { backgroundColor: "#1a1e22" },
                                }}
                            >
                                Continue with GitHub
                            </Button>

                            <Button
                                variant="contained"
                                size="large"
                                fullWidth
                                startIcon={<GoogleIcon />}
                                onClick={() => login("google")}
                                disabled={isLoading}
                                sx={{
                                    backgroundColor: "#4285f4",
                                    "&:hover": { backgroundColor: "#357abd" },
                                }}
                            >
                                Continue with Google
                            </Button>

                            <Button
                                variant="contained"
                                size="large"
                                fullWidth
                                startIcon={<MicrosoftIcon />}
                                onClick={() => login("microsoft")}
                                disabled={isLoading}
                                sx={{
                                    backgroundColor: "#00a4ef",
                                    "&:hover": { backgroundColor: "#0078d4" },
                                }}
                            >
                                Continue with Microsoft
                            </Button>
                        </Stack>

                        {/* Footer */}
                        <Box
                            sx={{
                                textAlign: "center",
                                mt: 4
                            }}>
                            <Typography variant="body2" sx={{
                                color: "text.secondary"
                            }}>
                                By signing in, you agree to our terms of service and privacy policy.
                            </Typography>
                        </Box>
                    </CardContent>
                </Card>
            </Box>
        </Container>
    );
}

export default SignInPage;
