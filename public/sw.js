const CACHE = "hadzar-shell-v1";
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && (url.pathname.startsWith("/_next/") || url.pathname.startsWith("/assets/") || url.pathname === "/manifest.webmanifest" || url.pathname === "/favicon.svg")) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || new Response("Offline", { status: 503 }))),
  );
});
