/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - PROGRESSIVE WEB APP (PWA) SERVICE WORKER
 * File: sw.js (Location: cashbook-frontend/sw.js - Enterprise V9.8 Cloudflare Pages Fix)
 * 💡 Features:
 *   1. 🛡️ CLOUDFLARE PAGES 308 REDIRECT UNWRAPPER: Strips response.redirected flag
 *      via cleanRedirectResponse() to permanently eliminate Chrome ERR_FAILED!
 *   2. 🔄 AUTO CACHE PURGE: Bumped to v2026.11.04-cf-fix to clear old redirected caches
 *   3. 🎯 PAGE-SPECIFIC OFFLINE FALLBACK: Supports canteen-pos, pm-cashier & index
 *   4. ⚡ STALE-WHILE-REVALIDATE: 0ms Instant offline access for all static assets
 * ==============================================================================
 */

const CACHE_NAME = 'golden-erp-cache-v2026.11.04-cf-fix';

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
  './views/student.html',
  './views/staff.html',
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
 * 🛡️ CRITICAL HELPER: Cloudflare Pages ၏ 308 Redirect ကြောင့် ကပ်ပါလာသော
 * `response.redirected = true` အား Chrome က ERR_FAILED မပစ်စေရန် အသစ်ပြန်ထုပ်ပိုးပေးခြင်း
 */
async function cleanRedirectResponse(response) {
  if (!response) return response;
  if (!response.redirected) return response;

  const body = await response.blob();
  const headers = new Headers(response.headers);
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

/**
 * 💡 1. Install Event - Redirect-Safe Pre-caching
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_ASSETS.map(async (asset) => {
          try {
            const res = await fetch(asset, { redirect: 'follow' });
            if (res && res.status === 200) {
              const cleanRes = await cleanRedirectResponse(res);
              await cache.put(asset, cleanRes);
            }
          } catch (err) {
            console.warn(`[Service Worker] Warning caching ${asset}:`, err.message);
          }
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
        const cache = await caches.open(CACHE_NAME);

        // ၁။ Network-First with Redirect Unwrapping
        try {
          const networkResponse = await fetch(request.url, { redirect: 'follow' });
          if (networkResponse && networkResponse.status === 200) {
            const cleanRes = await cleanRedirectResponse(networkResponse);
            cache.put(request, cleanRes.clone()).catch(() => { });
            return cleanRes;
          }
        } catch (netErr) {
          console.warn('[Service Worker] Network navigation failed, using offline fallback:', netErr.message);
        }

        // ၂။ Offline Fallback (သက်ဆိုင်ရာ စာမျက်နှာအလိုက် သီးခြား Cache မှ ထုတ်ပေးခြင်း)
        if (pathname.includes('canteen-pos')) {
          const posMatch = (await cache.match('./canteen-pos.html', { ignoreSearch: true })) ||
            (await cache.match('/canteen-pos.html', { ignoreSearch: true })) ||
            (await cache.match('/canteen-pos', { ignoreSearch: true })) ||
            (await cache.match(request, { ignoreSearch: true }));
          if (posMatch) return await cleanRedirectResponse(posMatch);
        }

        if (pathname.includes('pm-cashier')) {
          const pmMatch = (await cache.match('./pm-cashier.html', { ignoreSearch: true })) ||
            (await cache.match('/pm-cashier.html', { ignoreSearch: true })) ||
            (await cache.match('/pm-cashier', { ignoreSearch: true })) ||
            (await cache.match(request, { ignoreSearch: true }));
          if (pmMatch) return await cleanRedirectResponse(pmMatch);
        }

        const indexMatch = (await cache.match('./index.html', { ignoreSearch: true })) ||
          (await cache.match('/index.html', { ignoreSearch: true })) ||
          (await cache.match('./', { ignoreSearch: true }));
        if (indexMatch) return await cleanRedirectResponse(indexMatch);

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

      const fetchPromise = fetch(request, { redirect: 'follow' })
        .then(async (networkResponse) => {
          if (
            networkResponse &&
            networkResponse.status === 200 &&
            (networkResponse.type === 'basic' || networkResponse.type === 'cors')
          ) {
            const cleanRes = await cleanRedirectResponse(networkResponse);
            cache.put(request, cleanRes.clone()).catch(() => { });
            return cleanRes;
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        event.waitUntil(fetchPromise);
        return await cleanRedirectResponse(cachedResponse);
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