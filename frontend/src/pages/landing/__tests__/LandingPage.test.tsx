import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuth } from "../../../contexts/AuthContext";
import { ThemeWrapper } from "../../../theme";
import { LandingPage } from "../LandingPage";

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

const mockedUseAuth = vi.mocked(useAuth);

function authState(
  isLoading: boolean,
  isAuthenticated: boolean,
  isPendingSignup = false
): ReturnType<typeof useAuth> {
  return {
    user: null,
    isLoading,
    isAuthenticated,
    isPendingSignup,
    pendingProfile: null,
    error: null,
    login: vi.fn(),
    logout: vi.fn(async () => undefined),
    refreshUser: vi.fn(async () => undefined),
  };
}

function renderLanding() {
  return render(
    <ThemeWrapper>
      <MemoryRouter
        initialEntries={["/"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/signin" element={<div>Sign in route</div>} />
          <Route path="/signup" element={<div>Sign up route</div>} />
          <Route path="/posts" element={<div>Reader route</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeWrapper>
  );
}

describe("LandingPage", () => {
  beforeEach(() => {
    mockedUseAuth.mockReset();
  });

  it("shows a stable status while authentication is loading", () => {
    mockedUseAuth.mockReturnValue(authState(true, false));
    renderLanding();

    expect(
      screen.getByRole("status", { name: "Checking authentication" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /calmer way/i })
    ).not.toBeInTheDocument();
  });

  it("redirects authenticated visitors to the reader", () => {
    mockedUseAuth.mockReturnValue(authState(false, true));
    renderLanding();

    expect(screen.getByText("Reader route")).toBeInTheDocument();
  });

  it("redirects pending OAuth signups to profile completion", () => {
    mockedUseAuth.mockReturnValue(authState(false, false, true));
    renderLanding();

    expect(screen.getByText("Sign up route")).toBeInTheDocument();
  });

  it("renders the product pitch and required feature highlights for signed-out visitors", () => {
    mockedUseAuth.mockReturnValue(authState(false, false));
    renderLanding();

    expect(
      screen.getByRole("heading", {
        name: /a calmer way to follow the web/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByText("Organize your feeds")).toBeInTheDocument();
    expect(screen.getByText("Listen on your terms")).toBeInTheDocument();
    expect(screen.getByText("Keep reading offline")).toBeInTheDocument();
  });

  it("navigates both sign-in actions to the existing sign-in route", async () => {
    const user = userEvent.setup();
    mockedUseAuth.mockReturnValue(authState(false, false));
    renderLanding();

    const links = screen.getAllByRole("link", {
      name: /sign in|start reading/i,
    });
    expect(links).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin"
    );
    expect(screen.getByRole("link", { name: "Start reading" })).toHaveAttribute(
      "href",
      "/signin"
    );

    await user.click(screen.getByRole("link", { name: "Start reading" }));

    expect(screen.getByText("Sign in route")).toBeInTheDocument();
  });
});
