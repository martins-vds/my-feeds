import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { ReadAlongToggles } from "../ReadAlongToggles";

function setup(props: Partial<ComponentProps<typeof ReadAlongToggles>> = {}) {
  const handlers = {
    onHighlightChange: vi.fn(),
    onAutoScrollChange: vi.fn(),
    onHighlightModeChange: vi.fn(),
  };
  render(
    <ReadAlongToggles
      highlight={false}
      autoScroll={true}
      highlightMode="word"
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

const highlightSwitch = () => screen.getByRole("switch", { name: "Highlight while playing" });
const autoScrollSwitch = () => screen.getByRole("switch", { name: "Auto-scroll while playing" });

describe("ReadAlongToggles", () => {
  describe("highlight switch", () => {
    it("shows an off preference as off", () => {
      setup({ highlight: false });
      expect(highlightSwitch()).not.toBeChecked();
    });

    it("shows an on preference as on", () => {
      setup({ highlight: true });
      expect(highlightSwitch()).toBeChecked();
    });

    it("reports a change", async () => {
      const { onHighlightChange } = setup({ highlight: false });
      await userEvent.click(highlightSwitch());
      expect(onHighlightChange).toHaveBeenCalledTimes(1);
      expect(onHighlightChange).toHaveBeenCalledWith(true);
    });

    it("is enabled, with no note, when it is not locked", () => {
      setup({ highlightLocked: false });
      expect(highlightSwitch()).toBeEnabled();
      expect(highlightSwitch()).not.toHaveAttribute("aria-describedby");
      expect(screen.queryByText(/stays on/)).not.toBeInTheDocument();
    });
  });

  describe("when the highlight is locked on", () => {
    it("is on and cannot be changed, whatever the saved preference", () => {
      setup({ highlight: false, highlightLocked: true });
      expect(highlightSwitch()).toBeChecked();
      expect(highlightSwitch()).toBeDisabled();
    });

    it("explains why", () => {
      setup({ highlightLocked: true });
      const note = "Highlighting stays on while you read silently.";
      expect(screen.getByText(note)).toBeInTheDocument();
      expect(highlightSwitch()).toHaveAccessibleDescription(note);
    });

    it("leaves the auto-scroll switch usable", async () => {
      const { onAutoScrollChange } = setup({ autoScroll: true, highlightLocked: true });
      expect(autoScrollSwitch()).toBeEnabled();
      await userEvent.click(autoScrollSwitch());
      expect(onAutoScrollChange).toHaveBeenCalledWith(false);
    });
  });
});
