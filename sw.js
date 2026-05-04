/* STH Site App — service worker
   Caches the app shell so the launcher and modules work offline.
   Network-first for Firebase data, cache-first for static assets. */

const CACHE_NAME = 'sth-site-app-v1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './assets/sth-logo-white.png',
  './shared/styles.css',
  './shared/firebase.js',
  './shared/auth.js',
  './shared/components.js',
  './modules/piling/',
  './modules/piling/index.html',
  './modules/piling/app.js',
  './modules/piling/styles.css',
  './modules/cartage/',
  './modules/cartage/index.html',
  './modules/cartage/app.js',
  './modules/cartage/styles.css'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS).catch(err => {
      console.warn('SW: some shell assets failed to cache', err);
    }))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Don't cache Firebase/Firestore traffic — always go to network for live data
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('googleapis.com') || url.hostname.includes('firebase.com')) {
    return; // Let the browser handle it normally
  }

  // Don't cache POST etc
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        // Cache successful responses for next time
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      }).catch(() => cached); // If network fails, fall back to cache
      return cached || fetchPromise;
    })
  );
});
