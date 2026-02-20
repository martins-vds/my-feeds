import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from "react";
import { api, ApiError } from "../services/api";

/**
 * User data from the API
 */
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  provider: "github" | "google" | "microsoft";
  timezone: string;
  notificationsEnabled: boolean;
}

/**
 * Pending profile data from OAuth (pre-fill for sign-up form)
 */
export interface PendingProfile {
  email: string;
  name: string | null;
  avatarUrl: string | null;
  provider: "github" | "google" | "microsoft";
}

/**
 * Auth context state
 */
interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isPendingSignup: boolean;
  pendingProfile: PendingProfile | null;
  error: string | null;
}

/**
 * Auth context value with actions
 */
interface AuthContextValue extends AuthState {
  login: (provider: "github" | "google" | "microsoft") => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Auth provider props
 */
interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Auth context provider component
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
    isPendingSignup: false,
    pendingProfile: null,
    error: null,
  });

  /**
   * Fetch current user from API
   */
  const refreshUser = useCallback(async () => {
    try {
      setState((prev) => ({ ...prev, isLoading: true, error: null }));
      const data = await api.get<
        { pending_signup: true; profile: PendingProfile } | (User & { pending_signup?: undefined })
      >("/auth/me");

      if (data && "pending_signup" in data && data.pending_signup === true) {
        // Pending sign-up state
        setState({
          user: null,
          isLoading: false,
          isAuthenticated: false,
          isPendingSignup: true,
          pendingProfile: data.profile,
          error: null,
        });
      } else {
        // Fully authenticated
        setState({
          user: data as User,
          isLoading: false,
          isAuthenticated: true,
          isPendingSignup: false,
          pendingProfile: null,
          error: null,
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Not authenticated - this is expected for unauthenticated users
        setState({
          user: null,
          isLoading: false,
          isAuthenticated: false,
          isPendingSignup: false,
          pendingProfile: null,
          error: null,
        });
      } else {
        setState({
          user: null,
          isLoading: false,
          isAuthenticated: false,
          isPendingSignup: false,
          pendingProfile: null,
          error: err instanceof Error ? err.message : "Failed to fetch user",
        });
      }
    }
  }, []);

  /**
   * Redirect to OAuth login
   */
  const login = useCallback((provider: "github" | "google" | "microsoft") => {
    // Redirect to backend OAuth endpoint
    window.location.href = `/api/auth/login/${provider}`;
  }, []);

  /**
   * Logout current user
   */
  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        isPendingSignup: false,
        pendingProfile: null,
        error: null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : "Failed to logout",
      }));
    }
  }, []);

  // Check authentication status on mount
  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const value: AuthContextValue = {
    ...state,
    login,
    logout,
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Hook to access auth context
 */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

export default AuthContext;
