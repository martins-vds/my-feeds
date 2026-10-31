import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PostContent } from "../PostContent";

const html = `<p style="background-image:url(https://tracker.example/css)">Article</p>
  <picture><source srcset="https://tracker.example/source"><img src="https://tracker.example/pixel"
  srcset="https://tracker.example/retina 2x" alt="Publisher image" onerror="alert(1)"></picture>
  <svg><image href="https://tracker.example/svg"/></svg>
  <video poster="https://tracker.example/poster"><source src="https://tracker.example/video"></video>`;

describe("publisher image consent", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubEnv("VITE_ALLOW_EXTERNAL_IMAGES", "true");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("blocks all embedded resource loads before consent while preserving article text", () => {
    const { container } = render(<PostContent content={html} summary={null} userId="alice" />);
    expect(screen.getByText("Article")).toBeInTheDocument();
    expect(
      container
        .querySelector('[data-testid="post-content"]')!
        .querySelector("[src], [srcset], [poster], [style], svg, video")
    ).toBeNull();
    expect(container.querySelector("img")).toHaveAttribute("hidden");
    expect(screen.getByText(/IP address/i)).toBeInTheDocument();
  });

  it("allows sanitized images only after explicit consent and lets the user turn them off", () => {
    const { container } = render(<PostContent content={html} summary={null} userId="alice" />);
    fireEvent.click(screen.getByRole("checkbox", { name: /load publisher images/i }));
    expect(container.querySelector("img")).toHaveAttribute("src", "https://tracker.example/pixel");
    expect(container.querySelector("img")).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(container.querySelector("img")).not.toHaveAttribute("onerror");
    expect(container.querySelector("img")).not.toHaveAttribute("srcset");
    expect(container.querySelector("img")).not.toHaveAttribute("hidden");
    fireEvent.click(screen.getByRole("checkbox", { name: /load publisher images/i }));
    expect(container.querySelector("[src]")).toBeNull();
  });

  it("never inherits another account's opt-in on an identity change", () => {
    const { container, rerender } = render(
      <PostContent content={html} summary={null} userId="alice" />
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /load publisher images/i }));
    rerender(<PostContent content={html} summary={null} userId="bob" />);
    expect(container.querySelector("[src]")).toBeNull();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("keeps the control disabled when the operator has not enabled external images", () => {
    vi.stubEnv("VITE_ALLOW_EXTERNAL_IMAGES", "false");
    localStorage.setItem("almanac:publisher-images:v1:alice", "true");
    const { container } = render(<PostContent content={html} summary={null} userId="alice" />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByText(/disabled by the operator/i)).toBeInTheDocument();
    expect(container.querySelector("[src]")).toBeNull();
  });
});
