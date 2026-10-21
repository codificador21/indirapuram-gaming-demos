/*
 * Minimal service worker: makes the app installable and keeps it usable on a flaky connection.
 * - Static assets (/_next/static, /icons): cache-first (they are content-hashed).
 * - Pages: network-first, falling back to the last cached copy, then to /offline.
 * - API calls and server actions (POST) are never cached.
 */
const VERSION = 'v1';
const STATIC = `static-${VERSION}`;
const PAGES = `pages-${VERSION}`;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.addAll(['/offline'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![STATIC, PAGES].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.open(STATIC).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) caches.open(PAGES).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('/offline'))),
    );
  }
});
