/**
 * GOLDEN ERP SYSTEM - CASHIER CASH BOOK MODULE
 * File: js/cashier.js 
 * 💡 Features: Full Dataset Loader (2000 rows limit), Accurate Total Entries Card (705+ rows),
 *              6 Sub-Books Routing, 17/19-Column Dynamic Schema & Cross-Module Invoice Printer
 */

var currentCashierSubBook = 'CABank'; // 'CABank' | 'CACash' | 'CAOffice' | 'CAKitchen' | 'CAPayroll' | 'todayIncome'
var allCashierData = [];
var filteredCashierData = [];
var currentCashierPage = 1;
var CASHIER_PAGE_SIZE = 50;
var searchTimeoutCashier = null;
var isCashierSubmitting = false;
var currentCashierTotalRows = 0; // 💡 Accurate Total Rows Tracker

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
 * 💡 Safe Comma String Number Parser
 */
function parseCleanNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  var str = String(val).replace(/,/g, '').trim();
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * 💡 Initialize View
 */
function initCashierView(bookName, useCache) {
  switchCashierSubTab(bookName || 'CABank', useCache !== undefined ? useCache : true);
}

/**
 * 💡 Switch Cashier Sub-Tabs
 */
function switchCashierSubTab(subTab, useCache) {
  currentCashierSubBook = subTab || 'CABank';
  currentCashierPage = 1;
  useCache = useCache !== undefined ? useCache : true;

  const tabThemes = {
    'CABank':      { active: 'bg-amber-500/25 text-amber-300 border-amber-400/60 ring-2 ring-amber-500/30 opacity-100 shadow-amber-950/40', inactive: 'bg-amber-950/20 border-amber-500/20 text-amber-400/60 opacity-60 hover:opacity-100' },
    'CACash':      { active: 'bg-emerald-500/25 text-emerald-300 border-emerald-400/60 ring-2 ring-emerald-500/30 opacity-100 shadow-emerald-950/40', inactive: 'bg-emerald-950/20 border-emerald-500/20 text-emerald-400/60 opacity-60 hover:opacity-100' },
    'CAOffice':    { active: 'bg-cyan-500/25 text-cyan-300 border-cyan-400/60 ring-2 ring-cyan-500/30 opacity-100 shadow-cyan-950/40', inactive: 'bg-cyan-950/20 border-cyan-500/20 text-cyan-400/60 opacity-60 hover:opacity-100' },
    'CAKitchen':   { active: 'bg-rose-500/25 text-rose-300 border-rose-400/60 ring-2 ring-rose-500/30 opacity-100 shadow-rose-950/40', inactive: 'bg-rose-950/20 border-rose-500/20 text-rose-400/60 opacity-60 hover:opacity-100' },
    'CAPayroll':   { active: 'bg-purple-500/25 text-purple-300 border-purple-400/60 ring-2 ring-purple-500/30 opacity-100 shadow-purple-950/40', inactive: 'bg-purple-950/20 border-purple-500/20 text-purple-400/60 opacity-60 hover:opacity-100' },
    'todayIncome': { active: 'bg-sky-500/25 text-sky-300 border-sky-400/60 ring-2 ring-sky-500/30 opacity-100 shadow-sky-950/40', inactive: 'bg-sky-950/20 border-sky-500/20 text-sky-400/60 opacity-60 hover:opacity-100' }
  };

  Object.keys(tabThemes).forEach(key => {
    const btn = document.getElementById(`ca-tab-${key}`);
    if (btn) {
      const theme = tabThemes[key];
      btn.className = `ca-sub-tab-btn px-3.5 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 border ${subTab === key ? theme.active : theme.inactive}`;
    }
  });

  const btnAdd = document.getElementById('ca-btn-add');
  if (btnAdd) {
    if (subTab === 'todayIncome') {
      btnAdd.classList.add('hidden');
    } else {
      btnAdd.classList.remove('hidden');
    }
  }

  loadCashierData(useCache);
}

/**
 * 💡 Load Cashier Data (Fetches full dataset up to 2000 rows)
 */
async function loadCashierData(useCache) {
  useCache = useCache !== undefined ? useCache : true;
  try {
    if (currentCashierSubBook === 'todayIncome') {
      await loadTodayIncomeForCashier(useCache);
      return;
    }

    const cacheKey = `getCashierData_${JSON.stringify({ bookName: currentCashierSubBook })}`;
    const hasCache = useCache && !!window.getApiCache(cacheKey);

    if (!hasCache && typeof toggleLoading === 'function') {
      toggleLoading(true);
    }

    // 💡 FIX: Fetch up to 2000 rows so all 705+ records load completely
    const response = await callApi('getCashierData', {
      bookName: currentCashierSubBook,
      page: 1,
      limit: 2000,
      forceRefresh: !useCache
    });

    if (response && response.success) {
      allCashierData = response.data || [];
      window.allCashierData = allCashierData;
      currentCashierTotalRows = response.totalRows || allCashierData.length || 0;

      renderStatsCashier(response.stats || { totalIncome: 0, totalExpense: 0, balance: 0 }, currentCashierTotalRows);
      applyCashierSearchAndRender();
    }
  } catch (error) {
    console.error('Failed to load Cashier data:', error);
    if (typeof showToast === 'function') showToast("ERROR", "Cashier စာရင်းများ ဖတ်ယူ၍ မရပါ: " + error.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 Load Today's Student Income Entries Live Feed
 */
async function loadTodayIncomeForCashier(useCache) {
  useCache = useCache !== undefined ? useCache : true;
  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const response = await callApi('getTodayIncomeForCashier', {
      page: 1,
      limit: 2000,
      forceRefresh: !useCache
    });

    if (response && response.success) {
      allCashierData = response.data || [];
      window.allCashierData = allCashierData;
      currentCashierTotalRows = response.totalRows || allCashierData.length || 0;
      
      let totalInc = 0, totalExp = 0;
      allCashierData.forEach(r => {
        totalInc += Number(r.credit || 0);
        totalExp += Number(r.debit || 0);
      });

      renderStatsCashier({ totalIncome: totalInc, totalExpense: totalExp, balance: totalInc - totalExp }, currentCashierTotalRows);
      applyCashierSearchAndRender();
    }
  } catch (error) {
    console.error("Failed to load Today Income for Cashier:", error);
    if (typeof showToast === 'function') showToast("ERROR", "ယနေ့ ဝင်ငွေစာရင်းများ ဖတ်ယူ၍ မရပါ: " + error.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 Render KPI Header Stats Cards (Accurately displays 705+ rows)
 */
function renderStatsCashier(stats, totalRowsCount) {
  const elInc = document.getElementById('ca-total-income');
  const elExp = document.getElementById('ca-total-expense');
  const elBal = document.getElementById('ca-balance');
  const elCount = document.getElementById('ca-entries-count');

  if (elInc) elInc.textContent = `${Number(stats.totalIncome || 0).toLocaleString('en-US')} MMK`;
  if (elExp) elExp.textContent = `${Number(stats.totalExpense || 0).toLocaleString('en-US')} MMK`;
  if (elBal) elBal.textContent = `${Number(stats.balance || 0).toLocaleString('en-US')} MMK`;
  
  // 💡 FIX: Accurately display actual total rows from database
  if (elCount) elCount.textContent = (totalRowsCount || currentCashierTotalRows || allCashierData.length).toLocaleString('en-US');
}

/**
 * 💡 Strict Search Criteria Filter
 */
function filterCashierData(list, searchVal, fromDate, toDate) {
  var safeList = Array.isArray(list) ? list : [];
  return safeList.filter(function(row) {
    if (typeof window.isDateInRange === 'function') {
      if (!window.isDateInRange(row.date || row.effDate, fromDate, toDate)) return false;
    }

    if (!searchVal || !searchVal.trim()) return true;
    var q = searchVal.trim().toLowerCase();

    if (currentCashierSubBook === 'todayIncome') {
      var nameMatch = String(row.fyidName || row.name || '').toLowerCase().includes(q);
      var fyidMatch = String(row.fyid || '').toLowerCase().includes(q);
      var idMatch = String(row.id || '').toLowerCase().includes(q);
      return nameMatch || fyidMatch || idMatch;
    }

    var descMatch = String(row.description || '').toLowerCase().includes(q);
    var catMatch = String(row.category || '').toLowerCase().includes(q);
    var respMatch = String(row.respPerson || '').toLowerCase().includes(q);
    var debitMatch = String(row.debit || '').includes(q);
    var creditMatch = String(row.credit || '').includes(q);

    return descMatch || catMatch || respMatch || debitMatch || creditMatch;
  });
}

function clearDateFilterCashier() {
  const fromEl = document.getElementById('ca-date-from');
  const toEl = document.getElementById('ca-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  applyCashierSearchAndRender();
}

function applyCashierSearchAndRender() {
  const searchInput = document.getElementById('cashier-search');
  const query = searchInput ? searchInput.value.trim() : '';

  const fromEl = document.getElementById('ca-date-from');
  const toEl = document.getElementById('ca-date-to');
  const fromDate = fromEl ? fromEl.value : '';
  const toDate = toEl ? toEl.value : '';

  filteredCashierData = filterCashierData(allCashierData, query, fromDate, toDate);
  currentCashierPage = 1;
  renderCashierTable();
}

function onSearchInputCashier() {
  if (searchTimeoutCashier) clearTimeout(searchTimeoutCashier);
  searchTimeoutCashier = setTimeout(() => {
    applyCashierSearchAndRender();
  }, 150);
}

/**
 * 💡 Dynamic Table Header Renderer
 */
function renderCashierTableHead() {
  const thead = document.getElementById('cashier-table-head');
  if (!thead) return;

  const isTodayIncomeTab = (currentCashierSubBook === 'todayIncome');

  if (isTodayIncomeTab) {
    thead.innerHTML = `
      <tr class="bg-[#0e172a]">
        <th scope="col" class="w-12 text-center text-slate-400 text-xs py-3">NO</th>
        <th scope="col" class="w-28 text-slate-400 text-xs py-3">EFFECT DATE</th>
        <th scope="col" class="w-28 text-slate-400 text-xs py-3">DATE</th>
        <th scope="col" class="w-24 text-slate-400 text-xs py-3">FY</th>
        <th scope="col" class="w-24 text-slate-400 text-xs py-3">ID</th>
        <th scope="col" class="w-32 text-slate-400 text-xs py-3">FYID</th>
        <th scope="col" class="min-w-[200px] text-slate-400 text-xs py-3">FYID NAME</th>
        <th scope="col" class="w-32 text-slate-400 text-xs py-3">CLASS</th>
        <th scope="col" class="w-32 text-slate-400 text-xs py-3">CATEGORY</th>
        <th scope="col" class="w-36 text-slate-400 text-xs py-3">ACCOUNT NAME</th>
        <th scope="col" class="w-24 text-slate-400 text-xs py-3">METHOD</th>
        <th scope="col" class="w-32 text-right text-rose-400 text-xs py-3">DEBIT (ပြန်အမ်း)</th>
        <th scope="col" class="w-32 text-right text-emerald-400 text-xs py-3">CREDIT (ဝင်ငွေ)</th>
        <th scope="col" class="w-32 text-right text-indigo-400 text-xs py-3">AUT AMOUNT</th>
        <th scope="col" class="w-24 text-slate-400 text-xs py-3">PROMO</th>
        <th scope="col" class="w-24 text-slate-400 text-xs py-3">MY</th>
        <th scope="col" class="w-36 text-slate-400 text-xs py-3">VR NO</th>
        <th scope="col" class="min-w-[150px] text-slate-400 text-xs py-3">REMARK</th>
        <th scope="col" class="w-28 text-center text-slate-400 text-xs py-3 right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg">ACTION</th>
      </tr>
    `;
  } else {
    thead.innerHTML = `
      <tr class="bg-[#0e172a]">
        <th scope="col" class="w-12 text-center text-slate-400 text-xs py-3">NO</th>
        <th scope="col" class="w-28 text-slate-400 text-xs py-3">DATE</th>
        <th scope="col" class="w-36 text-amber-300 text-xs py-3">RESPONSIBILITY PERSON</th>
        <th scope="col" class="w-36 text-slate-400 text-xs py-3">CATEGORY</th>
        <th scope="col" class="min-w-[280px] text-slate-400 text-xs py-3">DESCRIPTION</th>
        <th scope="col" class="w-24 text-slate-400 text-xs py-3">METHOD</th>
        <th scope="col" class="w-32 text-right text-emerald-400 text-xs py-3">DEBIT</th>
        <th scope="col" class="w-32 text-right text-rose-400 text-xs py-3">CREDIT</th>
        <th scope="col" class="w-36 text-right text-slate-400 text-xs py-3">BALANCES</th>
        <th scope="col" class="w-32 text-slate-400 text-xs py-3">TRANSFER</th>
        <th scope="col" class="w-32 text-slate-400 text-xs py-3">VR NO</th>
        <th scope="col" class="w-24 text-slate-400 text-xs py-3">MY</th>
        <th scope="col" class="w-28 text-slate-400 text-xs py-3">FY</th>
        <th scope="col" class="w-32 text-slate-400 text-xs py-3">BOOK NAME</th>
        <th scope="col" class="w-28 text-slate-400 text-xs py-3">CREATED BY</th>
        <th scope="col" class="w-32 text-slate-400 text-xs py-3">CREATED AT</th>
        <th scope="col" class="w-28 text-center text-slate-400 text-xs py-3 right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg">ACTION</th>
      </tr>
    `;
  }
}

/**
 * 💡 Render Table Grid Rows
 */
function renderCashierTable() {
  renderCashierTableHead();

  const tbody = document.getElementById('cashier-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  const totalEntries = filteredCashierData.length;
  const totalPages = Math.ceil(totalEntries / CASHIER_PAGE_SIZE) || 1;
  if (currentCashierPage > totalPages) currentCashierPage = totalPages;

  const startIndex = (currentCashierPage - 1) * CASHIER_PAGE_SIZE;
  const endIndex = Math.min(startIndex + CASHIER_PAGE_SIZE, totalEntries);
  const pageItems = filteredCashierData.slice(startIndex, endIndex);

  const isTodayIncomeTab = (currentCashierSubBook === 'todayIncome');
  const isViewer = (window.AppState ? window.AppState.currentUserRole : '') === "Viewer";

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${isTodayIncomeTab ? '19' : '17'}" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော စာရင်း မရှိပါ။</td></tr>`;
    updateCashierPaginationInfo(0, 0, 0);
    return;
  }

  pageItems.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition-all border-b border-slate-800/40 text-xs';

    const displayNo = Math.floor(parseCleanNum(item.no || (startIndex + index + 1))) || 1;

    if (isTodayIncomeTab) {
      tr.innerHTML = `
        <td class="text-center font-mono font-semibold text-slate-400 py-3 px-2">${displayNo}</td>
        <td class="font-mono py-3 px-2">${escapeHtml(item.effDate) || '-'}</td>
        <td class="font-mono py-3 px-2">${escapeHtml(item.date) || '-'}</td>
        <td class="font-mono font-bold text-indigo-400 py-3 px-2">${escapeHtml(item.fy) || '-'}</td>
        <td class="font-mono font-bold py-3 px-2">${escapeHtml(item.id) || '-'}</td>
        <td class="font-mono font-bold text-indigo-300 py-3 px-2">${escapeHtml(item.fyid) || '-'}</td>
        <td class="font-bold text-slate-100 py-3 px-2">${escapeHtml(item.fyidName) || '-'}</td>
        <td class="py-3 px-2">${escapeHtml(item.class) || '-'}</td>
        <td class="py-3 px-2">${typeof window.formatCategoryBadgeHtml === 'function' ? window.formatCategoryBadgeHtml(item.category) : escapeHtml(item.category)}</td>
        <td class="font-semibold text-slate-200 py-3 px-2">${escapeHtml(item.accountName) || '-'}</td>
        <td class="font-bold text-slate-400 py-3 px-2">${escapeHtml(item.method) || '-'}</td>
        <td class="text-right font-mono font-bold text-rose-400 py-3 px-2">${item.debit > 0 ? Number(item.debit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
        <td class="text-right font-mono font-bold text-emerald-400 py-3 px-2">${item.credit > 0 ? Number(item.credit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
        <td class="text-right font-mono font-bold text-indigo-400 py-3 px-2">${item.autAmount > 0 ? Number(item.autAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
        <td class="text-xs py-3 px-2">${escapeHtml(item.promo) || '-'}</td>
        <td class="font-mono text-xs py-3 px-2">${escapeHtml(item.my) || '-'}</td>
        <td class="font-mono text-xs text-slate-400 py-3 px-2">${escapeHtml(item.vrNo) || '-'}</td>
        <td class="max-w-xs truncate text-xs text-slate-400 py-3 px-2" title="${escapeHtml(item.remark || '')}">${escapeHtml(item.remark) || '-'}</td>
        <td class="text-center right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg py-3 px-2">
          <button onclick="printInvoice('${item.uniqueId}')" class="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition font-bold" title="Print Receipt">
            <i class="fa-solid fa-print mr-1"></i> Print
          </button>
        </td>
      `;
    } else {
      const isLocked = Boolean(item.isLocked || isViewer);
      const lockClass = isLocked ? "opacity-30 cursor-not-allowed pointer-events-none" : "hover:text-white";
      const lockTitle = item.isLocked ? "Locked - Must be edited from original source book" : "";
      const disabledAttr = isLocked ? 'disabled' : '';

      tr.innerHTML = `
        <td class="text-center font-mono font-semibold text-slate-400 py-3 px-2">${displayNo}</td>
        <td class="font-mono py-3 px-2">${item.date || '-'}</td>
        <td class="font-bold text-amber-300 py-3 px-2">${escapeHtml(item.respPerson) || '-'}</td>
        <td class="py-3 px-2">${typeof window.formatCategoryBadgeHtml === 'function' ? window.formatCategoryBadgeHtml(item.category) : escapeHtml(item.category)}</td>
        <td class="font-bold text-slate-100 max-w-xs truncate py-3 px-2" title="${escapeHtml(item.description)}">${escapeHtml(item.description) || '-'}</td>
        <td class="font-semibold py-3 px-2">${escapeHtml(item.method) || '-'}</td>
        <td class="text-right font-mono font-bold text-emerald-400 py-3 px-2">${item.debit > 0 ? Number(item.debit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
        <td class="text-right font-mono font-bold text-rose-400 py-3 px-2">${item.credit > 0 ? Number(item.credit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
        <td class="text-right font-mono font-bold text-indigo-400 py-3 px-2">${Number(item.balances || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td class="py-3 px-2 text-indigo-400 text-xs">${escapeHtml(item.transfer) || '-'}</td>
        <td class="font-mono text-slate-400 py-3 px-2">${escapeHtml(item.vrNo) || '-'}</td>
        <td class="font-mono py-3 px-2">${escapeHtml(item.my) || '-'}</td>
        <td class="font-mono font-bold text-indigo-300 py-3 px-2">${escapeHtml(item.fy) || '-'}</td>
        <td class="py-3 px-2">${escapeHtml(item.bookName) || '-'}</td>
        <td class="py-3 px-2">${escapeHtml(item.createdBy) || 'System'}</td>
        <td class="font-mono text-slate-500 py-3 px-2">${item.createdAt ? item.createdAt.slice(0,10) : '-'}</td>
        <td class="text-center right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg py-3 px-2">
          <div class="flex items-center justify-center gap-2">
            <button onclick="editCashierEntry('${item.uniqueId}')" class="p-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition ${lockClass}" title="Edit ${lockTitle}" ${disabledAttr}><i class="fa-solid fa-pen-to-square"></i></button>
            <button onclick="deleteCashierEntry('${item.uniqueId}')" class="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition btn-delete ${lockClass}" title="Delete ${lockTitle}" ${disabledAttr}><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      `;
    }

    tbody.appendChild(tr);
  });

  updateCashierPaginationInfo(startIndex + 1, endIndex, totalEntries);
}

function updateCashierPaginationInfo(start, end, total) {
  const info = document.getElementById('ca-pagination-info');
  if (info) info.textContent = `Showing ${start} to ${end} of ${total} entries`;

  const btnPrev = document.getElementById('ca-btn-prev');
  const btnNext = document.getElementById('ca-btn-next');

  if (btnPrev) btnPrev.disabled = (currentCashierPage <= 1);
  if (btnNext) btnNext.disabled = (end >= total);
}

function changePageCashier(delta) {
  currentCashierPage += delta;
  renderCashierTable();
}

/**
 * 💡 Populate Dropdowns from config
 */
function populateDropdownsCashier() {
  const defKey = `${currentCashierSubBook.charAt(0).toLowerCase()}${currentCashierSubBook.slice(1)}Book`;
  const def = (window.DROPDOWNS && window.DROPDOWNS[defKey]) || window.DROPDOWNS?.cashBook || {};

  const catSelect = document.getElementById('ca-category');
  if (catSelect && def.category) {
    catSelect.innerHTML = def.category.map(c => `<option value="${c}">${c}</option>`).join('');
  }

  const methodSelect = document.getElementById('ca-method');
  if (methodSelect) {
    const isBank = currentCashierSubBook === 'CABank';
    methodSelect.innerHTML = `
      <option value="Cash" ${!isBank ? 'selected' : ''}>Cash</option>
      <option value="Bank" ${isBank ? 'selected' : ''}>Bank</option>
    `;
  }

  const transSelect = document.getElementById('ca-transfer');
  if (transSelect) {
    const options = ["CABank", "CACash", "CAOffice", "CAKitchen", "CAPayroll"].filter(b => b !== currentCashierSubBook);
    transSelect.innerHTML = `<option value="">-- No Transfer --</option>` +
      options.map(t => `<option value="${t}">${t}</option>`).join('');
  }
}

function onCategoryChangeCashier() {
  autoFillTransferDescriptionCashier();
}

function onTransferTargetChangeCashier() {
  autoFillTransferDescriptionCashier();
}

function autoFillTransferDescriptionCashier() {
  const cat = document.getElementById('ca-category')?.value;
  const transferTo = document.getElementById('ca-transfer')?.value;
  const descEl = document.getElementById('ca-description');

  if (cat === "Transfer" && transferTo && descEl) {
    descEl.value = `[${currentCashierSubBook} Transfer to ${transferTo}] `;
  }
}

function openAddModalCashier() {
  const form = document.getElementById('cashier-form');
  if (form) form.reset();

  const uidEl = document.getElementById('ca-uniqueId');
  if (uidEl) uidEl.value = '';

  const dateEl = document.getElementById('ca-date');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  const debitEl = document.getElementById('ca-debit');
  if (debitEl) debitEl.value = 0;

  const creditEl = document.getElementById('ca-credit');
  if (creditEl) creditEl.value = 0;

  populateDropdownsCashier();

  const titleEl = document.getElementById('ca-form-title');
  if (titleEl) titleEl.textContent = `Add Entry (${currentCashierSubBook})`;

  const modalEl = document.getElementById('cashier-modal');
  if (modalEl) modalEl.classList.remove('hidden');
}

function closeCashierModal() {
  const modal = document.getElementById('cashier-modal');
  if (modal) modal.classList.add('hidden');
}

async function saveCashierForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (isCashierSubmitting) return;
  isCashierSubmitting = true;

  const uniqueId = document.getElementById('ca-uniqueId')?.value || '';
  const payload = {
    uniqueId,
    bookName: currentCashierSubBook,
    date: document.getElementById('ca-date')?.value || '',
    respPerson: document.getElementById('ca-resp-person')?.value || '',
    category: document.getElementById('ca-category')?.value || 'Income',
    method: document.getElementById('ca-method')?.value || 'Cash',
    transfer: document.getElementById('ca-transfer')?.value || '',
    debit: Number(document.getElementById('ca-debit')?.value || 0),
    credit: Number(document.getElementById('ca-credit')?.value || 0),
    description: document.getElementById('ca-description')?.value || '',
    createdBy: (window.AppState ? window.AppState.currentUser : '') || "System"
  };

  try {
    closeCashierModal();
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const actionName = uniqueId ? 'updateCashierEntry' : 'saveCashierEntry';
    const response = await callApi(actionName, payload);

    if (response && response.success) {
      if (typeof showToast === 'function') showToast('SUCCESS', 'Cashier စာရင်း အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။');
      if (typeof clearAllApiCache === 'function') clearAllApiCache();
      loadCashierData(false);
    } else {
      if (typeof showToast === 'function') showToast('ERROR', response?.message || 'သိမ်းဆည်းမှု မအောင်မြင်ပါ။');
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast('ERROR', `အမှားအယွင်း ဖြစ်ပေါ်ခဲ့သည်: ${error.message}`);
  } finally {
    isCashierSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function editCashierEntry(uniqueId) {
  const row = allCashierData.find(item => item.uniqueId === uniqueId);
  if (!row) {
    if (typeof showToast === 'function') showToast("ERROR", "မူရင်း အချက်အလက် ရှာမတွေ့ပါ။");
    return;
  }

  openAddModalCashier();

  const uidEl = document.getElementById('ca-uniqueId');
  if (uidEl) uidEl.value = row.uniqueId || '';

  const dateEl = document.getElementById('ca-date');
  if (dateEl) dateEl.value = row.date || '';

  const respEl = document.getElementById('ca-resp-person');
  if (respEl) respEl.value = row.respPerson || '';

  const catEl = document.getElementById('ca-category');
  if (catEl) catEl.value = row.category || 'Income';

  const methodEl = document.getElementById('ca-method');
  if (methodEl) methodEl.value = row.method || 'Cash';

  const transferEl = document.getElementById('ca-transfer');
  if (transferEl) transferEl.value = row.transfer || '';

  const debitEl = document.getElementById('ca-debit');
  if (debitEl) debitEl.value = row.debit || 0;

  const creditEl = document.getElementById('ca-credit');
  if (creditEl) creditEl.value = row.credit || 0;

  const descEl = document.getElementById('ca-description');
  if (descEl) descEl.value = row.description || '';

  const titleEl = document.getElementById('ca-form-title');
  if (titleEl) titleEl.textContent = `Edit Entry (${currentCashierSubBook})`;
}

async function deleteCashierEntry(uniqueId) {
  if (!confirm("ဤ စာရင်းအား အပြီးတိုင် ဖျက်သိမ်းလိုပါသလား။")) return;

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    const response = await callApi('deleteCashierEntry', { uniqueId, bookName: currentCashierSubBook });

    if (response && response.success) {
      if (typeof showToast === 'function') showToast('SUCCESS', 'Cashier စာရင်းအား အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။');
      if (typeof clearAllApiCache === 'function') clearAllApiCache();
      loadCashierData(false);
    } else {
      if (typeof showToast === 'function') showToast('ERROR', response?.message || 'ဖျက်သိမ်းမှု မအောင်မြင်ပါ။');
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast('ERROR', `ဖျက်သိမ်းမှု အမှား: ${error.message}`);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function exportToCSVCashier() {
  if (!allCashierData || allCashierData.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  let csv = "NO,DATE,RESPONSIBILITY PERSON,CATEGORY,DESCRIPTION,METHOD,DEBIT,CREDIT,BALANCES,TRANSFER,VR NO,MY,FY,BOOK NAME,CREATED BY,CREATED AT,UNIQUEID\n";
  allCashierData.forEach(r => {
    let desc = `"${(r.description || '').replace(/"/g, '""')}"`;
    let resp = `"${(r.respPerson || '').replace(/"/g, '""')}"`;
    let cat = `"${(r.category || '').replace(/"/g, '""')}"`;

    csv += `${r.no || ''},${r.date || ''},${resp},${cat},${desc},${r.method || ''},${r.debit || 0},${r.credit || 0},${r.balances || 0},${r.transfer || ''},${r.vrNo || ''},${r.my || ''},${r.fy || ''},${r.bookName || ''},${r.createdBy || ''},${r.createdAt || ''},${r.uniqueId || ''}\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${currentCashierSubBook}_export_${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 EXPOSE GLOBALLY
window.initCashierView = initCashierView;
window.switchCashierSubTab = switchCashierSubTab;
window.loadCashierData = loadCashierData;
window.loadTodayIncomeForCashier = loadTodayIncomeForCashier;
window.openAddModalCashier = openAddModalCashier;
window.closeCashierModal = closeCashierModal;
window.saveCashierForm = saveCashierForm;
window.editCashierEntry = editCashierEntry;
window.deleteCashierEntry = deleteCashierEntry;
window.exportToCSVCashier = exportToCSVCashier;
window.onSearchInputCashier = onSearchInputCashier;
window.clearDateFilterCashier = clearDateFilterCashier;
window.changePageCashier = changePageCashier;
window.onCategoryChangeCashier = onCategoryChangeCashier;
window.onTransferTargetChangeCashier = onTransferTargetChangeCashier;
