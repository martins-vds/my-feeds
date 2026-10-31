import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { OfflineIndicator } from "../OfflineIndicator";

it("explains that private articles and audio are intentionally not saved offline", () => {
  render(<OfflineIndicator />);
  act(() => window.dispatchEvent(new Event("offline")));
  expect(screen.getByText(/articles and audio are not saved offline/i)).toBeInTheDocument();
});
