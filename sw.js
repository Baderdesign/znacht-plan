// Bader Znacht: Die App startet immer sofort vom Gerät, auch mit schlechtem Empfang.
// Im Hintergrund wird die neueste Version geholt. Gibt es eine neue, lädt die App kurz neu.
const C = "bader-znacht-v18";
const FILES = ["./", "index.html", "app.js?v=15", "manifest.webmanifest?v=4",
  "chuchi-icon-180.png", "chuchi-icon-192.png", "chuchi-icon-512.png", "bader-chuchi-schrift.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function refresh(c, req, key, isPage) {
  try {
    const r = await fetch(req, { cache: "no-cache" });
    if (!r || !r.ok) return;
    if (isPage) {
      const old = await c.match(key);
      const [a, b] = await Promise.all([old ? old.clone().text() : "", r.clone().text()]);
      await c.put(key, r);
      if (old && a !== b) (await self.clients.matchAll({ type: "window" })).forEach(cl => cl.postMessage({ type: "update" }));
    } else await c.put(key, r);
  } catch (_) { /* offline: nichts tun */ }
}

self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const u = new URL(req.url);
  const own = u.origin === location.origin;
  const font = u.hostname === "fonts.googleapis.com" || u.hostname === "fonts.gstatic.com";
  if (!own && !font) return; // Datenbank-Anfragen gehen immer direkt ins Internet
  const isPage = req.mode === "navigate";
  const key = isPage ? "index.html" : req;
  e.respondWith(caches.open(C).then(async c => {
    const cached = await c.match(key, { ignoreSearch: isPage });
    if (cached) { if (own) e.waitUntil(refresh(c, req, key, isPage)); return cached; }
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === "opaque")) c.put(key, r.clone());
      return r;
    } catch (_) { return (await c.match("index.html")) || Response.error(); }
  }));
});
