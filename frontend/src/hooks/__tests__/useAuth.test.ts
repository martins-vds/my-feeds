/**
 * Unit tests for useAuth hook
 * TDD: Written FIRST - must FAIL until implementation is complete
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { ReactNode } from "react";
import { AuthProvider, useAuth } from "../../contexts/AuthContext";

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

const wrapper = ({ children }: { children: ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe("useAuth hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    vi.mocked(api.get).mockRejectedValue(
      new ApiError(401, "UNAUTHORIZED", "Not authenticated")
    );
    
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
    window.location = { href: "" } as Location;
    
    const { result } = renderHook(() => useAuth(), { wrapper });
    
    result.current.login("github");
    
    expect(window.location.href).toBe("/api/auth/login/github");
    
    window.location = originalLocation;
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
    
    await result.current.logout();
    
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it("should throw error when used outside AuthProvider", () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow("useAuth must be used within an AuthProvider");
    
    consoleSpy.mockRestore();
  });
});
