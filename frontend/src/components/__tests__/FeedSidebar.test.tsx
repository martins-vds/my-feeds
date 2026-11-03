import type { ComponentProps } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FeedSidebar } from "../FeedSidebar";

type SidebarProps = ComponentProps<typeof FeedSidebar>;

function renderSidebar(overrides: Partial<SidebarProps> = {}) {
  const props: SidebarProps = {
    categories: [],
    feedsByCategory: {},
    loadingFeeds: new Set<string>(),
    onExpandCategory: vi.fn(),
    loading: false,
    error: null,
    selectedCategoryId: null,
    activeFeedId: null,
    readState: "all",
    uncategorizedActive: false,
    totalUnread: 0,
    unreadByFeed: {},
    unreadByCategory: {},
    uncategorizedUnread: 0,
    onSelectAll: vi.fn(),
    onSelectCategory: vi.fn(),
    onSelectFeed: vi.fn(),
    onSelectUncategorized: vi.fn(),
    onReadStateChange: vi.fn(),
    onMarkCategoryRead: vi.fn(),
    onMarkUncategorizedRead: vi.fn(),
    onMarkFeedRead: vi.fn(),
    onCreateCategory: vi.fn(),
    onUpdateCategory: vi.fn(),
    onDeleteCategory: vi.fn(),
    onAddFeed: vi.fn(),
    onDeleteFeed: vi.fn(),
    onRefreshFeed: vi.fn(),
    onSetFeedCategories: vi.fn(),
    onSetFeedActive: vi.fn(),
    ...overrides,
  };
  render(<FeedSidebar {...props} />);
  return props;
}

describe("FeedSidebar read-state filter", () => {
  it("offers All, Unread, In progress and Read, in that order", () => {
    renderSidebar();

    const group = screen.getByRole("group", { name: "read state filter" });
    const labels = within(group)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(labels).toEqual(["All", "Unread", "In progress", "Read"]);
  });

  it("marks the active filter as pressed", () => {
    renderSidebar({ readState: "in_progress" });

    const group = screen.getByRole("group", { name: "read state filter" });
    expect(within(group).getByRole("button", { name: "In progress" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(within(group).getByRole("button", { name: "All" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("reports the chosen filter", async () => {
    const props = renderSidebar();
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "In progress" }));

    expect(props.onReadStateChange).toHaveBeenCalledWith("in_progress");
  });
});
