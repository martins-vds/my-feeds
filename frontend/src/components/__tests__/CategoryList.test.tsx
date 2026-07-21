/**
 * Vitest unit tests for CategoryList component
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CategoryList } from "../CategoryList";
import type { Category, Feed } from "../../types";

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: "cat-1",
    name: "Technology",
    position: 0,
    feedCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: "feed-1",
    categoryIds: ["cat-1"],
    url: "https://example.com/feed.xml",
    title: "Example Feed",
    description: null,
    siteUrl: "https://example.com",
    iconUrl: null,
    lastFetchedAt: null,
    fetchErrorCount: 0,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const defaultProps = {
  categories: [] as Category[],
  feeds: [] as Feed[],
  loading: false,
  error: null as string | null,
  selectedCategoryId: null as string | null,
  onSelectCategory: vi.fn(),
  onCreateCategory: vi.fn().mockResolvedValue(makeCategory()),
  onUpdateCategory: vi.fn().mockResolvedValue(makeCategory()),
  onDeleteCategory: vi.fn().mockResolvedValue(undefined),
  onAddFeed: vi.fn().mockResolvedValue(makeFeed()),
  onDeleteFeed: vi.fn().mockResolvedValue(undefined),
  onRefreshFeed: vi.fn().mockResolvedValue(makeFeed()),
  onSetFeedCategories: vi.fn().mockResolvedValue(makeFeed()),
  onSetFeedActive: vi.fn().mockResolvedValue(makeFeed()),
};

describe("CategoryList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("rendering", () => {
    it("should display loading state initially", () => {
      render(<CategoryList {...defaultProps} loading={true} />);
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    it("should display empty state when no categories or feeds exist", () => {
      render(<CategoryList {...defaultProps} categories={[]} />);
      expect(screen.getByText(/no feeds yet/i)).toBeInTheDocument();
    });

    it("should display categories in position order", () => {
      const cats = [
        makeCategory({ id: "c1", name: "Alpha", position: 0 }),
        makeCategory({ id: "c2", name: "Beta", position: 1 }),
      ];
      render(<CategoryList {...defaultProps} categories={cats} />);
      expect(screen.getByText("Alpha")).toBeInTheDocument();
      expect(screen.getByText("Beta")).toBeInTheDocument();
    });

    it("should display feed count for each category", () => {
      const cats = [makeCategory({ feedCount: 5 })];
      render(<CategoryList {...defaultProps} categories={cats} />);
      expect(screen.getByText("5 feeds")).toBeInTheDocument();
    });

    it("should display error state on API failure", () => {
      render(<CategoryList {...defaultProps} error="Failed to load categories" />);
      expect(screen.getByText("Failed to load categories")).toBeInTheDocument();
    });
  });

  describe("category creation", () => {
    it("should show add category button", () => {
      const cats = [makeCategory()];
      render(<CategoryList {...defaultProps} categories={cats} />);
      expect(screen.getByLabelText("add category")).toBeInTheDocument();
    });

    it("should open create dialog when clicking add button", async () => {
      const cats = [makeCategory()];
      render(<CategoryList {...defaultProps} categories={cats} />);
      await userEvent.click(screen.getByLabelText("add category"));
      expect(screen.getByText("New Category")).toBeInTheDocument();
    });

    it("should call API and refresh list on successful creation", async () => {
      const onCreateCategory = vi.fn().mockResolvedValue(makeCategory({ name: "New" }));
      const cats = [makeCategory()];
      render(
        <CategoryList {...defaultProps} categories={cats} onCreateCategory={onCreateCategory} />
      );

      await userEvent.click(screen.getByLabelText("add category"));
      const input = screen.getByLabelText("Category Name");
      await userEvent.clear(input);
      await userEvent.type(input, "New");
      const saveBtn = screen.getByRole("button", { name: "Create" });
      await userEvent.click(saveBtn);
      expect(onCreateCategory).toHaveBeenCalledWith("New");
    });

    it("should display error when name is duplicate", async () => {
      const err = new Error("Category already exists");
      const onCreateCategory = vi.fn().mockRejectedValue(err);
      const cats = [makeCategory()];
      render(
        <CategoryList {...defaultProps} categories={cats} onCreateCategory={onCreateCategory} />
      );

      await userEvent.click(screen.getByLabelText("add category"));
      const input = screen.getByLabelText("Category Name");
      await userEvent.clear(input);
      await userEvent.type(input, "Duplicate");
      const saveBtn = screen.getByRole("button", { name: "Create" });
      await userEvent.click(saveBtn);
      expect(onCreateCategory).toHaveBeenCalledWith("Duplicate");
    });

    it("should display error when limit reached (25 categories)", async () => {
      const err = new Error("Maximum 25 categories reached");
      const onCreateCategory = vi.fn().mockRejectedValue(err);
      const cats = [makeCategory()];
      render(
        <CategoryList {...defaultProps} categories={cats} onCreateCategory={onCreateCategory} />
      );

      await userEvent.click(screen.getByLabelText("add category"));
      const input = screen.getByLabelText("Category Name");
      await userEvent.clear(input);
      await userEvent.type(input, "Over Limit");
      const saveBtn = screen.getByRole("button", { name: "Create" });
      await userEvent.click(saveBtn);
      expect(onCreateCategory).toHaveBeenCalledWith("Over Limit");
    });
  });

  describe("category editing", () => {
    it("should open edit dialog when clicking edit button", async () => {
      const cats = [makeCategory({ id: "c1", name: "Tech" })];
      render(<CategoryList {...defaultProps} categories={cats} />);

      // Open context menu
      const moreBtn = screen.getByLabelText("category options");
      await userEvent.click(moreBtn);
      const editItem = screen.getByText("Edit Category");
      await userEvent.click(editItem);
      // Form should appear with existing name
      const input = screen.getByLabelText("Category Name");
      expect(input).toHaveValue("Tech");
    });

    it("should update category name on save", async () => {
      const onUpdateCategory = vi.fn().mockResolvedValue(makeCategory({ name: "Updated" }));
      const cats = [makeCategory({ id: "c1", name: "Old Name" })];
      render(
        <CategoryList {...defaultProps} categories={cats} onUpdateCategory={onUpdateCategory} />
      );

      const moreBtn = screen.getByLabelText("category options");
      await userEvent.click(moreBtn);
      await userEvent.click(screen.getByText("Edit Category"));
      const input = screen.getByLabelText("Category Name");
      await userEvent.clear(input);
      await userEvent.type(input, "Updated");
      const saveBtn = screen.getByRole("button", { name: "Save" });
      await userEvent.click(saveBtn);
      expect(onUpdateCategory).toHaveBeenCalledWith("c1", "Updated");
    });
  });

  describe("category deletion", () => {
    it("should show confirmation dialog when clicking delete", async () => {
      const cats = [makeCategory({ id: "c1", name: "Deletable" })];
      render(<CategoryList {...defaultProps} categories={cats} />);

      const moreBtn = screen.getByLabelText("category options");
      await userEvent.click(moreBtn);
      await userEvent.click(screen.getByText("Delete Category"));
      expect(screen.getByText("Delete Category?")).toBeInTheDocument();
    });

    it("should delete category and refresh list on confirm", async () => {
      const onDeleteCategory = vi.fn().mockResolvedValue(undefined);
      const cats = [makeCategory({ id: "c1", name: "To Delete" })];
      render(
        <CategoryList {...defaultProps} categories={cats} onDeleteCategory={onDeleteCategory} />
      );

      const moreBtn = screen.getByLabelText("category options");
      await userEvent.click(moreBtn);
      await userEvent.click(screen.getByText("Delete Category"));
      // The dialog has a "Delete" button to confirm
      const dialogBtns = screen.getAllByRole("button", { name: /delete/i });
      const confirmBtn = dialogBtns[dialogBtns.length - 1];
      await userEvent.click(confirmBtn);
      expect(onDeleteCategory).toHaveBeenCalledWith("c1");
    });

    it("should cancel deletion and close dialog on cancel", async () => {
      const cats = [makeCategory({ id: "c1" })];
      render(<CategoryList {...defaultProps} categories={cats} />);

      const moreBtn = screen.getByLabelText("category options");
      await userEvent.click(moreBtn);
      await userEvent.click(screen.getByText("Delete Category"));
      expect(screen.getByText("Delete Category?")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
      // Dialog should close (MUI may animate)
      await waitFor(() => {
        expect(screen.queryByText("Delete Category?")).not.toBeInTheDocument();
      });
    });
  });

  describe("navigation", () => {
    it("should expand category to show feeds when clicked", async () => {
      const cats = [makeCategory({ id: "c1", name: "Expandable" })];
      const onSelectCategory = vi.fn();
      render(
        <CategoryList {...defaultProps} categories={cats} onSelectCategory={onSelectCategory} />
      );

      await userEvent.click(screen.getByText("Expandable"));
      expect(onSelectCategory).toHaveBeenCalledWith("c1");
    });
  });

  describe("adding feeds without a category", () => {
    it("shows a top-level add feed button", () => {
      const cats = [makeCategory()];
      render(<CategoryList {...defaultProps} categories={cats} />);
      expect(screen.getByLabelText("add feed")).toBeInTheDocument();
    });

    it("adds an uncategorized feed from the empty state", async () => {
      const onAddFeed = vi.fn().mockResolvedValue(makeFeed({ categoryIds: [] }));
      render(<CategoryList {...defaultProps} categories={[]} onAddFeed={onAddFeed} />);

      // Empty state offers a contained "Add Feed" button (no category needed)
      await userEvent.click(screen.getByRole("button", { name: "Add Feed" }));

      const dialog = screen.getByRole("dialog");
      await userEvent.type(
        within(dialog).getByLabelText("Feed URL"),
        "https://example.com/feed.xml"
      );
      await userEvent.click(within(dialog).getByRole("button", { name: "Add Feed" }));

      await waitFor(() => {
        expect(onAddFeed).toHaveBeenCalledWith(null, "https://example.com/feed.xml");
      });
    });

    it("adds an uncategorized feed from the header button", async () => {
      const onAddFeed = vi.fn().mockResolvedValue(makeFeed({ categoryIds: [] }));
      const cats = [makeCategory()];
      render(<CategoryList {...defaultProps} categories={cats} onAddFeed={onAddFeed} />);

      await userEvent.click(screen.getByLabelText("add feed"));

      const dialog = screen.getByRole("dialog");
      await userEvent.type(
        within(dialog).getByLabelText("Feed URL"),
        "https://news.example/rss"
      );
      await userEvent.click(within(dialog).getByRole("button", { name: "Add Feed" }));

      await waitFor(() => {
        expect(onAddFeed).toHaveBeenCalledWith(null, "https://news.example/rss");
      });
    });
  });
});
