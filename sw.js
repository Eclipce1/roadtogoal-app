// Keeps the app opening with no connection. Network first, so a new version
// always wins when there is a connection; the cache is only the fallback.
const CACHE = "roadtogoal-shell-v2";
const SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./dayclock.js",
  "./quotes.js",
  "./sound.js",
  "./icons.js",
  "./app.js",
  "./goalplan.js",
  "./habit.js",
  "./stepcard.js",
  "./graph.js",
  "./goals.js",
  "./agenda.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    // "no-cache" = ask the server whether the file changed, instead of trusting the
    // browser's own idea of how long a file stays fresh
    fetch(req, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
