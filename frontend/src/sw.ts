/**
 * Service Worker for Almanac PWA
 *
 * Implements caching strategies:
 * - Network-first for API calls (with offline fallback)
 * - Cache-first for static assets
 * - Stale-while-revalidate for images
 */

/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, CacheFirst, StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";

// Service worker global scope
declare let self: ServiceWorkerGlobalScope & typeof globalThis;
const sw = self;

// Precache static assets injected by VitePWA. The injectManifest build step
// replaces the literal `self.__WB_MANIFEST` reference below with the manifest.
precacheAndRoute(self.__WB_MANIFEST);

// Clean up old caches
cleanupOutdatedCaches();

// Cache names
const CACHE_NAMES = {
  api: "api-cache-v1",
  images: "images-cache-v1",
  audio: "audio-cache-v1",
};

/**
 * Audio routes - Cache first
 * Audio files are large, prefer cached versions. Registered before the generic
 * /api/ route because Workbox uses the first matching route.
 */
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/audio/"),
  new CacheFirst({
    cacheName: CACHE_NAMES.audio,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200, 206],
      }),
      new ExpirationPlugin({
        maxEntries: 20,
        maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
      }),
    ],
  })
);

/**
 * API routes - Network first with cache fallback
 * Cache responses for offline reading. Auth endpoints and navigations (OAuth
 * login redirects) bypass the SW: caching them replays stale redirects/sessions.
 */
registerRoute(
  ({ url, request }) =>
    url.pathname.startsWith("/api/") &&
    !url.pathname.startsWith("/api/auth/") &&
    request.mode !== "navigate",
  new NetworkFirst({
    cacheName: CACHE_NAMES.api,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24, // 1 day
      }),
    ],
    networkTimeoutSeconds: 10,
  })
);

/**
 * Image routes - Stale while revalidate
 * Serve cached images immediately, update in background
 */
registerRoute(
  ({ request }) => request.destination === "image",
  new StaleWhileRevalidate({
    cacheName: CACHE_NAMES.images,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200],
      }),
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 60 * 60 * 24 * 7, // 7 days
      }),
    ],
  })
);

/**
 * Handle skip waiting
 */
sw.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    void sw.skipWaiting();
  }
});

/**
 * Handle install
 */
sw.addEventListener("install", () => {
  console.log("[SW] Installing service worker");
});

/**
 * Handle activate
 */
sw.addEventListener("activate", (event) => {
  console.log("[SW] Activating service worker");
  event.waitUntil(sw.clients.claim());
});
