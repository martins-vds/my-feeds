import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from "react";
import { api, ApiError } from "../services/api";
import {
  beginPrivateStateValidation,
  finishPrivateStateValidation,
  invalidatePrivateState,
} from "../services/privateState";

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
  privateStateKey: string;
  login: (provider: "github" | "google" | "microsoft") => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const AUTH_CHANGE_KEY = "almanac:auth-change:v1";
function notificationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

function createAuthChannel(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(AUTH_CHANGE_KEY) : null;
  } catch {
    return null;
  }
}

const tabId = notificationId();
const signedOutState: AuthState = {
  user: null,
  isLoading: false,
  isAuthenticated: false,
  isPendingSignup: false,
  pendingProfile: null,
  error: null,
};

function broadcastAuthChange(action: "logout" | "refresh") {
  const message = { action, source: tabId, nonce: notificationId() };
  try {
    localStorage.setItem(AUTH_CHANGE_KEY, JSON.stringify(message));
  } catch {
    // Storage may be unavailable; BroadcastChannel still covers live tabs.
  }
  const channel = createAuthChannel();
  try {
    channel?.postMessage(message);
  } catch {
    // Storage and focus revalidation remain available if messaging is denied.
  } finally {
    channel?.close();
  }
}

function hasRecordedLogout(): boolean {
  try {
    const value = localStorage.getItem(AUTH_CHANGE_KEY);
    return Boolean(value && JSON.parse(value).action === "logout");
  } catch {
    return false;
  }
}

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
  const [state, setState] = useState<AuthState>({ ...signedOutState, isLoading: true });
  const [resetVersion, setResetVersion] = useState(0);
  const requestVersion = useRef(0);
  const identity = useRef<string | null>(null);

  const clearIdentity = useCallback(() => {
    requestVersion.current += 1;
    identity.current = null;
    invalidatePrivateState();
    setResetVersion((value) => value + 1);
    setState(signedOutState);
  }, []);

  /**
   * Fetch current user from API
   */
  const loadUser = useCallback(
    async (broadcast: boolean) => {
      if (!broadcast && hasRecordedLogout()) {
        clearIdentity();
        return;
      }
      const previousIdentity = identity.current;
      requestVersion.current += 1;
      const version = requestVersion.current;
      const validationVersion = beginPrivateStateValidation();
      try {
        setState((previous) => ({ ...previous, isLoading: true, error: null }));
        const data = await api.get<
          | { pending_signup: true; profile: PendingProfile }
          | (User & { pending_signup?: undefined })
        >("/auth/me");
        if (version !== requestVersion.current) return;

        if (data && "pending_signup" in data && data.pending_signup === true) {
          clearIdentity();
          // Pending sign-up state
          setState({
            user: null,
            isLoading: false,
            isAuthenticated: false,
            isPendingSignup: true,
            pendingProfile: data.profile,
            error: null,
          });
          if (broadcast) broadcastAuthChange("refresh");
        } else {
          if (!data || !("id" in data) || !data.id) {
            clearIdentity();
            return;
          }
          if (previousIdentity !== data.id) clearIdentity();
          else finishPrivateStateValidation(validationVersion);
          identity.current = data.id;
          // Fully authenticated
          setState({
            user: data as User,
            isLoading: false,
            isAuthenticated: true,
            isPendingSignup: false,
            pendingProfile: null,
            error: null,
          });
          if (broadcast && previousIdentity !== data.id) broadcastAuthChange("refresh");
        }
      } catch (err) {
        if (version !== requestVersion.current) return;
        clearIdentity();
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
    },
    [clearIdentity]
  );

  const refreshUser = useCallback(() => loadUser(true), [loadUser]);

  /**
   * Redirect to OAuth login
   */
  const login = useCallback(
    (provider: "github" | "google" | "microsoft") => {
      clearIdentity();
      broadcastAuthChange("logout");
      // Redirect to backend OAuth endpoint
      window.location.href = `/api/auth/login/${provider}`;
    },
    [clearIdentity]
  );

  /**
   * Logout current user
   */
  const logout = useCallback(async () => {
    clearIdentity();
    broadcastAuthChange("logout");
    const version = requestVersion.current;
    try {
      await api.post("/auth/logout");
    } catch (err) {
      if (version !== requestVersion.current) return;
      setState((prev) => ({
        ...prev,
        error: `Your local reader was cleared, but the server session could not be ended. ${
          err instanceof Error ? err.message : "Reconnect and retry signing out."
        }`,
      }));
    }
  }, [clearIdentity]);

  // Check authentication status on mount
  useEffect(() => {
    const handleChange = (data: unknown) => {
      if (!data || typeof data !== "object" || !("action" in data)) return;
      if ("source" in data && data.source === tabId) return;
      if (data.action === "logout") clearIdentity();
      else if (data.action === "refresh") void loadUser(false);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_CHANGE_KEY || !event.newValue) return;
      try {
        handleChange(JSON.parse(event.newValue));
      } catch {
        /* Ignore malformed signals. */
      }
    };
    const handleExpired = () => {
      clearIdentity();
      broadcastAuthChange("logout");
    };
    // Revalidate restored/back-forward or newly focused tabs, whose shared
    // cookie may have changed while the page was suspended.
    const handleVisible = () => {
      if (document.visibilityState === "visible" && identity.current) void loadUser(false);
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void loadUser(false);
    };
    const channel = createAuthChannel();
    if (channel) channel.onmessage = (event) => handleChange(event.data);
    window.addEventListener("storage", handleStorage);
    window.addEventListener("almanac:session-expired", handleExpired);
    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisible);
    const oauthLanding = ["/auth/callback", "/signup"].includes(window.location.pathname);
    if (hasRecordedLogout() && !oauthLanding) clearIdentity();
    else void loadUser(true);
    return () => {
      requestVersion.current += 1;
      invalidatePrivateState();
      channel?.close();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("almanac:session-expired", handleExpired);
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisible);
    };
  }, [loadUser, clearIdentity]);

  const value: AuthContextValue = {
    ...state,
    privateStateKey: `${state.user?.id ?? "anonymous"}:${resetVersion}`,
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
