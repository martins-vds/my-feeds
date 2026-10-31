/**
 * Unit tests for useAuth hook
 * TDD: Written FIRST - must FAIL until implementation is complete
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, render, screen } from "@testing-library/react";
import { ReactNode, useState, useEffect } from "react";
import { AuthProvider, useAuth } from "../../contexts/AuthContext";
import { ProtectedRoute } from "../../components/ProtectedRoute";
import { BrowserRouter, MemoryRouter, Route, Routes } from "react-router-dom";

// Mock the API module
vi.mock("../../services/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
      message: string
    ) {
      super(message);
    }
  },
}));

import { api, ApiError } from "../../services/api";

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children} </AuthProvider>;

describe("useAuth hook", () => {
  afterEach(() => vi.unstubAllGlobals());
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("should start with loading state", () => {
    vi.mocked(api.get).mockImplementation(() => new Promise(() => {})); // Never resolves

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("should set authenticated state when user is fetched", async () => {
    const mockUser = {
      id: "123",
      email: "test@example.com",
      name: "Test User",
      avatarUrl: null,
      provider: "github" as const,
      timezone: "UTC",
      notificationsEnabled: false,
    };

    vi.mocked(api.get).mockResolvedValue(mockUser);

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user).toEqual(mockUser);
    expect(result.current.error).toBeNull();
  });

  it("should set unauthenticated state on 401 error", async () => {
    vi.mocked(api.get).mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Not authenticated"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.error).toBeNull(); // 401 is expected, not an error
  });

  it("should set error state on unexpected error", async () => {
    vi.mocked(api.get).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toBe("Network error");
  });

  it("should provide login function that redirects", () => {
    vi.mocked(api.get).mockResolvedValue(null);

    // Mock window.location
    const originalLocation = window.location;
    // @ts-expect-error - mocking location
    delete window.location;
    window.location = { href: "" } as unknown as string & Location;

    const { result } = renderHook(() => useAuth(), { wrapper });

    result.current.login("github");

    expect(window.location.href).toBe("/api/auth/login/github");

    window.location = originalLocation as unknown as string & Location;
  });

  it("should clear user on logout", async () => {
    const mockUser = {
      id: "123",
      email: "test@example.com",
      name: "Test User",
      avatarUrl: null,
      provider: "github" as const,
      timezone: "UTC",
      notificationsEnabled: false,
    };

    vi.mocked(api.get).mockResolvedValue(mockUser);
    vi.mocked(api.post).mockResolvedValue({});

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(true);
    });

    await act(async () => {
      await result.current.logout();
    });

    await waitFor(() => {
      expect(result.current.isAuthenticated).toBe(false);
      expect(result.current.user).toBeNull();
    });
  });

  it("should throw error when used outside AuthProvider", () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within an AuthProvider");

    consoleSpy.mockRestore();
  });

  it("clears identity immediately even if logout fails", async () => {
    vi.mocked(api.get).mockResolvedValue({ id: "alice" });
    vi.mocked(api.post).mockRejectedValue(new Error("Network unavailable"));
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.id).toBe("alice"));
    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.error).toContain("Network unavailable");
  });

  it("ignores a pending auth response after logout", async () => {
    let resolve!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    vi.mocked(api.post).mockResolvedValue({});
    const { result } = renderHook(() => useAuth(), { wrapper });
    await act(async () => {
      await result.current.logout();
    });
    await act(async () => {
      resolve({ id: "alice" });
    });
    expect(result.current.user).toBeNull();
  });

  it("clears private child state on account switch", async () => {
    vi.mocked(api.get).mockResolvedValue({ id: "alice" });
    let refresh!: () => Promise<void>;
    function CaptureAuth() {
      const refreshUser = useAuth().refreshUser;
      useEffect(() => {
        refresh = refreshUser;
      }, [refreshUser]);
      return null;
    }
    function PrivateChild() {
      const [value, setValue] = useState("clean");
      return <button onClick={() => setValue("alice private state")}>{value}</button>;
    }
    render(
      <BrowserRouter>
        <AuthProvider>
          <CaptureAuth />
          <ProtectedRoute>
            <PrivateChild />
          </ProtectedRoute>
        </AuthProvider>
      </BrowserRouter>
    );
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    await act(async () => {
      screen.getByRole("button").click();
    });
    vi.mocked(api.get).mockResolvedValue({ id: "bob" });
    await act(async () => {
      await refresh();
    });
    expect(screen.queryByText("alice private state")).toBeNull();
  });

  it("hides but retains mounted reader state during same-account visibility revalidation", async () => {
    vi.mocked(api.get).mockResolvedValue({ id: "alice" });
    function PrivateReader() {
      const [position, setPosition] = useState(0);
      return <button onClick={() => setPosition(42)}>Reader position {position}</button>;
    }
    render(
      <MemoryRouter>
        <AuthProvider>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <PrivateReader />
                </ProtectedRoute>
              }
            />
            <Route path="/signin" element={<div>Sign in</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole("button")).toBeInTheDocument());
    act(() => screen.getByRole("button").click());
    const reader = screen.getByText("Reader position 42");
    let resolve!: (value: unknown) => void;
    vi.mocked(api.get).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        })
    );
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(reader).toBeInTheDocument();
    expect(reader).not.toBeVisible();
    expect(reader.closest("[inert]")).not.toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    await act(async () => {
      resolve({ id: "alice" });
    });
    expect(screen.getByRole("button")).toBe(reader);
    expect(reader).toHaveTextContent("Reader position 42");
    expect(reader).toBeVisible();
  });

  it.each([
    new ApiError(401, "UNAUTHORIZED", "Session expired"),
    new Error("Unable to verify session"),
  ])("removes retained private state when revalidation fails: %s", async (failure) => {
    vi.mocked(api.get).mockResolvedValue({ id: "alice" });
    render(
      <MemoryRouter>
        <AuthProvider>
          <Routes>
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <div>Alice private reader</div>
                </ProtectedRoute>
              }
            />
            <Route path="/signin" element={<div>Sign in</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("Alice private reader")).toBeVisible());
    vi.mocked(api.get).mockRejectedValue(failure);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(screen.queryByText("Alice private reader")).toBeNull();
  });

  it("clears identity on another tab's logout and API session expiry", async () => {
    vi.mocked(api.get).mockResolvedValue({ id: "alice" });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.id).toBe("alice"));
    act(() =>
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "almanac:auth-change:v1",
          newValue: JSON.stringify({ action: "logout", nonce: "other-tab" }),
        })
      )
    );
    expect(result.current.user).toBeNull();
    await act(async () => {
      await result.current.refreshUser();
    });
    act(() => window.dispatchEvent(new Event("almanac:session-expired")));
    expect(result.current.user).toBeNull();
  });

  it("does not silently restore a still-valid server session after a previous local logout", async () => {
    localStorage.setItem("almanac:auth-change:v1", JSON.stringify({ action: "logout" }));
    vi.mocked(api.get).mockResolvedValue({ id: "alice" });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(api.get).not.toHaveBeenCalled();
  });

  it("keeps auth and logout usable when BroadcastChannel is denied by browser privacy settings", async () => {
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        constructor() {
          throw new Error("Unavailable");
        }
      }
    );
    vi.mocked(api.get).mockResolvedValue({ id: "alice" });
    vi.mocked(api.post).mockResolvedValue({});
    let hook!: ReturnType<typeof renderHook<ReturnType<typeof useAuth>, unknown>>;
    expect(() => {
      hook = renderHook(() => useAuth(), { wrapper });
    }).not.toThrow();
    await waitFor(() => expect(hook.result.current.user?.id).toBe("alice"));
    await act(async () => {
      await hook.result.current.logout();
    });
    expect(hook.result.current.user).toBeNull();
    expect(api.post).toHaveBeenCalledWith("/auth/logout");
  });

  it("does not require secure-context randomUUID for non-secret cross-tab notification IDs", async () => {
    vi.stubGlobal("crypto", {});
    vi.mocked(api.get).mockResolvedValue({ id: "alice" });
    vi.mocked(api.post).mockResolvedValue({});
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user?.id).toBe("alice");
    await act(async () => {
      await result.current.logout();
    });
    expect(result.current.user).toBeNull();
  });
});
