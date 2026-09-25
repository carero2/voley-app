// Service worker: permite usar la app sin conexión (pabellones con mala cobertura).
// Estrategia "network first": si hay red se usa la última versión publicada; si no, la caché.
const CACHE = 'voley-app-v6';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './icons/icon.svg',
  './js/app.js',
  './js/actions.js',
  './js/store.js',
  './js/rally.js',
  './js/stats.js',
  './js/ui.js',
  './js/views/home.js',
  './js/views/team.js',
  './js/views/match.js',
  './js/views/stats.js',
  './js/views/data.js',
  './js/views/clubs.js',
  './js/views/rivals.js',
  './js/help.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
