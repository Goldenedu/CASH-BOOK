/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN INVENTORY & PURCHASES CONTROLLER
 * File: js/canteen/canteen-inventory.js (Enterprise V9.3 Full Production Edition)
 * 💡 Features:
 *   1. 🕒 Strict MMT (UTC+06:30) Timezone Universal Support
 *   2. 🛒 Purchases Hub Live KPIs: Today, THIS MONTH & All-Time purchase totals
 *   3. 📅 Quick Date Filters: Today & This Month 1-click filter shortcuts
 *   4. 📈 Default 8% Markup on Purchases & Catalog Smart Pricing (50-Step Rounding)
 *   5. 📦 Stock Inventory Auditor with Capital Invariance Harmony
 *   6. 🛡️ Robust Role Security & Defensive Input Validation (Zero-Crash)
 *   7. ⚡ D1 Quota Shield with IndexedDB Offline Persistence (0 Read Overhead)
 *   8. 🛡️ Scope-Safe Helper (Zero 'esc' SyntaxError Guarantee)
 * ==============================================================================
 */

// 🕒 Pure Non-Recursive MMT Date Helper (UTC+06:30)
function getMMTDateString(dInput) {
  if (dInput && typeof dInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dInput.trim())) {
    return dInput.trim();
  }
  const d = dInput ? new Date(dInput) : new Date();
  const targetMs = isNaN(d.getTime()) ? Date.now() : d.getTime();
  const mmt = new Date(targetMs + (6.5 * 60 * 60 * 1000));
  return mmt.toISOString().slice(0, 10);
}

// 🛡️ Standalone Role Normalizer (Loop-Free Guaranteed)
function getNormalizedRole() {
  const raw = String(gSession?.role || localStorage.getItem('golden_user_role') || 'Cashier').trim();
  return raw.toLowerCase().replace(/[\s_-]/g, '');
}

// 🛡️ Scope-Safe Variable Declarations (Prevents Identifier SyntaxError)
var esc = window.esc || (s => s ? String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) : '');
var escAttr = window.escAttr || (s => s ? String(s).replace(/'/g, "\\'") : '');

var gPosCashBookPage = 1, gPosCashBookLimit = 20, gPosCashBookTotalRows = 0, gPcbSearchTimeout = null;
var gPosCashBookData = [];
var gPurModalRowIndex = 0;

// ==============================================================================
// 💰 1. POS CASH BOOK CONTROLLER (ADMIN: JAN-DEC | OTHERS: DAILY ONLY)
// ==============================================================================
function onSearchPosCashBookDebounced() {
  clearTimeout(gPcbSearchTimeout);
  gPcbSearchTimeout = setTimeout(() => loadPosCashBook(1), 250);
}

function clearPosCashBookFilter() {
  const s = document.getElementById('pcb-search'); if (s) s.value = '';
  const df = document.getElementById('pcb-date-from'); if (df) df.value = '';
  const dt = document.getElementById('pcb-date-to'); if (dt) dt.value = '';
  loadPosCashBook(1);
}

function changePosCashBookPage(delta) {
  loadPosCashBook(gPosCashBookPage + delta);
}

async function loadPosCashBook(page = 1) {
  gPosCashBookPage = Math.max(1, page);
  const role = getNormalizedRole();
  const isAdmin = role.includes('admin') || role.includes('owner') || role.includes('finance');

  // Hide date range filter for non-admin roles (Daily view only)
  const filterBox = document.getElementById('pcb-date-filter-box');
  if (filterBox) filterBox.style.display = isAdmin ? 'flex' : 'none';

  const searchVal = document.getElementById('pcb-search')?.value.trim() || '';
  const dateFrom = document.getElementById('pcb-date-from')?.value || '';
  const dateTo = document.getElementById('pcb-date-to')?.value || '';

  try {
    const res = await callApi('getPosCashBookData', {
      searchVal, dateFrom, dateTo, page: gPosCashBookPage, limit: gPosCashBookLimit, _t: Date.now()
    }, 'POST');

    if (res && res.success) {
      gPosCashBookData = res.data || [];
      gPosCashBookTotalRows = res.totalRows || 0;
      const stats = res.stats || {};
      const scopeTag = isAdmin ? `(${res.year || new Date().getFullYear()} Jan-Dec)` : '(Today)';

      document.getElementById('pcb-kpi-label-bank').textContent = `Bank Balance ${scopeTag}`;
      document.getElementById('pcb-kpi-label-cash').textContent = `Cash Balance ${scopeTag}`;
      document.getElementById('pcb-kpi-label-total').textContent = `Total Balance ${scopeTag}`;
      document.getElementById('pcb-kpi-label-entries').textContent = `Total Entries ${scopeTag}`;

      document.getElementById('pcb-bank-balance').textContent = `${Number(stats.bankBalance || 0).toLocaleString()} MMK`;
      document.getElementById('pcb-cash-balance').textContent = `${Number(stats.cashBalance || 0).toLocaleString()} MMK`;
      document.getElementById('pcb-total-balance').textContent = `${Number(stats.totalBalance || 0).toLocaleString()} MMK`;
      document.getElementById('pcb-entries-count').textContent = Number(stats.totalEntries || 0).toLocaleString();

      const tbody = document.getElementById('pcb-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (gPosCashBookData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-slate-500 font-bold">No transactions found.</td></tr>`;
      } else {
        gPosCashBookData.forEach((r, idx) => {
          const displayNo = r.no || (gPosCashBookTotalRows - ((gPosCashBookPage - 1) * gPosCashBookLimit + idx));
          const sd = Number(r.surplusDeficit || 0);
          const sdColor = sd > 0 ? 'text-emerald-400' : (sd < 0 ? 'text-rose-400' : 'text-slate-500');
          const sdText = sd > 0 ? `+${sd.toLocaleString()}` : (sd < 0 ? sd.toLocaleString() : '0');

          tbody.innerHTML += `
            <tr class="hover:bg-slate-800/30 border-b border-slate-800/40">
              <td class="text-center font-mono py-3 px-2 text-slate-400">${displayNo}</td>
              <td class="font-mono py-3 px-2">${esc(r.date)}</td>
              <td class="font-bold text-slate-200 py-3 px-2">${esc(r.category)}</td>
              <td class="py-3 px-2">${esc(r.description)}</td>
              <td class="py-3 px-2 font-bold ${r.method === 'Bank' ? 'text-amber-400' : 'text-emerald-400'}">${esc(r.method)}</td>
              <td class="text-right font-mono font-bold text-emerald-400 py-3 px-2">${r.debit > 0 ? Number(r.debit).toLocaleString() : '-'}</td>
              <td class="text-right font-mono font-bold text-rose-400 py-3 px-2">${r.credit > 0 ? Number(r.credit).toLocaleString() : '-'}</td>
              <td class="text-right font-mono font-bold text-indigo-400 py-3 px-2">${Number(r.balances || 0).toLocaleString()}</td>
              <td class="font-mono text-slate-400 py-3 px-2">${esc(r.ref || r.vrNo || '-')}</td>
              <td class="text-right font-mono font-bold ${sdColor} py-3 px-2">${sdText}</td>
              <td class="text-center py-3 px-2 right-0 sticky bg-[#0c1322] border-l border-slate-800">
                ${isAdmin ? `<button onclick="deletePosCashBookEntry('${escAttr(r.uniqueId)}')" class="text-rose-400 hover:text-rose-300 p-1"><i class="fa-solid fa-trash"></i></button>` : '-'}
              </td>
            </tr>
          `;
        });
      }

      const start = (gPosCashBookPage - 1) * gPosCashBookLimit + 1;
      const end = Math.min(start + gPosCashBookLimit - 1, gPosCashBookTotalRows);
      document.getElementById('pcb-pagination-info').textContent = gPosCashBookTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gPosCashBookTotalRows} entries`;
      document.getElementById('pcb-btn-prev').disabled = (gPosCashBookPage <= 1);
      document.getElementById('pcb-btn-next').disabled = (end >= gPosCashBookTotalRows);
    }
  } catch (err) {
    console.error("POS Cash Book Load Error:", err);
  }
}

function openPosCashBookModal() {
  document.getElementById('pcb-m-date').value = getMMTDateString();
  document.getElementById('pcb-m-debit').value = 0;
  document.getElementById('pcb-m-credit').value = 0;
  document.getElementById('pcb-m-surplus').value = 0;
  document.getElementById('pcb-m-ref').value = '';
  document.getElementById('pcb-m-desc').value = '';
  document.getElementById('pos-cashbook-modal')?.classList.remove('hidden');
}

async function submitPosCashBookForm(e) {
  e.preventDefault();
  const debit = Math.max(0, parseFloat(document.getElementById('pcb-m-debit')?.value || 0));
  const credit = Math.max(0, parseFloat(document.getElementById('pcb-m-credit')?.value || 0));
  const surplusDeficit = parseFloat(document.getElementById('pcb-m-surplus')?.value || 0) || 0;

  if (debit <= 0 && credit <= 0 && surplusDeficit === 0) {
    return showToast("ERROR", "Please enter a valid Debit, Credit, or Surplus/Deficit amount.");
  }

  const payload = {
    date: document.getElementById('pcb-m-date')?.value || getMMTDateString(),
    category: document.getElementById('pcb-m-category')?.value || 'POS Sales',
    method: document.getElementById('pcb-m-method')?.value || 'Cash',
    debit,
    credit,
    surplusDeficit,
    ref: document.getElementById('pcb-m-ref')?.value.trim() || '',
    description: document.getElementById('pcb-m-desc')?.value.trim() || ''
  };

  try {
    const res = await callApi('savePosCashBookEntry', payload);
    if (res && res.success) {
      showToast("SUCCESS", "POS Cash Book entry saved.");
      closeModal('pos-cashbook-modal');
      loadPosCashBook(1);
    } else {
      showToast("ERROR", res?.message || "Failed to save entry.");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}


// ------------------------------------------------------------------------------
// 📦 1. CATALOG PRELOAD & CACHE CONTROLLER (D1 QUOTA-SHIELD)
// ------------------------------------------------------------------------------
async function loadItemsCatalog(isManualRefresh) {
  if (navigator.onLine) {
    try {
      const res = await callApi('getPosItems', { onlyActive: true, _t: Date.now() }, 'POST');
      if (res && res.success) {
        gItemsCache = res.data || [];
        if (typeof dbSaveItems === 'function') {
          await dbSaveItems(gItemsCache);
        }
        if (isManualRefresh) {
          showToast("SUCCESS", `ပစ္စည်း (${gItemsCache.length}) မျိုး အသစ်ရယူပြီးပါပြီ။`);
        }
        return;
      }
    } catch (e) {
      console.warn("[Catalog] Online load failed, falling back to IndexedDB...");
    }
  }

  if (typeof dbGetAllItems === 'function') {
    gItemsCache = await dbGetAllItems();
  }
}

// ------------------------------------------------------------------------------
// 📊 2. REAL-TIME STOCK INVENTORY AUDITOR (PAGINATED 20 ROWS)
// ------------------------------------------------------------------------------
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

      const elTotalItems = document.getElementById('stock-total-items');
      if (elTotalItems) elTotalItems.textContent = `${summary.totalItems || 0} မျိုး`;

      const elTotalQty = document.getElementById('stock-total-qty');
      if (elTotalQty) elTotalQty.textContent = `${Number(summary.totalStockQty || 0).toLocaleString()} ခု`;

      const elTotalVal = document.getElementById('stock-total-val');
      if (elTotalVal) elTotalVal.textContent = `${Number(summary.totalStockValue || 0).toLocaleString()} MMK`;

      const elAlertCount = document.getElementById('stock-alert-count');
      if (elAlertCount) elAlertCount.textContent = `${(summary.outOfStockCount || 0) + (summary.lowStockCount || 0)} မျိုး`;

      const tbody = document.getElementById('stock-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ပစ္စည်း မရှိပါ။</td></tr>`;
      } else {
        const role = getNormalizedRole();
        const canManageStock = role.includes('admin') || role.includes('owner');

        items.forEach((item, idx) => {
          const displayNo = gStockTotalRows - ((gStockPage - 1) * gStockLimit + idx);

          let badgeHtml = '';
          if (item.currentStock <= 0) {
            badgeHtml = '<span class="px-2 py-0.5 rounded text-[9px] font-black bg-rose-500/20 text-rose-500 border border-rose-500/30">OUT OF STOCK</span>';
          } else if (item.currentStock <= 10) {
            badgeHtml = '<span class="px-2 py-0.5 rounded text-[9px] font-black bg-amber-500/20 text-amber-500 border border-amber-500/30">LOW STOCK</span>';
          } else {
            badgeHtml = '<span class="px-2 py-0.5 rounded text-[9px] font-black bg-emerald-500/20 text-emerald-500 border border-emerald-500/30">HEALTHY</span>';
          }

          const actionHtml = canManageStock ? `
            <button onclick="openQuickEditModal('${escAttr(item.barcode)}')" class="p-1.5 text-teal-500 hover:bg-teal-500/10 rounded-lg transition" title="Edit Price & Stock">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
          ` : '<span class="text-slate-400">-</span>';

          tbody.innerHTML += `
            <tr class="hover:bg-slate-500/10 text-xs border-b border-[var(--border-color)]">
              <td class="text-center font-mono py-2.5 px-3 text-slate-400">${displayNo}</td>
              <td class="font-mono text-slate-400 py-2.5 px-3 font-bold">${esc(item.barcode)}</td>
              <td class="font-bold py-2.5 px-3">${esc(item.itemName)}</td>
              <td class="text-slate-400 py-2.5 px-3">${esc(item.category)}</td>
              <td class="text-right font-mono text-slate-400 py-2.5 px-3">${Number(item.costPrice || 0).toLocaleString()}</td>
              <td class="text-right font-mono font-bold text-emerald-500 py-2.5 px-3">${Number(item.sellingPrice || 0).toLocaleString()} MMK</td>
              <td class="text-center font-mono font-black py-2.5 px-3 text-sm ${item.currentStock <= 0 ? 'text-rose-500' : (item.currentStock <= 10 ? 'text-amber-500' : '')}">
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
    console.error("[CanteenInventory] Stock Inventory Load Error:", err);
  }
}

// ------------------------------------------------------------------------------
// 📄 3. STOCK INVENTORY CSV EXPORT (STRICT MMT TIMESTAMP & CAPITAL GUARD)
// ------------------------------------------------------------------------------
async function exportStockInventoryCSV() {
  try {
    const res = await callApi('getPosStockInventory', { page: 1, limit: 1000, _t: Date.now() }, 'POST');
    const items = res?.data || gItemsCache;
    if (!items || items.length === 0) return showToast("ERROR", "ထုတ်ယူရန် Stock စာရင်း မရှိပါ။");

    let csv = "NO,BARCODE,ITEM_NAME,CATEGORY,COST_PRICE,SELLING_PRICE,CURRENT_STOCK,STOCK_VALUE,STATUS\n";
    const safeCell = s => `"${String(s || '').replace(/"/g, '""')}"`;

    items.forEach((item, idx) => {
      let statusText = 'HEALTHY';
      if (item.currentStock <= 0) statusText = 'OUT OF STOCK';
      else if (item.currentStock <= 10) statusText = 'LOW STOCK';

      // 💰 Capital Invariance Formula applied to CSV
      const sValue = item.stockValue !== undefined
        ? item.stockValue
        : (Number(item.costPrice || 0) * Math.max(0, Number(item.currentStock || 0) - Number(item.surplusStock || 0)));

      csv += `${idx + 1},${safeCell(item.barcode)},${safeCell(item.itemName)},${safeCell(item.category)},${item.costPrice || 0},${item.sellingPrice || 0},${item.currentStock || 0},${sValue},${safeCell(statusText)}\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Canteen_Stock_Inventory_${getMMTDateString()}.csv`;
    a.click();
    showToast("SUCCESS", "Stock စာရင်း CSV ထုတ်ယူမှု အောင်မြင်ပါသည်။");
  } catch (err) {
    showToast("ERROR", "CSV ထုတ်ယူရာတွင် အမှားဖြစ်ပေါ်ခဲ့သည်: " + err.message);
  }
}

// ------------------------------------------------------------------------------
// ✏️ 4. QUICK STOCK & PRICE EDIT (ADMIN ONLY)
// ------------------------------------------------------------------------------
function openQuickEditModal(barcode) {
  const role = getNormalizedRole();
  if (role === 'canteencashier' || role === 'cashier') {
    return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် လက်ကျန်စာရင်းအား တိုက်ရိုက်ပြင်ဆင်ခွင့် မရှိပါ။ Admin ထံ တင်ပြပါ။");
  }

  const item = gItemsCache.find(it => it.barcode === barcode) || gStockInventoryData.find(it => it.barcode === barcode);
  if (!item) return;

  const elName = document.getElementById('qe-item-name');
  if (elName) elName.textContent = item.itemName;

  const elBarcode = document.getElementById('qe-barcode');
  if (elBarcode) elBarcode.textContent = item.barcode;

  const elStock = document.getElementById('qe-stock');
  if (elStock) elStock.value = item.currentStock || 0;

  const elCost = document.getElementById('qe-cost');
  if (elCost) elCost.value = item.costPrice || 0;

  const elPrice = document.getElementById('qe-price');
  if (elPrice) elPrice.value = item.sellingPrice || 0;

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

// ------------------------------------------------------------------------------
// 🛒 5. PURCHASES AUDITOR WITH LIVE KPIS & QUICK DATE SHORTCUTS
// ------------------------------------------------------------------------------
function setFilterPurchasesToday() {
  const today = getMMTDateString();
  const dFrom = document.getElementById('pur-date-from');
  const dTo = document.getElementById('pur-date-to');
  if (dFrom) dFrom.value = today;
  if (dTo) dTo.value = today;
  loadPurchasesHistory(1);
}

// 🎯 NEW: 1-Click "This Month" Filter Shortcut
function setFilterPurchasesThisMonth() {
  const today = getMMTDateString();
  const monthPrefix = today.slice(0, 7);
  const monthStart = `${monthPrefix}-01`;
  const [y, m] = monthPrefix.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const monthEnd = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

  const dFrom = document.getElementById('pur-date-from');
  const dTo = document.getElementById('pur-date-to');
  if (dFrom) dFrom.value = monthStart;
  if (dTo) dTo.value = monthEnd;
  loadPurchasesHistory(1);
}

function onSearchPurchasesDebounced() {
  clearTimeout(gPurSearchTimeout);
  gPurSearchTimeout = setTimeout(() => { loadPurchasesHistory(1); }, 250);
}

function clearPurchasesFilter() {
  const sInput = document.getElementById('pur-search');
  if (sInput) sInput.value = '';

  const sFilter = document.getElementById('pur-supplier-filter');
  if (sFilter) sFilter.value = '';

  const dFrom = document.getElementById('pur-date-from');
  if (dFrom) dFrom.value = '';

  const dTo = document.getElementById('pur-date-to');
  if (dTo) dTo.value = '';

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

      // 1. Render Top 4 ERP KPIs (Today Purchase, Monthly Purchase, Total Purchase, Stocks Balance)
      const kpiToday = document.getElementById('pur-kpi-today');
      if (kpiToday) kpiToday.textContent = `${Number(res.todayPurchasesTotal || 0).toLocaleString()} MMK`;

      const kpiMonth = document.getElementById('pur-kpi-month');
      if (kpiMonth) kpiMonth.textContent = `${Number(res.thisMonthPurchasesTotal || 0).toLocaleString()} MMK`;

      const kpiAll = document.getElementById('pur-kpi-all');
      if (kpiAll) kpiAll.textContent = `${Number(res.allTimePurchasesTotal || 0).toLocaleString()} MMK`;

      const kpiStockBal = document.getElementById('pur-kpi-stock-bal');
      if (kpiStockBal) kpiStockBal.textContent = `${Number(res.stocksBalanceTotal || 0).toLocaleString()} MMK`;

      // 2. Render 17-Column Table
      const tbody = document.getElementById('pur-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="18" class="text-center py-8 text-slate-500 font-bold">No purchase records found.</td></tr>`;
      } else {
        const role = getNormalizedRole();
        const canManagePurchases = role.includes('admin') || role.includes('owner') || role.includes('finance');

        records.forEach((r, idx) => {
          const displayNo = r.no || (gPurchasesTotalRows - ((gPurchasesPage - 1) * gPurchasesLimit + idx));

          const actionHtml = canManagePurchases ? `
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="openEditPurchaseModal('${escAttr(r.id)}')" class="p-1 text-indigo-400 hover:text-indigo-300 transition" title="Edit">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button onclick="deletePurchaseEntry('${escAttr(r.id)}', '${escAttr(r.purchaseNo)}')" class="p-1 text-rose-400 hover:text-rose-300 transition" title="Delete">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          ` : '<span class="text-slate-500">-</span>';

          tbody.innerHTML += `
            <tr class="hover:bg-slate-800/30 border-b border-slate-800/40">
              <td class="text-center font-mono py-3 px-2 text-slate-400">${displayNo}</td>
              <td class="font-mono font-bold text-slate-300 py-3 px-2">${esc(r.barcode)}</td>
              <td class="py-3 px-2 text-slate-300">${esc(r.category || 'Snack')}</td>
              <td class="font-bold text-white py-3 px-2">${esc(r.itemName)}</td>
              <td class="py-3 px-2 font-bold ${r.method === 'Bank' ? 'text-amber-400' : 'text-emerald-400'}">${esc(r.method || 'Cash')}</td>
              <td class="text-right font-mono font-bold py-3 px-2">${Number(r.qty || 0).toLocaleString()}</td>
              <td class="text-right font-mono text-slate-300 py-3 px-2">${Number(r.costPrice || 0).toLocaleString()}</td>
              <td class="text-right font-mono font-bold text-amber-400 py-3 px-2">${Number(r.totalCost || 0).toLocaleString()}</td>
              <td class="text-right font-mono font-bold text-emerald-400 py-3 px-2">${Number(r.sellingPrice || 0).toLocaleString()}</td>
              <td class="text-right font-mono font-bold text-sky-400 py-3 px-2">${Number(r.wholesalePrice || 0).toLocaleString()}</td>
              <td class="py-3 px-2 text-slate-200">${esc(r.supplierName || '-')}</td>
              <td class="py-3 px-2 text-slate-300">${esc(r.shopName || '-')}</td>
              <td class="font-mono py-3 px-2 text-slate-400">${esc(r.supplierPhone || '-')}</td>
              <td class="py-3 px-2 text-slate-400 truncate max-w-[160px]" title="${esc(r.supplierAddress)}">${esc(r.supplierAddress || '-')}</td>
              <td class="font-mono py-3 px-2 text-slate-400">${esc(r.ref || '-')}</td>
              <td class="font-mono font-bold text-indigo-300 py-3 px-2">${esc(r.voucherNo || r.purchaseNo)}</td>
              <td class="py-3 px-2 text-slate-400 truncate max-w-[160px]" title="${esc(r.remark)}">${esc(r.remark || '-')}</td>
              <td class="text-center py-3 px-2 right-0 sticky bg-[#0c1322] border-l border-slate-800">${actionHtml}</td>
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
    console.error("[CanteenInventory] Purchases History Load Error:", err);
  }
}

// ------------------------------------------------------------------------------
// 🎯 6. SMART PRICING CALCULATOR (DEFAULT 8% MARKUP, 50-STEP ROUNDING)
// ------------------------------------------------------------------------------
function triggerSmartPriceCalc() {
  const cost = parseFloat(document.getElementById('m-cost-price')?.value || 0);
  const markupInput = document.getElementById('m-markup-percent');
  const markup = parseFloat(markupInput?.value !== undefined && markupInput.value !== '' ? markupInput.value : 8);

  if (cost <= 0) {
    const elSug = document.getElementById('m-suggested-price');
    if (elSug) elSug.textContent = '0 MMK';
    return;
  }

  const rawPrice = cost * (1 + markup / 100);
  const rounded = Math.ceil(rawPrice / 50) * 50;

  const elSug = document.getElementById('m-suggested-price');
  if (elSug) elSug.textContent = `${rounded.toLocaleString()} MMK`;

  const sellingInput = document.getElementById('m-selling-price');
  if (sellingInput) sellingInput.value = rounded;
}

// ------------------------------------------------------------------------------
// 📄 CSV EXPORTERS & DELETE HELPERS FOR POS CASH BOOK & PURCHASES
// ------------------------------------------------------------------------------
async function deletePosCashBookEntry(uniqueId) {
  if (!confirm("Are you sure you want to delete this POS Cash Book entry?")) return;
  try {
    const res = await callApi('deletePosCashBookEntry', { uniqueId });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "Entry deleted.");
      loadPosCashBook(gPosCashBookPage);
    } else {
      showToast("ERROR", res?.message || "Failed to delete entry.");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

async function exportPosCashBookCSV() {
  try {
    const res = await callApi('getPosCashBookData', { page: 1, limit: 5000, _t: Date.now() }, 'POST');
    const rows = res?.data || gPosCashBookData;
    if (!rows || rows.length === 0) return showToast("ERROR", "No records to export.");

    let csv = "NO,DATE,CATEGORY,DESCRIPTION,METHOD,DEBIT,CREDIT,BALANCE,REF,SURPLUS_DEFICIT\n";
    const safeCell = s => `"${String(s || '').replace(/"/g, '""')}"`;

    rows.forEach((r, idx) => {
      csv += `${r.no || (idx + 1)},${safeCell(r.date)},${safeCell(r.category)},${safeCell(r.description)},${safeCell(r.method)},${r.debit || 0},${r.credit || 0},${r.balances || 0},${safeCell(r.ref || r.vrNo)},${r.surplusDeficit || 0}\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `POS_Cash_Book_${getMMTDateString()}.csv`;
    a.click();
    showToast("SUCCESS", "POS Cash Book CSV exported.");
  } catch (err) {
    showToast("ERROR", "CSV Export failed: " + err.message);
  }
}

function openItemModal() {
  document.getElementById('m-pur-date').value = getMMTDateString();
  document.getElementById('m-pur-method').value = 'Cash';
  document.getElementById('m-pur-ref').value = '';
  document.getElementById('m-sup-name').value = '';
  document.getElementById('m-shop-name').value = '';
  document.getElementById('m-sup-phone').value = '';
  document.getElementById('m-sup-address').value = '';
  document.getElementById('m-pur-remark').value = '';
  document.getElementById('m-pur-calc-total').value = '0';
  document.getElementById('m-pur-voucher-amt').value = '';
  document.getElementById('m-pur-diff').value = '0';

  const tbody = document.getElementById('m-pur-items-tbody');
  if (tbody) tbody.innerHTML = '';
  gPurModalRowIndex = 0;
  addPurchaseItemRow(); // Start with 1 row
  loadSuppliersList();
  document.getElementById('pos-item-modal')?.classList.remove('hidden');
}

function onSelectPurchaseSupplier() {
  const supId = document.getElementById('m-supplier-id')?.value;
  const sup = gSuppliersCache.find(s => String(s.id) === String(supId));
  if (sup) {
    document.getElementById('m-sup-name').value = sup.contactPerson || sup.supplierName || '';
    document.getElementById('m-shop-name').value = sup.shopName || sup.supplierName || '';
    document.getElementById('m-sup-phone').value = sup.phoneNo || '';
    document.getElementById('m-sup-address').value = sup.address || '';
  }
}

function addPurchaseItemRow() {
  const tbody = document.getElementById('m-pur-items-tbody');
  if (!tbody) return;
  gPurModalRowIndex++;
  const idx = gPurModalRowIndex;

  const tr = document.createElement('tr');
  tr.id = `pur-row-${idx}`;
  tr.className = "hover:bg-slate-800/30 text-xs";
  tr.innerHTML = `
    <td class="p-2 text-center font-mono text-slate-400">${tbody.children.length + 1}</td>
    <td class="p-2"><input type="text" id="pr-bar-${idx}" required placeholder="Barcode" oninput="onPurRowBarcode(${idx})" class="w-full bg-[#0f172a] border border-slate-700 rounded p-1.5 font-mono text-white"></td>
    <td class="p-2">
      <select id="pr-cat-${idx}" class="w-full bg-[#0f172a] border border-slate-700 rounded p-1.5 text-white">
        <option value="Snack">Snack</option>
        <option value="Drink">Drink</option>
        <option value="Meal">Meal</option>
        <option value="Stationery">Stationery</option>
      </select>
    </td>
    <td class="p-2"><input type="text" id="pr-name-${idx}" required placeholder="Item Name" class="w-full bg-[#0f172a] border border-slate-700 rounded p-1.5 text-white"></td>
    <td class="p-2"><input type="number" id="pr-qty-${idx}" min="1" step="any" value="1" required oninput="onPurRowCalc(${idx})" class="w-full bg-[#0f172a] border border-slate-700 rounded p-1.5 text-right font-mono text-white"></td>
    <td class="p-2"><input type="number" id="pr-cost-${idx}" min="0" step="any" value="0" required oninput="onPurRowCalc(${idx})" class="w-full bg-[#0f172a] border border-slate-700 rounded p-1.5 text-right font-mono text-white"></td>
    <td class="p-2"><input type="text" id="pr-amt-${idx}" readonly value="0" class="w-full bg-[#080e1c] border border-slate-800 rounded p-1.5 text-right font-mono font-bold text-amber-400"></td>
    <td class="p-2"><input type="number" id="pr-rmk-${idx}" min="0" step="any" value="8" oninput="onPurRowCalc(${idx})" class="w-full bg-[#0f172a] border border-slate-700 rounded p-1.5 text-center font-mono text-emerald-400"></td>
    <td class="p-2"><input type="number" id="pr-rpr-${idx}" min="0" step="any" value="0" required class="w-full bg-[#0f172a] border border-emerald-500/40 rounded p-1.5 text-right font-mono font-bold text-emerald-400"></td>
    <td class="p-2"><input type="number" id="pr-wmk-${idx}" min="0" step="any" value="5" oninput="onPurRowCalc(${idx})" class="w-full bg-[#0f172a] border border-slate-700 rounded p-1.5 text-center font-mono text-sky-400"></td>
    <td class="p-2"><input type="number" id="pr-wpr-${idx}" min="0" step="any" value="0" required class="w-full bg-[#0f172a] border border-sky-500/40 rounded p-1.5 text-right font-mono font-bold text-sky-400"></td>
    <td class="p-2 text-center">
      <button type="button" onclick="removePurchaseItemRow(${idx})" class="text-rose-400 hover:text-rose-300 p-1"><i class="fa-solid fa-trash-can"></i></button>
    </td>
  `;
  tbody.appendChild(tr);
}

function removePurchaseItemRow(idx) {
  const tbody = document.getElementById('m-pur-items-tbody');
  if (tbody && tbody.children.length > 1) {
    document.getElementById(`pur-row-${idx}`)?.remove();
    calcPurchaseVoucherTotals();
  }
}

function onPurRowBarcode(idx) {
  const bCode = document.getElementById(`pr-bar-${idx}`)?.value.trim();
  const existing = gItemsCache.find(it => it.barcode === bCode);
  if (existing) {
    document.getElementById(`pr-name-${idx}`).value = existing.itemName || '';
    document.getElementById(`pr-cat-${idx}`).value = existing.category || 'Snack';
    document.getElementById(`pr-cost-${idx}`).value = existing.costPrice || 0;
    onPurRowCalc(idx);
  }
}

function onPurRowCalc(idx) {
  const qty = Math.max(0, parseFloat(document.getElementById(`pr-qty-${idx}`)?.value || 0));
  const cost = Math.max(0, parseFloat(document.getElementById(`pr-cost-${idx}`)?.value || 0));
  const rMarkup = Math.max(0, parseFloat(document.getElementById(`pr-rmk-${idx}`)?.value || 0));
  const wMarkup = Math.max(0, parseFloat(document.getElementById(`pr-wmk-${idx}`)?.value || 0));

  const amt = Math.round(qty * cost * 100) / 100;
  document.getElementById(`pr-amt-${idx}`).value = amt;

  if (cost > 0) {
    const rRounded = Math.ceil((cost * (1 + rMarkup / 100)) / 50) * 50;
    const wRounded = Math.ceil((cost * (1 + wMarkup / 100)) / 50) * 50;
    document.getElementById(`pr-rpr-${idx}`).value = rRounded;
    document.getElementById(`pr-wpr-${idx}`).value = wRounded;
  }
  calcPurchaseVoucherTotals();
}

function calcPurchaseVoucherTotals() {
  const tbody = document.getElementById('m-pur-items-tbody');
  let calcTotal = 0;
  if (tbody) {
    Array.from(tbody.children).forEach(tr => {
      const idx = tr.id.replace('pur-row-', '');
      calcTotal += parseFloat(document.getElementById(`pr-amt-${idx}`)?.value || 0);
    });
  }
  calcTotal = Math.round(calcTotal * 100) / 100;
  document.getElementById('m-pur-calc-total').value = calcTotal.toLocaleString();

  const voucherInput = document.getElementById('m-pur-voucher-amt');
  const voucherAmt = voucherInput.value !== '' ? parseFloat(voucherInput.value) : calcTotal;
  const diff = Math.round((calcTotal - voucherAmt) * 100) / 100; // Positive = Surplus (Discount received), Negative = Deficit

  const diffEl = document.getElementById('m-pur-diff');
  diffEl.value = (diff > 0 ? `+${diff}` : diff);
}

function lookupExistingBarcode() {
  const bCode = document.getElementById('m-barcode')?.value.trim();
  if (!bCode) return;

  const existing = gItemsCache.find(it => it.barcode === bCode);
  if (existing) {
    const elName = document.getElementById('m-item-name');
    if (elName) elName.value = existing.itemName;

    const elCat = document.getElementById('m-category');
    if (elCat) elCat.value = existing.category || 'Snack';

    const elCost = document.getElementById('m-cost-price');
    if (elCost) elCost.value = existing.costPrice;

    const elMarkup = document.getElementById('m-markup-percent');
    if (elMarkup) elMarkup.value = existing.markupPercent !== undefined ? existing.markupPercent : 8;

    triggerSmartPriceCalc();
  }
}

async function submitPosPurchase(e) {
  if (e && e.preventDefault) e.preventDefault();

  const tbody = document.getElementById('m-pur-items-tbody');
  if (!tbody || tbody.children.length === 0) {
    return showToast("ERROR", "Please add at least 1 item row.");
  }

  const items = [];
  let calcTotal = 0;

  Array.from(tbody.children).forEach(tr => {
    const idx = tr.id.replace('pur-row-', '');
    const barcode = document.getElementById(`pr-bar-${idx}`)?.value.trim() || '';
    const category = document.getElementById(`pr-cat-${idx}`)?.value || 'Snack';
    const itemName = document.getElementById(`pr-name-${idx}`)?.value.trim() || '';
    const qty = parseFloat(document.getElementById(`pr-qty-${idx}`)?.value || 0);
    const costPrice = parseFloat(document.getElementById(`pr-cost-${idx}`)?.value || 0);
    const markupPercent = parseFloat(document.getElementById(`pr-rmk-${idx}`)?.value || 8);
    const sellingPrice = parseFloat(document.getElementById(`pr-rpr-${idx}`)?.value || 0);
    const wholesaleMarkup = parseFloat(document.getElementById(`pr-wmk-${idx}`)?.value || 5);
    const wholesalePrice = parseFloat(document.getElementById(`pr-wpr-${idx}`)?.value || 0);

    if (barcode && itemName && qty > 0 && costPrice > 0) {
      calcTotal += (qty * costPrice);
      items.push({
        barcode,
        category,
        itemName,
        qty,
        costPrice,
        markupPercent,
        sellingPrice,
        wholesaleMarkup,
        wholesalePrice
      });
    }
  });

  if (items.length === 0) {
    return showToast("ERROR", "Please enter valid Barcode, Item Name, Qty (>0), and Buy Price (>0).");
  }

  calcTotal = Math.round(calcTotal * 100) / 100;
  const voucherAmtInput = document.getElementById('m-pur-voucher-amt')?.value;
  const voucherAmount = (voucherAmtInput !== undefined && voucherAmtInput !== '') ? parseFloat(voucherAmtInput) : calcTotal;
  const surplusDeficit = Math.round((calcTotal - voucherAmount) * 100) / 100;

  const payload = {
    date: document.getElementById('m-pur-date')?.value || getMMTDateString(),
    method: document.getElementById('m-pur-method')?.value || 'Cash',
    ref: document.getElementById('m-pur-ref')?.value.trim() || '',
    supplierId: parseInt(document.getElementById('m-supplier-id')?.value, 10) || null,
    supplierName: document.getElementById('m-sup-name')?.value.trim() || '',
    shopName: document.getElementById('m-shop-name')?.value.trim() || '',
    phoneNo: document.getElementById('m-sup-phone')?.value.trim() || '',
    address: document.getElementById('m-sup-address')?.value.trim() || '',
    remark: document.getElementById('m-pur-remark')?.value.trim() || '',
    voucherAmount,
    surplusDeficit,
    items
  };

  try {
    const res = await callApi('savePosPurchase', payload);
    if (res && res.success) {
      showToast("SUCCESS", res.message || `Voucher (${res.voucherNo}) saved & posted to POS Cash Book.`);
      closeModal('pos-item-modal');
      await Promise.all([
        loadItemsCatalog(false),
        loadPurchasesHistory(1),
        loadStockInventory(1),
        loadPosCashBook(1),
        loadCanteenDashboard()
      ]);
    } else {
      showToast("ERROR", res?.message || "Failed to save purchase voucher.");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// ------------------------------------------------------------------------------
// ✏️ 7. EDIT PURCHASE ENTRY (DEFAULT 8% MARKUP & ADMIN CONTROLLED)
// ------------------------------------------------------------------------------
function openEditPurchaseModal(id) {
  const role = getNormalizedRole();
  if (role === 'canteencashier' || role === 'cashier') {
    return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် အဝယ်စာရင်းဟောင်းများအား ပြင်ဆင်ခွင့် မရှိပါ။ Admin ထံ တင်ပြပါ။");
  }

  const item = gPurchasesData.find(p => String(p.id) === String(id));
  if (!item) return showToast("ERROR", "အဝယ်စာရင်း အချက်အလက် မတွေ့ပါ။");

  const elId = document.getElementById('edit-pur-id');
  if (elId) elId.value = item.id;

  const elNo = document.getElementById('edit-pur-no');
  if (elNo) elNo.textContent = item.purchaseNo;

  const elName = document.getElementById('edit-pur-item-name');
  if (elName) elName.textContent = `${item.itemName} (${item.barcode})`;

  const elDate = document.getElementById('edit-pur-date');
  if (elDate) elDate.value = item.date;

  const supSelect = document.getElementById('edit-pur-supplier');
  if (supSelect) supSelect.value = item.supplierId || '';

  const elQty = document.getElementById('edit-pur-qty');
  if (elQty) elQty.value = item.qty;

  const elCost = document.getElementById('edit-pur-cost');
  if (elCost) elCost.value = item.costPrice;

  // 🎯 Default 8% Markup
  const elMarkup = document.getElementById('edit-pur-markup');
  if (elMarkup) elMarkup.value = item.markupPercent !== undefined ? item.markupPercent : 8;

  const elSelling = document.getElementById('edit-pur-selling');
  if (elSelling) elSelling.value = item.sellingPrice;

  const elRemark = document.getElementById('edit-pur-remark');
  if (elRemark) elRemark.value = item.remark || '';

  document.getElementById('pos-edit-purchase-modal')?.classList.remove('hidden');
}

function triggerEditPurSmartPriceCalc() {
  const cost = parseFloat(document.getElementById('edit-pur-cost')?.value || 0);
  const markupInput = document.getElementById('edit-pur-markup');
  const markup = parseFloat(markupInput?.value !== undefined && markupInput.value !== '' ? markupInput.value : 8);

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

  const markupInput = document.getElementById('edit-pur-markup');
  const markupPercent = parseFloat(markupInput?.value !== undefined && markupInput.value !== '' ? markupInput.value : 8);
  const sellingPrice = parseFloat(document.getElementById('edit-pur-selling')?.value || 0);
  const remark = document.getElementById('edit-pur-remark')?.value.trim();

  try {
    const res = await callApi('updatePosPurchase', { id, purchaseNo, date, supplierId, qty, costPrice, markupPercent, sellingPrice, remark });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အဝယ်စာရင်း ပြင်ဆင်ပြီးပါပြီ။");
      closeModal('pos-edit-purchase-modal');
      await Promise.all([loadPurchasesHistory(gPurchasesPage), loadItemsCatalog(false), loadStockInventory(gStockPage)]);
    } else {
      showToast("ERROR", res?.message || "ပြင်ဆင်မှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

async function deletePurchaseEntry(id, purchaseNo) {
  const role = getNormalizedRole();
  if (role === 'canteencashier' || role === 'cashier') {
    return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် အဝယ်စာရင်းဟောင်းများအား ဖျက်သိမ်းခွင့် မရှိပါ။ Admin ထံ တင်ပြပါ။");
  }

  if (!confirm(`အဝယ်ဘောက်ချာ (${purchaseNo}) အား ဖျက်သိမ်းမည်မှာ သေချာပါသလား?\n\nသတိပြုရန်: စတော့လက်ကျန်ထဲမှ ဝယ်ယူထားသော အရေအတွက်ကို အလိုအလျောက် ပြန်လည်နုတ်ယူပါမည်။`)) {
    return;
  }

  try {
    const res = await callApi('deletePosPurchase', { id: parseInt(id, 10), purchaseNo });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အဝယ်စာရင်း ဖျက်သိမ်းပြီးပါပြီ။");
      await Promise.all([loadPurchasesHistory(gPurchasesPage), loadItemsCatalog(false), loadStockInventory(gStockPage)]);
    } else {
      showToast("ERROR", res?.message || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// ------------------------------------------------------------------------------
// 🏢 8. SUPPLIERS MASTER CONTROLLER
// ------------------------------------------------------------------------------
async function loadSuppliersList() {
  try {
    const res = await callApi('getPosSuppliers', { _t: Date.now() }, 'POST');
    if (res && res.success) {
      gSuppliersCache = res.data || [];
      const filterSelect = document.getElementById('pur-supplier-filter');
      const modalSelect = document.getElementById('m-supplier-id');
      const editPurSupplier = document.getElementById('edit-pur-supplier');

      const options = gSuppliersCache.map(s => `<option value="${s.id}">${esc(s.supplierName)}${s.phoneNo ? ' (' + esc(s.phoneNo) + ')' : ''}</option>`).join('');

      if (filterSelect) filterSelect.innerHTML = `<option value="">All Suppliers (ကုန်သည်အားလုံး)</option>` + options;
      if (modalSelect) modalSelect.innerHTML = `<option value="">-- ရွေးချယ်ပါ (အထွေထွေ) --</option>` + options;
      if (editPurSupplier) editPurSupplier.innerHTML = `<option value="">-- ရွေးချယ်ပါ (အထွေထွေ) --</option>` + options;
    }
  } catch (e) {
    console.warn("[Suppliers] Failed to load suppliers list:", e.message);
  }
}

function openSupplierModal() {
  const elName = document.getElementById('sup-name');
  if (elName) elName.value = '';

  const elContact = document.getElementById('sup-contact');
  if (elContact) elContact.value = '';

  const elPhone = document.getElementById('sup-phone');
  if (elPhone) elPhone.value = '';

  const elAddress = document.getElementById('sup-address');
  if (elAddress) elAddress.value = '';

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

async function exportPurchasesCSV() {
  try {
    const res = await callApi('getPosPurchasesHistory', { page: 1, limit: 5000, _t: Date.now() }, 'POST');
    const rows = res?.data || gPurchasesData;
    if (!rows || rows.length === 0) return showToast("ERROR", "No purchase records to export.");

    let csv = "NO,BARCODE,CATEGORY,ITEM_NAME,METHOD,QTY,PRICE,AMOUNT,RETAIL_PRICE,WHOLESALE_PRICE,SUPPLIER_NAME,SHOP_NAME,PH_NO,ADDRESS,REF,VOUCHER_NO,REMARK\n";
    const safeCell = s => `"${String(s || '').replace(/"/g, '""')}"`;

    rows.forEach((r, idx) => {
      csv += `${r.no || (idx + 1)},${safeCell(r.barcode)},${safeCell(r.category)},${safeCell(r.itemName)},${safeCell(r.method)},${r.qty || 0},${r.costPrice || 0},${r.totalCost || 0},${r.sellingPrice || 0},${r.wholesalePrice || 0},${safeCell(r.supplierName)},${safeCell(r.shopName)},${safeCell(r.supplierPhone)},${safeCell(r.supplierAddress)},${safeCell(r.ref)},${safeCell(r.voucherNo)},${safeCell(r.remark)}\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `POS_Purchases_${getMMTDateString()}.csv`;
    a.click();
    showToast("SUCCESS", "Purchases CSV exported.");
  } catch (err) {
    showToast("ERROR", "CSV Export failed: " + err.message);
  }
}

// Window Exports (Add to bottom of canteen-inventory.js)
window.loadPosCashBook = loadPosCashBook;
window.onSearchPosCashBookDebounced = onSearchPosCashBookDebounced;
window.clearPosCashBookFilter = clearPosCashBookFilter;
window.changePosCashBookPage = changePosCashBookPage;
window.openPosCashBookModal = openPosCashBookModal;
window.submitPosCashBookForm = submitPosCashBookForm;
window.deletePosCashBookEntry = deletePosCashBookEntry;
window.exportPosCashBookCSV = exportPosCashBookCSV;

window.onSelectPurchaseSupplier = onSelectPurchaseSupplier;
window.addPurchaseItemRow = addPurchaseItemRow;
window.removePurchaseItemRow = removePurchaseItemRow;
window.onPurRowBarcode = onPurRowBarcode;
window.onPurRowCalc = onPurRowCalc;
window.calcPurchaseVoucherTotals = calcPurchaseVoucherTotals;
window.exportPurchasesCSV = exportPurchasesCSV;

// ------------------------------------------------------------------------------
// 🌐 9. WINDOW GLOBAL EXPORTS
// ------------------------------------------------------------------------------
window.loadItemsCatalog = loadItemsCatalog;
window.loadStockInventory = loadStockInventory;
window.onSearchStockDebounced = onSearchStockDebounced;
window.changeStockPage = changeStockPage;
window.exportStockInventoryCSV = exportStockInventoryCSV;
window.openQuickEditModal = openQuickEditModal;
window.submitQuickEdit = submitQuickEdit;
window.setFilterPurchasesToday = setFilterPurchasesToday;
window.setFilterPurchasesThisMonth = setFilterPurchasesThisMonth;
window.loadPurchasesHistory = loadPurchasesHistory;
window.onSearchPurchasesDebounced = onSearchPurchasesDebounced;
window.clearPurchasesFilter = clearPurchasesFilter;
window.changePurchasesPage = changePurchasesPage;
window.triggerSmartPriceCalc = triggerSmartPriceCalc;
window.openItemModal = openItemModal;
window.lookupExistingBarcode = lookupExistingBarcode;
window.submitPosPurchase = submitPosPurchase;
window.openEditPurchaseModal = openEditPurchaseModal;
window.triggerEditPurSmartPriceCalc = triggerEditPurSmartPriceCalc;
window.submitEditPurchase = submitEditPurchase;
window.deletePurchaseEntry = deletePurchaseEntry;
window.loadSuppliersList = loadSuppliersList;
window.openSupplierModal = openSupplierModal;
window.submitNewSupplier = submitNewSupplier;