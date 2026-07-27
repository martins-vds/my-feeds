/**
 * PostContent component - renders sanitized HTML content from posts
 */

import React, { useMemo } from "react";
import { Box, Typography } from "@mui/material";
import DOMPurify from "dompurify";
import { hasReadableContent } from "../utils/readableContent";

interface PostContentProps {
    content: string | null;
    summary: string | null;
}

// Feed content is untrusted third-party HTML. Open any links it contains in a
// new tab without leaking the referrer or the window handle.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
        node.setAttribute("target", "_blank");
        node.setAttribute("rel", "noopener noreferrer");
    }
});

/**
 * Sanitize untrusted feed HTML with DOMPurify to prevent XSS.
 *
 * DOMPurify already removes scripts, iframes, objects, embeds, event handlers
 * and dangerous URLs. Feed articles don't need <style> or form controls, so
 * those are dropped too.
 */
function sanitizeHtml(html: string): string {
    return DOMPurify.sanitize(html, {
        FORBID_TAGS: [
            "style",
            "form",
            "input",
            "button",
            "select",
            "textarea",
            "option",
        ],
    });
}

/**
 * PostContent renders the post's HTML content safely
 */
export const PostContent: React.FC<PostContentProps> = ({ content, summary }) => {
    // Use content if available, fall back to summary
    const displayContent = content || summary;

    // Posts with no real content (empty, or just a discussion/comments link
    // like Hacker News) are only available on the original site.
    const readable = useMemo(() => hasReadableContent(displayContent), [displayContent]);

    // Sanitize the HTML content
    const sanitizedContent = useMemo(() => {
        if (!readable || !displayContent) return null;
        return sanitizeHtml(displayContent);
    }, [readable, displayContent]);

    if (!sanitizedContent) {
        return (
            <Box sx={{ py: 4 }} data-testid="post-content">
                <Typography color="text.secondary" textAlign="center">
                    This article is only available on the original site.
                </Typography>
            </Box>
        );
    }

    return (
        <Box
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
    );
};

export default PostContent;
