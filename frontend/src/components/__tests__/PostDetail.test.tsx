/**
 * Vitest unit tests for PostContent component and PostDetailPage
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostContent } from "../PostContent";

describe("PostContent", () => {
  describe("rendering", () => {
    it("should display 'No content available' when both content and summary are null", () => {
      render(<PostContent content={null} summary={null} />);
      expect(screen.getByText("No content available")).toBeInTheDocument();
    });

    it("should render content when provided", () => {
      render(<PostContent content="<p>Hello World</p>" summary={null} />);
      expect(screen.getByText("Hello World")).toBeInTheDocument();
    });

    it("should fall back to summary when content is null", () => {
      render(<PostContent content={null} summary="<p>Summary text</p>" />);
      expect(screen.getByText("Summary text")).toBeInTheDocument();
    });

    it("should prefer content over summary when both exist", () => {
      render(<PostContent content="<p>Full content</p>" summary="<p>Brief summary</p>" />);
      expect(screen.getByText("Full content")).toBeInTheDocument();
      expect(screen.queryByText("Brief summary")).not.toBeInTheDocument();
    });

    it("should render the 'post-content' test ID", () => {
      render(<PostContent content="<p>Test</p>" summary={null} />);
      expect(screen.getByTestId("post-content")).toBeInTheDocument();
    });
  });

  describe("HTML rendering", () => {
    it("should render headings from HTML", () => {
      render(<PostContent content="<h2>My Heading</h2><p>Paragraph text</p>" summary={null} />);
      expect(screen.getByText("My Heading")).toBeInTheDocument();
      expect(screen.getByText("Paragraph text")).toBeInTheDocument();
    });

    it("should render links from HTML", () => {
      render(
        <PostContent content='<p>Click <a href="https://example.com">here</a></p>' summary={null} />
      );
      const link = screen.getByText("here");
      expect(link).toBeInTheDocument();
      expect(link.closest("a")).toHaveAttribute("href", "https://example.com");
    });

    it("should render lists from HTML", () => {
      render(<PostContent content="<ul><li>Item 1</li><li>Item 2</li></ul>" summary={null} />);
      expect(screen.getByText("Item 1")).toBeInTheDocument();
      expect(screen.getByText("Item 2")).toBeInTheDocument();
    });
  });

  describe("sanitization", () => {
    it("should strip script tags from content", () => {
      render(
        <PostContent content='<p>Safe text</p><script>alert("xss")</script>' summary={null} />
      );
      expect(screen.getByText("Safe text")).toBeInTheDocument();
      expect(document.querySelector("script")).toBeNull();
    });

    it("should strip iframe tags from content", () => {
      render(
        <PostContent content='<p>Visible</p><iframe src="evil.com"></iframe>' summary={null} />
      );
      expect(screen.getByText("Visible")).toBeInTheDocument();
      expect(document.querySelector("iframe")).toBeNull();
    });

    it("should strip style tags from content", () => {
      render(
        <PostContent content="<p>Styled text</p><style>body{display:none}</style>" summary={null} />
      );
      expect(screen.getByText("Styled text")).toBeInTheDocument();
      // PostContent sanitizes by removing <style> tags from its own content.
      // MUI/emotion may inject its own <style> elements, so check within post-content.
      const postContent = screen.getByTestId("post-content");
      expect(postContent.querySelector("style")).toBeNull();
    });

    it("should strip event handler attributes from elements", () => {
      render(<PostContent content='<p onclick="alert(1)">Click me</p>' summary={null} />);
      const element = screen.getByText("Click me");
      expect(element).not.toHaveAttribute("onclick");
    });

    it("should strip javascript: protocol from href attributes", () => {
      render(<PostContent content='<a href="javascript:alert(1)">Bad link</a>' summary={null} />);
      const link = screen.getByText("Bad link");
      expect(link).not.toHaveAttribute("href", "javascript:alert(1)");
    });

    it("should strip form elements from content", () => {
      render(
        <PostContent
          content='<form action="/submit"><input type="text"/></form><p>After form</p>'
          summary={null}
        />
      );
      expect(screen.getByText("After form")).toBeInTheDocument();
      expect(document.querySelector("form")).toBeNull();
    });

    it("should strip embed and object tags from content", () => {
      render(
        <PostContent
          content='<object data="flash.swf"></object><embed src="flash.swf" /><p>Text</p>'
          summary={null}
        />
      );
      expect(screen.getByText("Text")).toBeInTheDocument();
      expect(document.querySelector("object")).toBeNull();
      expect(document.querySelector("embed")).toBeNull();
    });
  });
});
