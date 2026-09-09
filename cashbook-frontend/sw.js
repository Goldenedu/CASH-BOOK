/**
 * GOLDEN ERP SYSTEM - PROGRESSIVE WEB APP (PWA) SERVICE WORKER
 * File: sw.js
 * 💡 Features: Fault-Tolerant Parallel Pre-caching (Zero Install Bottlenecks),
 *              Native Route Reconciliation via ignoreSearch (Phase 4.3),
 *              0ms Instant Offline Navigation (Stale-While-Revalidate Engine),
 *              Crash-Proof Fetch Interceptor (Zero TypeError on Offline Drop)
 */

const CACHE_NAME = 'golden-erp-cache-v2026.09.04';

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
 * 💡 1. Install Event - Parallel Fault-Tolerant Pre-caching
 */
self.addEventListener('install', (event) => {
  console.log('[Service Worker] Installing & Pre-caching All Styles, Scripts & Views...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // ⚡ FIX: တစ်ခုချင်းစီ (Serial) သိမ်းမည့်အစား ပြိုင်တူ (Parallel) သိမ်းဆည်းသဖြင့် Install အလွန်မြန်ဆန်သည်
      // Error တက်သော ဖိုင်ရှိခဲ့လျှင်လည်း အခြားဖိုင်များ ဆက်လက် သိမ်းဆည်းနိုင်ရန် Catch လုပ်ပေးထားသည်
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
 * 💡 3. Crash-Proof Fetch Interceptor & Route Reconciler
 */
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // ⚠️ 1. Ignore non-HTTP/HTTPS requests (e.g. chrome-extension)
  if (!request.url.startsWith('http')) {
    return;
  }

  const url = new URL(request.url);

  // ⚠️ 2. Bypass API calls & Cloudflare Worker endpoints (Handled by offline-sync.js)
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.hostname.includes('workers.dev') ||
    url.searchParams.has('action')
  ) {
    return; 
  }

  // 💡 3. Stale-While-Revalidate Engine
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // ⚡ FIX: Native 'ignoreSearch' ကို အသုံးပြုခြင်းဖြင့် ?v=... Query များကို အလိုအလျောက် ကျော်ဖြတ်ပြီး Cache ကို တိကျစွာ ဆွဲထုတ်သည်
      const cachedResponse = await cache.match(request, { ignoreSearch: true });

      // Background revalidation (Network မှ နောက်ဆုံး Update ကို ယူပြီး Cache ထဲ ပြန်ထည့်သည်)
      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          // Response သေချာမှန်ကန်မှသာ Cache ထဲ ထည့်မည်
          if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => null);

      // 🎯 Cache တွေ့ပါက 0ms ဖြင့် ချက်ချင်း Return ပြန်ပေးပြီး နောက်ကွယ်တွင် Fetch ဆက်လုပ်စေသည်
      if (cachedResponse) {
        event.waitUntil(fetchPromise);
        return cachedResponse;
      }

      // Cache မရှိပါက Network အတိုင်း ဆက်သွားသည်
      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }

      // 🎯 Offline SPA Route Fallback: အော့ဖ်လိုင်းဖြစ်နေချိန် စာမျက်နှာ Reload လုပ်မိပါက Index သို့ ပြန်ပို့ပေးသည်
      if (request.mode === 'navigate') {
        const indexFallback = await cache.match('./index.html', { ignoreSearch: true });
        if (indexFallback) return indexFallback;
      }

      // 🛡️ Ultimate Fallback: Offline ပျတ်ကျချိန်တွင် 'Failed to convert value to Response' Error တက်ခြင်းကို ကာကွယ်သည်
      return new Response('', {
        status: 503,
        statusText: 'Service Unavailable (Offline)'
      });
    })()
  );
});
