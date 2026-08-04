import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ThemeWrapper } from "../../../theme";
import { ReaderPreview } from "../ReaderPreview";

describe("ReaderPreview", () => {
  it("renders a decorative reader preview without exposing fake controls", () => {
    render(
      <ThemeWrapper>
        <ReaderPreview />
      </ThemeWrapper>
    );

    const preview = screen.getByTestId("reader-preview");
    expect(preview).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("All posts")).toBeInTheDocument();
    expect(screen.getByText("Technology")).toBeInTheDocument();
  });
});
