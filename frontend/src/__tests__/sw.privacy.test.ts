// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const { routes, listeners, storage, network } = vi.hoisted(() => ({
  routes: [] as Array<{ match: (input: any) => boolean; handler: any }>,
  listeners: new Map<string, (event: any) => void>(),
  storage: { keys: vi.fn(), delete: vi.fn() },
  network: vi.fn(),
}));

vi.mock("workbox-precaching", () => ({
  precacheAndRoute: vi.fn(),
  cleanupOutdatedCaches: vi.fn(),
}));
vi.mock("workbox-routing", () => ({
  registerRoute: (match: any, handler: any) => routes.push({ match, handler }),
}));
vi.mock("workbox-strategies", () => {
  class Strategy {
    constructor(public options: any) {}
  }
  return {
    CacheFirst: Strategy,
    NetworkFirst: Strategy,
    NetworkOnly: Strategy,
    StaleWhileRevalidate: Strategy,
  };
});
vi.mock("workbox-expiration", () => ({ ExpirationPlugin: class {} }));
vi.mock("workbox-cacheable-response", () => ({ CacheableResponsePlugin: class {} }));

describe("service worker private boundary", () => {
  beforeEach(async () => {
    routes.length = 0;
    listeners.clear();
    storage.keys.mockResolvedValue([
      "api-cache-v1",
      "audio-cache-v1",
      "images-cache-v1",
      "unrelated-cache",
    ]);
    storage.delete.mockClear();
    vi.stubGlobal("caches", storage);
    vi.stubGlobal("fetch", network);
    vi.stubGlobal("self", {
      __WB_MANIFEST: [],
      location: new URL("https://reader.example/"),
      addEventListener: (name: string, callback: any) => listeners.set(name, callback),
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
      skipWaiting: vi.fn(),
    });
    vi.resetModules();
    await import("../sw");
  });

  it("routes every API request directly to no-store network, including audio and auth", async () => {
    for (const path of ["/api/posts", "/api/audio/secret.mp3", "/api/auth/me"]) {
      const request = new Request(`https://reader.example${path}`);
      const input = { url: new URL(request.url), request };
      const route = routes.find((route) => route.match(input));
      expect(route).toBeDefined();
      expect(typeof route!.handler).toBe("function");
      await route!.handler(input);
      expect(network).toHaveBeenLastCalledWith(request, { cache: "no-store" });
    }
  });

  it("purges legacy private and unscoped publisher image caches on activation", async () => {
    let done!: Promise<unknown>;
    listeners.get("activate")!({
      waitUntil: (promise: Promise<unknown>) => {
        done = promise;
      },
    });
    await done;
    expect(storage.delete.mock.calls.map(([name]) => name)).toEqual(
      expect.arrayContaining(["api-cache-v1", "audio-cache-v1", "images-cache-v1"])
    );
    expect(storage.delete).not.toHaveBeenCalledWith("unrelated-cache");
  });

  it("never caches publisher images but preserves public app images", () => {
    const match = (url: string) =>
      routes.filter((route) =>
        route.match({
          url: new URL(url),
          request: { destination: "image" },
        })
      );
    expect(match("https://tracker.example/pixel")).toHaveLength(0);
    expect(match("https://reader.example/icons/icon.svg")).toHaveLength(1);
  });
});
