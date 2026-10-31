import { test, expect } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

test.use({ serviceWorkers: "allow" });
test.describe.configure({ mode: "serial" });

let server: Server;
let origin: string;
const root = resolve(import.meta.dirname, "..", "dist");

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    if (path === "/privacy-worker.html") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<!doctype html><html><body>Worker privacy harness</body></html>");
      return;
    }
    if (path.startsWith("/api/")) {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ secret: "Alice private response" }));
      return;
    }
    const file = resolve(join(root, path.slice(1)));
    if (!file.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const content = await readFile(file);
      const types: Record<string, string> = {
        ".js": "application/javascript",
        ".html": "text/html",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json",
      };
      response.writeHead(200, {
        "Content-Type": types[extname(file)] ?? "application/octet-stream",
      });
      response.end(content);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test server port");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done, reject) =>
    server.close((error) => (error ? reject(error) : done()))
  );
});

test("production worker purges legacy secrets and cannot replay private API or audio offline", async ({
  page,
  context,
}) => {
  await page.goto(`${origin}/privacy-worker.html`);
  await page.evaluate(async () => {
    for (const name of ["api-cache-v1", "audio-cache-v1", "images-cache-v1"]) {
      const cache = await caches.open(name);
      await cache.put("/api/posts", new Response("Alice legacy private response"));
    }
    await navigator.serviceWorker.register("/sw.js", { type: "module" });
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("api-cache-v1");
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("audio-cache-v1");
  await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain("images-cache-v1");

  const privatePaths = ["/api/posts", "/api/audio/private.mp3", "/api/auth/me"];
  for (const path of privatePaths) {
    expect(await page.evaluate(async (path) => (await fetch(path)).text(), path)).toContain(
      "Alice private response"
    );
  }
  const cachedPrivateUrls = await page.evaluate(async () => {
    const names = await caches.keys();
    const requests = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
    return requests
      .flat()
      .map((request) => new URL(request.url).pathname)
      .filter((path) => path.startsWith("/api/"));
  });
  expect(cachedPrivateUrls).toEqual([]);

  await context.setOffline(true);
  for (const path of privatePaths) {
    expect(
      await page.evaluate(async (path) => {
        try {
          await fetch(path);
          return "replayed";
        } catch {
          return "unavailable";
        }
      }, path)
    ).toBe("unavailable");
  }
  expect(await page.evaluate(async () => (await fetch("/icons/icon.svg")).status)).toBe(200);
  expect(await page.evaluate(async () => (await fetch("/index.html")).status)).toBe(200);
  await context.setOffline(false);
});
