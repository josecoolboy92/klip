/* Service worker: lets Klip Studio open offline, and receives videos shared from other apps. */
const CACHE = 'klip-v1';
const APP = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/editor.js', 'js/engine.js', 'js/export.js', 'js/fx.js',
  'js/media.js', 'js/db.js', 'js/util.js', 'js/templates.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png'];
// Libraries and fonts from these sites are kept for offline use after the first visit
const CDN = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Videos shared from other apps (Android "Share" → Klip Studio)
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith((async () => {
      const form = await e.request.formData();
      const files = form.getAll('media');
      const cache = await caches.open('klip-shared');
      await Promise.all(files.map((f, i) => cache.put(`shared-${Date.now()}-${i}`, new Response(f, { headers: { 'x-name': encodeURIComponent(f.name), 'content-type': f.type } }))));
      return Response.redirect('./#library', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET') return;
  if (CDN.includes(url.hostname)) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const res = await fetch(e.request);
      if (res.ok) c.put(e.request, res.clone());
      return res;
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then((res) => {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match('index.html'))));
});
