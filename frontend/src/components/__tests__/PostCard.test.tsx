import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PostCard } from "../PostCard";
import type { PostSummary } from "../../hooks/usePostsData";

function makePost(overrides: Partial<PostSummary> = {}): PostSummary {
  return {
    id: "post-1",
    feedId: "feed-1",
    feedTitle: "Test Feed",
    feedIconUrl: null,
    title: "Test Post Title",
    summary: "A short summary",
    author: "Author Name",
    link: "https://example.com/1",
    publishedAt: "2026-02-13T12:00:00Z",
    isRead: false,
    readProgress: 0,
    isSeen: false,
    hasAudio: false,
    hasContent: true,
    ...overrides,
  };
}

describe("PostCard reading state", () => {
  it("shows no reading hints for an article that was never opened", () => {
    render(<PostCard post={makePost()} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Opened")).not.toBeInTheDocument();
  });

  it("says Opened when the article was opened but not read", () => {
    render(<PostCard post={makePost({ isSeen: true })} />);

    expect(screen.getByText("Opened")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows a progress bar and percent for an article in progress", () => {
    render(<PostCard post={makePost({ isSeen: true, readProgress: 0.42 })} />);

    const bar = screen.getByRole("progressbar", { name: "Reading progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.queryByText("Opened")).not.toBeInTheDocument();
  });

  it("never shows 0% for a started article", () => {
    render(<PostCard post={makePost({ isSeen: true, readProgress: 0.004 })} />);

    expect(screen.getByText("1%")).toBeInTheDocument();
  });

  it("shows nothing extra once the article is read", () => {
    render(<PostCard post={makePost({ isRead: true, readProgress: 1, isSeen: true })} />);

    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByText("Opened")).not.toBeInTheDocument();
    expect(screen.queryByText("100%")).not.toBeInTheDocument();
  });
});
