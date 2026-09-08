/**
 * GOLDEN ERP SYSTEM - OFFLINE-FIRST BACKGROUND SYNC ENGINE
 * File: js/offline-sync.js
 * 💡 Features: Direct Cloudflare Worker Routing (405 Method Not Allowed Fixed),
 *              Safe JSON Response Parser (Unexpected end of JSON fixed),
 *              IndexedDB Outbox Storage, Strict FIFO Sequential Sync,
 *              Live Connection Status Badge (Auto-Hides only when 100% Synced) & Silent Ledger Refresh
 */

(function(window) {
  'use strict';

  const DB_NAME = 'GoldenERP_OfflineDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'outbox_queue';
  const FALLBACK_KEY = 'golden_offline_fallback_queue';

  // 💡 Real Cloudflare D1 Backend Worker Endpoint (Never post to pages.dev/api)
  const FALLBACK_WORKER_URL = "https://cashbook-app-api.goldeneduprivateschool.workers.dev/";

  let dbInstance = null;
  let isSyncing = false;
  let syncIntervalId = null;

  function getTargetApiUrl() {
    if (typeof window !== 'undefined' && window.CONFIG && window.CONFIG.API_URL) {
      return window.CONFIG.API_URL;
    }
    if (typeof API_WORKER_URL !== 'undefined' && API_WORKER_URL) {
      return API_WORKER_URL;
    }
    return FALLBACK_WORKER_URL;
  }

  /**
   * 💡 1. Open or Initialize IndexedDB
   */
  function getDB() {
    return new Promise((resolve) => {
      if (dbInstance) return resolve(dbInstance);

      if (!window.indexedDB) {
        console.warn("[OfflineSync] IndexedDB not supported, falling back to LocalStorage.");
        return resolve(null);
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function(event) {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
          store.createIndex('timestamp', 'timestamp', { unique: false });
          store.createIndex('action', 'action', { unique: false });
        }
      };

      request.onsuccess = function(event) {
        dbInstance = event.target.result;
        resolve(dbInstance);
      };

      request.onerror = function(event) {
        console.error("[OfflineSync] IndexedDB Open Error:", event.target.error);
        resolve(null);
      };
    });
  }

  /**
   * 💡 2. Enqueue Offline Action to IndexedDB
   */
  async function enqueueRequest(action, payload = {}, method = 'POST') {
    const db = await getDB();
    
    // Ensure Unique ID exists so server treats as idempotent upsert
    if (payload && !payload.uniqueId && !payload.uniqueid) {
      payload.uniqueId = `OFFLINE_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }

    const item = {
      action: action,
      payload: payload,
      method: method,
      timestamp: Date.now(),
      createdTimeStr: new Date().toLocaleTimeString(),
      retryCount: 0
    };

    if (db) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          const store = tx.objectStore(STORE_NAME);
          const req = store.add(item);

          req.onsuccess = () => {
            updateNetworkStatusUI();
            resolve(true);
          };
          req.onerror = () => {
            fallbackAddToLocalStorage(item);
            updateNetworkStatusUI();
            resolve(true);
          };
        } catch (e) {
          fallbackAddToLocalStorage(item);
          updateNetworkStatusUI();
          resolve(true);
        }
      });
    } else {
      fallbackAddToLocalStorage(item);
      updateNetworkStatusUI();
      return true;
    }
  }

  function fallbackAddToLocalStorage(item) {
    try {
      const q = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]');
      item.id = Date.now() + Math.random();
      q.push(item);
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(q));
    } catch (e) {
      console.warn("[OfflineSync] LocalStorage fallback queue error:", e);
    }
  }

  /**
   * 💡 3. Get All Queued Items (FIFO Order)
   */
  async function getAllQueuedRequests() {
    const db = await getDB();
    if (!db) {
      try {
        return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]');
      } catch (e) {
        return [];
      }
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();

        req.onsuccess = () => {
          const list = req.result || [];
          // Sort FIFO by timestamp
          list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
          resolve(list);
        };
        req.onerror = () => resolve(fallbackGetAll());
      } catch (e) {
        resolve(fallbackGetAll());
      }
    });
  }

  function fallbackGetAll() {
    try {
      return JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]');
    } catch (e) {
      return [];
    }
  }

  /**
   * 💡 4. Remove Single Completed Item from Queue
   */
  async function removeQueuedRequest(id) {
    const db = await getDB();
    if (!db) {
      fallbackRemove(id);
      return;
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (e) {
        fallbackRemove(id);
        resolve(false);
      }
    });
  }

  function fallbackRemove(id) {
    try {
      let q = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '[]');
      q = q.filter(item => item.id !== id);
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(q));
    } catch (e) {}
  }

  /**
   * 💡 5. Count Total Pending Offline Items
   */
  async function getQueueCount() {
    const list = await getAllQueuedRequests();
    return list.length;
  }

  /**
   * 💡 6. Background Sequential Replay Engine (Posts directly to Cloudflare Worker)
   */
  async function processOfflineSyncQueue(isManual = false) {
    if (isSyncing) return;

    const queue = await getAllQueuedRequests();
    if (!queue || queue.length === 0) {
      updateNetworkStatusUI();
      if (isManual && typeof window.showToast === 'function') {
        window.showToast("SUCCESS", "Sync လုပ်ရန် ကျန်ရှိသော စာရင်း မရှိပါ။ အားလုံး အဆင်ပြေပါသည်။");
      }
      return;
    }

    if (!navigator.onLine) {
      if (isManual && typeof window.showToast === 'function') {
        window.showToast("ERROR", "အင်တာနက်လိုင်း ချိတ်ဆက်မှု မရှိသေးပါ။");
      }
      updateNetworkStatusUI();
      return;
    }

    isSyncing = true;
    updateNetworkStatusUI(true, queue.length);

    let successCount = 0;
    const apiUrl = getTargetApiUrl(); // 💡 Real Cloudflare Worker URL
    const token = localStorage.getItem('golden_auth_token') || (window.AppState ? window.AppState.authToken : '') || '';
    const role = localStorage.getItem('golden_user_role') || (window.AppState ? window.AppState.currentUserRole : '') || '';

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];

      if (!navigator.onLine) {
        break;
      }

      try {
        const response = await fetch(apiUrl, {
          method: item.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
          },
          body: JSON.stringify({
            action: item.action,
            token: token,
            authToken: token,
            role: role,
            ...item.payload
          })
        });

        if (response.ok) {
          let resData = null;
          try {
            resData = await response.json();
          } catch (jsonErr) {}

          if (resData && resData.success) {
            // 💡 Database ထဲ အမှန်တကယ် ရောက်သွားမှသာ Queue ထဲမှ ဖျက်ထုတ်မည်
            await removeQueuedRequest(item.id);
            successCount++;
          } else {
            console.warn(`[OfflineSync] Item validation error:`, resData?.message);
            await removeQueuedRequest(item.id); // Evict bad/unfixable data to unblock queue
          }
        } else if (response.status === 400 || response.status === 404) {
          await removeQueuedRequest(item.id); // Evict invalid request
        } else {
          // Server 500 or real network drop -> Break and retry later
          break;
        }
      } catch (networkErr) {
        console.warn(`[OfflineSync] Network disconnect during sync:`, networkErr);
        break;
      }
    }

    isSyncing = false;
    updateNetworkStatusUI(); // 💡 Queue ထဲ စာရင်းကုန်သွားပါက Pending ဘားကြီး အလိုအလျောက် ပျောက်ကွယ်သွားမည်

    if (successCount > 0) {
      if (typeof window.showToast === 'function') {
        window.showToast("SUCCESS", `✅ လိုင်းပြန်ရသဖြင့် စက်ထဲ သိမ်းထားသော စာရင်း (${successCount}) ခုအား Cloudflare သို့ အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ!`);
      }
      triggerSilentActiveLedgerReload();
    }
  }

  /**
   * 💡 7. Trigger Silent Table Reload for whichever Module is active
   */
  function triggerSilentActiveLedgerReload() {
    if (typeof window.clearAllApiCache === 'function') window.clearAllApiCache();

    if (typeof window.loadIncomeData === 'function') window.loadIncomeData(true, true);
    if (typeof window.loadOfficeData === 'function') window.loadOfficeData(true);
    if (typeof window.loadBankData === 'function') window.loadBankData(true);
    if (typeof window.loadCashData === 'function') window.loadCashData(true);
    if (typeof window.loadPayrollData === 'function') window.loadPayrollData(true);
    if (typeof window.loadStudentData === 'function') window.loadStudentData(false);
    if (typeof window.loadStudentMoneyData === 'function') window.loadStudentMoneyData(true);
    if (typeof window.loadDashboardData === 'function') window.loadDashboardData(true);
  }

  /**
   * 💡 8. Live UI Indicator Badge (Auto Hides when Queue is 0)
   */
  async function updateNetworkStatusUI(syncInProgress = false, totalToSync = 0) {
    let badge = document.getElementById('global-network-badge');

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'global-network-badge';
      badge.className = 'fixed bottom-4 right-4 z-50 transition-all duration-300 pointer-events-auto';
      document.body.appendChild(badge);
    }

    const count = await getQueueCount();
    const isOnline = navigator.onLine;

    // 💡 FIX: စာရင်းများ ဆာဗာသို့ အမှန်တကယ် ရောက်ရှိသွားပါက (count === 0) ချက်ချင်း အလိုအလျောက် ပျောက်သွားမည်
    if (count === 0 && !syncInProgress) {
      badge.classList.add('hidden');
      return;
    }

    badge.classList.remove('hidden');

    if (syncInProgress) {
      badge.innerHTML = `
        <div class="px-3 py-1.5 rounded-xl bg-indigo-600/90 backdrop-blur border border-indigo-500/30 text-white shadow-2xl flex items-center gap-2 text-xs font-bold animate-pulse">
          <i class="fa-solid fa-rotate fa-spin text-indigo-300"></i>
          <span>ဆာဗာသို့ ပို့ဆောင်နေပါသည် (${totalToSync})...</span>
        </div>
      `;
      return;
    }

    if (!isOnline) {
      badge.innerHTML = `
        <div class="px-3 py-1.5 rounded-xl bg-amber-500/90 backdrop-blur border border-amber-400/30 text-slate-950 shadow-2xl flex items-center gap-2 text-xs font-extrabold cursor-pointer" onclick="window.OfflineSync.processQueue(true)">
          <span class="w-2.5 h-2.5 rounded-full bg-rose-600 animate-ping"></span>
          <i class="fa-solid fa-wifi text-slate-900"></i>
          <span>Offline Mode (${count} Pending)</span>
        </div>
      `;
      return;
    }

    if (count > 0) {
      badge.innerHTML = `
        <div class="px-3.5 py-1.5 rounded-xl bg-[#0c1322] border border-amber-500/40 text-amber-300 shadow-2xl flex items-center gap-2.5 text-xs font-bold">
          <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
          <span>${count} Pending Sync</span>
          <button onclick="window.OfflineSync.processQueue(true)" class="px-2 py-0.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded text-[10px] font-black cursor-pointer transition">Sync Now</button>
        </div>
      `;
      return;
    }

    badge.classList.add('hidden');
  }

  /**
   * 💡 9. Lifecycle Event Listeners
   */
  function initOfflineSyncEngine() {
    window.addEventListener('online', () => {
      console.log("[OfflineSync] Network online detected. Triggering background sync...");
      updateNetworkStatusUI();
      processOfflineSyncQueue(false);
    });

    window.addEventListener('offline', () => {
      console.warn("[OfflineSync] Network disconnected. Switching to Offline Mode...");
      updateNetworkStatusUI();
    });

    // Check queue every 15 seconds automatically
    if (syncIntervalId) clearInterval(syncIntervalId);
    syncIntervalId = setInterval(() => {
      if (navigator.onLine) {
        processOfflineSyncQueue(false);
      }
    }, 15000);

    // Initial check on load
    updateNetworkStatusUI();
    if (navigator.onLine) {
      setTimeout(() => processOfflineSyncQueue(false), 2000);
    }
  }

  // EXPOSE GLOBALLY
  window.OfflineSync = {
    init: initOfflineSyncEngine,
    enqueue: enqueueRequest,
    processQueue: processOfflineSyncQueue,
    forceSync: () => processOfflineSyncQueue(true),
    getQueueCount: getQueueCount,
    updateUI: updateNetworkStatusUI
  };

  // Auto-init on script load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOfflineSyncEngine);
  } else {
    initOfflineSyncEngine();
  }

})(window);
