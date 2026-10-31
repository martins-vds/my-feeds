/**
 * Service Worker for Almanac PWA
 *
 * Implements caching strategies:
 * - Network-only, no-store for private API and audio
 * - Precached public app assets and public icons for offline use
 */

/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/client" />

import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { purgePrivateCaches } from "./services/privateState";

// Service worker global scope
declare let self: ServiceWorkerGlobalScope & typeof globalThis;
const sw = self;

// Precache static assets injected by VitePWA. The injectManifest build step
// replaces the literal `self.__WB_MANIFEST` reference below with the manifest.
precacheAndRoute(self.__WB_MANIFEST);

// Clean up old caches
cleanupOutdatedCaches();

// Never replay another user's private response, including auth redirects.
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  ({ request }) => fetch(request, { cache: "no-store" })
);

/**
 * Image routes - Stale while revalidate
 * Serve cached images immediately, update in background
 */
registerRoute(
  ({ url, request }) =>
    request.destination === "image" &&
    url.origin === sw.location.origin &&
    url.pathname.startsWith("/icons/"),
  new StaleWhileRevalidate({
    cacheName: "public-images-cache-v2",
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
  if (event.data?.type === "PURGE_PRIVATE_CACHES") {
    event.waitUntil(purgePrivateCaches());
  }
});

/**
 * Handle install
 */
sw.addEventListener("install", (event) => {
  // Replace legacy private-cache workers immediately rather than waiting for
  // a user to accept an optional offline-app update.
  event.waitUntil(sw.skipWaiting());
});

/**
 * Handle activate
 */
sw.addEventListener("activate", (event) => {
  event.waitUntil(purgePrivateCaches().then(() => sw.clients.claim()));
});
