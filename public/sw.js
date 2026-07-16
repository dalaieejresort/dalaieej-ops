const NAVIGATION_CACHE = "dalaieej-navigation-v2";
const ASSET_CACHE = "dalaieej-assets-v1";
const OFFLINE_ROUTES = ["/", "/register", "/ops"];
const STATIC_ASSETS = new Set([
  "/app-icon.svg",
  "/favicon.ico",
  "/manifest.webmanifest",
]);
const NAVIGATION_TIMEOUT_MS = 5000;

async function fetchNavigation(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);

  try {
    return await fetch(request, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) return cachedResponse;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(NAVIGATION_CACHE);

      await Promise.allSettled(
        OFFLINE_ROUTES.map(async (route) => {
          const response = await fetch(route, { cache: "reload" });
          if (response.ok) await cache.put(route, response);
        }),
      );

      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) =>
            (cacheName.startsWith("dalaieej-navigation-") &&
              cacheName !== NAVIGATION_CACHE) ||
            (cacheName.startsWith("dalaieej-assets-") &&
              cacheName !== ASSET_CACHE),
          )
          .map((cacheName) => caches.delete(cacheName)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (
    request.mode !== "navigate" &&
    !url.pathname.startsWith("/_next/static/") &&
    !STATIC_ASSETS.has(url.pathname)
  ) {
    return;
  }

  if (request.mode !== "navigate") {
    event.respondWith(cacheFirstAsset(request));
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(NAVIGATION_CACHE);

      try {
        const response = await fetchNavigation(request);
        if (response.ok) {
          try {
            await cache.put(request, response.clone());
          } catch {
            // A successful live navigation is still preferable to stale data.
          }
        }
        return response;
      } catch {
        return (
          (await cache.match(request, { ignoreSearch: true })) ??
          (await cache.match(new URL(request.url).pathname)) ??
          (await cache.match("/")) ??
          Response.error()
        );
      }
    })(),
  );
});
