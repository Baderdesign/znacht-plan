// Bader Znacht: App-Dateien liegen auf dem Gerät, damit die App sofort und auch offline startet.
// Im Hintergrund wird jeweils die neueste Version geholt und beim nächsten Öffnen verwendet.
const C = "bader-znacht-v3";
const FILES = ["./", "index.html", "app.js", "manifest.webmanifest?v=2",
  "bader-icon-180.png", "bader-icon-192.png", "bader-icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  const own = u.origin === location.origin;
  const font = u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";
  if (!own && !font) return; // Datenbank-Anfragen gehen immer direkt ins Internet
  e.respondWith(caches.open(C).then(async c => {
    const key = req.mode === "navigate" ? "index.html" : req;
    const cached = await c.match(key, { ignoreSearch: req.mode === "navigate" });
    const fresh = fetch(req).then(r => { if (r && (r.ok || r.type === "opaque")) c.put(key, r.clone()); return r; }).catch(() => null);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) || (await c.match("index.html")) || Response.error();
  }));
});
