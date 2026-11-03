/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CANTEEN POS DEDICATED SERVICE WORKER
 * File: sw.js (Strictly Scoped to Canteen POS Offline Mode Only)
 * ==============================================================================
 */

const CACHE_NAME = 'golden-canteen-pos-v2026.11.05';

// 💡 Canteen POS အော့ဖ်လိုင်းသုံးနိုင်ရန် လိုအပ်သော ဖိုင်များသာ သိမ်းဆည်းမည်
const PRECACHE_ASSETS = [
  './canteen-pos.html',
  './css/tailwind.min.css',
  './css/fontawesome.min.css',
  './css/style.css',
  './webfonts/fa-solid-900.woff2',
  './webfonts/fa-regular-400.woff2',
  './webfonts/fa-brands-400.woff2',
  './webfonts/fa-v4compatibility.woff2',
  './js/config.js',
  './js/api.js',
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

async function cleanRedirectResponse(response) {
  if (!response || !response.redirected) return response;
  const body = await response.blob();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: new Headers(response.headers)
  });
}

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
          } catch (err) { }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) return caches.delete(cacheName);
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!request.url.startsWith('http')) return;

  const url = new URL(request.url);

  // API များကို လုံးဝ မထိပါ
  if (
    request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.hostname.includes('workers.dev') ||
    url.searchParams.has('action')
  ) {
    return;
  }

  const pathname = url.pathname.toLowerCase();

  // 🎯 Navigation Request ဖြစ်ပါက Canteen POS တစ်ခုတည်းကိုသာ Offline Fallback ပေးမည်
  // (Main ERP index.html နှင့် pm-cashier.html တို့ကို Browser တိုက်ရိုက် Online ဖွင့်စေမည်)
  if (request.mode === 'navigate') {
    if (!pathname.includes('canteen-pos')) {
      return; // Main ERP နှင့် PM Cashier အား SW က လုံးဝ ဝင်မစွက်ဖက်ပါ
    }

    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
          const networkResponse = await fetch(request.url, { redirect: 'follow' });
          if (networkResponse && networkResponse.status === 200) {
            const cleanRes = await cleanRedirectResponse(networkResponse);
            cache.put('./canteen-pos.html', cleanRes.clone()).catch(() => { });
            return cleanRes;
          }
        } catch (netErr) { }

        const posMatch = (await cache.match('./canteen-pos.html', { ignoreSearch: true })) ||
          (await cache.match('/canteen-pos.html', { ignoreSearch: true })) ||
          (await cache.match(request, { ignoreSearch: true }));
        if (posMatch) return await cleanRedirectResponse(posMatch);

        return new Response('Offline - Canteen POS not cached yet', { status: 503 });
      })()
    );
    return;
  }

  // 🎯 Static Assets (Canteen POS အတွက် လိုအပ်သော ဖိုင်များသာ Cache သုံးမည်)
  const isPosAsset = pathname.includes('/canteen') ||
    pathname.includes('/css/') ||
    pathname.includes('/webfonts/') ||
    pathname.endsWith('/config.js') ||
    pathname.endsWith('/api.js');

  if (!isPosAsset) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request, { ignoreSearch: true });

      const fetchPromise = fetch(request, { redirect: 'follow' })
        .then(async (networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
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
      return (await fetchPromise) || new Response('', { status: 503 });
    })()
  );
});