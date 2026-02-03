"""API client service for backend communication."""

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";

/**
 * Custom error class for API errors
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Type for API response wrapper
 */
interface ApiResponse<T> {
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/**
 * HTTP client for API requests with error handling
 */
class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    options?: {
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...options?.headers,
    };

    const response = await fetch(url, {
      method,
      headers,
      credentials: "include", // Include cookies for session
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    // Handle empty responses (204 No Content)
    if (response.status === 204) {
      return undefined as T;
    }

    const data = (await response.json()) as ApiResponse<T>;

    if (!response.ok) {
      throw new ApiError(
        response.status,
        data.error?.code || "UNKNOWN_ERROR",
        data.error?.message || "An error occurred",
        data.error?.details
      );
    }

    return data as T;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }
}

// Singleton API client instance
export const api = new ApiClient(API_BASE_URL);

// Re-export for direct imports
export default api;
