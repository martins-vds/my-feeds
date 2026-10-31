import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "../../contexts/AuthContext";
import { api } from "../api";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());
const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

describe("private requests during auth revalidation", () => {
  it("rejects pre-probe private responses even when the same account is confirmed", async () => {
    let completePost!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/auth/me")
          ? new Response(JSON.stringify({ id: "alice" }))
          : new Promise<Response>((done) => {
              completePost = done;
            })
      )
    );
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.id).toBe("alice"));
    const post = api.get("/posts").then(
      () => null,
      (error: Error) => error
    );
    await waitFor(() => expect(completePost).toBeTypeOf("function"));
    await act(async () => {
      await result.current.refreshUser();
    });
    completePost(new Response(JSON.stringify({ title: "stale private payload" })));
    expect((await post)?.message).toMatch(/session changed/i);
  });

  it("releases blocked requests safely if the auth owner unmounts during validation", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (calls++ === 0) return new Response(JSON.stringify({ id: "alice" }));
        return new Promise<Response>(() => {});
      })
    );
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.user?.id).toBe("alice"));
    act(() => {
      void result.current.refreshUser();
    });
    const outcome: { error: Error | null } = { error: null };
    void api.get("/posts").catch((error: Error) => {
      outcome.error = error;
    });
    unmount();
    await waitFor(() => expect(outcome.error).not.toBeNull());
    expect(outcome.error?.message).toMatch(/session changed/i);
  });

  it.each(["alice", "bob"])(
    "does not dispatch private requests until account %s is verified",
    async (nextUser) => {
      let verify!: (response: Response) => void;
      let authCalls = 0;
      const paths: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          paths.push(url);
          if (url.endsWith("/auth/me")) {
            if (authCalls++ === 0) return new Response(JSON.stringify({ id: "alice" }));
            return new Promise<Response>((done) => {
              verify = done;
            });
          }
          return new Response(JSON.stringify({ title: `${nextUser} article` }));
        })
      );
      const { result } = renderHook(() => useAuth(), { wrapper });
      await waitFor(() => expect(result.current.user?.id).toBe("alice"));
      let validating!: Promise<void>;
      act(() => {
        validating = result.current.refreshUser();
      });
      const privateRequest = api.get("/posts").then(
        (value) => ({ value, error: null }),
        (error: Error) => ({ value: null, error })
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(paths).not.toContain("/api/posts");
      await act(async () => {
        verify(new Response(JSON.stringify({ id: nextUser })));
        await validating;
      });
      const outcome = await privateRequest;
      if (nextUser === "alice") {
        expect(outcome.value).toEqual({ title: "alice article" });
        expect(paths).toContain("/api/posts");
      } else {
        expect(outcome.error?.message).toMatch(/session changed/i);
        expect(paths).not.toContain("/api/posts");
      }
    }
  );
});
