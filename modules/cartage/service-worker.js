const CACHE_NAME = 'sth-cartage-v5';
const urlsToCache = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './logo.jpg',
  './icon-192.png',
  './icon-512.png',
  './Cartage_Register_BLANK.xlsx',
  './xlsx.full.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(err => console.log('Cache install error:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(names =>
      Promise.all(names.map(n => n !== CACHE_NAME ? caches.delete(n) : null))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Never cache Firebase requests — they need live connections
  if (url.includes('firestore.googleapis.com') ||
      url.includes('firebaseio.com') ||
      url.includes('googleapis.com') ||
      url.includes('gstatic.com')) {
    return; // Let network handle it
  }

  event.respondWith(
    caches.match(event.request).then(response => {
      if (response) return response;
      return fetch(event.request.clone()).then(resp => {
        if (!resp || resp.status !== 200 || resp.type === 'error') return resp;
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
