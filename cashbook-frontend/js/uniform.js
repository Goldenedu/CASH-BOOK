/**
 * GOLDEN ERP SYSTEM - UNIFORM INVENTORY LEDGER MODULE (D1 DATABASE COMPATIBLE)
 * File: js/uniform.js 
 * 💡 Features: Live Cloudflare D1 SQL Sync, Auto PID Generator, Profit & Stock Value Computation, Integer NO & Real-Time Sync
 */

window.UniformState = {
  page: 1,
  limit: 30,
  totalRows: 0,
  activeData: [],
  searchVal: '',
  stats: { sellingUnit: 0, currentQty: 0, totalStockValue: 0, totalProduct: 0 }
};

var searchTimeoutUniform = null;
var isUniformSubmitting = false; // 💡 Double Submit Protection Flag

/**
 * 💡 Safe Native DOM HTML Escaper
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof window.escapeHtml === 'function' && window.escapeHtml !== escapeHtml) {
    return window.escapeHtml(str);
  }
  var div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * 💡 Safe escaper for values injected into inline onclick="...('VALUE')" handlers.
 * Escapes backslashes/quotes for the JS string literal, then HTML-escapes the
 * result so it can't break out of the surrounding double-quoted HTML attribute.
 */
function escapeJsAttr(str) {
  if (str === null || str === undefined) return '';
  var jsEscaped = String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return escapeHtml(jsEscaped);
}

/**
 * 💡 Strict Search Filter Function for Uniform Ledger
 */
function filterUniformData(list = [], searchVal = '') {
  if (!searchVal || !searchVal.trim()) return list;
  const q = searchVal.trim().toLowerCase();

  return list.filter(row => {
    const pidMatch = String(row.product_id || row.productId || '').toLowerCase().includes(q);
    const nameMatch = String(row.product_name || row.productName || '').toLowerCase().includes(q);
    const typeMatch = String(row.type || '').toLowerCase().includes(q);
    const sizeMatch = String(row.size || '').toLowerCase().includes(q);

    return pidMatch || nameMatch || typeMatch || sizeMatch;
  });
}

/**
 * 💡 Load Uniform Inventory Data from Cloudflare D1 Backend
 */
async function loadUniformData(isSilent = false) {
  if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);

  const state = window.UniformState;

  try {
    const response = await callApi('getUniformData', {
      page: state.page,
      limit: state.limit,
      searchVal: state.searchVal,
      forceRefresh: true
    }, 'GET');

    if (response && response.data) {
      state.activeData = response.data;
      state.totalRows = response.totalRows || response.data.length || 0;

      let sUnit = 0;
      let cQty = 0;
      let stockVal = 0;

      response.data.forEach(item => {
        sUnit += Number(item.selling_unit ?? item.sellingUnit ?? 0);
        cQty += Number(item.current_qty ?? item.currentQty ?? 0);
        stockVal += Number(item.total_stock_value ?? item.totalStockValue ?? 0);
      });

      state.stats = {
        sellingUnit: sUnit,
        currentQty: cQty,
        totalStockValue: stockVal,
        totalProduct: response.data.length
      };

      updateStatsUniform();
      renderUniformTable();
      updatePaginationUniform();
    }
  } catch (err) {
    console.error("Error loading Uniform data:", err);
    if (!isSilent && typeof showToast === 'function') {
      showToast("ERROR", "ယူနီဖောင်း စာရင်းများ ရယူ၍ မရပါ: " + err.message);
    }
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function updateStatsUniform() {
  const stats = window.UniformState.stats;

  const sUnitEl = document.getElementById('uni-selling-unit');
  if (sUnitEl) sUnitEl.innerText = Number(stats.sellingUnit || 0).toLocaleString('en-US');

  const cQtyEl = document.getElementById('uni-current-qty');
  if (cQtyEl) cQtyEl.innerText = Number(stats.currentQty || 0).toLocaleString('en-US');

  const valEl = document.getElementById('uni-stock-value');
  if (valEl) valEl.innerText = Number(stats.totalStockValue || 0).toLocaleString('en-US') + " MMK";

  const countEl = document.getElementById('uni-total-products');
  if (countEl) countEl.innerText = window.UniformState.totalRows.toLocaleString('en-US');
}

/**
 * 💡 Render Table Grid Rows with Live Calculations
 */
function renderUniformTable() {
  const tableBody = document.getElementById('uniform-table-body');
  if (!tableBody) return;

  const rawData = window.UniformState.activeData || [];
  const searchInput = document.getElementById('uniform-search');
  const searchVal = searchInput ? searchInput.value.trim() : (window.UniformState.searchVal || '');

  const data = filterUniformData(rawData, searchVal);

  if (!data || data.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ယူနီဖောင်း ပစ္စည်း မရှိပါ။</td></tr>`;
    return;
  }

  const isViewer = (window.AppState ? window.AppState.currentUserRole : '') === "Viewer";

  tableBody.innerHTML = data.map((row, idx) => {
    const uid = row.uniqueid || row.uniqueId || '';
    const rowId = row.id || '';
    const pid = row.product_id || row.productId || '-';
    const pname = row.product_name || row.productName || '-';
    const openStock = Number(row.opening_stock ?? row.openingStock ?? 0);
    const unitPrice = Number(row.unit_price ?? row.unitPrice ?? 0);
    const totalAmt = Number(row.total_amount ?? row.totalAmount ?? (openStock * unitPrice));
    const sellPrice = Number(row.selling_price ?? row.sellingPrice ?? 0);
    const profitAmt = Number(row.profit_amount ?? row.profitAmount ?? (sellPrice - unitPrice));
    const sellUnit = Number(row.selling_unit ?? row.sellingUnit ?? 0);
    const curQty = Number(row.current_qty ?? row.currentQty ?? (openStock - sellUnit));
    const totStockVal = Number(row.total_stock_value ?? row.totalStockValue ?? (curQty * unitPrice));

    const displayNo = (window.UniformState.page - 1) * window.UniformState.limit + idx + 1;

    return `
      <tr class="hover:bg-slate-800/20 text-slate-300">
        <td class="text-center font-bold text-slate-400 py-3 px-2">${displayNo}</td>
        <td class="font-bold text-slate-200 font-mono py-3 px-2">${escapeHtml(pid)}</td>
        <td class="font-bold text-slate-300 py-3 px-2">${escapeHtml(pname)}</td>
        <td class="py-3 px-2"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400">${escapeHtml(row.type || '-')}</span></td>
        <td class="font-mono font-semibold py-3 px-2">${escapeHtml(row.size || '-')}</td>
        <td class="text-right font-medium py-3 px-2">${openStock}</td>
        <td class="text-right text-rose-400 font-mono py-3 px-2">${unitPrice.toLocaleString('en-US')}</td>
        <td class="text-right font-mono py-3 px-2">${totalAmt.toLocaleString('en-US')}</td>
        <td class="text-right text-emerald-400 font-mono py-3 px-2">${sellPrice.toLocaleString('en-US')}</td>
        <td class="text-right text-emerald-400 font-bold font-mono py-3 px-2">${profitAmt.toLocaleString('en-US')}</td>
        <td class="text-right text-teal-400 font-bold font-mono py-3 px-2">${sellUnit}</td>
        <td class="text-right font-bold text-slate-200 font-mono py-3 px-2">${curQty}</td>
        <td class="text-right font-bold text-indigo-400 font-mono py-3 px-2">${totStockVal.toLocaleString('en-US')}</td>
        <td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">
          <div class="flex items-center justify-center gap-3 ${isViewer ? 'hidden' : ''}">
            <button onclick="editUniformEntry('${escapeJsAttr(uid)}', '${escapeJsAttr(rowId)}')" class="text-indigo-400 hover:text-indigo-300 transition" title="Edit Product"><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="deleteUniformEntry('${escapeJsAttr(uid)}', '${escapeJsAttr(rowId)}')" class="text-rose-400 hover:text-rose-300 transition" title="Delete Product"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function updatePaginationUniform() {
  const state = window.UniformState;
  const info = document.getElementById('uni-pagination-info');
  if (info) {
    const start = state.totalRows === 0 ? 0 : (state.page - 1) * state.limit + 1;
    const end = Math.min(state.page * state.limit, state.totalRows);
    info.innerHTML = `Showing <span class="text-indigo-400 font-extrabold">${start}</span> to <span class="text-indigo-400 font-extrabold">${end}</span> of <span class="text-indigo-400 font-extrabold">${state.totalRows}</span> entries`;
  }
}

function changePageUniform(dir) {
  const state = window.UniformState;
  if (dir === -1 && state.page > 1) {
    state.page--;
    loadUniformData(false);
  } else if (dir === 1 && (state.page * state.limit) < state.totalRows) {
    state.page++;
    loadUniformData(false);
  }
}

function onSearchInputUniform() {
  clearTimeout(searchTimeoutUniform);
  searchTimeoutUniform = setTimeout(() => {
    const input = document.getElementById('uniform-search');
    window.UniformState.searchVal = input ? input.value.trim() : '';
    renderUniformTable();
  }, 200);
}

/**
 * 💡 Open Add Modal with Auto-Increment PID Calculation
 */
function openAddModalUniform() {
  const form = document.getElementById('uniform-form');
  if (form) form.reset();

  const uidEl = document.getElementById('uni-uniqueId');
  if (uidEl) uidEl.value = "";

  let maxSeq = 0;
  if (window.UniformState.activeData) {
    window.UniformState.activeData.forEach(row => {
      const pid = String(row.product_id || row.productId || "").trim();
      let num = parseInt(pid.replace(/[^\d]/g, ""), 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    });
  }
  const nextId = "PID " + String(maxSeq + 1).padStart(3, '0');
  const pidEl = document.getElementById('uni-pid');
  if (pidEl) pidEl.value = nextId;

  const titleEl = document.getElementById('uni-form-title');
  if (titleEl) titleEl.innerText = "Add New Uniform Product";

  const modalEl = document.getElementById('uniform-modal');
  if (modalEl) modalEl.classList.remove('hidden');
}

function closeUniformModal() {
  const modalEl = document.getElementById('uniform-modal');
  if (modalEl) modalEl.classList.add('hidden');
}

/**
 * 💡 Save / Update Uniform Item with Double Submit Lock
 */
async function saveUniformForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (isUniformSubmitting) return;
  isUniformSubmitting = true;

  const uniqueId = document.getElementById('uni-uniqueId')?.value || '';
  const isAdd = (!uniqueId);

  const entry = {
    uniqueId: uniqueId,
    productId: document.getElementById('uni-pid')?.value || '',
    productName: document.getElementById('uni-name')?.value || '',
    type: document.getElementById('uni-type')?.value || '',
    size: document.getElementById('uni-size')?.value || '',
    openingStock: parseFloat(document.getElementById('uni-stock')?.value) || 0,
    unitPrice: parseFloat(document.getElementById('uni-price')?.value) || 0,
    sellingPrice: parseFloat(document.getElementById('uni-sellprice')?.value) || 0,
    createdBy: (window.AppState ? window.AppState.currentUser : '') || "System"
  };

  closeUniformModal();

  const action = isAdd ? 'saveUniformEntry' : 'updateUniformEntry';
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    const response = await callApi(action, entry);
    if (response && response.success) {
      if (typeof showToast === 'function') {
        showToast("SUCCESS", isAdd ? "ကုန်ပစ္စည်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။" : "ကုန်ပစ္စည်း အချက်အလက်များ ပြင်ဆင်ပြီးပါပြီ။");
      }

      // 💡 Invalidate Cache for Office Advance Uniform Sync
      if (typeof clearAllApiCache === 'function') clearAllApiCache();
      if (window.OfficeState) window.OfficeState.uniformProducts = [];

      loadUniformData(true);
    } else {
      if (typeof showToast === 'function') showToast("ERROR", "သိမ်းဆည်းမှု မအောင်မြင်ပါ: " + (response ? response.message : ""));
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
  } finally {
    isUniformSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function editUniformEntry(uniqueId, rowId) {
  const row = window.UniformState.activeData.find(item =>
    (uniqueId && (item.uniqueid === uniqueId || item.uniqueId === uniqueId)) ||
    (rowId && String(item.id) === String(rowId))
  );

  if (!row) {
    if (typeof showToast === 'function') showToast("ERROR", "မူရင်း အချက်အလက် ရှာမတွေ့ပါ။");
    return;
  }

  openAddModalUniform();

  const uidEl = document.getElementById('uni-uniqueId');
  if (uidEl) uidEl.value = row.uniqueid || row.uniqueId || '';

  const pidEl = document.getElementById('uni-pid');
  if (pidEl) pidEl.value = row.product_id || row.productId || '';

  const nameEl = document.getElementById('uni-name');
  if (nameEl) nameEl.value = row.product_name || row.productName || '';

  const typeEl = document.getElementById('uni-type');
  if (typeEl) typeEl.value = row.type || '';

  const sizeEl = document.getElementById('uni-size');
  if (sizeEl) sizeEl.value = row.size || '';

  const stockEl = document.getElementById('uni-stock');
  if (stockEl) stockEl.value = row.opening_stock ?? row.openingStock ?? 0;

  const priceEl = document.getElementById('uni-price');
  if (priceEl) priceEl.value = row.unit_price ?? row.unitPrice ?? 0;

  const sellPriceEl = document.getElementById('uni-sellprice');
  if (sellPriceEl) sellPriceEl.value = row.selling_price ?? row.sellingPrice ?? 0;

  const titleEl = document.getElementById('uni-form-title');
  if (titleEl) titleEl.innerText = "Edit Uniform Product";
}

async function deleteUniformEntry(uniqueId, rowId) {
  if (confirm("ဤ ကုန်ပစ္စည်း မှတ်တမ်းအား အပြီးတိုင် ဖျက်သိမ်းလိုပါသလား။")) {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    try {
      const response = await callApi('deleteUniformEntry', { uniqueId, id: rowId });
      if (response && response.success) {
        if (typeof showToast === 'function') showToast("SUCCESS", "ကုန်ပစ္စည်း မှတ်တမ်းအား အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။");
        if (typeof clearAllApiCache === 'function') clearAllApiCache();
        if (window.OfficeState) window.OfficeState.uniformProducts = [];
        loadUniformData(true);
      } else {
        if (typeof showToast === 'function') showToast("ERROR", "ဖျက်သိမ်းမှု မအောင်မြင်ပါ: " + (response ? response.message : ""));
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
    } finally {
      if (typeof toggleLoading === 'function') toggleLoading(false);
    }
  }
}

function exportToCSVUniform() {
  const data = window.UniformState.activeData;
  if (!data || data.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  let csv = "NO,PRODUCT ID,PRODUCT NAME,TYPE,SIZE,OPENING STOCK,UNIT PRICE,TOTAL AMOUNT,SELLING PRICE,PROFIT AMOUNT,SELLING UNIT,CURRENT QTY,TOTAL STOCK VALUE,UNIQUEID\n";
  data.forEach((row, idx) => {
    let name = `"${(row.product_name || row.productName || '').replace(/"/g, '""')}"`;
    let type = `"${(row.type || '').replace(/"/g, '""')}"`;
    let size = `"${(row.size || '').replace(/"/g, '""')}"`;
    const openStock = row.opening_stock ?? row.openingStock ?? 0;
    const unitPrice = row.unit_price ?? row.unitPrice ?? 0;
    const totalAmt = row.total_amount ?? row.totalAmount ?? 0;
    const sellPrice = row.selling_price ?? row.sellingPrice ?? 0;
    const profitAmt = row.profit_amount ?? row.profitAmount ?? 0;
    const sellUnit = row.selling_unit ?? row.sellingUnit ?? 0;
    const curQty = row.current_qty ?? row.currentQty ?? 0;
    const totStockVal = row.total_stock_value ?? row.totalStockValue ?? 0;

    const displayNo = (window.UniformState.page - 1) * window.UniformState.limit + idx + 1;

    csv += `${displayNo},${row.product_id || row.productId || ''},${name},${type},${size},${openStock},${unitPrice},${totalAmt},${sellPrice},${profitAmt},${sellUnit},${curQty},${totStockVal},${row.uniqueid || row.uniqueId || ''}\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `uniform_ledger_${new Date().toISOString().slice(0, 10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 EXPOSE GLOBALLY
window.loadUniformData = loadUniformData;
window.openAddModalUniform = openAddModalUniform;
window.closeUniformModal = closeUniformModal;
window.saveUniformForm = saveUniformForm;
window.editUniformEntry = editUniformEntry;
window.deleteUniformEntry = deleteUniformEntry;
window.exportToCSVUniform = exportToCSVUniform;
window.onSearchInputUniform = onSearchInputUniform;
window.changePageUniform = changePageUniform;
