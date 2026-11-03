import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";

afterEach(() => vi.unstubAllGlobals());

describe("api.put keepalive", () => {
  it("forwards keepalive to fetch so a request can outlive the page", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await api.put("/posts/p1/progress", { progress: 0.5 }, { keepalive: true });

    expect(fetcher.mock.calls[0][1].keepalive).toBe(true);
  });

  it("leaves keepalive out of the request unless asked", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);

    await api.put("/posts/p1/progress", { progress: 0.5 });

    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("keepalive");
  });
});
