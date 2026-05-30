const CACHE_NAME = 'famface-v1';
const URLS_TO_CACHE = [
  '/',
  '/Rapheal.html',
  '/website/styles.css',
  '/website/manifest.json',
  '/website/icons/icon-192.svg',
  '/website/icons/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
