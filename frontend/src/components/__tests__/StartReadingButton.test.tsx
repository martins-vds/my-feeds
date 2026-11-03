import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StartReadingButton } from "../StartReadingButton";
import type { ReadingMode } from "../../hooks/useReadAlongPreferences";

function setup(props: { progress?: number; isRead?: boolean; mode?: ReadingMode } = {}) {
  const onStart = vi.fn();
  render(
    <StartReadingButton progress={0} isRead={false} mode="silent" onStart={onStart} {...props} />
  );
  return { onStart };
}

const mainButton = () => screen.getByTestId("start-reading-button");
const menuButton = () => screen.getByTestId("start-reading-menu");

describe("StartReadingButton", () => {
  describe("main label", () => {
    it("invites the user to start an article they have not started", () => {
      setup({ progress: 0 });
      expect(mainButton()).toHaveAccessibleName("Start reading");
    });

    it("offers to continue an article in progress, with the whole percent", () => {
      setup({ progress: 0.42 });
      expect(mainButton()).toHaveAccessibleName("Continue reading · 42%");
    });

    it("rounds the percent down", () => {
      setup({ progress: 0.429 });
      expect(mainButton()).toHaveAccessibleName("Continue reading · 42%");
    });

    it("never shows 0% for an article that was barely started", () => {
      setup({ progress: 0.004 });
      expect(mainButton()).toHaveAccessibleName("Continue reading · 1%");
    });

    it("offers to read a finished article again", () => {
      setup({ progress: 1, isRead: true });
      expect(mainButton()).toHaveAccessibleName("Read again");
    });

    it("offers to read again when the article was marked read with partial progress", () => {
      setup({ progress: 0.3, isRead: true });
      expect(mainButton()).toHaveAccessibleName("Read again");
    });
  });

  describe("starting", () => {
    it.each<ReadingMode>(["silent", "sound"])(
      "starts in the remembered %s mode from the main button",
      async (mode) => {
        const { onStart } = setup({ mode });
        await userEvent.click(mainButton());
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onStart).toHaveBeenCalledWith(mode);
      }
    );

    it("opens the menu from the arrow without starting anything", async () => {
      const { onStart } = setup();
      await userEvent.click(menuButton());
      expect(screen.getByRole("menu")).toBeInTheDocument();
      expect(onStart).not.toHaveBeenCalled();
    });

    it.each([
      { chosen: "sound", name: "Read with sound", remembered: "silent" },
      { chosen: "silent", name: "Read silently", remembered: "sound" },
    ] as const)(
      "starts $chosen from the menu whatever mode is remembered",
      async ({ chosen, name, remembered }) => {
        const { onStart } = setup({ mode: remembered });
        await userEvent.click(menuButton());
        await userEvent.click(screen.getByRole("menuitemradio", { name }));
        expect(onStart).toHaveBeenCalledTimes(1);
        expect(onStart).toHaveBeenCalledWith(chosen);
      }
    );

    it("closes the menu once a mode is chosen", async () => {
      setup();
      await userEvent.click(menuButton());
      await userEvent.click(screen.getByRole("menuitemradio", { name: "Read with sound" }));
      expect(menuButton()).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
    });

    it("closes the menu on Escape without starting anything", async () => {
      const { onStart } = setup();
      await userEvent.click(menuButton());
      await userEvent.keyboard("{Escape}");
      expect(menuButton()).toHaveAttribute("aria-expanded", "false");
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
      expect(onStart).not.toHaveBeenCalled();
    });
  });

  describe("menu", () => {
    it.each([
      { mode: "silent", remembered: "Read silently", other: "Read with sound" },
      { mode: "sound", remembered: "Read with sound", other: "Read silently" },
    ] as const)("marks $mode as the remembered mode", async ({ mode, remembered, other }) => {
      setup({ mode });
      await userEvent.click(menuButton());
      expect(screen.getByRole("menuitemradio", { name: remembered })).toBeChecked();
      expect(screen.getByRole("menuitemradio", { name: other })).not.toBeChecked();
    });

    it("exposes the arrow as a menu button", async () => {
      setup();
      const arrow = screen.getByRole("button", { name: "Choose how to read" });
      expect(arrow).toBe(menuButton());
      expect(arrow).toHaveAttribute("aria-haspopup", "menu");
      expect(arrow).toHaveAttribute("aria-expanded", "false");
      expect(arrow).not.toHaveAttribute("aria-controls");

      await userEvent.click(arrow);
      expect(arrow).toHaveAttribute("aria-expanded", "true");
      expect(arrow).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
      expect(screen.getByRole("menu")).toHaveAccessibleName("Reading mode");
    });
  });
});
