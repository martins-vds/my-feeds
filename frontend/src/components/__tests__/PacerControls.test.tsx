import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { PacerControls } from "../PacerControls";
import { WPM_OPTIONS } from "../../constants/audio";

function setup(props: Partial<ComponentProps<typeof PacerControls>> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    onWpmChange: vi.fn(),
    onStop: vi.fn(),
  };
  const view = render(
    <PacerControls isPlaying={false} fraction={0} wpm={250} {...handlers} {...props} />
  );
  return { ...handlers, unmount: view.unmount };
}

const slider = () => screen.getByRole("slider", { name: "Reading position" });
const speedButton = () => screen.getByTestId("pacer-speed-button");

describe("PacerControls", () => {
  describe("play and pause", () => {
    it("offers Play while paused and toggles on click", async () => {
      const { onToggle } = setup({ isPlaying: false });
      expect(screen.getByTestId("pacer-controls")).toBeInTheDocument();
      const button = screen.getByRole("button", { name: "Play" });
      expect(button).toBe(screen.getByTestId("pacer-play-button"));

      await userEvent.click(button);
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("offers Pause while playing and toggles on click", async () => {
      const { onToggle } = setup({ isPlaying: true });
      expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Pause" }));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe("position", () => {
    it.each([
      { fraction: 0, percent: 0 },
      { fraction: 0.426, percent: 42 },
      { fraction: 0.57, percent: 57 },
      { fraction: 0.999, percent: 99 },
      { fraction: 1, percent: 100 },
    ])("shows a position of $fraction as $percent percent", ({ fraction, percent }) => {
      setup({ fraction });
      expect(slider()).toHaveValue(String(percent));
      expect(slider()).toHaveAttribute("aria-valuetext", `${percent} percent`);
      expect(screen.getByTestId("pacer-percent").textContent).toBe(`${percent}%`);
    });

    it("spans the whole article", () => {
      setup();
      expect(slider()).toHaveAttribute("aria-valuemin", "0");
      expect(slider()).toHaveAttribute("aria-valuemax", "100");
    });

    it("seeks to the fraction the slider is moved to", () => {
      const { onSeek } = setup({ fraction: 0.1 });
      fireEvent.change(slider(), { target: { value: "40" } });
      expect(onSeek).toHaveBeenCalledTimes(1);
      expect(onSeek).toHaveBeenCalledWith(0.4);
    });

    it("moves one percent for each arrow key", async () => {
      const { onSeek } = setup({ fraction: 0.42 });
      slider().focus();
      await userEvent.keyboard("{ArrowRight}");
      expect(onSeek).toHaveBeenCalledWith(0.43);
    });

    it("marks the slider's root for end-to-end tests", () => {
      setup();
      expect(screen.getByTestId("pacer-position")).toBeInTheDocument();
    });
  });

  describe("reading speed", () => {
    it("shows the pace on a button named Reading speed", () => {
      setup({ wpm: 300 });
      expect(speedButton()).toHaveTextContent("300 wpm");
      expect(speedButton()).toHaveAccessibleName("Reading speed");
    });

    it("exposes the button as a menu button", async () => {
      setup();
      expect(speedButton()).toHaveAttribute("aria-haspopup", "menu");
      expect(speedButton()).toHaveAttribute("aria-expanded", "false");
      expect(speedButton()).not.toHaveAttribute("aria-controls");

      await userEvent.click(speedButton());
      expect(speedButton()).toHaveAttribute("aria-expanded", "true");
      expect(speedButton()).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
      expect(screen.getByRole("menu")).toHaveAccessibleName("Reading speed options");
    });

    it("offers every pace and marks the current one", async () => {
      setup({ wpm: 300 });
      await userEvent.click(speedButton());

      const items = screen.getAllByRole("menuitemradio");
      expect(items.map((item) => item.textContent)).toEqual(
        WPM_OPTIONS.map((wpm) => `${wpm} words per minute`)
      );
      expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(
        WPM_OPTIONS.map((wpm) => String(wpm === 300))
      );
    });

    it("changes the pace and closes the menu", async () => {
      const { onWpmChange } = setup({ wpm: 250 });
      await userEvent.click(speedButton());
      await userEvent.click(screen.getByRole("menuitemradio", { name: "400 words per minute" }));

      expect(onWpmChange).toHaveBeenCalledTimes(1);
      expect(onWpmChange).toHaveBeenCalledWith(400);
      expect(speedButton()).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    });

    it("closes the menu on Escape without changing the pace", async () => {
      const { onWpmChange } = setup();
      await userEvent.click(speedButton());
      await userEvent.keyboard("{Escape}");

      expect(speedButton()).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
      expect(onWpmChange).not.toHaveBeenCalled();
    });

    it("reports when the menu opens and closes, so auto-scroll can wait", async () => {
      const onSpeedMenuOpenChange = vi.fn();
      setup({ onSpeedMenuOpenChange });
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(false);

      await userEvent.click(speedButton());
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(true);

      await userEvent.keyboard("{Escape}");
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(false);
    });

    it("reports the menu closed when the controls go away while it is open", async () => {
      const onSpeedMenuOpenChange = vi.fn();
      const { unmount } = setup({ onSpeedMenuOpenChange });
      await userEvent.click(speedButton());
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(true);

      unmount();
      expect(onSpeedMenuOpenChange).toHaveBeenLastCalledWith(false);
    });
  });

  describe("stop", () => {
    it("stops reading", async () => {
      const { onStop, onToggle } = setup({ isPlaying: true });
      const button = screen.getByRole("button", { name: "Stop reading" });
      expect(button).toBe(screen.getByTestId("pacer-stop-button"));

      await userEvent.click(button);
      expect(onStop).toHaveBeenCalledTimes(1);
      expect(onToggle).not.toHaveBeenCalled();
    });
  });
});
