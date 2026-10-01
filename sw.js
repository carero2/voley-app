// Service worker: la app funciona sin conexión (pabellones con mala cobertura) y se actualiza sola.
// - «Network first» sin la caché HTTP del navegador (cache: 'no-cache'): con red, siempre la última versión
//   publicada (el servidor responde «sin cambios» si no hay nada nuevo); sin red, la copia guardada.
// - Al instalarse una versión nueva toma el control enseguida y la app se recarga (ver app.js).
// VERSION debe coincidir con js/version.js (lo comprueba tests/sw.test.mjs).
const VERSION = '29';
const CACHE = `voley-app-v${VERSION}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './icons/icon.svg',
  './js/actions.js',
  './js/app.js',
  './js/help.js',
  './js/rally.js',
  './js/stats.js',
  './js/store.js',
  './js/sync-core.js',
  './js/sync.js',
  './js/ui.js',
  './js/version.js',
  './js/views/clubs.js',
  './js/views/data.js',
  './js/views/home.js',
  './js/views/match.js',
  './js/views/rivals.js',
  './js/views/stats.js',
  './js/views/sync-ui.js',
  './js/views/team.js',
  './js/views/voice-review.js',
  './js/voice/db.js',
  './js/voice/parser.js',
  './js/voice/queue.js',
  './js/voice/recorder.js',
  './js/voice/transcribe.js',
];

self.addEventListener('install', (e) => {
  // 'reload': se descargan del servidor, no de la caché HTTP del navegador.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache' }) : fetch(new Request(req, { cache: 'no-cache' }));
  e.respondWith(
    fresh
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true })),
  );
});
