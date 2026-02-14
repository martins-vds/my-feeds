/**
 * PostContent component - renders sanitized HTML content from posts
 */

import React, { useMemo } from "react";
import { Box, Typography } from "@mui/material";

interface PostContentProps {
    content: string | null;
    summary: string | null;
}

/**
 * Sanitize HTML content to prevent XSS
 * In a production app, use DOMPurify or similar
 */
function sanitizeHtml(html: string): string {
    // Basic sanitization - in production, use a library like DOMPurify
    // This is a simplified version for the demo
    const div = document.createElement("div");
    div.innerHTML = html;

    // Remove potentially dangerous elements
    const dangerousTags = ["script", "style", "iframe", "object", "embed", "form"];
    dangerousTags.forEach((tag) => {
        const elements = div.getElementsByTagName(tag);
        while (elements.length > 0) {
            elements[0].parentNode?.removeChild(elements[0]);
        }
    });

    // Remove event handlers from all elements
    const allElements = div.getElementsByTagName("*");
    for (const element of Array.from(allElements)) {
        const attributes = Array.from(element.attributes);
        for (const attr of attributes) {
            if (attr.name.startsWith("on") || attr.value.startsWith("javascript:")) {
                element.removeAttribute(attr.name);
            }
        }
    }

    return div.innerHTML;
}

/**
 * PostContent renders the post's HTML content safely
 */
export const PostContent: React.FC<PostContentProps> = ({ content, summary }) => {
    // Use content if available, fall back to summary
    const displayContent = content || summary;

    // Sanitize the HTML content
    const sanitizedContent = useMemo(() => {
        if (!displayContent) return null;
        return sanitizeHtml(displayContent);
    }, [displayContent]);

    if (!sanitizedContent) {
        return (
            <Box sx={{ py: 4 }} data-testid="post-content">
                <Typography color="text.secondary" textAlign="center">
                    No content available
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
