/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN GLOBAL STATE & NETWORK CONTROLLER
 * File: js/canteen/canteen-state.js
 * ==============================================================================
 */

// 🎯 Global Application Variables (Shared across modules)
var gSession = null;
var gActiveView = 'pos';
var gItemsCache = [];
var gSuppliersCache = [];
var gStockInventoryData = [];
var gPurchasesData = [];
var gSalesOrdersData = [];
var gWasteData = [];
var gCart = [];
var gWasteCart = [];
var gCurrentStudent = null;
var gPaymentMode = 'Student Pocket Money';
var gDailySpendingCap = 10000;
var isSubmitting = false;

// Pagination Variables (20 Rows Per Page)
var gStockPage = 1, gStockLimit = 20, gStockTotalRows = 0, gStockSearchTimeout = null;
var gPurchasesPage = 1, gPurchasesLimit = 20, gPurchasesTotalRows = 0, gPurSearchTimeout = null;
var gSalesPage = 1, gSalesLimit = 20, gSalesTotalRows = 0, gSalesSearchTimeout = null;
var gWastePage = 1, gWasteLimit = 20, gWasteTotalRows = 0, gWasteSearchTimeout = null;

// Safe Escape Helpers
const esc = window.escapeHtml || (s => s ? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '');
const escAttr = window.escapeJsAttr || (s => s ? String(s).replace(/'/g, "\\'") : '');

// 🎯 DOMContentLoaded Bootstrap
window.addEventListener('DOMContentLoaded', async () => {
  const userStr = localStorage.getItem('golden_user') || localStorage.getItem('user');
  const token = localStorage.getItem('golden_auth_token') || localStorage.getItem('token');

  if (!userStr || !token) {
    window.location.href = '/';
    return;
  }

  gSession = JSON.parse(userStr);
  const role = (gSession.role || 'Cashier').trim();

  // Role UI Badges
  const roleBadge = document.getElementById('pos-role-badge');
  if (roleBadge) roleBadge.textContent = role.toUpperCase();
  const sideRole = document.getElementById('side-user-role');
  if (sideRole) sideRole.textContent = role.toUpperCase();

  const todayStr = new Date().toISOString().slice(0, 10);
  const dateEl = document.getElementById('pos-today-date');
  if (dateEl) dateEl.textContent = todayStr;
  const sideDateEl = document.getElementById('side-today-date');
  if (sideDateEl) sideDateEl.textContent = todayStr;

  // Initialize Offline IndexedDB
  await initCanteenDB();

  // Network Online/Offline Monitoring
  initNetworkMonitor();

  // Counter Role Isolation
  if (role.startsWith('counter')) {
    document.getElementById('canteen-sidebar')?.classList.add('hidden');
    document.getElementById('btn-toggle-sidebar')?.classList.add('hidden');
    document.getElementById('btn-admin-stock')?.classList.add('hidden');
    document.getElementById('btn-header-waste')?.classList.add('hidden');
    document.getElementById('btn-header-close-day')?.classList.add('hidden');
    switchCanteenView('pos');
  } else if (role === 'canteen_cashier') {
    document.getElementById('btn-side-settings')?.classList.add('hidden');
    switchCanteenView('pos');
  } else {
    switchCanteenView('dashboard');
  }

  // Keyboard Hotkeys
  window.addEventListener('keydown', handleGlobalHotkeys);

  // Close Dropdowns on outside click
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
  });

  // Background Cache Load & Pending Badge Check
  await Promise.all([
    loadItemsCatalog(false),
    loadSuppliersList(),
    loadPosSettings(),
    updatePendingBadgeCount(),
    cacheStudentDirectoryForOffline()
  ]);

  focusScanner();
});

// 🎯 Network Online / Offline Engine
function initNetworkMonitor() {
  const updateStatus = () => {
    const el = document.getElementById('pos-network-status');
    const isOnline = navigator.onLine;
    if (el) {
      if (isOnline) {
        el.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> ONLINE`;
        el.className = "flex items-center gap-1.5 text-emerald-400 font-bold font-mono";
      } else {
        el.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span> OFFLINE`;
        el.className = "flex items-center gap-1.5 text-rose-400 font-bold font-mono";
      }
    }
  };

  window.addEventListener('online', async () => {
    updateStatus();
    showToast("SUCCESS", "အင်တာနက်လိုင်း ပြန်လည်ချိတ်ဆက်မိပါပြီ။ အော့ဖ်လိုင်းအရောင်းများ စတင် Sync ပြုလုပ်ပါမည်။");
    if (typeof autoSyncPendingOrders === 'function') {
      await autoSyncPendingOrders();
    }
  });

  window.addEventListener('offline', () => {
    updateStatus();
    showToast("ERROR", "အင်တာနက်လိုင်း ပြတ်တောက်သွားပါသည်။ Offline POS Mode သို့ အလိုအလျောက် ပြောင်းလဲထားပါသည်။");
  });

  updateStatus();
}

// 🎯 Pre-cache Student directory for offline wallet scanning
async function cacheStudentDirectoryForOffline() {
  if (!navigator.onLine) return;
  try {
    const currentFy = (typeof window.getCurrentAcademicYear === 'function') ? window.getCurrentAcademicYear() : '2026-2027';
    const res = await callApi('getStudentMoneySummary', { fy: currentFy }, 'GET');
    if (res && res.success && res.data) {
      await dbSaveStudents(res.data);
    }
  } catch (e) {
    console.warn("[OfflineCache] Student directory preload warning:", e.message);
  }
}

// 🎯 Update Pending Counter Badge in Header
async function updatePendingBadgeCount() {
  const badge = document.getElementById('pending-count');
  if (!badge) return;
  const pendingOrders = await dbGetPendingOrders();
  badge.textContent = pendingOrders.length;

  const btn = document.getElementById('btn-pending-sync');
  if (btn) {
    if (pendingOrders.length > 0) {
      btn.className = "px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shadow animate-pulse";
    } else {
      btn.className = "px-3 py-1.5 rounded-lg bg-slate-850 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1.5 transition active:scale-95 shadow";
    }
  }
}

// 🎯 Screen Viewport Switcher
function switchCanteenView(viewName) {
  gActiveView = viewName;
  const views = ['dashboard', 'pos', 'sales', 'stock', 'purchases', 'waste'];

  views.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    const navBtn = document.getElementById(`nav-btn-${v}`);
    if (el) el.classList.toggle('hidden', v !== viewName);
    
    if (navBtn) {
      if (v === viewName) {
        navBtn.className = "w-full px-3 py-2 rounded-xl transition flex items-center gap-3 bg-emerald-600 text-white shadow-lg shadow-emerald-900/30";
      } else {
        navBtn.className = "w-full px-3 py-2 rounded-xl transition flex items-center gap-3 text-slate-400 hover:text-white hover:bg-slate-800/50";
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
      waste: 'CANTEEN WASTAGE & LOSS AUDITOR'
    };
    titleEl.textContent = titles[viewName] || 'CANTEEN POS SYSTEM';
  }

  if (viewName === 'dashboard' && typeof loadCanteenDashboard === 'function') loadCanteenDashboard();
  else if (viewName === 'sales' && typeof loadSalesOrdersHistory === 'function') loadSalesOrdersHistory(1);
  else if (viewName === 'stock' && typeof loadStockInventory === 'function') loadStockInventory(1);
  else if (viewName === 'purchases' && typeof loadPurchasesHistory === 'function') loadPurchasesHistory(1);
  else if (viewName === 'waste' && typeof loadWasteHistory === 'function') loadWasteHistory(1);
  else if (viewName === 'pos') focusScanner();
}

function refreshActiveCanteenView() {
  const refreshBtn = document.getElementById('btn-global-refresh');
  if (refreshBtn) refreshBtn.classList.add('animate-spin');

  try {
    if (gActiveView === 'dashboard') loadCanteenDashboard();
    else if (gActiveView === 'sales') loadSalesOrdersHistory(gSalesPage);
    else if (gActiveView === 'stock') loadStockInventory(gStockPage);
    else if (gActiveView === 'purchases') loadPurchasesHistory(gPurchasesPage);
    else if (gActiveView === 'waste') loadWasteHistory(gWastePage);
    else if (gActiveView === 'pos') loadItemsCatalog(true);
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('animate-spin');
  }
}

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
    setPaymentMode('Student Pocket Money');
    document.getElementById('pos-student-input')?.focus();
  } else if (e.key === 'F4') {
    e.preventDefault();
    setPaymentMode('Cash');
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
  localStorage.clear();
  window.location.href = '/';
}

// Global Exports
window.switchCanteenView = switchCanteenView;
window.refreshActiveCanteenView = refreshActiveCanteenView;
window.toggleCanteenSidebar = toggleCanteenSidebar;
window.showToast = showToast;
window.focusScanner = focusScanner;
window.closeModal = closeModal;
window.logoutPos = logoutPos;
window.updatePendingBadgeCount = updatePendingBadgeCount;