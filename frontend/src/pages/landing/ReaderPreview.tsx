import { Box, Paper, Stack, Typography } from "@mui/material";

const previewPosts = [
  {
    source: "Signal & Noise",
    title: "Designing calmer digital spaces",
    time: "8 min",
  },
  {
    source: "The Practical Web",
    title: "A better way to follow what matters",
    time: "5 min",
  },
  {
    source: "Field Notes",
    title: "Reading rituals for busy weeks",
    time: "11 min",
  },
];

export function ReaderPreview() {
  return (
    <Paper
      data-testid="reader-preview"
      aria-hidden="true"
      elevation={0}
      sx={{
        overflow: "hidden",
        border: 1,
        borderColor: "divider",
        boxShadow: "0 18px 50px rgba(28, 25, 23, 0.12)",
        transform: { md: "rotate(1deg)" },
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "96px minmax(0, 1fr)",
            sm: "132px minmax(0, 1fr)",
          },
          minHeight: { xs: 300, sm: 360 },
        }}
      >
        <Box
          sx={{
            borderRight: 1,
            borderColor: "divider",
            bgcolor: "background.default",
            p: 2,
          }}
        >
          <Typography variant="subtitle2" sx={{ mb: 2 }}>
            Almanac
          </Typography>
          <Stack spacing={1.5}>
            {["All posts", "Technology", "Design", "Culture"].map(
              (label, index) => (
                <Box
                  key={label}
                  sx={{
                    px: 1,
                    py: 0.75,
                    borderRadius: 1,
                    bgcolor:
                      index === 0
                        ? "rgba(180, 83, 9, 0.10)"
                        : "transparent",
                  }}
                >
                  <Typography
                    variant="caption"
                    color={index === 0 ? "primary.main" : "text.secondary"}
                  >
                    {label}
                  </Typography>
                </Box>
              )
            )}
          </Stack>
        </Box>

        <Box
          sx={{
            bgcolor: "background.paper",
            p: { xs: 1.5, sm: 2.5 },
          }}
        >
          <Typography variant="h6" sx={{ mb: 2 }}>
            Latest
          </Typography>
          <Stack spacing={1.25}>
            {previewPosts.map((post) => (
              <Box
                key={post.title}
                sx={{
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 2,
                  p: 1.5,
                }}
              >
                <Typography variant="caption" color="primary.main">
                  {post.source}
                </Typography>
                <Typography variant="body2" fontWeight={700}>
                  {post.title}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {post.time}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      </Box>
    </Paper>
  );
}
