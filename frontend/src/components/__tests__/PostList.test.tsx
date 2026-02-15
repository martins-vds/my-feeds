/**
 * Vitest unit tests for PostList component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PostList } from "../PostList";
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
    hasAudio: false,
    ...overrides,
  };
}

describe("PostList", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("rendering", () => {
    it("should display loading state initially", () => {
      render(
        <PostList posts={[]} loading={true} loadingMore={false} hasMore={false} error={null} />
      );
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("should display empty state when no posts exist", () => {
      render(
        <PostList posts={[]} loading={false} loadingMore={false} hasMore={false} error={null} />
      );
      expect(screen.getByTestId("posts-empty")).toBeInTheDocument();
      expect(screen.getByText(/no posts found/i)).toBeInTheDocument();
    });

    it("should display posts sorted by date descending", () => {
      const posts = [
        makePost({ id: "a", title: "Newer", publishedAt: "2026-02-14T00:00:00Z" }),
        makePost({ id: "b", title: "Older", publishedAt: "2026-02-12T00:00:00Z" }),
      ];
      render(
        <PostList posts={posts} loading={false} loadingMore={false} hasMore={false} error={null} />
      );
      expect(screen.getByText("Newer")).toBeInTheDocument();
      expect(screen.getByText("Older")).toBeInTheDocument();
    });

    it("should display post title, summary, and metadata", () => {
      render(
        <PostList
          posts={[makePost({ title: "My Great Post", feedTitle: "Cool Feed" })]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
        />
      );
      expect(screen.getByText("My Great Post")).toBeInTheDocument();
      expect(screen.getByText("Cool Feed")).toBeInTheDocument();
    });

    it("should display feed title for each post", () => {
      render(
        <PostList
          posts={[makePost({ feedTitle: "Feed Alpha" })]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
        />
      );
      expect(screen.getByText("Feed Alpha")).toBeInTheDocument();
    });

    it("should display error state on API failure", () => {
      render(
        <PostList
          posts={[]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error="Network error"
        />
      );
      expect(screen.getByTestId("posts-error")).toBeInTheDocument();
      expect(screen.getByText("Network error")).toBeInTheDocument();
    });
  });

  describe("read state indicator", () => {
    it("should visually distinguish read and unread posts", () => {
      const posts = [
        makePost({ id: "read-1", isRead: true }),
        makePost({ id: "unread-1", isRead: false }),
      ];
      render(
        <PostList posts={posts} loading={false} loadingMore={false} hasMore={false} error={null} />
      );
      expect(screen.getByTestId("post-card-read-1")).toBeInTheDocument();
      expect(screen.getByTestId("post-card-unread-1")).toBeInTheDocument();
    });
  });

  describe("filtering", () => {
    it("should filter by category when category selected", () => {
      render(
        <PostList
          posts={[makePost({ feedTitle: "Cat A Feed" })]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
        />
      );
      expect(screen.getByText("Cat A Feed")).toBeInTheDocument();
    });

    it("should filter by feed when feed selected", () => {
      render(
        <PostList
          posts={[makePost({ feedTitle: "Specific Feed" })]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
        />
      );
      expect(screen.getByText("Specific Feed")).toBeInTheDocument();
    });

    it("should filter by unread when readState is unread", () => {
      render(
        <PostList
          posts={[makePost({ title: "Unread Post", isRead: false })]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
        />
      );
      expect(screen.getByText("Unread Post")).toBeInTheDocument();
    });
  });

  describe("pagination", () => {
    it("should show load more button when hasMore is true", () => {
      render(
        <PostList
          posts={[makePost()]}
          loading={false}
          loadingMore={false}
          hasMore={true}
          error={null}
        />
      );
      expect(screen.getByTestId("load-more-button")).toBeInTheDocument();
    });

    it("should load more posts when clicking load more", async () => {
      const onLoadMore = vi.fn();
      render(
        <PostList
          posts={[makePost()]}
          loading={false}
          loadingMore={false}
          hasMore={true}
          error={null}
          onLoadMore={onLoadMore}
        />
      );
      await userEvent.click(screen.getByTestId("load-more-button"));
      expect(onLoadMore).toHaveBeenCalledOnce();
    });

    it("should not show load more when hasMore is false", () => {
      render(
        <PostList
          posts={[makePost()]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
        />
      );
      expect(screen.queryByTestId("load-more-button")).not.toBeInTheDocument();
    });
  });

  describe("interaction", () => {
    it("should navigate to post detail when clicking post", async () => {
      const onPostClick = vi.fn();
      const post = makePost({ id: "click-1" });
      render(
        <PostList
          posts={[post]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
          onPostClick={onPostClick}
        />
      );
      const card = screen.getByTestId("post-card-click-1");
      // CardActionArea is the first button in the card
      const buttons = within(card).getAllByRole("button");
      await userEvent.click(buttons[0]);
      expect(onPostClick).toHaveBeenCalledWith(post);
    });

    it("should show audio icon for posts with audio", () => {
      render(
        <PostList
          posts={[makePost({ id: "audio-1", hasAudio: true })]}
          loading={false}
          loadingMore={false}
          hasMore={false}
          error={null}
        />
      );
      expect(screen.getByText("Audio")).toBeInTheDocument();
    });
  });
});
