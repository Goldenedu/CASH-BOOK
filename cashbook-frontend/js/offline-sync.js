/**
 * GOLDEN ERP SYSTEM - OFFLINE-FIRST BACKGROUND SYNC ENGINE
 * File: js/offline-sync.js
 * 💡 Features: IndexedDB Outbox Storage, Strict FIFO Sequential Sync, Idempotency Guard,
 *              Live Connection Status Badge, Auto-Replay on Network Reconnect & Silent Ledger Refresh
 */

(function(window) {
  'use strict';

  const DB_NAME = 'GoldenERP_OfflineDB';
  const DB_VERSION = 1;
  const STORE_NAME = 'outbox_queue';

  let dbInstance = null;
  let isSyncing = false;
  let syncIntervalId = null;

  /**
   * 💡 1. Open or Initialize IndexedDB
   */
  function getDB() {
    return new Promise((resolve, reject) => {
      if (dbInstance) return resolve(dbInstance);

      if (!window.indexedDB) {
        console.warn("IndexedDB not supported in this browser. Falling back to local queue memory.");
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
        console.error("IndexedDB Open Error:", event.target.error);
        resolve(null);
      };
    });
  }

  /**
   * 💡 2. Enqueue Offline Action to IndexedDB
   */
  async function enqueueRequest(action, payload, method = 'POST') {
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
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.add(item);

        req.onsuccess = () => {
          updateNetworkStatusUI();
          resolve(true);
        };
        req.onerror = () => {
          // Fallback to localStorage if IndexedDB write fails
          fallbackAddToLocalStorage(item);
          updateNetworkStatusUI();
          resolve(true);
        };
      });
    } else {
      fallbackAddToLocalStorage(item);
      updateNetworkStatusUI();
      return true;
    }
  }

  function fallbackAddToLocalStorage(item) {
    try {
      const q = JSON.parse(localStorage.getItem('golden_offline_fallback_queue') || '[]');
      item.id = Date.now();
      q.push(item);
      localStorage.setItem('golden_offline_fallback_queue', JSON.stringify(q));
    } catch (e) {
      console.warn("LocalStorage fallback queue full or disabled:", e);
    }
  }

  /**
   * 💡 3. Get All Queued Items (FIFO Order)
   */
  async function getAllQueuedRequests() {
    const db = await getDB();
    if (!db) {
      try {
        return JSON.parse(localStorage.getItem('golden_offline_fallback_queue') || '[]');
      } catch (e) {
        return [];
      }
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();

      req.onsuccess = () => {
        const list = req.result || [];
        // Sort FIFO by timestamp
        list.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        resolve(list);
      };
      req.onerror = () => resolve([]);
    });
  }

  /**
   * 💡 4. Remove Single Completed Item from Queue
   */
  async function removeQueuedRequest(id) {
    const db = await getDB();
    if (!db) {
      try {
        let q = JSON.parse(localStorage.getItem('golden_offline_fallback_queue') || '[]');
        q = q.filter(item => item.id !== id);
        localStorage.setItem('golden_offline_fallback_queue', JSON.stringify(q));
      } catch (e) {}
      return;
    }

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    });
  }

  /**
   * 💡 5. Count Total Pending Offline Items
   */
  async function getQueueCount() {
    const list = await getAllQueuedRequests();
    return list.length;
  }

  /**
   * 💡 6. Background Sequential Replay Engine (FIFO)
   */
  async function processOfflineSyncQueue(isManual = false) {
    if (isSyncing) return;
    if (!navigator.onLine) {
      if (isManual && typeof showToast === 'function') {
        showToast("ERROR", "အင်တာနက်လိုင်း ချိတ်ဆက်မှု မရှိသေးပါ။");
      }
      updateNetworkStatusUI();
      return;
    }

    const queue = await getAllQueuedRequests();
    if (queue.length === 0) {
      updateNetworkStatusUI();
      if (isManual && typeof showToast === 'function') {
        showToast("SUCCESS", "Sync လုပ်ရန် ကျန်ရှိသော စာရင်း မရှိပါ။ အားလုံး အဆင်ပြေပါသည်။");
      }
      return;
    }

    isSyncing = true;
    updateNetworkStatusUI(true, queue.length);

    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];

      // Re-verify network during loop
      if (!navigator.onLine) {
        break;
      }

      try {
        // Send request via real native fetch
        const response = await fetch(window.API_BASE_URL || '/api', {
          method: item.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${window.AppState?.authToken || ''}`,
            'X-Offline-Replay': 'true'
          },
          body: JSON.stringify({
            action: item.action,
            ...item.payload
          })
        });

        const resData = await response.json();

        if (response.ok && resData && resData.success) {
          await removeQueuedRequest(item.id);
          successCount++;
        } else {
          // If permanent application validation error (not network error), log & pop
          console.warn(`Sync item failed on server:`, resData?.message);
          failedCount++;
        }
      } catch (networkErr) {
        console.warn(`Sync paused due to network disconnect:`, networkErr);
        break; // Stop loop if connection drops mid-sync
      }
    }

    isSyncing = false;
    updateNetworkStatusUI();

    if (successCount > 0) {
      if (typeof showToast === 'function') {
        showToast("SUCCESS", `✅ လိုင်းပြန်ရသဖြင့် စက်ထဲ သိမ်းထားသော စာရင်း (${successCount}) ခုအား Cloudflare သို့ အလိုအလျောက် ပို့ပြီးပါပြီ။`);
      }
      triggerSilentActiveLedgerReload();
    }
  }

  /**
   * 💡 7. Trigger Silent Table Reload for whichever Module is active
   */
  function triggerSilentActiveLedgerReload() {
    if (typeof window.clearAllApiCache === 'function') window.clearAllApiCache();

    // Check all active module loaders
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
   * 💡 8. Live UI Indicator Badge
   */
  async function updateNetworkStatusUI(syncInProgress = false, totalToSync = 0) {
    let badge = document.getElementById('global-network-badge');

    // Create badge container if not present
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'global-network-badge';
      badge.className = 'fixed bottom-4 right-4 z-50 transition-all duration-300 pointer-events-auto';
      document.body.appendChild(badge);
    }

    const count = await getQueueCount();
    const isOnline = navigator.onLine;

    if (syncInProgress) {
      badge.innerHTML = `
        <div class="px-3 py-1.5 rounded-xl bg-indigo-600/90 backdrop-blur border border-indigo-500/30 text-white shadow-2xl flex items-center gap-2 text-xs font-bold animate-pulse">
          <i class="fa-solid fa-rotate fa-spin text-indigo-300"></i>
          <span>Syncing (${totalToSync}) Records...</span>
        </div>
      `;
      badge.classList.remove('hidden');
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
      badge.classList.remove('hidden');
      return;
    }

    if (count > 0) {
      badge.innerHTML = `
        <div class="px-3 py-1.5 rounded-xl bg-indigo-600/90 backdrop-blur border border-indigo-500/30 text-white shadow-2xl flex items-center gap-2 text-xs font-bold cursor-pointer hover:bg-indigo-500 transition" onclick="window.OfflineSync.processQueue(true)">
          <i class="fa-solid fa-cloud-arrow-up text-amber-300"></i>
          <span>${count} Pending Sync</span>
          <button class="px-1.5 py-0.5 bg-white/20 rounded text-[10px] uppercase font-mono">Sync Now</button>
        </div>
      `;
      badge.classList.remove('hidden');
      return;
    }

    // If online and 0 pending items -> Hide badge
    badge.classList.add('hidden');
  }

  /**
   * 💡 9. Lifecycle Event Listeners
   */
  function initOfflineSyncEngine() {
    window.addEventListener('online', () => {
      console.log("Network online detected. Triggering background sync...");
      updateNetworkStatusUI();
      processOfflineSyncQueue(false);
    });

    window.addEventListener('offline', () => {
      console.warn("Network disconnected. Switching to Offline Mode...");
      updateNetworkStatusUI();
      if (typeof showToast === 'function') {
        showToast("ERROR", "📶 အင်တာနက်လိုင်း ပြတ်တောက်သွားပါသည်။ စာရင်းများကို စက်ထဲတွင် ယာယီသိမ်းဆည်းပေးနေပါသည် (Offline Mode)။");
      }
    });

    // Check queue every 30 seconds automatically
    if (syncIntervalId) clearInterval(syncIntervalId);
    syncIntervalId = setInterval(() => {
      if (navigator.onLine) {
        processOfflineSyncQueue(false);
      }
    }, 30000);

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
