/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN GLOBAL STATE & NETWORK CONTROLLER
 * File: js/canteen/canteen-state.js (Enterprise V9.6 Full Production Edition)
 * 💡 Features:
 *   1. 🕒 Live MMT (UTC+06:30) Ticking Clock (Date + Time AM/PM)
 *   2. 🔒 ACTIVE SESSION WATCHDOG: Graceful Auto-Logout on Token/Session Expiration
 *   3. 🛡️ Scope-Safe Singleton Helpers (Zero SyntaxError Guarantee)
 *   4. ⚡ Quota-Shield: IndexedDB Pre-caching on App Startup (0 D1 Read Waste)
 *   5. 👤 Dynamic Role Authenticator (Fixes Cashier Showing as Admin)
 *   6. 🌐 4.5s Network Settle & QUIC Socket Flush (Fixes QUIC_NETWORK_IDLE_TIMEOUT)
 *   7. 🧩 Direct Partials Auto-Mount: Zero Recursion Stack Overflow Guarantee
 *   8. 🔄 Universal Robust Async Refresh Engine for All Tab Views
 *   9. ⌨️ Global Hardware Hotkeys (F2, F4, F8, Esc)
 * ==============================================================================
 */

// ------------------------------------------------------------------------------
// 🕒 1. STRICT MYANMAR STANDARD TIME ENGINE (MMT UTC+06:30)
// ------------------------------------------------------------------------------
function getMMTDateString(dInput) {
  if (dInput && typeof dInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dInput.trim())) {
    return dInput.trim();
  }
  const d = dInput ? new Date(dInput) : new Date();
  const targetMs = isNaN(d.getTime()) ? Date.now() : d.getTime();
  // Myanmar is strictly UTC + 6 hours 30 minutes (23,400,000 ms)
  const mmt = new Date(targetMs + (6.5 * 60 * 60 * 1000));
  return mmt.toISOString().slice(0, 10);
}
window.getMMTDateString = getMMTDateString;

function getMMTFullDateTimeString(dInput) {
  const d = dInput ? new Date(dInput) : new Date();
  const targetMs = isNaN(d.getTime()) ? Date.now() : d.getTime();
  const mmt = new Date(targetMs + (6.5 * 60 * 60 * 1000));
  const y = mmt.getUTCFullYear();
  const m = String(mmt.getUTCMonth() + 1).padStart(2, '0');
  const day = String(mmt.getUTCDate()).padStart(2, '0');
  let hours = mmt.getUTCHours();
  const minutes = String(mmt.getUTCMinutes()).padStart(2, '0');
  const seconds = String(mmt.getUTCSeconds()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, '0');
  return `${y}-${m}-${day} | ${strHours}:${minutes}:${seconds} ${ampm} (MMT)`;
}
window.getMMTFullDateTimeString = getMMTFullDateTimeString;

var _liveClockInterval = null;
function startLiveClock() {
  function tick() {
    const fullTimeStr = getMMTFullDateTimeString();
    const dateOnlyStr = getMMTDateString();
    const dateEl = document.getElementById('pos-today-date');
    if (dateEl) dateEl.textContent = fullTimeStr;
    const sideDateEl = document.getElementById('side-today-date');
    if (sideDateEl) sideDateEl.textContent = `MMT ${dateOnlyStr}`;
  }
  tick();
  if (_liveClockInterval) clearInterval(_liveClockInterval);
  _liveClockInterval = setInterval(tick, 1000);
}

// ------------------------------------------------------------------------------
// 🔒 1.1 ACTIVE SESSION WATCHDOG & AUTO-LOGOUT CONTROLLER (NEW)
// ------------------------------------------------------------------------------
var _sessionWatchdogInterval = null;
var _isLoggingOut = false;

function isTokenExpired() {
  const token = localStorage.getItem('golden_auth_token') || localStorage.getItem('token');
  if (!token) return true;

  // ၁။ Explicit Expiration Timestamp စစ်ဆေးခြင်း
  const expAt = localStorage.getItem('golden_token_expires_at');
  if (expAt) {
    const expTime = Number(expAt);
    if (!isNaN(expTime) && expTime > 0) {
      const expMs = expTime < 10000000000 ? expTime * 1000 : expTime;
      if (Date.now() >= expMs) return true;
    }
  }

  // ၂။ Base64 Decoded JWT Payload စစ်ဆေးခြင်း
  try {
    const parts = token.split('.');
    if (parts.length === 3) {
      const base64Url = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const payload = JSON.parse(atob(base64Url));
      if (payload && payload.exp) {
        if (Date.now() >= payload.exp * 1000) return true;
      }
    }
  } catch (e) {}

  return false;
}

function triggerSessionExpiredLogout() {
  if (_isLoggingOut) return;
  _isLoggingOut = true;

  const savedTheme = localStorage.getItem('canteen_pos_theme');
  localStorage.removeItem('golden_auth_token');
  localStorage.removeItem('golden_user');
  localStorage.removeItem('golden_user_role');
  localStorage.removeItem('golden_user_name');
  localStorage.removeItem('golden_token_expires_at');
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (savedTheme) localStorage.setItem('canteen_pos_theme', savedTheme);

  if (typeof showToast === 'function') {
    showToast("ERROR", "⚠️ Session သက်တမ်း ကုန်ဆုံးသွားပါပြီ။ Login သို့ ပြန်လည်ပို့ဆောင်နေပါသည်...");
  }

  setTimeout(() => {
    window.location.href = '/?session_expired=1';
  }, 700);
}

function checkSessionValidity() {
  const token = localStorage.getItem('golden_auth_token') || localStorage.getItem('token');
  if (!token) {
    triggerSessionExpiredLogout();
    return;
  }
  // အင်တာနက် ချိတ်ဆက်ထားချိန်တွင် token သက်တမ်းကုန်သွားပါက auto-logout ပြုလုပ်သည်
  if (navigator.onLine && isTokenExpired()) {
    triggerSessionExpiredLogout();
  }
}

function initSessionWatchdog() {
  if (_sessionWatchdogInterval) clearInterval(_sessionWatchdogInterval);
  // စက္ကန့် ၃၀ လျှင် တစ်ကြိမ် ပုံမှန်စစ်ဆေးခြင်း
  _sessionWatchdogInterval = setInterval(checkSessionValidity, 30000);

  // Tab ပြန်ပွင့်ချိန် သို့မဟုတ် Window Focus ပြန်ရချိန်တွင် တပြိုင်နက် စစ်ဆေးခြင်း
  window.addEventListener('focus', checkSessionValidity);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkSessionValidity();
  });
}

// ------------------------------------------------------------------------------
// 🛡️ 2. SAFE ROLE NORMALIZATION HELPER
// ------------------------------------------------------------------------------
function getNormalizedRole() {
  const rawRole = String(gSession?.role || localStorage.getItem('golden_user_role') || 'Cashier').trim();
  return rawRole.toLowerCase().replace(/[\s_-]/g, '');
}
window.getNormalizedRole = getNormalizedRole;

// ------------------------------------------------------------------------------
// 🛡️ 3. SCOPE-SAFE SINGLETON HELPERS
// ------------------------------------------------------------------------------
window.esc = window.esc || window.escapeHtml || (s => s ? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '');
window.escAttr = window.escAttr || window.escapeJsAttr || (s => s ? String(s).replace(/'/g, "\\'") : '');

var esc = window.esc;
var escAttr = window.escAttr;

// ------------------------------------------------------------------------------
// 🎯 4. GLOBAL APPLICATION STATE & MEMORY CACHES
// ------------------------------------------------------------------------------
var gSession = null;
var gActiveView = 'pos';
var gItemsCache = [];
var gSuppliersCache = [];
var gStockInventoryData = [];
var gPurchasesData = [];
var gSalesOrdersData = [];
var gWasteData = [];
var gSurplusData = [];
var gCart = [];
var gWasteCart = [];
var gSurplusCart = [];
var gCurrentStudent = null;
var gPaymentMode = 'Student Pocket Money';
var gDailySpendingCap = 10000;
var isSubmitting = false;

// 📄 Pagination Variables (20 Rows Per Page)
var gStockPage = 1, gStockLimit = 20, gStockTotalRows = 0, gStockSearchTimeout = null;
var gPurchasesPage = 1, gPurchasesLimit = 20, gPurchasesTotalRows = 0, gPurSearchTimeout = null;
var gSalesPage = 1, gSalesLimit = 20, gSalesTotalRows = 0, gSalesSearchTimeout = null;
var gWastePage = 1, gWasteLimit = 20, gWasteTotalRows = 0, gWasteSearchTimeout = null;
var gSurplusPage = 1, gSurplusLimit = 20, gSurplusTotalRows = 0, gSurplusSearchTimeout = null;

// Network Stabilization & Mutex Flags
var _onlineDebounceTimer = null;
var _isAutoSyncRunning = false;

// ------------------------------------------------------------------------------
// 🧩 5. RECURSION-FREE COMPONENT PARTIALS LOADER
// ------------------------------------------------------------------------------
async function loadCanteenComponents() {
  async function loadPartial(containerId, url, cacheKey) {
    const container = document.getElementById(containerId);
    if (!container) return;
    if (container.children.length > 0) return; // Already rendered

    const pathsToTry = [url, `/${url}`, `components/${url.split('/').pop()}`, `/components/${url.split('/').pop()}`];
    const uniquePaths = [...new Set(pathsToTry)];

    let html = null;
    for (const p of uniquePaths) {
      try {
        const res = await fetch(p);
        if (res.ok) {
          html = await res.text();
          if (html && html.trim().length > 0) {
            try { localStorage.setItem(cacheKey, html); } catch(e) {}
            break;
          }
        }
      } catch(e) {}
    }

    if (html) {
      container.innerHTML = html;
    } else {
      const cached = localStorage.getItem(cacheKey);
      if (cached) container.innerHTML = cached;
    }
  }

  await Promise.allSettled([
    loadPartial('view-dashboard', 'components/canteen-dashboard.html', 'canteen_tpl_dashboard'),
    loadPartial('view-purchases', 'components/canteen-purchases.html', 'canteen_tpl_purchases'),
    loadPartial('canteen-modals-container', 'components/canteen-modals.html', 'canteen_tpl_modals')
  ]);
}

// ------------------------------------------------------------------------------
// 🚀 6. APPLICATION BOOTSTRAP & LIFECYCLE
// ------------------------------------------------------------------------------
window.addEventListener('DOMContentLoaded', async () => {
  // 🧩 1. Mount Component Partials First (Zero Recursion Guaranteed)
  try {
    await loadCanteenComponents();
  } catch(compErr) {
    console.warn("[CanteenState] Components mount notice:", compErr);
  }

  const userStr = localStorage.getItem('golden_user') || localStorage.getItem('user');
  const token = localStorage.getItem('golden_auth_token') || localStorage.getItem('token');

  // 🔒 Session Validation: If token missing or expired while online, redirect to login
  if (!userStr || !token || (navigator.onLine && isTokenExpired())) {
    triggerSessionExpiredLogout();
    return;
  }

  try {
    gSession = JSON.parse(userStr);
  } catch(e) {
    gSession = { role: localStorage.getItem('golden_user_role') || 'Cashier' };
  }

  const rawRole = String(gSession.role || 'Cashier').trim();
  const role = getNormalizedRole();

  // 👤 DYNAMIC ROLE BADGE
  const roleDisplay = rawRole.toUpperCase().replace(/_/g, ' ');
  const roleBadge = document.getElementById('pos-role-badge');
  if (roleBadge) roleBadge.textContent = roleDisplay;
  const sideRole = document.getElementById('side-user-role');
  if (sideRole) sideRole.textContent = roleDisplay;

  // 🕒 START LIVE TICKING CLOCK & SESSION WATCHDOG
  startLiveClock();
  initSessionWatchdog();

  // INITIALIZE OFFLINE DB & NETWORK MONITOR
  if (typeof initCanteenDB === 'function') await initCanteenDB();
  initNetworkMonitor();

  // 🛡️ ROLE WORKSPACE ISOLATION
  const html = document.documentElement;
  const isCounter = role.includes('counter');
  const isCashier = role === 'canteencashier' || role === 'cashier';
  const isAdmin = role === 'canteenadmin' || role === 'admin' || role === 'owner';

  if (isCounter) {
    html.classList.add('role-counter');
    html.classList.remove('role-cashier', 'role-admin');
    
    const sidebar = document.getElementById('canteen-sidebar');
    if (sidebar) sidebar.style.display = 'none';
    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    if (toggleBtn) toggleBtn.style.display = 'none';
    ['btn-admin-stock', 'btn-header-waste', 'btn-header-surplus', 'btn-header-close-day'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    switchCanteenView('pos');

  } else if (isCashier) {
    html.classList.add('role-cashier');
    html.classList.remove('role-counter', 'role-admin');
    
    // Cashier: Only POS Settings is restricted
    const btnSettings = document.getElementById('btn-side-settings');
    if (btnSettings) btnSettings.style.display = 'none';
    
    // Day close & Evening clearing are accessible
    const btnClose = document.getElementById('btn-header-close-day');
    if (btnClose) btnClose.style.display = '';
    const navClose = document.getElementById('nav-btn-close-day');
    if (navClose) navClose.style.display = '';
    const navSettle = document.getElementById('nav-btn-settle');
    if (navSettle) navSettle.style.display = '';

    switchCanteenView('pos');

  } else {
    html.classList.add('role-admin');
    html.classList.remove('role-counter', 'role-cashier');
    switchCanteenView('dashboard');
  }

  window.addEventListener('keydown', handleGlobalHotkeys);

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    const barcodeInput = document.getElementById('pos-barcode-input');
    const dropdown = document.getElementById('pos-search-dropdown');
    if (dropdown && !dropdown.contains(e.target) && e.target !== barcodeInput) {
      dropdown.classList.add('hidden');
    }

    const wasteInput = document.getElementById('waste-barcode-input');
    const wasteDropdown = document.getElementById('waste-search-dropdown');
    if (wasteDropdown && !wasteDropdown.contains(e.target) && e.target !== wasteInput) {
      wasteDropdown.classList.add('hidden');
    }

    const surplusInput = document.getElementById('surplus-barcode-input');
    const surplusDropdown = document.getElementById('surplus-search-dropdown');
    if (surplusDropdown && !surplusDropdown.contains(e.target) && e.target !== surplusInput) {
      surplusDropdown.classList.add('hidden');
    }
  });

  // ⚡ D1 QUOTA-SHIELD: NON-BLOCKING BACKGROUND PRE-CACHE
  try {
    const tasks = [];
    if (typeof loadItemsCatalog === 'function') tasks.push(loadItemsCatalog(false));
    if (typeof loadSuppliersList === 'function') tasks.push(loadSuppliersList());
    if (typeof loadPosSettings === 'function') tasks.push(loadPosSettings());
    if (typeof updatePendingBadgeCount === 'function') tasks.push(updatePendingBadgeCount());
    if (typeof cacheStudentDirectoryForOffline === 'function') tasks.push(cacheStudentDirectoryForOffline());
    await Promise.allSettled(tasks);
  } catch (err) {
    console.warn("[CanteenState] Background pre-cache notice:", err);
  }

  focusScanner();
});

// ------------------------------------------------------------------------------
// 🎨 7. THEME CONTROLLER
// ------------------------------------------------------------------------------
function toggleCanteenTheme() {
  const html = document.documentElement;
  const isDark = html.classList.contains('dark');
  if (isDark) {
    html.classList.remove('dark');
    html.classList.add('light');
    localStorage.setItem('canteen_pos_theme', 'light');
    showToast("SUCCESS", "Light Mode သို့ ပြောင်းလဲထားပါသည်။");
  } else {
    html.classList.remove('light');
    html.classList.add('dark');
    localStorage.setItem('canteen_pos_theme', 'dark');
    showToast("SUCCESS", "Dark Mode သို့ ပြောင်းလဲထားပါသည်။");
  }
}

// ------------------------------------------------------------------------------
// 🌐 8. REAL-TIME NETWORK MONITOR & 4.5S SETTLED AUTO-SYNC
// ------------------------------------------------------------------------------
function initNetworkMonitor() {
  const updateStatus = () => {
    const el = document.getElementById('pos-network-status');
    const isOnline = navigator.onLine;
    if (el) {
      if (isOnline) {
        el.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ONLINE`;
        el.className = "flex items-center gap-1.5 text-emerald-500 font-bold font-mono";
      } else {
        el.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span> OFFLINE`;
        el.className = "flex items-center gap-1.5 text-rose-500 font-bold font-mono";
      }
    }
  };

  window.addEventListener('online', () => {
    updateStatus();
    checkSessionValidity(); // Check token status when reconnecting online
    if (_onlineDebounceTimer) clearTimeout(_onlineDebounceTimer);

    // 🛡️ Enterprise Network Settle & Socket Flush Window (4500ms):
    _onlineDebounceTimer = setTimeout(async () => {
      if (!navigator.onLine || _isAutoSyncRunning) return;
      _isAutoSyncRunning = true;

      try {
        if (typeof updatePendingBadgeCount === 'function') {
          await updatePendingBadgeCount();
        }

        const pendingOrders = (typeof dbGetPendingOrders === 'function') 
          ? await dbGetPendingOrders() 
          : [];

        if (pendingOrders && pendingOrders.length > 0) {
          // 🛡️ Flush dead QUIC socket with lightweight probe
          try {
            const probeBase = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
            await fetch(`${probeBase}/?_probe=${Date.now()}`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store' });
          } catch(probeErr) {}

          if (typeof autoSyncPendingOrders === 'function') {
            await autoSyncPendingOrders();
          }
        }
      } catch (syncErr) {
        console.warn("[NetworkMonitor] Auto-sync settle notice:", syncErr);
      } finally {
        _isAutoSyncRunning = false;
      }
    }, 4500);
  });

  window.addEventListener('offline', () => {
    if (_onlineDebounceTimer) {
      clearTimeout(_onlineDebounceTimer);
      _onlineDebounceTimer = null;
    }
    _isAutoSyncRunning = false;
    updateStatus();
    showToast("ERROR", "အင်တာနက်လိုင်း ပြတ်တောက်သွားပါသည်။ Offline POS Mode သို့ ပြောင်းလဲထားပါသည်။");
  });

  updateStatus();
}

async function cacheStudentDirectoryForOffline() {
  if (!navigator.onLine) return;
  try {
    const res = await callApi('getPosStudentsSnapshot', { _t: Date.now() }, 'POST');
    if (res && res.success && Array.isArray(res.data) && typeof dbSaveStudents === 'function') {
      await dbSaveStudents(res.data);
    }
  } catch (e) {
    console.warn("[OfflineCache] Preload notice:", e.message);
  }
}

async function updatePendingBadgeCount() {
  const badge = document.getElementById('pending-count');
  if (!badge || typeof dbGetPendingOrders !== 'function') return;
  const pendingOrders = await dbGetPendingOrders();
  badge.textContent = pendingOrders.length;

  const btn = document.getElementById('btn-pending-sync');
  if (btn) {
    if (pendingOrders.length > 0) {
      btn.className = "px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-500 text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shadow animate-pulse";
    } else {
      btn.className = "px-3 py-1.5 rounded-lg bg-slate-200/80 dark:bg-slate-800 border border-[var(--border-color)] text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shadow-sm";
    }
  }
}

// ------------------------------------------------------------------------------
// 🧭 9. WORKSPACE VIEW SWITCHER
// ------------------------------------------------------------------------------
function switchCanteenView(viewName) {
  gActiveView = viewName;
  const views = ['dashboard', 'pos', 'sales', 'stock', 'purchases', 'waste', 'surplus'];

  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    const navBtn = document.getElementById(`nav-btn-${v}`);
    if (el) el.classList.toggle('hidden', v !== viewName);
    
    if (navBtn) {
      if (v === viewName) {
        navBtn.className = "w-full px-3 py-2 rounded-xl transition flex items-center gap-3 bg-emerald-600 text-white shadow-lg shadow-emerald-900/30";
      } else {
        navBtn.className = "w-full px-3 py-2 rounded-xl transition flex items-center gap-3 text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800/50";
      }
    }
  });

  const titleEl = document.getElementById('canteen-view-title');
  if (titleEl) {
    const titles = {
      dashboard: 'CANTEEN EXECUTIVE DASHBOARD',
      pos: 'CANTEEN POS REGISTER TERMINAL',
      sales: 'CANTEEN SALES ORDERS HISTORY',
      stock: 'REAL-TIME STOCK INVENTORY AUDITOR',
      purchases: 'PURCHASES & SUPPLIERS AUDIT HISTORY',
      waste: 'CANTEEN WASTAGE & LOSS AUDITOR',
      surplus: 'CANTEEN STOCK SURPLUS AUDITOR'
    };
    titleEl.textContent = titles[viewName] || 'CANTEEN POS SYSTEM';
  }

  if (viewName === 'dashboard' && typeof loadCanteenDashboard === 'function') loadCanteenDashboard();
  else if (viewName === 'sales' && typeof loadSalesOrdersHistory === 'function') loadSalesOrdersHistory(1);
  else if (viewName === 'stock' && typeof loadStockInventory === 'function') loadStockInventory(1);
  else if (viewName === 'purchases' && typeof loadPurchasesHistory === 'function') loadPurchasesHistory(1);
  else if (viewName === 'waste' && typeof loadWasteHistory === 'function') loadWasteHistory(1);
  else if (viewName === 'surplus' && typeof loadSurplusHistory === 'function') loadSurplusHistory(1);
  else if (viewName === 'pos') focusScanner();
}

// ------------------------------------------------------------------------------
// 🔄 10. UNIVERSAL ROBUST ASYNC REFRESH ENGINE
// ------------------------------------------------------------------------------
async function refreshActiveCanteenView() {
  const refreshBtn = document.getElementById('btn-global-refresh');
  if (refreshBtn) refreshBtn.classList.add('animate-spin');

  try {
    if (gActiveView === 'dashboard' && typeof loadCanteenDashboard === 'function') {
      await loadCanteenDashboard();
    } else if (gActiveView === 'sales' && typeof loadSalesOrdersHistory === 'function') {
      await loadSalesOrdersHistory(gSalesPage || 1);
    } else if (gActiveView === 'stock' && typeof loadStockInventory === 'function') {
      await loadStockInventory(gStockPage || 1);
    } else if (gActiveView === 'purchases' && typeof loadPurchasesHistory === 'function') {
      await loadPurchasesHistory(gPurchasesPage || 1);
    } else if (gActiveView === 'waste' && typeof loadWasteHistory === 'function') {
      await loadWasteHistory(gWastePage || 1);
    } else if (gActiveView === 'surplus' && typeof loadSurplusHistory === 'function') {
      await loadSurplusHistory(gSurplusPage || 1);
    } else if (gActiveView === 'pos') {
      if (typeof loadItemsCatalog === 'function') await loadItemsCatalog(true);
      await cacheStudentDirectoryForOffline();
    }

    if (gActiveView !== 'pos') {
      showToast("SUCCESS", "အချက်အလက်များ အသစ်ရယူပြီးပါပြီ။");
    }
  } catch (err) {
    showToast("ERROR", "Refresh အမှား: " + err.message);
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('animate-spin');
  }
}

// ------------------------------------------------------------------------------
// 🛠️ 11. UI HELPERS & KEYBOARD HOTKEYS
// ------------------------------------------------------------------------------
function toggleCanteenSidebar() {
  document.getElementById('canteen-sidebar')?.classList.toggle('hidden');
}

function showToast(type, msg) {
  const box = document.getElementById('pos-toast-box');
  if (!box) return;
  const isErr = (type === 'ERROR');
  box.innerHTML = `
    <div class="pointer-events-auto p-4 rounded-2xl shadow-2xl border-2 flex items-center gap-3 animate-in zoom-in-95 duration-150 ${
      isErr ? 'bg-rose-950 border-rose-500 text-white shadow-[0_0_40px_rgba(244,63,94,0.4)]' : 'bg-emerald-950 border-emerald-500 text-white shadow-[0_0_40px_rgba(16,185,129,0.4)]'
    }">
      <i class="fa-solid ${isErr ? 'fa-triangle-exclamation text-rose-400 text-xl' : 'fa-circle-check text-emerald-400 text-xl'}"></i>
      <p class="text-xs font-bold leading-snug flex-1">${msg}</p>
    </div>
  `;
  setTimeout(() => { if (box) box.innerHTML = ''; }, 3200);
}

function focusScanner() {
  const input = document.getElementById('pos-barcode-input');
  if (input && gActiveView === 'pos') input.focus();
}

function handleGlobalHotkeys(e) {
  if (gActiveView !== 'pos') return;
  if (e.key === 'F2') {
    e.preventDefault();
    if (typeof setPaymentMode === 'function') setPaymentMode('Student Pocket Money');
    document.getElementById('pos-student-input')?.focus();
  } else if (e.key === 'F4') {
    e.preventDefault();
    if (typeof setPaymentMode === 'function') setPaymentMode('Cash');
    focusScanner();
  } else if (e.key === 'F8') {
    e.preventDefault();
    if (typeof executeCheckout === 'function') executeCheckout();
  } else if (e.key === 'Escape') {
    if (typeof clearCart === 'function') clearCart(false);
    focusScanner();
  }
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

function logoutPos() {
  // Clear auth info safely while preserving user theme preference
  const savedTheme = localStorage.getItem('canteen_pos_theme');
  localStorage.removeItem('golden_auth_token');
  localStorage.removeItem('golden_user');
  localStorage.removeItem('golden_user_role');
  localStorage.removeItem('golden_user_name');
  localStorage.removeItem('golden_token_expires_at');
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  if (savedTheme) localStorage.setItem('canteen_pos_theme', savedTheme);
  window.location.href = '/';
}

// ------------------------------------------------------------------------------
// 🌐 12. WINDOW GLOBAL EXPORTS
// ------------------------------------------------------------------------------
window.getMMTDateString = getMMTDateString;
window.getMMTFullDateTimeString = getMMTFullDateTimeString;
window.getNormalizedRole = getNormalizedRole;
window.startLiveClock = startLiveClock;
window.startMMTClock = startLiveClock;
window.loadCanteenComponents = loadCanteenComponents;
window.switchCanteenView = switchCanteenView;
window.refreshActiveCanteenView = refreshActiveCanteenView;
window.toggleCanteenSidebar = toggleCanteenSidebar;
window.toggleCanteenTheme = toggleCanteenTheme;
window.showToast = showToast;
window.focusScanner = focusScanner;
window.closeModal = closeModal;
window.logoutPos = logoutPos;
window.updatePendingBadgeCount = updatePendingBadgeCount;
window.cacheStudentDirectoryForOffline = cacheStudentDirectoryForOffline;
window.isTokenExpired = isTokenExpired;
window.checkSessionValidity = checkSessionValidity;
window.triggerSessionExpiredLogout = triggerSessionExpiredLogout;
window.initSessionWatchdog = initSessionWatchdog;