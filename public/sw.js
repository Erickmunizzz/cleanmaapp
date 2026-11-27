/* Cache only versioned, public static files. Never cache pages, sessions, or API data. */
const CACHE_PREFIX = "cleanma-pwa-static-";
const CACHE = CACHE_PREFIX + "v1";
const ICONS = new Set(["/pwa/icon-192.png", "/pwa/icon-512.png", "/pwa/apple-touch-icon.png"]);
const HASHED_ASSET = /^\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.(js|css|woff2)$/;

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE)
    .map(key => caches.delete(key)))));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.mode === "navigate" || request.headers.has("Authorization")) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.search || !(ICONS.has(url.pathname) || HASHED_ASSET.test(url.pathname))) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    const type = response.headers.get("content-type") || "";
    const cacheControl = response.headers.get("cache-control") || "";
    if (response.ok && !response.redirected && !/\b(no-store|private)\b/i.test(cacheControl) &&
        /^(image\/png|text\/css|(?:application|text)\/javascript|font\/woff2)(?:;|$)/i.test(type)) {
      await cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  })());
});
