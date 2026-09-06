/**
 * GOLDEN ERP SYSTEM - PROGRESSIVE WEB APP (PWA) SERVICE WORKER
 * File: sw.js
 * 💡 Features: Full App Shell & Views Pre-caching, 0ms Instant Offline Navigation,
 *              Stale-While-Revalidate Engine & Safe API Bypass
 */

const CACHE_NAME = 'golden-erp-cache-v2026.09.01';

// 💡 အော့ဖ်လိုင်းသုံးနိုင်ရန် စက်ထဲ ကြိုတင်သိမ်းဆည်းမည့် ဖိုင်များအားလုံး
const PRECACHE_ASSETS = [
  './',
  './index.html',
  
  // 💡 1. CORE SCRIPTS
  './js/config.js',
  './js/offline-sync.js',
  './js/api.js',
  './js/auth.js',
  './js/bank-cash.js',
  './js/office-kit.js',
  './js/cashier.js',
  './js/hr.js',
  './js/income.js',
  './js/staff.js',
  './js/student.js',
  './js/student-money.js',
  './js/uniform.js',
  './js/promotion.js',
  './js/reports.js',
  './js/settings.js',
  './js/dashboard.js',
  './js/app.js',

  // 💡 2. ALL 13 HTML VIEWS (Offline Menu Navigation)
  './views/dashboard.html',
  './views/bank-cash.html',
  './views/income.html',
  './views/office-kit.html',
  './views/cashier.html',
  './views/hr.html',
  './views/staff.html',
  './views/student.html',
  './views/student-money.html',
  './views/uniform.html',
  './views/promotion.html',
  './views/reports.html',
  './views/settings.html'
];

/**
 * 💡 1. Install Event - Pre-cache App Shell & Views
 */
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing & Pre-caching All Views & Assets...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Safe batch caching: individual failure will not block entire install
      for (const asset of PRECACHE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn(`[Service Worker] Warning caching ${asset}:`, err);
        }
      }
    }).then(() => self.skipWaiting())
  );
});

/**
 * 💡 2. Activate Event - Clean Old Cache Versions
 */
self.addEventListener('activate', (event) => {
  console.log('[Service Worker] Activating & Cleaning Old Caches...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log(`[Service Worker] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

/**
 * 💡 3. Fetch Interceptor - 0ms Cache-First with Background Network Revalidation
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // ⚠️ 1. Bypass API calls & Cloudflare Worker endpoints (Handled by js/offline-sync.js)
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.hostname.includes('workers.dev') ||
    url.searchParams.has('action')
  ) {
    return; // Pass through to live network / offline-sync interceptor
  }

  // 💡 2. For Views & Static Assets: Stale-While-Revalidate Strategy
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      // Fetch fresh version in background to update cache
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If network is completely offline, fail silently because we serve cached response
        });

      // If already in cache -> Return immediately (0ms instant load), else wait for network
      return cachedResponse || fetchPromise;
    })
  );
});
