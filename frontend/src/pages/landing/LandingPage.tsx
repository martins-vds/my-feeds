import AutoStoriesOutlinedIcon from "@mui/icons-material/AutoStoriesOutlined";
import CloudDoneOutlinedIcon from "@mui/icons-material/CloudDoneOutlined";
import HeadphonesOutlinedIcon from "@mui/icons-material/HeadphonesOutlined";
import {
  Box,
  Button,
  CircularProgress,
  Container,
  Link,
  Stack,
  Typography,
} from "@mui/material";
import { Link as RouterLink, Navigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { ReaderPreview } from "./ReaderPreview";

const features = [
  {
    icon: <AutoStoriesOutlinedIcon color="primary" />,
    title: "Organize your feeds",
    body: "Group the sources you trust into categories that match how you read.",
  },
  {
    icon: <HeadphonesOutlinedIcon color="primary" />,
    title: "Listen on your terms",
    body: "Turn saved articles into audio when reading is not convenient.",
  },
  {
    icon: <CloudDoneOutlinedIcon color="primary" />,
    title: "Keep reading offline",
    body: "Install Almanac as a PWA and keep your reading flow close at hand.",
  },
];

export function LandingPage() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Box
        role="status"
        aria-label="Checking authentication"
        sx={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/posts" replace />;
  }

  return (
    <Box sx={{ minHeight: "100vh", overflow: "hidden" }}>
      <Box
        component="header"
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Container maxWidth="lg">
          <Box
            sx={{
              minHeight: 72,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Typography variant="h6" component="span">
              Almanac
            </Typography>
            <Link
              component={RouterLink}
              to="/signin"
              color="text.primary"
              underline="hover"
              fontWeight={600}
            >
              Sign in
            </Link>
          </Box>
        </Container>
      </Box>

      <Box component="main">
        <Container maxWidth="lg">
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "minmax(0, 0.9fr) minmax(420px, 1.1fr)",
              },
              gap: { xs: 6, md: 8 },
              alignItems: "center",
              py: { xs: 8, md: 12 },
            }}
          >
            <Stack spacing={3} alignItems="flex-start">
              <Typography color="primary.main" fontWeight={700}>
                YOUR READING, RECLAIMED
              </Typography>
              <Typography component="h1" variant="h1">
                A calmer way to follow the web.
              </Typography>
              <Typography
                variant="h6"
                color="text.secondary"
                fontWeight={400}
              >
                Organize the feeds you trust, read without algorithmic noise,
                and listen when you are on the move.
              </Typography>
              <Button
                component={RouterLink}
                to="/signin"
                variant="contained"
                size="large"
              >
                Start reading
              </Button>
            </Stack>

            <ReaderPreview />
          </Box>

          <Box
            component="section"
            aria-label="Almanac features"
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "1fr",
                md: "repeat(3, 1fr)",
              },
              gap: 3,
              pb: { xs: 8, md: 12 },
            }}
          >
            {features.map((feature) => (
              <Stack key={feature.title} spacing={1.5} sx={{ p: 3 }}>
                {feature.icon}
                <Typography variant="h4" component="h2">
                  {feature.title}
                </Typography>
                <Typography color="text.secondary">{feature.body}</Typography>
              </Stack>
            ))}
          </Box>
        </Container>
      </Box>
    </Box>
  );
}
