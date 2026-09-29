/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CANTEEN POS & MANAGEMENT CLIENT CONTROLLER
 * File: js/canteen-pos.js (Location: cashbook-frontend/js/canteen-pos.js)
 * 
 * 💡 Architecture & Blueprint V6:
 *   1. 🏛️ MULTI-VIEW ROUTER: Dashboard, POS Register, Sales, Stock, Purchases & Waste
 *   2. 📊 LIVE DASHBOARD: 1-Batch Atomic Metrics (Sales, Stock Capital & Spoilage Loss)
 *   3. 🧾 PAGINATED SALES ORDERS: 20-Row Server-Side Pagination & Thermal Slip Reprint
 *   4. 📦 REAL-TIME STOCK AUDITOR: 20-Row Pagination, Full Barcode & CSV Export
 *   5. 🛒 PURCHASES AUDIT: 20-Row Pagination with Auto Stock-Rollback on Edit/Delete
 *   6. ⚠️ WASTAGE & LOSS LEDGER: Multi-item Cost-basis Loss & In-Memory Fast Cart
 *   7. ⚙️ DYNAMIC POS SETTINGS: Cached Daily Allowance Cap (Zero Extra D1 Reads)
 *   8. 🛡️ GRANULAR RBAC: Cashier can Purchase & Record Waste, but CANNOT Edit Stock
 * ==============================================================================
 */

// 🎯 Application Global States
let gSession = null;
let gActiveView = 'pos';     // 'dashboard', 'pos', 'sales', 'stock', 'purchases', 'waste'
let gItemsCache = [];       // O(1) Local Product Catalog Cache
let gSuppliersCache = [];   // Suppliers Master Cache
let gStockInventoryData = []; // Cached Stock List for CSV Export
let gPurchasesData = [];    // Cached Purchases for Edit/Delete
let gSalesOrdersData = [];  // Cached Sales Orders for Reprint Slip
let gWasteData = [];        // Cached Waste Records
let gCart = [];             // Dynamic In-Memory Cart State Array
let gWasteCart = [];        // 🎯 In-Memory Wastage Cart
let gCurrentStudent = null; // Scanned Student Object
let gPaymentMode = 'Student Pocket Money'; // 'Student Pocket Money' or 'Cash'
let gDailySpendingCap = 10000; // 🎯 Cached Daily Cap (Zero Repetitive D1 Reads)
let isSubmitting = false;

// 🎯 Pagination & Filter States (20 Rows Per Page)
let gStockPage = 1;
const gStockLimit = 20;
let gStockTotalRows = 0;
let gStockSearchTimeout = null;

let gPurchasesPage = 1;
const gPurchasesLimit = 20;
let gPurchasesTotalRows = 0;
let gPurSearchTimeout = null;

let gSalesPage = 1;
const gSalesLimit = 20;
let gSalesTotalRows = 0;
let gSalesSearchTimeout = null;

let gWastePage = 1;
const gWasteLimit = 20;
let gWasteTotalRows = 0;
let gWasteSearchTimeout = null;

// Safe Escape Helper
const esc = window.escapeHtml || (s => s ? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '');
const escAttr = window.escapeJsAttr || (s => s ? String(s).replace(/'/g, "\\'") : '');

// ==============================================================================
// 💡 1. CORE INITIALIZATION & ROLE-BASED WORKSPACE ROUTER
// ==============================================================================
window.addEventListener('DOMContentLoaded', async () => {
  const userStr = localStorage.getItem('golden_user') || localStorage.getItem('user');
  const token = localStorage.getItem('golden_auth_token') || localStorage.getItem('token');

  if (!userStr || !token) {
    window.location.href = '/';
    return;
  }

  gSession = JSON.parse(userStr);
  const role = (gSession.role || 'Cashier').trim();

  // Role Display
  const roleBadge = document.getElementById('pos-role-badge');
  if (roleBadge) roleBadge.textContent = role.toUpperCase();
  const sideRole = document.getElementById('side-user-role');
  if (sideRole) sideRole.textContent = role.toUpperCase();

  const todayStr = new Date().toISOString().slice(0, 10);
  const dateEl = document.getElementById('pos-today-date');
  if (dateEl) dateEl.textContent = todayStr;
  const sideDateEl = document.getElementById('side-today-date');
  if (sideDateEl) sideDateEl.textContent = todayStr;

  // 🎯 COUNTER ROLE ISOLATION: Counter 1, 2, 3 များသည် Fullscreen POS သာ သုံးရမည် (Sidebar ပိတ်ထားမည်)
  if (role.startsWith('counter')) {
    const sidebar = document.getElementById('canteen-sidebar');
    if (sidebar) sidebar.classList.add('hidden');
    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    if (toggleBtn) toggleBtn.classList.add('hidden');
    const btnAdmin = document.getElementById('btn-admin-stock');
    if (btnAdmin) btnAdmin.classList.add('hidden');
    const btnHeaderWaste = document.getElementById('btn-header-waste');
    if (btnHeaderWaste) btnHeaderWaste.classList.add('hidden');
    switchCanteenView('pos');
  } else if (role === 'canteen_cashier') {
    // 🎯 Cashier သည် အဝယ်စာရင်းနှင့် အပျက်စာရင်း သွင်းခွင့်ရှိသည် (Settings ပြင်ခွင့် မရှိပါ)
    const btnSettings = document.getElementById('btn-side-settings');
    if (btnSettings) btnSettings.classList.add('hidden');
    switchCanteenView('pos');
  } else {
    // Canteen Admin / Owner: ပင်မ Dashboard သို့ ဦးစွာ ပို့ဆောင်မည်
    switchCanteenView('dashboard');
  }

  // Bind Keyboard Hotkeys
  window.addEventListener('keydown', handleGlobalHotkeys);

  // 🎯 Dropdowns အပြင်ဘက်ကို ကလစ်နှိပ်ပါက အလိုအလျောက် ပိတ်မည့် Global Listener
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

  // Hook Edit Purchase Smart Price Calculator Listeners
  const editCostInput = document.getElementById('edit-pur-cost');
  const editMarkupInput = document.getElementById('edit-pur-markup');
  if (editCostInput) editCostInput.addEventListener('input', triggerEditPurSmartPriceCalc);
  if (editMarkupInput) editMarkupInput.addEventListener('input', triggerEditPurSmartPriceCalc);

  // Background Data Pre-fetch (Zero-Cache POST)
  await Promise.all([
    loadItemsCatalog(false),
    loadSuppliersList(),
    loadPosSettings()
  ]);
  
  focusScanner();
});

// 🎯 View Switcher Router (6 Core Views)
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

  // Load Fresh Data by View
  if (viewName === 'dashboard') loadCanteenDashboard();
  else if (viewName === 'sales') loadSalesOrdersHistory(1);
  else if (viewName === 'stock') loadStockInventory(1);
  else if (viewName === 'purchases') loadPurchasesHistory(1);
  else if (viewName === 'waste') loadWasteHistory(1);
  else if (viewName === 'pos') focusScanner();
}

// 🎯 Persistent Header Refresh Engine
async function refreshActiveCanteenView() {
  const refreshBtn = document.getElementById('btn-global-refresh');
  if (refreshBtn) refreshBtn.classList.add('animate-spin');

  try {
    if (gActiveView === 'dashboard') await loadCanteenDashboard();
    else if (gActiveView === 'sales') await loadSalesOrdersHistory(gSalesPage);
    else if (gActiveView === 'stock') await loadStockInventory(gStockPage);
    else if (gActiveView === 'purchases') await loadPurchasesHistory(gPurchasesPage);
    else if (gActiveView === 'waste') await loadWasteHistory(gWastePage);
    else if (gActiveView === 'pos') await loadItemsCatalog(true);

    showToast("SUCCESS", "အချက်အလက်များ အသစ်ရယူပြီးပါပြီ။");
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('animate-spin');
  }
}

function toggleCanteenSidebar() {
  const sidebar = document.getElementById('canteen-sidebar');
  if (sidebar) sidebar.classList.toggle('hidden');
}

// Center Toast Alert Engine
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

// 🎯 Global Hotkeys (F2: Wallet, F4: Cash, Esc: Clear)
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
  } else if (e.key === 'Escape') {
    clearCart(false);
    focusScanner();
  }
}

// ==============================================================================
// 💡 2. EXECUTIVE DASHBOARD CONTROLLER (VIEW 1 - LIVE & QUOTA SAFE)
// ==============================================================================
async function loadCanteenDashboard() {
  try {
    const res = await callApi('getCanteenDashboardMetrics', { _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      const { today, allTime, totalStockCapital, lowStockCount, todayLossCost, allTimeLossCost, date } = res.data;

      const dateLabel = document.getElementById('dash-date-label');
      if (dateLabel) dateLabel.textContent = date || new Date().toISOString().slice(0, 10);
      
      const settleBadge = document.getElementById('dash-settle-badge');
      if (settleBadge) {
        if (today.isSettled) {
          settleBadge.className = "px-3 py-1 rounded-xl text-xs font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 font-mono";
          settleBadge.textContent = `SETTLED (${today.settlement?.settlementNo || 'DONE'})`;
        } else {
          settleBadge.className = "px-3 py-1 rounded-xl text-xs font-black bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono animate-pulse";
          settleBadge.textContent = "PENDING CLEARING (ငွေရှင်းရန်ကျန်)";
        }
      }

      document.getElementById('dash-today-sales').textContent = `${Number(today.totalSales || 0).toLocaleString()} MMK`;
      document.getElementById('dash-today-orders').textContent = `${today.totalOrders || 0} Invoices Today`;
      document.getElementById('dash-today-wallet').textContent = `${Number(today.pocketMoneyShare || 0).toLocaleString()} MMK`;
      document.getElementById('dash-today-cash').textContent = `${Number(today.cashSalesShare || 0).toLocaleString()} MMK`;
      document.getElementById('dash-today-profit').textContent = `+${Number(today.totalProfit || 0).toLocaleString()} MMK`;
      
      // ⚠️ Wastage Loss Metrics
      const todayLossEl = document.getElementById('dash-today-loss');
      if (todayLossEl) todayLossEl.textContent = `-${Number(todayLossCost || 0).toLocaleString()} MMK`;

      document.getElementById('dash-all-sales').textContent = `${Number(allTime.totalSales || 0).toLocaleString()} MMK`;
      document.getElementById('dash-all-wallet').textContent = `${Number(allTime.pocketMoneyShare || 0).toLocaleString()} MMK`;
      document.getElementById('dash-all-cash').textContent = `${Number(allTime.cashSalesShare || 0).toLocaleString()} MMK`;
      document.getElementById('dash-all-orders').textContent = `${Number(allTime.totalOrders || 0).toLocaleString()} Invoices`;

      const capitalEl = document.getElementById('dash-stock-capital');
      if (capitalEl) {
        const capitalVal = totalStockCapital !== undefined ? totalStockCapital : (allTime.totalStockCapital || 0);
        capitalEl.textContent = `${Number(capitalVal).toLocaleString()} MMK`;
      }

      const allLossEl = document.getElementById('dash-all-loss');
      if (allLossEl) allLossEl.textContent = `${Number(allTimeLossCost || 0).toLocaleString()} MMK`;

      const lowStockAlert = document.getElementById('dash-low-stock-alert');
      if (lowStockAlert) {
        if (lowStockCount > 0) {
          lowStockAlert.textContent = `⚠️ Low Stock: ${lowStockCount} မျိုး`;
          lowStockAlert.classList.remove('hidden');
        } else {
          lowStockAlert.classList.add('hidden');
        }
      }
    }
  } catch (err) {
    console.error("Dashboard Load Error:", err);
  }
}

// ==============================================================================
// 💡 3. SALES ORDERS HISTORY CONTROLLER (VIEW 3 - 20 ROWS PER PAGE)
// ==============================================================================
function onSearchSalesDebounced() {
  clearTimeout(gSalesSearchTimeout);
  gSalesSearchTimeout = setTimeout(() => { loadSalesOrdersHistory(1); }, 250);
}

function clearSalesFilter() {
  document.getElementById('sales-search').value = '';
  document.getElementById('sales-method-filter').value = '';
  document.getElementById('sales-date-from').value = '';
  document.getElementById('sales-date-to').value = '';
  loadSalesOrdersHistory(1);
}

function changeSalesPage(delta) {
  loadSalesOrdersHistory(gSalesPage + delta);
}

async function loadSalesOrdersHistory(page = 1) {
  gSalesPage = Math.max(1, page);
  const searchVal = document.getElementById('sales-search')?.value.trim() || '';
  const paymentMethod = document.getElementById('sales-method-filter')?.value || '';
  const dateFrom = document.getElementById('sales-date-from')?.value || '';
  const dateTo = document.getElementById('sales-date-to')?.value || '';

  try {
    const res = await callApi('getPosSalesOrdersHistory', {
      searchVal, paymentMethod, dateFrom, dateTo,
      page: gSalesPage, limit: gSalesLimit, _t: Date.now()
    }, 'POST');

    if (res && res.success) {
      const records = res.data || [];
      gSalesOrdersData = records;
      gSalesTotalRows = res.totalRows || 0;

      const totalSalesBadge = document.getElementById('sales-total-amount-badge');
      if (totalSalesBadge) totalSalesBadge.textContent = `${Number(res.totalSalesAmount || 0).toLocaleString()} MMK`;

      const tbody = document.getElementById('sales-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-500 font-bold">အရောင်းမှတ်တမ်း မရှိပါ။</td></tr>`;
      } else {
        records.forEach((r, idx) => {
          const displayNo = gSalesTotalRows - ((gSalesPage - 1) * gSalesLimit + idx);
          const isWallet = (r.paymentMethod === 'Student Pocket Money');

          tbody.innerHTML += `
            <tr class="hover:bg-slate-800/40 text-xs border-b border-slate-800/40">
              <td class="text-center font-mono py-2.5 px-3 text-slate-500">${displayNo}</td>
              <td class="font-mono text-slate-300 py-2.5 px-3">${esc(r.date)}</td>
              <td class="font-mono font-bold text-sky-400 py-2.5 px-3">${esc(r.invoiceNo)}</td>
              <td class="py-2.5 px-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isWallet ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}">
                  ${isWallet ? 'Wallet' : 'Cash'}
                </span>
              </td>
              <td class="font-mono py-2.5 px-3 text-slate-300">${r.studentId ? `ID ${r.studentId}` : '-'}</td>
              <td class="py-2.5 px-3 text-slate-200">${esc(r.itemsSummary)}</td>
              <td class="text-right font-mono font-bold text-white py-2.5 px-3">${Number(r.totalAmount).toLocaleString()} MMK</td>
              <td class="text-right font-mono font-bold text-teal-400 py-2.5 px-3">+${Number(r.netProfit).toLocaleString()}</td>
              <td class="text-center py-2.5 px-3">
                <button onclick="reprintSalesSlip('${escAttr(r.invoiceNo)}')" class="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition" title="Print Receipt">
                  <i class="fa-solid fa-print"></i>
                </button>
              </td>
            </tr>
          `;
        });
      }

      const start = (gSalesPage - 1) * gSalesLimit + 1;
      const end = Math.min(start + gSalesLimit - 1, gSalesTotalRows);
      const info = document.getElementById('sales-pagination-info');
      if (info) info.textContent = gSalesTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gSalesTotalRows} entries`;

      const prevBtn = document.getElementById('sales-btn-prev');
      const nextBtn = document.getElementById('sales-btn-next');
      if (prevBtn) prevBtn.disabled = (gSalesPage <= 1);
      if (nextBtn) nextBtn.disabled = (end >= gSalesTotalRows);
    }
  } catch (err) {
    console.error("Sales History Load Error:", err);
  }
}

function reprintSalesSlip(invoiceNo) {
  const order = gSalesOrdersData.find(o => o.invoiceNo === invoiceNo);
  if (!order) return showToast("ERROR", "ပြေစာ အချက်အလက် မတွေ့ပါ။");

  const stuObj = order.studentId ? { studentId: order.studentId, name: `Student ID ${order.studentId}` } : null;
  printPosReceipt(order.invoiceNo, order.totalAmount, order.itemsSummary, order.paymentMethod, stuObj);
}

// ==============================================================================
// 💡 4. REAL-TIME STOCK INVENTORY AUDITOR (VIEW 4 - 20 ROWS PER PAGE)
// ==============================================================================
function onSearchStockDebounced() {
  clearTimeout(gStockSearchTimeout);
  gStockSearchTimeout = setTimeout(() => { loadStockInventory(1); }, 250);
}

function changeStockPage(delta) {
  loadStockInventory(gStockPage + delta);
}

async function loadStockInventory(page = 1) {
  gStockPage = Math.max(1, page);
  const searchVal = document.getElementById('stock-search')?.value.trim() || '';
  const category = document.getElementById('stock-category-filter')?.value || '';
  const stockStatus = document.getElementById('stock-status-filter')?.value || 'all';

  try {
    const res = await callApi('getPosStockInventory', {
      searchVal, category, stockStatus,
      page: gStockPage, limit: gStockLimit, _t: Date.now()
    }, 'POST');

    if (res && res.success) {
      const items = res.data || [];
      const summary = res.summary || {};
      gStockInventoryData = items;
      gStockTotalRows = res.totalRows || 0;

      document.getElementById('stock-total-items').textContent = `${summary.totalItems || 0} မျိုး`;
      document.getElementById('stock-total-qty').textContent = `${Number(summary.totalStockQty || 0).toLocaleString()} ခု`;
      document.getElementById('stock-total-val').textContent = `${Number(summary.totalStockValue || 0).toLocaleString()} MMK`;
      document.getElementById('stock-alert-count').textContent = `${(summary.outOfStockCount || 0) + (summary.lowStockCount || 0)} မျိုး`;

      const tbody = document.getElementById('stock-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ပစ္စည်း မရှိပါ။</td></tr>`;
      } else {
        const canManageStock = (gSession?.role === 'canteen_admin' || gSession?.role === 'Owner' || gSession?.role === 'Admin');

        items.forEach((item, idx) => {
          const displayNo = gStockTotalRows - ((gStockPage - 1) * gStockLimit + idx);

          let badgeHtml = '';
          if (item.currentStock <= 0) {
            badgeHtml = '<span class="px-2 py-0.5 rounded text-[9px] font-black bg-rose-500/20 text-rose-400 border border-rose-500/30">OUT OF STOCK</span>';
          } else if (item.currentStock <= 10) {
            badgeHtml = '<span class="px-2 py-0.5 rounded text-[9px] font-black bg-amber-500/20 text-amber-400 border border-amber-500/30">LOW STOCK</span>';
          } else {
            badgeHtml = '<span class="px-2 py-0.5 rounded text-[9px] font-black bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">HEALTHY</span>';
          }

          const actionHtml = canManageStock ? `
            <button onclick="openQuickEditModal('${escAttr(item.barcode)}')" class="p-1.5 text-teal-400 hover:text-teal-300 hover:bg-teal-500/10 rounded-lg transition" title="Edit Price & Stock">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
          ` : '<span class="text-slate-600">-</span>';

          tbody.innerHTML += `
            <tr class="hover:bg-slate-800/40 text-xs border-b border-slate-800/40">
              <td class="text-center font-mono py-2.5 px-3 text-slate-500">${displayNo}</td>
              <td class="font-mono text-slate-300 py-2.5 px-3 font-bold">${esc(item.barcode)}</td>
              <td class="font-bold text-white py-2.5 px-3">${esc(item.itemName)}</td>
              <td class="text-slate-400 py-2.5 px-3">${esc(item.category)}</td>
              <td class="text-right font-mono text-slate-400 py-2.5 px-3">${Number(item.costPrice).toLocaleString()}</td>
              <td class="text-right font-mono font-bold text-emerald-400 py-2.5 px-3">${Number(item.sellingPrice).toLocaleString()} MMK</td>
              <td class="text-center font-mono font-black py-2.5 px-3 text-sm ${item.currentStock <= 0 ? 'text-rose-400' : (item.currentStock <= 10 ? 'text-amber-400' : 'text-slate-200')}">
                ${item.currentStock}
              </td>
              <td class="text-center py-2.5 px-3">${badgeHtml}</td>
              <td class="text-center py-2.5 px-3">${actionHtml}</td>
            </tr>
          `;
        });
      }

      const start = (gStockPage - 1) * gStockLimit + 1;
      const end = Math.min(start + gStockLimit - 1, gStockTotalRows);
      const info = document.getElementById('stock-pagination-info');
      if (info) info.textContent = gStockTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gStockTotalRows} entries`;

      const prevBtn = document.getElementById('stock-btn-prev');
      const nextBtn = document.getElementById('stock-btn-next');
      if (prevBtn) prevBtn.disabled = (gStockPage <= 1);
      if (nextBtn) nextBtn.disabled = (end >= gStockTotalRows);
    }
  } catch (err) {
    console.error("Stock Inventory Load Error:", err);
  }
}

// 🎯 Stock Inventory CSV Export (UTF-8 BOM Supported)
async function exportStockInventoryCSV() {
  try {
    const res = await callApi('getPosStockInventory', { page: 1, limit: 1000, _t: Date.now() }, 'POST');
    const items = res?.data || gItemsCache;
    if (!items || items.length === 0) {
      return showToast("ERROR", "ထုတ်ယူရန် Stock စာရင်း မရှိပါ။");
    }

    let csv = "NO,BARCODE,ITEM_NAME,CATEGORY,COST_PRICE,SELLING_PRICE,CURRENT_STOCK,STOCK_VALUE,STATUS\n";
    const safeCell = s => `"${String(s || '').replace(/"/g, '""')}"`;

    items.forEach((item, idx) => {
      let statusText = 'HEALTHY';
      if (item.currentStock <= 0) statusText = 'OUT OF STOCK';
      else if (item.currentStock <= 10) statusText = 'LOW STOCK';

      const sValue = Number(item.costPrice || 0) * Number(item.currentStock || 0);

      csv += `${idx + 1},${safeCell(item.barcode)},${safeCell(item.itemName)},${safeCell(item.category)},${item.costPrice || 0},${item.sellingPrice || 0},${item.currentStock || 0},${sValue},${safeCell(statusText)}\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Canteen_Stock_Inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    showToast("SUCCESS", "Stock စာရင်း CSV ထုတ်ယူမှု အောင်မြင်ပါသည်။");
  } catch (err) {
    showToast("ERROR", "CSV ထုတ်ယူရာတွင် အမှားဖြစ်ပေါ်ခဲ့သည်: " + err.message);
  }
}

// 🎯 Quick Stock & Price Modal (Admin Only)
function openQuickEditModal(barcode) {
  if (gSession?.role === 'canteen_cashier') {
    return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် လက်ကျန်စာရင်းအား ပြင်ဆင်ခွင့် မရှိပါ။ Admin ထံ တင်ပြပါ။");
  }

  const item = gItemsCache.find(it => it.barcode === barcode) || gStockInventoryData.find(it => it.barcode === barcode);
  if (!item) return;

  document.getElementById('qe-item-name').textContent = item.itemName;
  document.getElementById('qe-barcode').textContent = item.barcode;
  document.getElementById('qe-stock').value = item.currentStock || 0;
  document.getElementById('qe-cost').value = item.costPrice || 0;
  document.getElementById('qe-price').value = item.sellingPrice || 0;

  document.getElementById('pos-quick-edit-modal')?.classList.remove('hidden');
}

async function submitQuickEdit() {
  const barcode = document.getElementById('qe-barcode')?.textContent.trim();
  const currentStock = parseFloat(document.getElementById('qe-stock')?.value || 0);
  const costPrice = parseFloat(document.getElementById('qe-cost')?.value || 0);
  const sellingPrice = parseFloat(document.getElementById('qe-price')?.value || 0);

  if (!barcode) return;

  try {
    const res = await callApi('updatePosItemQuick', { barcode, currentStock, costPrice, sellingPrice });
    if (res && res.success) {
      showToast("SUCCESS", "ပစ္စည်းအချက်အလက် ပြင်ဆင်ပြီးပါပြီ။");
      closeModal('pos-quick-edit-modal');
      await Promise.all([loadStockInventory(gStockPage), loadItemsCatalog(false)]);
    } else {
      showToast("ERROR", res?.message || "ပြင်ဆင်မှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// ==============================================================================
// 💡 5. PURCHASES HISTORY, SUPPLIERS & MANIPULATION (VIEW 5)
// ==============================================================================
function onSearchPurchasesDebounced() {
  clearTimeout(gPurSearchTimeout);
  gPurSearchTimeout = setTimeout(() => { loadPurchasesHistory(1); }, 250);
}

function clearPurchasesFilter() {
  document.getElementById('pur-search').value = '';
  document.getElementById('pur-supplier-filter').value = '';
  document.getElementById('pur-date-from').value = '';
  document.getElementById('pur-date-to').value = '';
  loadPurchasesHistory(1);
}

function changePurchasesPage(delta) {
  loadPurchasesHistory(gPurchasesPage + delta);
}

async function loadPurchasesHistory(page = 1) {
  gPurchasesPage = Math.max(1, page);
  const searchVal = document.getElementById('pur-search')?.value.trim() || '';
  const supplierId = document.getElementById('pur-supplier-filter')?.value || '';
  const dateFrom = document.getElementById('pur-date-from')?.value || '';
  const dateTo = document.getElementById('pur-date-to')?.value || '';

  try {
    const res = await callApi('getPosPurchasesHistory', {
      searchVal, supplierId, dateFrom, dateTo,
      page: gPurchasesPage, limit: gPurchasesLimit, _t: Date.now()
    }, 'POST');

    if (res && res.success) {
      const records = res.data || [];
      gPurchasesData = records;
      gPurchasesTotalRows = res.totalRows || 0;

      const tbody = document.getElementById('pur-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-500 font-bold">အဝယ်စာရင်း မရှိပါ။</td></tr>`;
      } else {
        const canManagePurchases = (gSession?.role === 'canteen_admin' || gSession?.role === 'Owner' || gSession?.role === 'Admin');

        records.forEach((r, idx) => {
          const displayNo = gPurchasesTotalRows - ((gPurchasesPage - 1) * gPurchasesLimit + idx);

          const actionHtml = canManagePurchases ? `
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="openEditPurchaseModal('${escAttr(r.id)}')" class="p-1 text-amber-400 hover:text-amber-300 transition" title="ပြင်ဆင်မည်">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button onclick="deletePurchaseEntry('${escAttr(r.id)}', '${escAttr(r.purchaseNo)}')" class="p-1 text-rose-400 hover:text-rose-300 transition" title="ဖျက်မည်">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          ` : '<span class="text-slate-600">-</span>';

          tbody.innerHTML += `
            <tr class="hover:bg-slate-800/40 text-xs border-b border-slate-800/40">
              <td class="text-center font-mono py-2.5 px-3 text-slate-500">${displayNo}</td>
              <td class="font-mono text-slate-300 py-2.5 px-3">${esc(r.date)}</td>
              <td class="font-mono font-bold text-amber-400 py-2.5 px-3">${esc(r.purchaseNo)}</td>
              <td class="font-bold text-slate-200 py-2.5 px-3">
                <span>${esc(r.supplierName)}</span>
                ${r.supplierPhone && r.supplierPhone !== '-' ? `<span class="text-[10px] text-slate-500 block font-mono">Ph: ${esc(r.supplierPhone)}</span>` : ''}
              </td>
              <td class="py-2.5 px-3">
                <span class="font-bold text-white block">${esc(r.itemName)}</span>
                <span class="text-[10px] font-mono text-slate-400 block font-bold">${esc(r.barcode)}</span>
              </td>
              <td class="text-center font-mono font-black text-white py-2.5 px-3">${r.qty}</td>
              <td class="text-right font-mono text-slate-400 py-2.5 px-3">${Number(r.costPrice).toLocaleString()}</td>
              <td class="text-right font-mono font-bold text-emerald-400 py-2.5 px-3">${Number(r.sellingPrice).toLocaleString()}</td>
              <td class="text-right font-mono font-black text-amber-300 py-2.5 px-3">${Number(r.totalCost).toLocaleString()} MMK</td>
              <td class="text-center py-2.5 px-3 right-0 sticky bg-[#080e1c] border-l border-slate-800">${actionHtml}</td>
            </tr>
          `;
        });
      }

      const start = (gPurchasesPage - 1) * gPurchasesLimit + 1;
      const end = Math.min(start + gPurchasesLimit - 1, gPurchasesTotalRows);
      const info = document.getElementById('pur-pagination-info');
      if (info) info.textContent = gPurchasesTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gPurchasesTotalRows} entries`;

      const prevBtn = document.getElementById('pur-btn-prev');
      const nextBtn = document.getElementById('pur-btn-next');
      if (prevBtn) prevBtn.disabled = (gPurchasesPage <= 1);
      if (nextBtn) nextBtn.disabled = (end >= gPurchasesTotalRows);
    }
  } catch (err) {
    console.error("Purchases History Load Error:", err);
  }
}

// 🎯 Edit Purchase Modal Controller
function openEditPurchaseModal(id) {
  if (gSession?.role === 'canteen_cashier') {
    return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် အဝယ်စာရင်းဟောင်းများအား ပြင်ဆင်ခွင့် မရှိပါ။");
  }

  const item = gPurchasesData.find(p => String(p.id) === String(id));
  if (!item) return showToast("ERROR", "အဝယ်စာရင်း အချက်အလက် မတွေ့ပါ။");

  document.getElementById('edit-pur-id').value = item.id;
  document.getElementById('edit-pur-no').textContent = item.purchaseNo;
  document.getElementById('edit-pur-item-name').textContent = `${item.itemName} (${item.barcode})`;
  document.getElementById('edit-pur-date').value = item.date;

  const supSelect = document.getElementById('edit-pur-supplier');
  if (supSelect) supSelect.value = item.supplierId || '';

  document.getElementById('edit-pur-qty').value = item.qty;
  document.getElementById('edit-pur-cost').value = item.costPrice;
  document.getElementById('edit-pur-markup').value = item.markupPercent || 20;
  document.getElementById('edit-pur-selling').value = item.sellingPrice;
  document.getElementById('edit-pur-remark').value = item.remark || '';

  document.getElementById('pos-edit-purchase-modal')?.classList.remove('hidden');
}

function triggerEditPurSmartPriceCalc() {
  const cost = parseFloat(document.getElementById('edit-pur-cost')?.value || 0);
  const markup = parseFloat(document.getElementById('edit-pur-markup')?.value || 20);
  if (cost <= 0) return;
  const rawPrice = cost * (1 + markup / 100);
  const rounded = Math.ceil(rawPrice / 50) * 50;
  const sellingInput = document.getElementById('edit-pur-selling');
  if (sellingInput) sellingInput.value = rounded;
}

async function submitEditPurchase(e) {
  if (e && e.preventDefault) e.preventDefault();
  const id = parseInt(document.getElementById('edit-pur-id')?.value, 10);
  const purchaseNo = document.getElementById('edit-pur-no')?.textContent.trim();
  const date = document.getElementById('edit-pur-date')?.value;
  const supplierId = parseInt(document.getElementById('edit-pur-supplier')?.value, 10) || null;
  const qty = parseFloat(document.getElementById('edit-pur-qty')?.value || 1);
  const costPrice = parseFloat(document.getElementById('edit-pur-cost')?.value || 0);
  const markupPercent = parseFloat(document.getElementById('edit-pur-markup')?.value || 20);
  const sellingPrice = parseFloat(document.getElementById('edit-pur-selling')?.value || 0);
  const remark = document.getElementById('edit-pur-remark')?.value.trim();

  if (!id && !purchaseNo) return showToast("ERROR", "အဝယ်စာရင်း အချက်အလက် မပြည့်စုံပါ။");
  if (qty <= 0 || costPrice <= 0) return showToast("ERROR", "Qty နှင့် ဝယ်ဈေး အတိအကျ ထည့်သွင်းပါ။");

  try {
    const res = await callApi('updatePosPurchase', {
      id, purchaseNo, date, supplierId, qty, costPrice, markupPercent, sellingPrice, remark
    });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အဝယ်စာရင်း ပြင်ဆင်ပြီးပါပြီ။");
      closeModal('pos-edit-purchase-modal');
      await Promise.all([
        loadPurchasesHistory(gPurchasesPage),
        loadItemsCatalog(false),
        loadStockInventory(gStockPage)
      ]);
    } else {
      showToast("ERROR", res?.message || "ပြင်ဆင်မှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

async function deletePurchaseEntry(id, purchaseNo) {
  if (gSession?.role === 'canteen_cashier') {
    return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် အဝယ်စာရင်းဟောင်းများအား ဖျက်သိမ်းခွင့် မရှိပါ။");
  }

  if (!confirm(`အဝယ်ဘောက်ချာ (${purchaseNo}) အား ဖျက်သိမ်းမည်မှာ သေချာပါသလား?\n\nသတိပြုရန်: ဤအဝယ်တွင် ပါဝင်သော ပစ္စည်းအရေအတွက်ကို လက်ကျန် Stock ထဲမှ အလိုအလျောက် ပြန်လည်နုတ်ယူညှိနှိုင်းသွားပါမည်။`)) {
    return;
  }

  try {
    const res = await callApi('deletePosPurchase', { id: parseInt(id, 10), purchaseNo });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အဝယ်စာရင်း ဖျက်သိမ်းပြီးပါပြီ။");
      await Promise.all([
        loadPurchasesHistory(gPurchasesPage),
        loadItemsCatalog(false),
        loadStockInventory(gStockPage)
      ]);
    } else {
      showToast("ERROR", res?.message || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// 🎯 Load Suppliers for Filter & Modals
async function loadSuppliersList() {
  try {
    const res = await callApi('getPosSuppliers', { _t: Date.now() }, 'POST');
    if (res && res.success) {
      gSuppliersCache = res.data || [];
      const filterSelect = document.getElementById('pur-supplier-filter');
      const modalSelect = document.getElementById('m-supplier-id');
      const editPurSupplier = document.getElementById('edit-pur-supplier');

      const options = gSuppliersCache.map(s => {
        const phText = s.phoneNo ? ` (${s.phoneNo})` : '';
        return `<option value="${s.id}">${esc(s.supplierName)}${esc(phText)}</option>`;
      }).join('');
      
      if (filterSelect) filterSelect.innerHTML = `<option value="">All Suppliers (ကုန်သည်အားလုံး)</option>` + options;
      if (modalSelect) modalSelect.innerHTML = `<option value="">-- ရွေးချယ်ပါ (အထွေထွေ) --</option>` + options;
      if (editPurSupplier) editPurSupplier.innerHTML = `<option value="">-- ရွေးချယ်ပါ (အထွေထွေ) --</option>` + options;
    }
  } catch (e) {
    console.warn("Suppliers Load Warning:", e.message);
  }
}

function openSupplierModal() {
  document.getElementById('sup-name').value = '';
  document.getElementById('sup-contact').value = '';
  document.getElementById('sup-phone').value = '';
  document.getElementById('sup-address').value = '';
  document.getElementById('pos-supplier-modal')?.classList.remove('hidden');
}

async function submitNewSupplier() {
  const name = document.getElementById('sup-name')?.value.trim();
  const contactPerson = document.getElementById('sup-contact')?.value.trim();
  const phoneNo = document.getElementById('sup-phone')?.value.trim();
  const address = document.getElementById('sup-address')?.value.trim();

  if (!name) return showToast("ERROR", "ကုန်သည်အမည် ထည့်သွင်းပါ။");

  try {
    const res = await callApi('savePosSupplier', { supplierName: name, contactPerson, phoneNo, address });
    if (res && res.success) {
      showToast("SUCCESS", "ကုန်သည်အသစ် ထည့်သွင်းပြီးပါပြီ။");
      closeModal('pos-supplier-modal');
      await loadSuppliersList();
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// ==============================================================================
// 💡 6. IN-MEMORY CART & BARCODE SCANNER LOGIC (VIEW 2 - ZERO D1 READ ON SCAN)
// ==============================================================================
async function loadItemsCatalog(isManualRefresh) {
  try {
    const res = await callApi('getPosItems', { onlyActive: true, _t: Date.now() }, 'POST');
    if (res && res.success) {
      gItemsCache = res.data || [];
      if (isManualRefresh) showToast("SUCCESS", `ပစ္စည်း (${gItemsCache.length}) မျိုး အသစ်ရယူပြီးပါပြီ။`);
    }
  } catch (err) {
    console.warn("Items Catalog Load Warning:", err.message);
  }
}

function handleBarcodeInput(e) {
  const val = e.target.value.trim();
  const dropdown = document.getElementById('pos-search-dropdown');

  if (e.key === 'Enter') {
    e.preventDefault();
    searchAndAddItem(val);
    return;
  }

  // 🎯 In-Memory Fast Match (Zero D1 Calls)
  if (val.length >= 2) {
    const matches = gItemsCache.filter(it => 
      it.itemName.toLowerCase().includes(val.toLowerCase()) || 
      it.barcode.toLowerCase().includes(val.toLowerCase())
    );

    if (matches.length > 0) {
      dropdown.innerHTML = matches.map(m => `
        <div onclick="selectDropdownItem('${escAttr(m.barcode)}')" class="p-2.5 hover:bg-slate-800 cursor-pointer border-b border-slate-700/60 flex items-center justify-between text-xs bg-[#0c1527] transition">
          <div>
            <span class="font-bold text-white">${esc(m.itemName)}</span>
            <span class="text-[10px] font-mono text-slate-400 block">${esc(m.barcode)}</span>
          </div>
          <span class="font-mono font-bold text-emerald-400">${Number(m.sellingPrice).toLocaleString()} MMK</span>
        </div>
      `).join('');
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
  } else {
    dropdown.classList.add('hidden');
  }
}

function selectDropdownItem(barcode) {
  document.getElementById('pos-search-dropdown')?.classList.add('hidden');
  searchAndAddItem(barcode);
}

function searchAndAddItem(targetCode) {
  const input = document.getElementById('pos-barcode-input');
  const code = (targetCode || input.value || '').trim();
  if (!code) return;

  const item = gItemsCache.find(it => it.barcode === code || it.itemName.toLowerCase() === code.toLowerCase());
  if (!item) {
    showToast("ERROR", `ပစ္စည်း ရှာမတွေ့ပါ: ${code}`);
    return;
  }

  const existing = gCart.find(ci => ci.barcode === item.barcode);
  if (existing) {
    if (item.currentStock > 0 && existing.qty + 1 > item.currentStock) {
      showToast("ERROR", `လက်ကျန် Stock (${item.currentStock}) သာ ရှိသဖြင့် ထပ်တိုး၍ မရပါ!`);
      return;
    }
    existing.qty += 1;
  } else {
    if (item.currentStock <= 0) {
      showToast("ERROR", `ဤပစ္စည်းတွင် လက်ကျန် Stock (0) ဖြစ်နေပါသည်။`);
      return;
    }
    gCart.push({
      barcode: item.barcode,
      name: item.itemName,
      price: Number(item.sellingPrice || 0),
      cost: Number(item.costPrice || 0),
      maxStock: Number(item.currentStock || 9999),
      qty: 1
    });
  }

  input.value = '';
  document.getElementById('pos-search-dropdown')?.classList.add('hidden');
  renderCart();
  focusScanner();
}

function renderCart() {
  const list = document.getElementById('pos-cart-list');
  const emptyBox = document.getElementById('pos-cart-empty');
  const badge = document.getElementById('pos-cart-badge');

  if (gCart.length === 0) {
    list.innerHTML = '';
    if (emptyBox) list.appendChild(emptyBox);
    badge.textContent = "0 Items";
    updateBillTotals();
    return;
  }

  list.innerHTML = '';
  gCart.forEach((item, idx) => {
    const subtotal = item.qty * item.price;
    list.innerHTML += `
      <div class="p-2.5 bg-[#080f1e]/80 border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs">
        <div class="min-w-0 flex-1">
          <h4 class="font-bold text-white truncate">${esc(item.name)}</h4>
          <span class="text-[10px] font-mono text-slate-400">${Number(item.price).toLocaleString()} MMK</span>
        </div>

        <div class="flex items-center gap-1 shrink-0 bg-[#060c18] border border-slate-800 rounded-lg p-0.5">
          <button onclick="changeCartQty(${idx}, -1)" class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs">-</button>
          <input type="number" value="${item.qty}" min="1" max="${item.maxStock}" onchange="setCartQty(${idx}, this.value)" class="w-8 bg-transparent text-center font-mono font-bold text-white text-xs outline-none">
          <button onclick="changeCartQty(${idx}, 1)" class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs">+</button>
        </div>

        <div class="text-right shrink-0 min-w-[70px]">
          <strong class="font-mono text-emerald-400 font-bold block">${Number(subtotal).toLocaleString()}</strong>
          <button onclick="removeCartItem(${idx})" class="text-[10px] text-slate-500 hover:text-rose-400 p-0.5 transition"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;
  });

  badge.textContent = `${gCart.length} Items`;
  updateBillTotals();
}

function changeCartQty(idx, delta) {
  if (!gCart[idx]) return;
  const target = gCart[idx].qty + delta;
  if (target <= 0) return removeCartItem(idx);
  if (target > gCart[idx].maxStock) {
    showToast("ERROR", `လက်ကျန် Stock (${gCart[idx].maxStock}) ကျော်လွန်၍ မရပါ!`);
    return;
  }
  gCart[idx].qty = target;
  renderCart();
}

function setCartQty(idx, val) {
  const q = parseInt(val, 10) || 1;
  if (q <= 0) return removeCartItem(idx);
  gCart[idx].qty = Math.min(q, gCart[idx].maxStock);
  renderCart();
}

function removeCartItem(idx) {
  gCart.splice(idx, 1);
  renderCart();
}

function clearCart(showAlert) {
  if (gCart.length === 0) return;
  if (showAlert && !confirm("Cart ထဲရှိ ပစ္စည်းများကို ပယ်ဖျက်မည်မှာ သေချာပါသလား?")) return;
  gCart = [];
  renderCart();
}

function updateBillTotals() {
  let totQty = 0, totAmt = 0, totCost = 0;
  gCart.forEach(ci => {
    totQty += ci.qty;
    totAmt += (ci.qty * ci.price);
    totCost += (ci.qty * ci.cost);
  });

  const netProfit = Math.max(0, totAmt - totCost);

  document.getElementById('pos-cart-total-qty').textContent = totQty;
  document.getElementById('pos-cart-subtotal').textContent = `${totAmt.toLocaleString()} MMK`;
  document.getElementById('sum-qty').textContent = totQty;
  document.getElementById('sum-cost').textContent = `${totCost.toLocaleString()} MMK`;
  document.getElementById('sum-profit').textContent = `+${netProfit.toLocaleString()} MMK`;
  document.getElementById('pos-grand-total').innerHTML = `${totAmt.toLocaleString()} <span class="text-sm font-bold">MMK</span>`;
  document.getElementById('pos-items-count-label').textContent = `${totQty} items in cart`;

  evaluateStudentCapWarning(totAmt);
}

// ==============================================================================
// 💡 7. STUDENT RADAR & DYNAMIC ALLOWANCE CAP VERIFIER
// ==============================================================================
function setPaymentMode(mode) {
  gPaymentMode = mode;
  const btnWallet = document.getElementById('btn-mode-wallet');
  const btnCash = document.getElementById('btn-mode-cash');
  const radar = document.getElementById('pos-student-radar');

  if (mode === 'Student Pocket Money') {
    btnWallet.className = "py-2 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 bg-indigo-600 text-white shadow-lg shadow-indigo-600/30";
    btnCash.className = "py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    radar.classList.remove('opacity-40', 'pointer-events-none');
    document.getElementById('btn-checkout-label').textContent = "မုန့်ဖိုးဖြင့် ရှင်းမည် (CHECKOUT)";
  } else {
    btnCash.className = "py-2 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 bg-emerald-600 text-white shadow-lg shadow-emerald-600/30";
    btnWallet.className = "py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    radar.classList.add('opacity-40', 'pointer-events-none');
    document.getElementById('btn-checkout-label').textContent = "ငွေသားဖြင့် ရှင်းမည် (CHECKOUT)";
  }
}

async function lookupStudentRadar() {
  const input = document.getElementById('pos-student-input');
  const val = (input?.value || '').trim();
  if (!val) return;

  try {
    const res = await callApi('lookupStudentForPos', { studentId: val, _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      gCurrentStudent = res.data;
      if (res.data.dailyCap) gDailySpendingCap = Number(res.data.dailyCap);
      renderStudentCard();
      showToast("SUCCESS", `ကျောင်းသား: ${gCurrentStudent.name}`);
      focusScanner();
    } else {
      gCurrentStudent = null;
      resetStudentCard();
      showToast("ERROR", res?.message || "ကျောင်းသား ရှာမတွေ့ပါ။");
    }
  } catch (err) {
    showToast("ERROR", "ကျောင်းသား စစ်ဆေး၍ မရပါ: " + err.message);
  }
}

function renderStudentCard() {
  if (!gCurrentStudent) return resetStudentCard();

  const cap = gDailySpendingCap || gCurrentStudent.dailyCap || 10000;

  document.getElementById('radar-student-name').textContent = gCurrentStudent.name;
  document.getElementById('radar-student-info').textContent = `Class: ${gCurrentStudent.studentClass || '-'} | FYID: ${gCurrentStudent.fyid || '-'}`;
  document.getElementById('radar-wallet-bal').textContent = `${Number(gCurrentStudent.currentBalance).toLocaleString()} MMK`;
  document.getElementById('radar-today-spent').textContent = `${Number(gCurrentStudent.todaySpent).toLocaleString()} / ${Number(cap).toLocaleString()}`;
  document.getElementById('radar-badge-status').textContent = "ACTIVE WALLET";
  document.getElementById('radar-badge-status').className = "px-2 py-0.5 rounded text-[9px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono";

  const capHeader = document.getElementById('radar-cap-header');
  if (capHeader) capHeader.textContent = `DAILY ${Number(cap).toLocaleString()} MMK CAP:`;

  const totalBill = getCartTotalAmount();
  evaluateStudentCapWarning(totalBill);
}

function resetStudentCard() {
  const cap = gDailySpendingCap || 10000;
  document.getElementById('radar-student-name').textContent = "ကျောင်းသား ရွေးချယ်ပါ";
  document.getElementById('radar-student-info').textContent = "Class: - | ID: -";
  document.getElementById('radar-wallet-bal').textContent = "0 MMK";
  document.getElementById('radar-today-spent').textContent = `0 / ${Number(cap).toLocaleString()}`;
  document.getElementById('radar-cap-text').textContent = `ကျန်ခွဲတမ်း: ${Number(cap).toLocaleString()} MMK`;
  document.getElementById('radar-progress-bar').style.width = "0%";
  document.getElementById('radar-progress-bar').className = "h-full bg-emerald-500";
  document.getElementById('radar-badge-status').textContent = "STANDBY";
  document.getElementById('radar-badge-status').className = "px-2 py-0.5 rounded text-[9px] font-black bg-slate-800 text-slate-400 border border-slate-700 font-mono";
}

function evaluateStudentCapWarning(currentBillAmount) {
  if (!gCurrentStudent || gPaymentMode !== 'Student Pocket Money') return;

  const spent = gCurrentStudent.todaySpent || 0;
  const cap = gDailySpendingCap || gCurrentStudent.dailyCap || 10000;
  const combined = spent + currentBillAmount;
  const percentage = Math.min(100, (combined / cap) * 100);
  const remainingQuota = Math.max(0, cap - spent);

  const pBar = document.getElementById('radar-progress-bar');
  const capText = document.getElementById('radar-cap-text');
  pBar.style.width = `${percentage}%`;

  if (combined > cap) {
    pBar.className = "h-full bg-rose-500 animate-pulse";
    capText.innerHTML = `<span class="text-rose-400 font-black">ကန့်သတ်ချက် ကျော်လွန်နေပါသည်! (ကျန်: ${remainingQuota.toLocaleString()} MMK)</span>`;
  } else if (percentage >= 80) {
    pBar.className = "h-full bg-amber-400";
    capText.textContent = `ကျန်ခွဲတမ်း: ${(cap - combined).toLocaleString()} MMK`;
  } else {
    pBar.className = "h-full bg-emerald-500";
    capText.textContent = `ကျန်ခွဲတမ်း: ${(cap - combined).toLocaleString()} MMK`;
  }
}

function getCartTotalAmount() {
  let tot = 0;
  gCart.forEach(ci => { tot += (ci.qty * ci.price); });
  return tot;
}

// ==============================================================================
// 💡 8. ATOMIC CHECKOUT & RECEIPT PRINTER (ZERO D1 CATALOG READ ON SALE)
// ==============================================================================
async function executeCheckout() {
  if (isSubmitting) return;

  if (gCart.length === 0) {
    return showToast("ERROR", "Cart ထဲတွင် ပစ္စည်းများ မရှိသေးပါ!");
  }

  const totalAmount = getCartTotalAmount();
  let totalCost = 0;
  const stockDeductions = [];
  const itemsListText = [];

  gCart.forEach(ci => {
    totalCost += (ci.qty * ci.cost);
    stockDeductions.push({ barcode: ci.barcode, qty: ci.qty });
    itemsListText.push(`${ci.name} x ${ci.qty}`);
  });

  const itemsSummary = itemsListText.join(', ');

  if (gPaymentMode === 'Student Pocket Money') {
    if (!gCurrentStudent) {
      return showToast("ERROR", "မုန့်ဖိုးဖြတ်တောက်ရန် ကျောင်းသား ID Scan အရင်ဖတ်ပေးပါ!");
    }

    if (totalAmount > gCurrentStudent.currentBalance) {
      return showToast("ERROR", `ကျောင်းသားတွင် မုန့်ဖိုး (${gCurrentStudent.currentBalance.toLocaleString()} MMK) သာ ကျန်သဖြင့် မလုံလောက်ပါ!`);
    }

    const spent = gCurrentStudent.todaySpent || 0;
    const cap = gDailySpendingCap || gCurrentStudent.dailyCap || 10000;
    if ((spent + totalAmount) > cap) {
      const remaining = Math.max(0, cap - spent);
      return showToast("ERROR", `တစ်ရက် ${Number(cap).toLocaleString()} ကျပ် ကန့်သတ်ချက် ကျော်လွန်နေပါသည်! (ကျန်ခွဲတမ်း: ${remaining.toLocaleString()} MMK)`);
    }
  }

  const payload = {
    date: new Date().toISOString().slice(0, 10),
    paymentMethod: gPaymentMode,
    studentId: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.studentId : null,
    studentName: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.name : '',
    fyid: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.fyid : '',
    studentClass: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.studentClass : '',
    totalAmount,
    totalCost,
    itemsSummary,
    stockDeductions,
    uniqueId: 'CAN_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
  };

  isSubmitting = true;
  const btn = document.getElementById('btn-checkout');
  if (btn) btn.disabled = true;

  try {
    const res = await callApi('checkoutPosSale', payload);
    if (res && res.success) {
      showToast("SUCCESS", `အရောင်း အောင်မြင်ပါပြီ! Invoice: ${res.invoiceNo}`);
      
      printPosReceipt(res.invoiceNo, totalAmount, itemsSummary, gPaymentMode, gCurrentStudent);

      // 🎯 D1 Quota Guard: D1 သို့ Catalog အသစ်မဆွဲဘဲ Local Memory Stock ကိုသာ နုတ်ယူသည်
      stockDeductions.forEach(sd => {
        const item = gItemsCache.find(it => it.barcode === sd.barcode);
        if (item) item.currentStock = Math.max(0, Number(item.currentStock || 0) - sd.qty);
      });

      // Reset Active Cart
      gCart = [];
      gCurrentStudent = null;
      const stuInp = document.getElementById('pos-student-input');
      if (stuInp) stuInp.value = '';
      resetStudentCard();
      renderCart();

    } else {
      // 🎯 Multi-Counter Conflict: အကယ်၍ အခြား counter က အရင်ရောင်းသွား၍ လက်ကျန်မရှိတော့ပါက Cache အသစ်ဆွဲသည်
      if (res?.message && res.message.includes('လက်ကျန်')) {
        await loadItemsCatalog(false);
      }
      showToast("ERROR", res?.message || "အရောင်း မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", "ဆာဗာ အမှား: " + err.message);
  } finally {
    isSubmitting = false;
    if (btn) btn.disabled = false;
    focusScanner();
  }
}

function printPosReceipt(invoiceNo, totalAmt, itemsSummary, method, student) {
  const today = new Date().toISOString().slice(0, 10);
  const cashierName = gSession?.name || 'Cashier';

  const studentInfoRow = student 
    ? `<tr><td colspan="2">Student: [${student.fyid || student.studentId}] ${student.name}</td></tr>` 
    : '';

  const slipHtml = `
    <!DOCTYPE html><html><head><title>Receipt - ${invoiceNo}</title>
    <style>
      @page { size: 80mm auto; margin: 0; }
      body { font-family: -apple-system, sans-serif; font-size: 11px; width: 72mm; margin: 0 auto; padding: 10px 0; color: #000; }
      .center { text-align: center; }
      .line { border-top: 1px dashed #000; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      td { padding: 2px 0; vertical-align: top; }
    </style></head><body>
      <div class="center">
        <h3 style="margin:0; font-size:14px; font-weight:900;">GOLDEN SCHOOL CANTEEN</h3>
        <p style="margin:2px 0;">Official Sales Receipt</p>
      </div>
      <div class="line"></div>
      <table>
        <tr><td>Inv: ${invoiceNo}</td><td style="text-align:right;">${today}</td></tr>
        <tr><td>Cashier: ${cashierName}</td><td style="text-align:right;">${method === 'Cash' ? 'Cash' : 'Wallet'}</td></tr>
        ${studentInfoRow}
      </table>
      <div class="line"></div>
      <p style="margin:4px 0; font-size:11px;"><strong>Items:</strong> ${itemsSummary}</p>
      <div class="line"></div>
      <table>
        <tr style="font-size:13px; font-weight:900;">
          <td>TOTAL PAID:</td>
          <td style="text-align:right;">${Number(totalAmt).toLocaleString()} MMK</td>
        </tr>
      </table>
      <div class="line"></div>
      <div class="center" style="font-size:10px; margin-top:8px;">
        <p style="margin:0;">ကျေးဇူးတင်ပါသည် / Thank You!</p>
      </div>
    </body></html>
  `;

  const w = window.open('', '_blank', 'width=350,height=500');
  if (!w) return;
  w.document.write(slipHtml);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); w.close(); }, 350);
}

// ==============================================================================
// 💡 9. SMART PRICING ENGINE & ITEM / PURCHASE MODAL
// ==============================================================================
function openItemModal() {
  document.getElementById('m-barcode').value = '';
  document.getElementById('m-item-name').value = '';
  document.getElementById('m-qty').value = '1';
  document.getElementById('m-cost-price').value = '';
  document.getElementById('m-markup-percent').value = '20';
  document.getElementById('m-suggested-price').textContent = '0 MMK';
  document.getElementById('m-selling-price').value = '';
  
  loadSuppliersList();
  document.getElementById('pos-item-modal')?.classList.remove('hidden');
}

function lookupExistingBarcode() {
  const bCode = document.getElementById('m-barcode').value.trim();
  const existing = gItemsCache.find(it => it.barcode === bCode);
  if (existing) {
    document.getElementById('m-item-name').value = existing.itemName;
    document.getElementById('m-category').value = existing.category || 'Snack';
    document.getElementById('m-cost-price').value = existing.costPrice;
    document.getElementById('m-markup-percent').value = existing.markupPercent || 20;
    triggerSmartPriceCalc();
  }
}

// 🎯 FIX: အတည်ပြုရောင်းဈေးသို့ အကြံပြုရောင်းဈေးတန်ဖိုးကို အလိုအလျောက် တိုက်ရိုက်ထည့်သွင်းပေးခြင်း
function triggerSmartPriceCalc() {
  const cost = parseFloat(document.getElementById('m-cost-price')?.value || 0);
  const markup = parseFloat(document.getElementById('m-markup-percent')?.value || 20);
  if (cost <= 0) {
    document.getElementById('m-suggested-price').textContent = '0 MMK';
    return;
  }

  const rawPrice = cost * (1 + markup / 100);
  const rounded = Math.ceil(rawPrice / 50) * 50;

  document.getElementById('m-suggested-price').textContent = `${rounded.toLocaleString()} MMK`;
  
  // 🎯 Auto-Sync အတည်ပြုရောင်းဈေး တိုက်ရိုက် Override
  const sellingInput = document.getElementById('m-selling-price');
  if (sellingInput) {
    sellingInput.value = rounded;
  }
}

// 🎯 ပစ္စည်းသစ်သွင်းခြင်း သို့မဟုတ် အဝယ်သွင်းပြီးမှသာ D1 မှ Catalog အသစ် ပြန်ဆွဲတင်မည်
async function submitPosPurchase(e) {
  e.preventDefault();
  const payload = {
    date: new Date().toISOString().slice(0, 10),
    barcode: document.getElementById('m-barcode').value.trim(),
    itemName: document.getElementById('m-item-name').value.trim(),
    category: document.getElementById('m-category').value,
    supplierId: parseInt(document.getElementById('m-supplier-id')?.value, 10) || null,
    qty: parseFloat(document.getElementById('m-qty').value || 1),
    costPrice: parseFloat(document.getElementById('m-cost-price').value || 0),
    markupPercent: parseFloat(document.getElementById('m-markup-percent').value || 20),
    sellingPrice: parseFloat(document.getElementById('m-selling-price').value || 0)
  };

  try {
    const res = await callApi('savePosPurchase', payload);
    if (res && res.success) {
      showToast("SUCCESS", "အဝယ်စာရင်းနှင့် ဈေးနှုန်း မှတ်တမ်းတင်ပြီးပါပြီ။");
      closeModal('pos-item-modal');
      await Promise.all([
        loadItemsCatalog(false),
        loadStockInventory(1),
        loadPurchasesHistory(1),
        loadCanteenDashboard()
      ]);
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// ==============================================================================
// ⚠️ 10. WASTAGE & LOSS LEDGER CONTROLLER (IN-MEMORY CART & 20-ROW AUDIT)
// ==============================================================================
function openWasteModal() {
  document.getElementById('waste-barcode-input').value = '';
  document.getElementById('m-waste-remark').value = '';
  document.getElementById('m-waste-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('m-waste-reason').value = 'ပျက်စီးကွဲရှ';
  gWasteCart = [];
  renderWasteCart();
  document.getElementById('pos-waste-modal')?.classList.remove('hidden');
}

function handleWasteBarcodeInput(e) {
  const val = e.target.value.trim();
  const dropdown = document.getElementById('waste-search-dropdown');

  if (e.key === 'Enter') {
    e.preventDefault();
    searchAndAddWasteItem(val);
    return;
  }

  // Live in-memory matching (Zero D1 reads)
  if (val.length >= 2) {
    const matches = gItemsCache.filter(it => 
      it.itemName.toLowerCase().includes(val.toLowerCase()) || 
      it.barcode.toLowerCase().includes(val.toLowerCase())
    );

    if (matches.length > 0) {
      dropdown.innerHTML = matches.map(m => `
        <div onclick="selectDropdownWasteItem('${escAttr(m.barcode)}')" class="p-2 hover:bg-slate-800 cursor-pointer border-b border-slate-700/60 flex items-center justify-between text-xs bg-[#0c1527] transition">
          <div>
            <span class="font-bold text-white">${esc(m.itemName)}</span>
            <span class="text-[10px] font-mono text-slate-400 block">${esc(m.barcode)}</span>
          </div>
          <span class="font-mono text-slate-300">Cost: ${Number(m.costPrice || 0).toLocaleString()} MMK</span>
        </div>
      `).join('');
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
  } else {
    dropdown.classList.add('hidden');
  }
}

function selectDropdownWasteItem(barcode) {
  document.getElementById('waste-search-dropdown')?.classList.add('hidden');
  searchAndAddWasteItem(barcode);
}

function searchAndAddWasteItem(targetCode) {
  const input = document.getElementById('waste-barcode-input');
  const code = (targetCode || input.value || '').trim();
  if (!code) return;

  const item = gItemsCache.find(it => it.barcode === code || it.itemName.toLowerCase() === code.toLowerCase());
  if (!item) {
    showToast("ERROR", `ပစ္စည်း ရှာမတွေ့ပါ: ${code}`);
    return;
  }

  const existing = gWasteCart.find(wi => wi.barcode === item.barcode);
  if (existing) {
    existing.qty += 1;
  } else {
    gWasteCart.push({
      barcode: item.barcode,
      name: item.itemName,
      costPrice: Number(item.costPrice || 0),
      currentStock: Number(item.currentStock || 0),
      qty: 1
    });
  }

  input.value = '';
  document.getElementById('waste-search-dropdown')?.classList.add('hidden');
  renderWasteCart();
}

function renderWasteCart() {
  const list = document.getElementById('waste-items-list');
  const emptyBox = document.getElementById('waste-items-empty');
  const badge = document.getElementById('waste-cart-badge');

  if (gWasteCart.length === 0) {
    list.innerHTML = '';
    if (emptyBox) list.appendChild(emptyBox);
    badge.textContent = "0 items";
    document.getElementById('waste-modal-total-qty').textContent = "0 ခု";
    document.getElementById('waste-modal-total-cost').textContent = "0 MMK";
    return;
  }

  list.innerHTML = '';
  let totalQty = 0;
  let totalCost = 0;

  gWasteCart.forEach((item, idx) => {
    const subtotal = item.qty * item.costPrice;
    totalQty += item.qty;
    totalCost += subtotal;

    list.innerHTML += `
      <div class="p-2 bg-[#080f1e]/80 border border-slate-800 rounded-lg flex items-center justify-between gap-2 text-xs">
        <div class="min-w-0 flex-1">
          <h5 class="font-bold text-white truncate">${esc(item.name)}</h5>
          <span class="text-[10px] font-mono text-slate-400">ဝယ်ရင်းဈေး: ${Number(item.costPrice).toLocaleString()} MMK</span>
        </div>

        <div class="flex items-center gap-1 shrink-0 bg-[#060c18] border border-slate-800 rounded-md p-0.5">
          <button type="button" onclick="changeWasteCartQty(${idx}, -1)" class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs">-</button>
          <input type="number" value="${item.qty}" min="1" onchange="setWasteCartQty(${idx}, this.value)" class="w-8 bg-transparent text-center font-mono font-bold text-white text-xs outline-none">
          <button type="button" onclick="changeWasteCartQty(${idx}, 1)" class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs">+</button>
        </div>

        <div class="text-right shrink-0 min-w-[70px]">
          <strong class="font-mono text-rose-400 font-bold block">${Number(subtotal).toLocaleString()}</strong>
          <button type="button" onclick="removeWasteCartItem(${idx})" class="text-[10px] text-slate-500 hover:text-rose-400 transition"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;
  });

  badge.textContent = `${gWasteCart.length} items`;
  document.getElementById('waste-modal-total-qty').textContent = `${totalQty} ခု`;
  document.getElementById('waste-modal-total-cost').textContent = `${Number(totalCost).toLocaleString()} MMK`;
}

function changeWasteCartQty(idx, delta) {
  if (!gWasteCart[idx]) return;
  const target = gWasteCart[idx].qty + delta;
  if (target <= 0) return removeWasteCartItem(idx);
  gWasteCart[idx].qty = target;
  renderWasteCart();
}

function setWasteCartQty(idx, val) {
  const q = parseInt(val, 10) || 1;
  if (q <= 0) return removeWasteCartItem(idx);
  gWasteCart[idx].qty = q;
  renderWasteCart();
}

function removeWasteCartItem(idx) {
  gWasteCart.splice(idx, 1);
  renderWasteCart();
}

async function submitPosWaste() {
  if (gWasteCart.length === 0) {
    return showToast("ERROR", "အပျက်စာရင်းသွင်းမည့် ပစ္စည်း အနည်းဆုံး ၁ ခု ရွေးချယ်ပါ။");
  }

  const payload = {
    date: document.getElementById('m-waste-date').value || new Date().toISOString().slice(0, 10),
    reason: document.getElementById('m-waste-reason').value,
    remark: document.getElementById('m-waste-remark').value.trim(),
    items: gWasteCart,
    uniqueId: 'WST_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
  };

  try {
    const res = await callApi('savePosWasteEntry', payload);
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အပျက်/အပျောက်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။");
      closeModal('pos-waste-modal');

      // 🎯 Local Cache Stock ထဲမှ ချက်ချင်းနုတ်ယူသည် (Zero D1 Read)
      gWasteCart.forEach(wi => {
        const item = gItemsCache.find(it => it.barcode === wi.barcode);
        if (item) item.currentStock = Math.max(0, Number(item.currentStock || 0) - wi.qty);
      });

      gWasteCart = [];
      await Promise.all([
        loadWasteHistory(1),
        loadStockInventory(gStockPage),
        loadCanteenDashboard()
      ]);
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// 🎯 Waste History View (20 Rows Paginated)
function onSearchWasteDebounced() {
  clearTimeout(gWasteSearchTimeout);
  gWasteSearchTimeout = setTimeout(() => { loadWasteHistory(1); }, 250);
}

function clearWasteFilter() {
  document.getElementById('waste-search').value = '';
  document.getElementById('waste-reason-filter').value = '';
  document.getElementById('waste-date-from').value = '';
  document.getElementById('waste-date-to').value = '';
  loadWasteHistory(1);
}

function changeWastePage(delta) {
  loadWasteHistory(gWastePage + delta);
}

async function loadWasteHistory(page = 1) {
  gWastePage = Math.max(1, page);
  const searchVal = document.getElementById('waste-search')?.value.trim() || '';
  const reason = document.getElementById('waste-reason-filter')?.value || '';
  const dateFrom = document.getElementById('waste-date-from')?.value || '';
  const dateTo = document.getElementById('waste-date-to')?.value || '';

  try {
    const res = await callApi('getPosWasteHistory', {
      searchVal, reason, dateFrom, dateTo,
      page: gWastePage, limit: gWasteLimit, _t: Date.now()
    }, 'POST');

    if (res && res.success) {
      const records = res.data || [];
      gWasteData = records;
      gWasteTotalRows = res.totalRows || 0;

      const totalLossBadge = document.getElementById('waste-total-loss-badge');
      if (totalLossBadge) totalLossBadge.textContent = `${Number(res.totalLossAmount || 0).toLocaleString()} MMK`;

      const tbody = document.getElementById('waste-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-500 font-bold">အပျက်/အပျောက်စာရင်း မရှိပါ။</td></tr>`;
      } else {
        records.forEach((r, idx) => {
          const displayNo = gWasteTotalRows - ((gWastePage - 1) * gWasteLimit + idx);

          tbody.innerHTML += `
            <tr class="hover:bg-slate-800/40 text-xs border-b border-slate-800/40">
              <td class="text-center font-mono py-2.5 px-3 text-slate-500">${displayNo}</td>
              <td class="font-mono text-slate-300 py-2.5 px-3">${esc(r.date)}</td>
              <td class="font-mono font-bold text-rose-400 py-2.5 px-3">${esc(r.wasteNo)}</td>
              <td class="text-center py-2.5 px-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  ${esc(r.reason)}
                </span>
              </td>
              <td class="py-2.5 px-3 text-white font-bold">${esc(r.itemsSummary)}</td>
              <td class="text-center font-mono font-black text-white py-2.5 px-3">${r.totalItemsQty}</td>
              <td class="text-right font-mono font-bold text-rose-400 py-2.5 px-3">${Number(r.totalLossCost).toLocaleString()} MMK</td>
              <td class="py-2.5 px-3 text-slate-400">${esc(r.reportedBy)}</td>
              <td class="py-2.5 px-3 text-slate-400 truncate max-w-xs">${esc(r.remark || '-')}</td>
            </tr>
          `;
        });
      }

      const start = (gWastePage - 1) * gWasteLimit + 1;
      const end = Math.min(start + gWasteLimit - 1, gWasteTotalRows);
      const info = document.getElementById('waste-pagination-info');
      if (info) info.textContent = gWasteTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gWasteTotalRows} entries`;

      const prevBtn = document.getElementById('waste-btn-prev');
      const nextBtn = document.getElementById('waste-btn-next');
      if (prevBtn) prevBtn.disabled = (gWastePage <= 1);
      if (nextBtn) nextBtn.disabled = (end >= gWasteTotalRows);
    }
  } catch (err) {
    console.error("Waste History Load Error:", err);
  }
}

// ==============================================================================
// ⚙️ 11. DYNAMIC POS SETTINGS (CACHED ALLOWANCE CAP CONTROLLER)
// ==============================================================================
async function loadPosSettings() {
  try {
    const res = await callApi('getPosSettings', { _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      if (res.data.daily_spending_cap) {
        gDailySpendingCap = Number(res.data.daily_spending_cap);
      }
    }
  } catch (e) {
    console.warn("Settings Cache Load Warning:", e.message);
  }
}

function openSettingsModal() {
  const role = (gSession?.role || '').trim();
  if (role !== 'canteen_admin' && role !== 'Owner' && role !== 'Admin') {
    return showToast("ERROR", "ဆက်တင် ပြင်ဆင်ခွင့် မရှိပါ။ (Admin Only)");
  }

  document.getElementById('m-set-daily-cap').value = gDailySpendingCap;
  document.getElementById('pos-settings-modal')?.classList.remove('hidden');
}

async function submitPosSettings(e) {
  if (e && e.preventDefault) e.preventDefault();
  const capVal = document.getElementById('m-set-daily-cap')?.value.trim();
  if (!capVal || isNaN(capVal)) return showToast("ERROR", "ကျောင်းသား တစ်နေ့တာ ကန့်သတ်ငွေ အတိအကျ ထည့်သွင်းပါ။");

  try {
    const res = await callApi('updatePosSettings', {
      settingKey: 'daily_spending_cap',
      settingValue: String(capVal)
    });

    if (res && res.success) {
      gDailySpendingCap = Number(capVal);
      showToast("SUCCESS", `Daily Cap ကို ${Number(capVal).toLocaleString()} MMK သို့ ပြင်ဆင်ပြီးပါပြီ။`);
      closeModal('pos-settings-modal');
      
      // Real-time UI reflection
      if (gCurrentStudent) renderStudentCard();
      else resetStudentCard();
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// ==============================================================================
// 💡 12. EVENING SETTLEMENT MODAL
// ==============================================================================
async function openSettlementModal() {
  try {
    const res = await callApi('getCanteenDailySummary', { date: new Date().toISOString().slice(0, 10), _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      const dt = res.data;
      document.getElementById('set-orders').textContent = `${dt.totalOrders} Orders`;
      document.getElementById('set-total').textContent = `${Number(dt.totalSales).toLocaleString()} MMK`;
      document.getElementById('set-cash').textContent = `${Number(dt.cashSalesShare).toLocaleString()} MMK`;
      document.getElementById('set-pocket').textContent = `${Number(dt.pocketMoneyShare).toLocaleString()} MMK`;
      document.getElementById('set-payout-text').textContent = `${Number(dt.pocketMoneyShare).toLocaleString()} MMK`;

      const actionBox = document.getElementById('set-action-box');
      if (dt.isSettled) {
        actionBox.innerHTML = `<div class="p-3 text-center bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 rounded-xl font-bold font-sans">ဤရက်စွဲအတွက် Finance နှင့် ငွေရှင်းပြီးဖြစ်ပါသည် (${dt.settlement?.settlement_no || dt.settlement?.settlementNo})</div>`;
      } else {
        actionBox.innerHTML = `<button onclick="confirmCanteenSettlement(${dt.pocketMoneyShare}, ${dt.cashSalesShare})" class="w-full py-3.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-black text-xs shadow-lg shadow-amber-950 active:scale-95 transition font-sans">Finance မှ ငွေထုတ်ပေးရှင်းလင်းပြီးကြောင်း အတည်ပြုမည်</button>`;
      }

      document.getElementById('pos-settlement-modal')?.classList.remove('hidden');
    }
  } catch (e) {
    showToast("ERROR", "Summary ခေါ်ယူ၍ မရပါ: " + e.message);
  }
}

async function confirmCanteenSettlement(pocketShare, cashShare) {
  if (!confirm("Finance မှ Pocket Money ရောင်းရငွေ အပြင်တွင် အမှန်တကယ် လက်ရောက်ရှင်းပြီးပြီလား?")) return;

  const payload = {
    date: new Date().toISOString().slice(0, 10),
    pocketMoneyShare: pocketShare,
    cashSalesShare: cashShare,
    netPayoutAmount: pocketShare,
    receivedBy: gSession?.name || 'Canteen Manager'
  };

  try {
    const res = await callApi('saveCanteenSettlement', payload);
    if (res && res.success) {
      showToast("SUCCESS", "ငွေရှင်းလင်းမှု မှတ်တမ်းတင်ပြီးပါပြီ။");
      closeModal('pos-settlement-modal');
      if (gActiveView === 'dashboard') loadCanteenDashboard();
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (e) {
    showToast("ERROR", e.message);
  }
}

function closeModal(id) { 
  document.getElementById(id)?.classList.add('hidden'); 
}

function logoutPos() {
  localStorage.removeItem('golden_auth_token');
  localStorage.removeItem('golden_user');
  localStorage.removeItem('golden_user_role');
  localStorage.removeItem('golden_user_name');
  localStorage.removeItem('golden_token_expires_at');
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
}

// 💡 EXPOSE GLOBALLY FOR DOM EVENT HANDLERS
window.switchCanteenView = switchCanteenView;
window.refreshActiveCanteenView = refreshActiveCanteenView;
window.toggleCanteenSidebar = toggleCanteenSidebar;
window.loadCanteenDashboard = loadCanteenDashboard;
window.loadSalesOrdersHistory = loadSalesOrdersHistory;
window.onSearchSalesDebounced = onSearchSalesDebounced;
window.clearSalesFilter = clearSalesFilter;
window.changeSalesPage = changeSalesPage;
window.reprintSalesSlip = reprintSalesSlip;
window.loadStockInventory = loadStockInventory;
window.onSearchStockDebounced = onSearchStockDebounced;
window.changeStockPage = changeStockPage;
window.exportStockInventoryCSV = exportStockInventoryCSV;
window.openQuickEditModal = openQuickEditModal;
window.submitQuickEdit = submitQuickEdit;
window.loadPurchasesHistory = loadPurchasesHistory;
window.onSearchPurchasesDebounced = onSearchPurchasesDebounced;
window.clearPurchasesFilter = clearPurchasesFilter;
window.changePurchasesPage = changePurchasesPage;
window.openEditPurchaseModal = openEditPurchaseModal;
window.triggerEditPurSmartPriceCalc = triggerEditPurSmartPriceCalc;
window.submitEditPurchase = submitEditPurchase;
window.deletePurchaseEntry = deletePurchaseEntry;
window.openSupplierModal = openSupplierModal;
window.submitNewSupplier = submitNewSupplier;
window.openItemModal = openItemModal;
window.lookupExistingBarcode = lookupExistingBarcode;
window.triggerSmartPriceCalc = triggerSmartPriceCalc;
window.submitPosPurchase = submitPosPurchase;

// ⚠️ Waste & Damage Exports
window.openWasteModal = openWasteModal;
window.handleWasteBarcodeInput = handleWasteBarcodeInput;
window.searchAndAddWasteItem = searchAndAddWasteItem;
window.selectDropdownWasteItem = selectDropdownWasteItem;
window.changeWasteCartQty = changeWasteCartQty;
window.setWasteCartQty = setWasteCartQty;
window.removeWasteCartItem = removeWasteCartItem;
window.submitPosWaste = submitPosWaste;
window.loadWasteHistory = loadWasteHistory;
window.onSearchWasteDebounced = onSearchWasteDebounced;
window.clearWasteFilter = clearWasteFilter;
window.changeWastePage = changeWastePage;

// ⚙️ Settings Exports
window.openSettingsModal = openSettingsModal;
window.submitPosSettings = submitPosSettings;
window.loadPosSettings = loadPosSettings;

window.openSettlementModal = openSettlementModal;
window.confirmCanteenSettlement = confirmCanteenSettlement;
window.closeModal = closeModal;
window.logoutPos = logoutPos;
window.searchAndAddItem = searchAndAddItem;
window.selectDropdownItem = selectDropdownItem;
window.handleBarcodeInput = handleBarcodeInput;
window.clearCart = clearCart;
window.changeCartQty = changeCartQty;
window.setCartQty = setCartQty;
window.removeCartItem = removeCartItem;
window.setPaymentMode = setPaymentMode;
window.lookupStudentRadar = lookupStudentRadar;
window.executeCheckout = executeCheckout;