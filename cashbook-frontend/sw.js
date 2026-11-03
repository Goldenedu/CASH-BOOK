/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - PROGRESSIVE WEB APP (PWA) SERVICE WORKER
 * File: sw.js (Location: cashbook-frontend/sw.js - Enterprise V9.7 Bulletproof Edition)
 * 💡 Features:
 *   1. 🔄 AUTO CACHE PURGE: Bumped to v2026.11.03-fix to purge broken navigation caches
 *   2. 🚀 REDIRECT-SAFE NAVIGATION: Passes request.url to follow Cloudflare redirects cleanly
 *   3. 🎯 PAGE-SPECIFIC OFFLINE FALLBACK: No infinite loop (canteen-pos and pm-cashier have isolated fallbacks)
 *   4. 🛡️ ZERO ERR_FAILED CRASH: Opaque redirects are never returned to navigation requests
 *   5. ⚡ STALE-WHILE-REVALIDATE: 0ms Instant offline access for static assets
 * ==============================================================================
 */

// 🎯 Version Bump: Cache အသစ်ပြောင်းလဲပြီး Chrome ရှိ မူလ Error ဖြစ်နေသော Cache အဟောင်းများကို ချက်ချင်း အပြီးတိုင်ရှင်းထုတ်မည်
const CACHE_NAME = 'golden-erp-cache-v2026.11.03-fix';

// 💡 အော့ဖ်လိုင်းသုံးနိုင်ရန် စက်ထဲ ကြိုတင်သိမ်းဆည်းမည့် ဖိုင်များအားလုံး
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './canteen-pos.html',
  './pm-cashier.html',

  // 💡 1. CORE STYLES
  './css/tailwind.min.css',
  './css/fontawesome.min.css',
  './css/style.css',

  // 💡 2. WEBFONTS
  './webfonts/fa-solid-900.woff2',
  './webfonts/fa-regular-400.woff2',
  './webfonts/fa-brands-400.woff2',
  './webfonts/fa-v4compatibility.woff2',

  // 💡 3. CORE APPLICATION SCRIPTS
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

  // 💡 4. ALL 13 HTML VIEWS
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
  './views/settings.html',

  // 💡 5. CANTEEN POS & PM CASHIER COMPONENTS
  './components/canteen-dashboard.html',
  './components/canteen-purchases.html',
  './components/canteen-modals.html',
  './js/canteen/canteen-db.js',
  './js/canteen/canteen-state.js',
  './js/canteen/canteen-pos.js',
  './js/canteen/canteen-inventory.js',
  './js/canteen/canteen-waste.js',
  './js/canteen/canteen-closing.js'
];

/**
 * 💡 1. Install Event - Parallel Fault-Tolerant Pre-caching
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_ASSETS.map(asset => {
          return cache.add(asset).catch(err => {
            console.warn(`[Service Worker] Warning caching ${asset}:`, err.message);
          });
        })
      );
    }).then(() => self.skipWaiting())
  );
});

/**
 * 💡 2. Activate Event - Clean Old Cache Versions & Claim Clients Instantly
 */
self.addEventListener('activate', (event) => {
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
 * 💡 3. Crash-Proof Fetch Interceptor (Zero ERR_FAILED Guarantee)
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (!request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // API နှင့် Cloudflare Workers သို့ သွားသော Data များအား Service Worker က လုံးဝ မထိတွေ့ဘဲ ကျော်လွှားမည်
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.hostname.includes('workers.dev') ||
    url.searchParams.has('action')
  ) {
    return;
  }

  // =========================================================================
  // 🎯 A. NAVIGATION REQUESTS (canteen-pos.html, pm-cashier.html, index.html)
  // =========================================================================
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const pathname = url.pathname.toLowerCase();

        // ၁။ Network-First: request အစား request.url (String) ဖြင့် fetch ခေါ်ယူပါသည်
        // (ထိုမှသာ Cloudflare Pages ၏ 308/301 Redirect များကို အမှားမဖြစ်ဘဲ ချောမွေ့စွာ follow သွားနိုင်ပါမည်)
        try {
          const networkResponse = await fetch(request.url);
          if (networkResponse && networkResponse.status === 200) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, networkResponse.clone()).catch(() => { });
            return networkResponse;
          }
        } catch (netErr) {
          console.warn('[Service Worker] Network navigation failed, using offline fallback:', netErr.message);
        }

        // ၂။ အင်တာနက်မရှိချိန် (Offline) ဖြစ်ပါက သက်ဆိုင်ရာ စာမျက်နှာအလိုက် သီးခြား Cache မှ ထုတ်ပေးခြင်း
        const cache = await caches.open(CACHE_NAME);

        // 🎯 Canteen POS ဖြစ်ပါက canteen-pos.html သီးသန့် ပြန်ထုတ်ပေးမည် (index.html သို့ လုံးဝ မလွှဲပါ)
        if (pathname.includes('canteen-pos')) {
          const posMatch = (await cache.match('./canteen-pos.html')) ||
            (await cache.match('/canteen-pos.html')) ||
            (await cache.match('canteen-pos.html'));
          if (posMatch) return posMatch;
        }

        // 🎯 PM Cashier ဖြစ်ပါက pm-cashier.html သီးသန့် ပြန်ထုတ်ပေးမည်
        if (pathname.includes('pm-cashier')) {
          const pmMatch = (await cache.match('./pm-cashier.html')) ||
            (await cache.match('/pm-cashier.html')) ||
            (await cache.match('pm-cashier.html'));
          if (pmMatch) return pmMatch;
        }

        // 🎯 ပင်မ ERP စာမျက်နှာ ဖြစ်ပါက index.html ပြန်ထုတ်ပေးမည်
        const indexMatch = (await cache.match('./index.html')) ||
          (await cache.match('/index.html')) ||
          (await cache.match('./'));
        if (indexMatch) return indexMatch;

        return new Response('Offline - Page not found in cache', {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      })()
    );
    return;
  }

  // =========================================================================
  // 🎯 B. STATIC ASSETS (JS, CSS, Images, Components, Fonts)
  // =========================================================================
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request, { ignoreSearch: true });

      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            cache.put(request, networkResponse.clone()).catch(() => { });
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        event.waitUntil(fetchPromise);
        return cachedResponse;
      }

      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }

      return new Response('', {
        status: 503,
        statusText: 'Service Unavailable (Offline Asset)'
      });
    })()
  );
});