// Service worker del Planificador — archivo estático real (antes se generaba
// como blob URL efímera en cada carga, lo que hacía la instalación como PWA
// poco fiable en Android). Estrategia: red primero, caché como respaldo
// offline. Sube el número de caché (CACHE) si necesitas forzar que los
// dispositivos ya instalados descarten la caché antigua tras un cambio grande.
const CACHE = 'plan-v2';
const APP_SHELL = ['./', './planificador.html', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
