/* Dog Attention – PiP Sound (offline-first)
   Note: MediaRecorder, PiP, and background playback are browser-controlled.
*/
const CACHE = "dog-attention-pip-cache-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./sw.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS);
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k === CACHE) ? null : caches.delete(k)));
    self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, {ignoreSearch:true});
    if(cached) return cached;
    try{
      const fresh = await fetch(req);
      if(req.method === "GET" && fresh.ok && (new URL(req.url).origin === location.origin)){
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch (e){
      // Offline fallback: try root
      const fallback = await cache.match("./");
      return fallback || new Response("Offline", {status: 503, headers: {"Content-Type":"text/plain"}});
    }
  })());
});
