// Bader Znacht: Mit Internet immer die neueste Version laden (höchstens 3 Sekunden warten).
// Ohne Internet oder bei schlechtem Empfang: die zuletzt geladene Version vom Gerät.
const C = "bader-znacht-v5";
const FILES = ["./", "index.html", "app.js?v=5", "manifest.webmanifest?v=2",
  "bader-icon-180.png", "bader-icon-192.png", "bader-icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(C).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
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
  const key = req.mode === "navigate" ? "index.html" : req;
  e.respondWith(caches.open(C).then(async c => {
    const net = fetch(req, own ? { cache: "no-cache" } : {}).then(r => {
      if (r && (r.ok || r.type === "opaque")) c.put(key, r.clone());
      return r;
    }).catch(() => null);
    const cached = await c.match(key, { ignoreSearch: req.mode === "navigate" });
    if (!cached) return (await net) || (await c.match("index.html")) || Response.error();
    const timeout = new Promise(res => setTimeout(() => res(null), 3000));
    const r = await Promise.race([net, timeout]);
    return r || cached;
  }));
});
