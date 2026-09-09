/**
 * GOLDEN ERP SYSTEM - PROGRESSIVE WEB APP (PWA) SERVICE WORKER
 * File: sw.js
 * 💡 Features: Crash-Proof Fetch Interceptor, View Route Reconciliation (Phase 4.3),
 *              Full CSS/Styles & Views Pre-caching, 0ms Instant Offline Navigation,
 *              Stale-While-Revalidate Engine & Safe API Bypass
 */

const CACHE_NAME = 'golden-erp-cache-v2026.09.03';

// 💡 အော့ဖ်လိုင်းသုံးနိုင်ရန် စက်ထဲ ကြိုတင်သိမ်းဆည်းမည့် ဖိုင်များအားလုံး (CSS + JS + HTML Views)
const PRECACHE_ASSETS = [
  './',
  './index.html',
  
  // 💡 1. CORE STYLES
  './css/tailwind.min.css',
  './css/fontawesome.min.css',
  './css/style.css',

  // 💡 2. CORE APPLICATION SCRIPTS
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

  // 💡 3. ALL 13 RECONCILED HTML VIEWS (Offline SPA View Routes)
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
 * 💡 1. Install Event - Pre-cache App Shell, Styles & Views
 */
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing & Pre-caching All Styles, Scripts & Views...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
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
 * 💡 Helper: URL Path Normalizer & Route Reconciler
 * SPA view request တွေဖြစ်တဲ့ /views/income.html သို့မဟုတ် views/income.html?v=... တွေကို
 * Cache ထဲက standard key နဲ့ ချိန်ညှိပေးခြင်း
 */
function normalizeRequest(request) {
  const url = new URL(request.url);
  // View dynamic query hash တွေကို ဖြုတ်ထုတ်ပြီး clean path ရယူခြင်း
  if (url.pathname.includes('/views/')) {
    const viewMatch = url.pathname.match(/views\/[a-zA-Z0-9\-_]+\.html/);
    if (viewMatch) {
      return new Request(`./${viewMatch[0]}`);
    }
  }
  return request;
}

/**
 * 💡 3. Crash-Proof Fetch Interceptor & Route Reconciler
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // ⚠️ 1. Ignore non-HTTP/HTTPS requests
  if (!request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // ⚠️ 2. Bypass API calls & Cloudflare Worker endpoints
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.hostname.includes('workers.dev') ||
    url.searchParams.has('action')
  ) {
    return;
  }

  // 💡 3. Stale-While-Revalidate with Route Reconciliation
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const normalizedReq = normalizeRequest(request);

      // Cache ထဲတွင် ignoreSearch အသုံးပြုပြီး အရင်ရှာပါ
      let cachedResponse = await cache.match(normalizedReq, { ignoreSearch: true });
      if (!cachedResponse && normalizedReq !== request) {
        cachedResponse = await cache.match(request, { ignoreSearch: true });
      }

      // Background revalidation logic
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            cache.put(normalizedReq, responseToCache);
          }
          return networkResponse;
        })
        .catch(() => null);

      // Cache တွေ့ပါက တန်း return ပြန်ပြီး background fetch အလုပ်လုပ်စေခြင်း
      if (cachedResponse) {
        event.waitUntil(fetchPromise);
        return cachedResponse;
      }

      // Cache မရှိပါက Network မှ တောင်းယူခြင်း
      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }

      // Navigation / SPA page load ဖြစ်ပါက offline app-shell (index.html) သို့ fallback ပေးခြင်း
      if (request.mode === 'navigate') {
        const indexFallback = await cache.match('./index.html');
        if (indexFallback) return indexFallback;
      }

      // Fallback empty response
      return new Response('', {
        status: 408,
        statusText: 'Offline Asset Unavailable'
      });
    })()
  );
});
