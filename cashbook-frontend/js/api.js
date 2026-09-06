/** 
 * GOLDEN ERP SYSTEM - CENTRAL API BRIDGE & OFFLINE INTERCEPTOR (D1 DATABASE EDITION)
 * File: js/api.js 
 * 💡 Features: Offline-First Network Interceptor, Background Outbox Auto-Routing,
 *              D1 Database Compatible API Bridge & SWR In-Memory Caching Engine
 */

// 💡 Corrected Worker URL matching Cloudflare Service Name (cashbook-app-api)
const API_WORKER_URL = (typeof window !== 'undefined' && window.CONFIG?.API_URL) 
  ? window.CONFIG.API_URL 
  : "https://cashbook-app-api.goldeneduprivateschool.workers.dev/";

// 💡 Global AppState
window.AppState = window.AppState || {
  currentUser: localStorage.getItem('golden_user_name') || null,
  currentUserRole: localStorage.getItem('golden_user_role') || null,
  authToken: localStorage.getItem('golden_auth_token') || null,
  currentModule: 'dashboard'
};

// 💡 Global In-Memory Cache Store for 0ms Instant Navigation
window.gDataCache = window.gDataCache || {};

/**
 * 💡 Cache Helper Functions with localStorage Persistence
 */
window.getApiCache = function(cacheKey) {
  if (window.gDataCache[cacheKey]) {
    return window.gDataCache[cacheKey];
  }
  
  try {
    const persistedCache = localStorage.getItem('api_cache_' + cacheKey);
    if (persistedCache) {
      const parsed = JSON.parse(persistedCache);
      const cacheAge = Date.now() - parsed.timestamp;
      if (cacheAge < 24 * 60 * 60 * 1000) {
        window.gDataCache[cacheKey] = parsed.data;
        return parsed.data;
      } else {
        localStorage.removeItem('api_cache_' + cacheKey);
      }
    }
  } catch (e) {
    console.warn('Failed to read from localStorage cache:', e);
  }
  
  return null;
};

window.setApiCache = function(cacheKey, data) {
  if (data && data.success) {
    window.gDataCache[cacheKey] = data;
    try {
      const cacheEntry = {
        timestamp: Date.now(),
        data: data
      };
      localStorage.setItem('api_cache_' + cacheKey, JSON.stringify(cacheEntry));
    } catch (e) {
      console.warn('Failed to persist cache to localStorage:', e);
    }
  }
};

window.clearAllApiCache = function() {
  window.gDataCache = {};
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('api_cache_')) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn('Failed to clear localStorage cache:', e);
  }
};

window.invalidateApiCache = function(actionPrefix = '') {
  if (!actionPrefix) {
    window.clearAllApiCache();
    return;
  }
  
  Object.keys(window.gDataCache).forEach(key => {
    if (key.toLowerCase().includes(actionPrefix.toLowerCase())) {
      delete window.gDataCache[key];
    }
  });
  
  try {
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('api_cache_') && key.toLowerCase().includes(actionPrefix.toLowerCase())) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn('Failed to invalidate localStorage cache:', e);
  }
};

/**
 * 💡 Error Logging System
 */
window.ErrorLogger = {
  maxLogs: 50,
  
  logError: function(context, error, additionalInfo = {}) {
    const errorEntry = {
      timestamp: new Date().toISOString(),
      context: context,
      errorMessage: error?.message || String(error),
      errorStack: error?.stack || null,
      additionalInfo: additionalInfo,
      userAgent: navigator.userAgent,
      url: window.location.href
    };
    
    let logs = [];
    try {
      const storedLogs = localStorage.getItem('error_logs');
      if (storedLogs) {
        logs = JSON.parse(storedLogs);
      }
    } catch (e) {
      console.warn('Failed to parse error logs:', e);
    }
    
    logs.unshift(errorEntry);
    if (logs.length > this.maxLogs) {
      logs = logs.slice(0, this.maxLogs);
    }
    
    try {
      localStorage.setItem('error_logs', JSON.stringify(logs));
    } catch (e) {
      console.warn('Failed to save error logs:', e);
    }
    
    console.error(`[ErrorLogger] ${context}:`, error, additionalInfo);
  },
  
  getLogs: function() {
    try {
      const storedLogs = localStorage.getItem('error_logs');
      return storedLogs ? JSON.parse(storedLogs) : [];
    } catch (e) {
      console.warn('Failed to get error logs:', e);
      return [];
    }
  },
  
  clearLogs: function() {
    localStorage.removeItem('error_logs');
  }
};

function getFreshAuthToken() {
  const token = localStorage.getItem('golden_auth_token') || (window.AppState ? window.AppState.authToken : null) || '';
  if (window.AppState) window.AppState.authToken = token;
  return token;
}

window.toggleLoading = function(show) {
  const overlay = document.getElementById('loading-overlay');
  if (overlay) {
    if (show) overlay.classList.remove('hidden');
    else overlay.classList.add('hidden');
  }
};

/**
 * 💡 Central D1-Compatible API Fetch Engine with Offline-First Interceptor
 */
window.callApi = async function(action, payload = {}, method = 'POST') {
  let serverPayload = {};
  let url = API_WORKER_URL;

  const isReadAction = action.startsWith('get') || action.startsWith('check');
  const isWriteAction = action.startsWith('save') || action.startsWith('update') || action.startsWith('delete') || action.startsWith('trigger') || action.startsWith('backup') || action.startsWith('export') || action.startsWith('send');
  const forceRefresh = payload.forceRefresh === true;

  const { forceRefresh: _, ...extractedPayload } = payload;
  serverPayload = extractedPayload; // Safely assigned in outer scope

  const cacheKey = `${action}_${JSON.stringify(serverPayload)}`;

  // 1. FAST OFFLINE CHECK FOR WRITES: If strictly offline, enqueue immediately without waiting for timeout
  if (isWriteAction && !navigator.onLine && window.OfflineSync) {
    console.warn(`[OfflineSync] Offline detected. Enqueueing ${action} immediately...`);
    await window.OfflineSync.enqueue(action, serverPayload, method);
    window.clearAllApiCache();
    window.showToast("SUCCESS", "📶 အင်တာနက်လိုင်း မရှိသေးသဖြင့် စက်ထဲတွင် ယာယီသိမ်းထားပါသည် (Offline Queue)။ လိုင်းရသည်နှင့် အလိုအလျောက် ပို့ပေးပါမည်။");
    return {
      success: true,
      isOfflineQueued: true,
      message: "စာရင်းအား စက်ထဲတွင် ယာယီသိမ်းဆည်းထားပါသည် (Offline Queue)"
    };
  }

  try {
    const currentToken = getFreshAuthToken();
    const currentRole = localStorage.getItem('golden_user_role') || (window.AppState ? window.AppState.currentUserRole : '') || '';

    if (isReadAction && !forceRefresh) {
      const cachedRes = window.getApiCache(cacheKey);
      if (cachedRes) {
        return cachedRes;
      }
    }

    const headers = {
      'Content-Type': 'application/json'
    };

    if (currentToken) {
      headers['Authorization'] = `Bearer ${currentToken}`;
    }

    const options = { method: method, headers: headers };

    if (method === 'GET') {
      const params = new URLSearchParams({
        action: action,
        token: currentToken,
        role: currentRole,
        ...serverPayload
      });
      url += `?${params.toString()}`;
    } else {
      options.body = JSON.stringify({
        action: action,
        token: currentToken,
        authToken: currentToken,
        role: currentRole,
        ...serverPayload
      });
    }

    const response = await fetch(url, options);

    if (response.status === 401) {
      console.warn(`[API 401] Unauthorized access for action: ${action}`);

      localStorage.removeItem('golden_auth_token');
      localStorage.removeItem('golden_user_name');
      localStorage.removeItem('golden_user_role');

      if (window.AppState) {
        window.AppState.authToken = null;
        window.AppState.currentUser = null;
        window.AppState.currentUserRole = null;
      }

      window.clearAllApiCache();
      document.documentElement.className = 'dark not-authed';

      const loginErrBox = document.getElementById('login-error');
      if (loginErrBox) {
        loginErrBox.textContent = "Session သက်တမ်း ကုန်ဆုံးသွားပါပြီ။ ပြန်လည် Login ဝင်ရောက်ပါ။";
        loginErrBox.classList.remove('hidden');
      }

      throw new Error("HTTP Error: 401 (Session Expired)");
    }

    if (!response.ok) {
      let serverMessage = '';
      try {
        const errData = await response.clone().json();
        serverMessage = errData && (errData.detail || errData.message) ? (errData.detail || errData.message) : '';
      } catch (parseErr) {}
      throw new Error(`HTTP Error: ${response.status}${serverMessage ? ` - ${serverMessage}` : ''}`);
    }

    const result = await response.json();

    if (isReadAction && result && result.success) {
      window.setApiCache(cacheKey, result);
    }

    if (isWriteAction && result && result.success) {
      window.clearAllApiCache();
    }

    return result;

  } catch (err) {
    // 💡 2. NETWORK DROP INTERCEPTOR: If request failed due to offline/network disconnect
    const isNetworkErr = !navigator.onLine || 
                         err.name === 'TypeError' ||
                         (err.message && (
                           err.message.includes('Failed to fetch') ||
                           err.message.includes('NetworkError') ||
                           err.message.includes('Load failed') ||
                           err.message.includes('network')
                         ));

    if (isWriteAction && isNetworkErr && window.OfflineSync) {
      console.warn(`[OfflineSync Interceptor] Network error during ${action}. Diverting to IndexedDB Outbox...`);
      await window.OfflineSync.enqueue(action, serverPayload, method);
      window.clearAllApiCache();
      
      window.showToast("SUCCESS", "📶 အင်တာနက်လိုင်း နှေးကွေး/ပြတ်တောက်နေသဖြင့် စက်ထဲတွင် ယာယီသိမ်းထားပါသည် (Offline Mode)။ လိုင်းရသည်နှင့် အလိုအလျောက် ပို့ပေးပါမည်။");

      return {
        success: true,
        isOfflineQueued: true,
        message: "စာရင်းအား စက်ထဲတွင် ယာယီသိမ်းဆည်းထားပါသည် (Offline Queue)"
      };
    }

    // If Read Action failed offline, try to serve from Cache
    if (isReadAction && isNetworkErr) {
      const staleCache = window.getApiCache(cacheKey);
      if (staleCache) {
        console.info(`[Offline Read] Serving stale cache for ${action}`);
        return staleCache;
      }
    }

    if (window.ErrorLogger) {
      window.ErrorLogger.logError(`API_CALL_${action}`, err, {
        action: action,
        payload: serverPayload,
        method: method,
        url: url
      });
    }

    console.error(`API Error [${action}]:`, err);

    if (!err.message || !err.message.includes("401")) {
      window.showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု မအောင်မြင်ပါ: " + err.message);
    }

    throw err;
  }
};

/**
 * 💡 Enterprise Background Prefetching Engine (Student Money Added)
 */
window.prefetchCoreModules = function() {
  window.viewCache = window.viewCache || {};
  const views = [
    'dashboard', 'bank-cash', 'income', 'office-kit', 'hr',
    'cashier', 'student', 'student-money', 'uniform', 'promotion', 'reports',
    'settings'
  ];

  views.forEach(v => {
    if (!window.viewCache[v]) {
      fetch(`views/${v}.html`)
        .then(r => r.ok ? r.text() : '')
        .then(html => { if (html) window.viewCache[v] = html; })
        .catch(() => {});
    }
  });

  setTimeout(() => {
    window.callApi('getDashboardData', {}).catch(() => {});
    window.callApi('getBankCashData', { bookName: 'Bank Book', page: 1, limit: 30, searchVal: '' }).catch(() => {});
    window.callApi('getBankCashData', { bookName: 'Cash Book', page: 1, limit: 30, searchVal: '' }).catch(() => {});
    window.callApi('getIncomeData', { page: 1, limit: 50, searchVal: '' }).catch(() => {});
    window.callApi('getExpenseData', { bookName: 'Office Exp Book', page: 1, limit: 30, searchVal: '' }).catch(() => {});
    window.callApi('getExpenseData', { bookName: 'Kitchen Exp Book', page: 1, limit: 30, searchVal: '' }).catch(() => {});
    window.callApi('getExpenseData', { bookName: 'HR Payroll Exp Book', page: 1, limit: 30, searchVal: '' }).catch(() => {});
    window.callApi('getCashierData', { bookName: 'CACash' }).catch(() => {});
    window.callApi('getCashierData', { bookName: 'CABank' }).catch(() => {});
    window.callApi('getTodayIncomeForCashier', {}).catch(() => {});
    window.callApi('getStudentData', { page: 1, limit: 50 }).catch(() => {});
    window.callApi('getStudentMoneyData', { page: 1, limit: 50 }).catch(() => {});
    window.callApi('getStaffData', { category: 'FullTime', page: 1, limit: 30, searchVal: '' }).catch(() => {});
    window.callApi('getUniformData', { page: 1, limit: 1000 }).catch(() => {});
    window.callApi('getPromotionData', {}).catch(() => {});
    window.callApi('getSettingsData', {}).catch(() => {});
  }, 100);
};

window.showToast = function(type, message) {
  if (document.documentElement.classList.contains('not-authed') && type === 'ERROR') {
    return;
  }

  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) return;

  let msg = String(message || "").trim();
  if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
    msg = "⚠️ အင်တာနက်လိုင်း နှေးကွေး/ပြတ်တောက်နေသဖြင့် ဆာဗာသို့ ချိတ်ဆက်၍ မရပါ။";
  }

  const toast = document.createElement('div');
  toast.className = `p-4 rounded-xl shadow-2xl flex items-center gap-3 text-xs font-bold transition-all transform translate-y-5 opacity-0 duration-300 pointer-events-auto bg-slate-900 border ${
    type === 'SUCCESS' ? 'border-emerald-500 text-emerald-400' : 'border-rose-500 text-rose-400'
  }`;

  const icon = type === 'SUCCESS' ? '<i class="fa-solid fa-circle-check text-base"></i>' : '<i class="fa-solid fa-circle-exclamation text-base"></i>';
  toast.innerHTML = `${icon} <span>${window.escapeHtml(msg)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => { toast.classList.remove('translate-y-5', 'opacity-0'); }, 10);
  setTimeout(() => {
    toast.classList.add('translate-y-5', 'opacity-0');
    setTimeout(() => { toast.remove(); }, 300);
  }, 4000);
};

window.escapeHtml = function(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
};

window.cleanNumber = function(val) {
  if (val === undefined || val === null || val === "") return 0;
  var strVal = String(val).trim();
  var isNegative = (strVal.includes("(") && strVal.includes(")")) || strVal.indexOf("-") === 0;
  var cleaned = strVal.replace(/[^0-9.]/g, "");
  var num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return isNegative ? -num : num;
};

window.parseIsoDate = function(dStr) {
  if (!dStr) return null;
  var str = String(dStr).trim();
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) {
    var parts = str.split(/[-/]/);
    return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  }
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(str)) {
    var parts2 = str.split(/[-/]/);
    return new Date(parseInt(parts2[2], 10), parseInt(parts2[1], 10) - 1, parseInt(parts2[0], 10));
  }
  var d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

window.isDateInRange = function(rowDateStr, fromDateStr, toDateStr) {
  if (!fromDateStr && !toDateStr) return true;
  if (!rowDateStr) return false;

  var rowDate = window.parseIsoDate(rowDateStr);
  if (!rowDate) return true;

  if (fromDateStr) {
    var fromDate = new Date(fromDateStr + 'T00:00:00');
    if (rowDate < fromDate) return false;
  }
  if (toDateStr) {
    var toDate = new Date(toDateStr + 'T23:59:59');
    if (rowDate > toDate) return false;
  }
  return true;
};
