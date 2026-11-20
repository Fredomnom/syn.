// syn Service Worker: App-Hülle offline verfügbar; API immer übers Netz (Erfassungen puffert die App selbst).
const CACHE = "syn-v1";
const SHELL = ["/", "/static/css/app.css", "/static/js/app.js", "/static/js/core.js", "/static/js/fields.js", "/static/js/shared.js",
  "/static/js/mobile.js", "/static/js/notes.js", "/static/icons/icon.svg", "/static/fonts/inter-400.woff2", "/static/fonts/inter-500.woff2",
  "/static/fonts/inter-600.woff2", "/static/fonts/space-grotesk-600.woff2", "/static/fonts/jetbrains-mono-400.woff2"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.startsWith("/api/") || u.pathname.startsWith("/dav")) return;
  e.respondWith(fetch(e.request).then((r) => { const c = r.clone(); caches.open(CACHE).then((x) => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match("/"))));
});
