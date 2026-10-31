/**
 * PostContent component - renders sanitized HTML content from posts
 */

import React, { useId, useMemo, useState } from "react";
import { Alert, Box, Button, Typography, Checkbox, FormControlLabel } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import DOMPurify from "dompurify";
import { hasReadableContent } from "../utils/readableContent";
import { usePublisherImages } from "../hooks/usePublisherImages";

interface PostContentProps {
  content: string | null;
  summary: string | null;
  userId?: string;
}

// Feed content is untrusted third-party HTML. Open any links it contains in a
// new tab without leaking the referrer or the window handle.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
  if (node.tagName === "IMG") {
    const src = node.getAttribute("src");
    if (src) {
      try {
        const url = new URL(src, window.location.origin);
        if (!["http:", "https:"].includes(url.protocol) || url.pathname.startsWith("/api/")) {
          node.removeAttribute("src");
        } else {
          node.setAttribute("src", url.href);
        }
      } catch {
        node.removeAttribute("src");
      }
    }
    node.setAttribute("referrerpolicy", "no-referrer");
    node.setAttribute("loading", "lazy");
    if (!node.hasAttribute("src")) node.setAttribute("hidden", "");
  }
});

/**
 * Sanitize untrusted feed HTML with DOMPurify to prevent XSS.
 *
 * DOMPurify already removes scripts, iframes, objects, embeds, event handlers
 * and dangerous URLs. Feed articles don't need <style> or form controls, so
 * those are dropped too.
 */
function sanitizeHtml(html: string, allowImages: boolean): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: [
      "style",
      "form",
      "input",
      "button",
      "select",
      "textarea",
      "option",
      "svg",
      "math",
      "video",
      "audio",
      "source",
      "track",
      "iframe",
      "object",
      "embed",
    ],
    FORBID_ATTR: [
      "style",
      "srcset",
      "poster",
      "background",
      "ping",
      ...(allowImages ? [] : ["src"]),
    ],
  });
}

/**
 * PostContent renders the post's HTML content safely.
 *
 * Forwards a ref to the rendered article container so the read-along layer can
 * wrap its words for highlighting (sanitization is unchanged).
 */
export const PostContent = React.forwardRef<HTMLDivElement, PostContentProps>(function PostContent(
  { content, summary, userId },
  ref
) {
  // Use content if available, fall back to summary
  const displayContent = content || summary;
  const { allowed, setAllowed, canOptIn, operatorAllowed } = usePublisherImages(userId);
  const [showImageDetails, setShowImageDetails] = useState(false);
  const imagePrivacyId = useId();

  // Posts with no real content (empty, or just a discussion/comments link
  // like Hacker News) are only available on the original site.
  const readable = useMemo(() => hasReadableContent(displayContent), [displayContent]);

  // Sanitize the HTML content
  const sanitizedContent = useMemo(() => {
    if (!readable || !displayContent) return null;
    return sanitizeHtml(displayContent, allowed);
  }, [readable, displayContent, allowed]);

  if (!sanitizedContent) {
    return (
      <Box sx={{ py: 4 }} data-testid="post-content">
        <Typography
          sx={{
            color: "text.secondary",
            textAlign: "center",
          }}
        >
          This article is only available on the original site.
        </Typography>
      </Box>
    );
  }

  return (
    <>
      <Box sx={{ mb: 2 }}>
        {operatorAllowed ? (
          <>
            <FormControlLabel
              control={
                <Checkbox
                  checked={allowed}
                  disabled={!canOptIn}
                  onChange={(_, checked) => setAllowed(checked)}
                  slotProps={{ input: { "aria-describedby": imagePrivacyId } }}
                />
              }
              label="Load publisher images for this account"
            />
            <Typography id={imagePrivacyId} variant="body2" color="text.secondary">
              Images are blocked by default. Loading them shares your IP address and may reveal which
              article you are reading to the publisher. This choice applies only to your account.
            </Typography>
          </>
        ) : (
          <Alert
            severity="warning"
            icon={false}
            role="note"
            aria-label="Image security notice"
            sx={{ py: 0.5, "& .MuiAlert-message": { width: "100%", minWidth: 0 } }}
          >
            <Box sx={{
              display: "grid",
              gridTemplateColumns: { xs: "22px minmax(0, 1fr)", sm: "22px minmax(0, max-content) auto" },
              alignItems: "center",
              columnGap: 1.5,
            }}>
              <WarningAmberIcon sx={{ fontSize: 22, color: "warning.main" }} />
              <Typography variant="body2">Images disabled for security reasons.</Typography>
              <Button
                color="inherit"
                size="small"
                aria-expanded={showImageDetails}
                aria-controls={showImageDetails ? imagePrivacyId : undefined}
                onClick={() => setShowImageDetails((shown) => !shown)}
                sx={{
                  gridColumn: { xs: 2, sm: "auto" },
                  justifySelf: "start",
                  textTransform: "none",
                  textDecoration: "underline",
                  minHeight: 44,
                }}
              >
                Learn more
              </Button>
              {showImageDetails && (
                <Typography id={imagePrivacyId} variant="body2" sx={{ mt: 0.5, gridColumn: "2 / -1" }}>
                  Loading publisher images shares your IP address and may reveal which article you
                  are reading to the publisher. Image loading is disabled by this app&apos;s operator.
                </Typography>
              )}
            </Box>
          </Alert>
        )}
      </Box>
      <Box
        ref={ref}
        data-testid="post-content"
        sx={{
          // Typography styles for article content
          "& h1, & h2, & h3, & h4, & h5, & h6": {
            mt: 3,
            mb: 1,
            fontWeight: "bold",
          },
          "& h1": { fontSize: "1.75rem" },
          "& h2": { fontSize: "1.5rem" },
          "& h3": { fontSize: "1.25rem" },
          "& p": {
            my: 1.5,
            lineHeight: 1.7,
          },
          "& a": {
            color: "primary.main",
            textDecoration: "underline",
            "&:hover": {
              textDecoration: "none",
            },
          },
          "& img": {
            maxWidth: "100%",
            height: "auto",
            borderRadius: 1,
            my: 2,
          },
          "& pre, & code": {
            backgroundColor: "grey.100",
            borderRadius: 1,
            fontFamily: "monospace",
            fontSize: "0.875rem",
          },
          "& pre": {
            p: 2,
            overflow: "auto",
          },
          "& code": {
            px: 0.5,
          },
          "& blockquote": {
            borderLeft: 4,
            borderColor: "primary.main",
            pl: 2,
            ml: 0,
            my: 2,
            fontStyle: "italic",
          },
          "& ul, & ol": {
            pl: 3,
            my: 1.5,
          },
          "& li": {
            my: 0.5,
          },
          "& table": {
            width: "100%",
            borderCollapse: "collapse",
            my: 2,
          },
          "& th, & td": {
            border: 1,
            borderColor: "divider",
            p: 1,
            textAlign: "left",
          },
          "& th": {
            backgroundColor: "grey.50",
            fontWeight: "bold",
          },
          "& figure": {
            my: 2,
            mx: 0,
          },
          "& figcaption": {
            fontSize: "0.875rem",
            color: "text.secondary",
            textAlign: "center",
            mt: 1,
          },
        }}
        dangerouslySetInnerHTML={{ __html: sanitizedContent }}
      />
    </>
  );
});

export default PostContent;
