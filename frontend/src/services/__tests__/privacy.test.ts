import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("private API lifecycle", () => {
  it("bypasses HTTP caches for auth and private reads", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async () => new Response(JSON.stringify({ id: "alice" })));
    vi.stubGlobal("fetch", fetcher);
    await api.get("/auth/me");
    await api.get("/posts");
    for (const [, options] of fetcher.mock.calls) {
      expect(options.cache).toBe("no-store");
      expect(options.credentials).toBe("include");
    }
  });

  it("marks mutations as XMLHttpRequest without weakening cookie credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    await api.post("/auth/logout");
    expect(fetcher.mock.calls[0][1].headers["X-Requested-With"]).toBe("XMLHttpRequest");
  });

  it("notifies the auth boundary even when a 401 has a non-JSON body", async () => {
    const expired = vi.fn();
    window.addEventListener("almanac:session-expired", expired);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("expired", { status: 401 })));
    await expect(api.get("/posts")).rejects.toThrow();
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener("almanac:session-expired", expired);
  });

  it("rejects old private responses after a session expires", async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((done) => {
              resolve = done;
            })
        )
        .mockResolvedValueOnce(new Response("expired", { status: 401 }))
    );
    const pending = api.get("/posts");
    await expect(api.get("/feeds")).rejects.toThrow();
    resolve(new Response(JSON.stringify({ secret: "alice" })));
    await expect(pending).rejects.toThrow(/session changed/i);
  });
});
