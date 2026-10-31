import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SignInPage } from "../SignInPage";

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    login: vi.fn(),
    logout: vi.fn(),
    isLoading: false,
    error: "Your local reader was cleared, but the server session could not be ended.",
  }),
}));

it("shows failed logout feedback on the signed-out screen and offers a retry", () => {
  render(<SignInPage />);
  expect(screen.getByRole("alert")).toHaveTextContent("server session could not be ended");
  expect(screen.getByRole("button", { name: /retry sign out/i })).toBeInTheDocument();
});
