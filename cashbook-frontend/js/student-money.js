/**
 * GOLDEN ERP SYSTEM - STUDENT MONEY LEDGER & WALLET MODULE
 * File: js/student-money.js
 * 💡 Features: Dual Sub-Tab Switcher (1. Transaction History | 2. Student Wallet Balances),
 *              1 Student = 1 Row Summary, Live Student Statement Timeline Modal,
 *              FY-Scoped Student Auto-Lookup, Live Balance Indicator & Multi-CSV Exporter
 */

var gCurrentStudentMoneyTab = 'history'; // 'history' | 'summary'
var gStudentMoneyHistoryData = [];
var gStudentMoneyFilteredData = [];
var gStudentMoneySummaryData = [];
var gStudentMoneyFilteredSummaryData = [];
var gStudentMoneyPage = 1;
var gStudentMoneyLimit = 20;
var gStudentMoneyTotalRows = 0;
var searchTimeoutStudentMoney = null;
var isStudentMoneySubmitting = false;

var gStudentCacheForMoney = {};

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

function parseCleanNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  var str = String(val).replace(/,/g, '').trim();
  var num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function getFyShortCode(fyStr) {
  if (!fyStr) return '2627';
  var parts = String(fyStr).split(/[-/]/);
  if (parts.length >= 2) {
    return `${parts[0].trim().slice(-2)}${parts[1].trim().slice(-2)}`;
  }
  return '2627';
}

function sanitizeFyidStr(fyidStr) {
  var s = String(fyidStr || '').trim();
  if (!s) return s;
  if (s.indexOf('.0') === -1) return s;
  var cleaned = s.replace(/\.0/g, '');
  var parts = cleaned.split('-STU-');
  if (parts.length === 2) {
    var numPart = parseInt(parts[1], 10) || 0;
    return `${parts[0]}-STU-${String(numPart).padStart(4, '0')}`;
  }
  return cleaned;
}

/**
 * 💡 Switch Sub-Tabs (History vs Wallet Summary)
 */
function switchStudentMoneySubTab(tabName) {
  gCurrentStudentMoneyTab = tabName || 'history';

  const btnHistory = document.getElementById('stm-tab-history');
  const btnSummary = document.getElementById('stm-tab-summary');
  const viewHistory = document.getElementById('stm-history-view');
  const viewSummary = document.getElementById('stm-summary-view');

  const kpi1Label = document.getElementById('stm-kpi-1-label');
  const kpi2Label = document.getElementById('stm-kpi-2-label');
  const kpi4Label = document.getElementById('stm-kpi-4-label');

  if (gCurrentStudentMoneyTab === 'history') {
    if (btnHistory) btnHistory.className = 'px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 bg-indigo-600 text-white shadow-lg shadow-indigo-600/20';
    if (btnSummary) btnSummary.className = 'px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 bg-slate-800 text-slate-400 hover:text-white border border-slate-700/50';
    if (viewHistory) viewHistory.classList.remove('hidden');
    if (viewSummary) viewSummary.classList.add('hidden');

    if (kpi1Label) kpi1Label.textContent = 'TOTAL DEPOSITED (အပ်ငွေ)';
    if (kpi2Label) kpi2Label.textContent = 'TOTAL WITHDRAWN (ထုတ်ငွေ)';
    if (kpi4Label) kpi4Label.textContent = 'TOTAL ENTRIES';

    loadStudentMoneyData(false);
  } else {
    if (btnHistory) btnHistory.className = 'px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 bg-slate-800 text-slate-400 hover:text-white border border-slate-700/50';
    if (btnSummary) btnSummary.className = 'px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 bg-amber-600 text-white shadow-lg shadow-amber-600/20';
    if (viewHistory) viewHistory.classList.add('hidden');
    if (viewSummary) viewSummary.classList.remove('hidden');

    if (kpi1Label) kpi1Label.textContent = 'TOTAL IN TRUST (စုစုပေါင်း အပ်ငွေ)';
    if (kpi2Label) kpi2Label.textContent = 'TOTAL WITHDRAWN (စုစုပေါင်း ထုတ်ငွေ)';
    if (kpi4Label) kpi4Label.textContent = 'ACTIVE WALLET STUDENTS';

    loadStudentMoneySummaryData(false);
  }
}

/**
 * 💡 Load Tab 1: Transaction History Data
 */
async function loadStudentMoneyData(isSilent) {
  try {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);

    const searchInput = document.getElementById('stm-search');
    const searchVal = searchInput ? searchInput.value.trim() : '';

    const response = await callApi('getStudentMoneyData', {
      page: gStudentMoneyPage,
      limit: 1000,
      searchVal: searchVal,
      forceRefresh: true
    }, 'GET');

    if (response && response.success) {
      gStudentMoneyHistoryData = response.data || [];
      gStudentMoneyTotalRows = response.totalRows || gStudentMoneyHistoryData.length || 0;

      renderStatsStudentMoney(response.stats || { totalIncome: 0, totalExpense: 0, balance: 0 }, gStudentMoneyTotalRows);
      applyStudentMoneySearchAndRender();
    } else {
      if (typeof showToast === 'function') showToast("ERROR", response?.message || "စာရင်းများ ရယူ၍ မရပါ။");
    }
  } catch (err) {
    console.error("Student Money Load Error:", err);
    if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 Load Tab 2: Individual Student Wallet Summary Data (1 Student = 1 Row)
 */
async function loadStudentMoneySummaryData(isSilent) {
  try {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);

    const searchInput = document.getElementById('stm-summary-search');
    const searchVal = searchInput ? searchInput.value.trim() : '';

    const response = await callApi('getStudentMoneySummary', {
      searchVal: searchVal,
      forceRefresh: true
    }, 'GET');

    if (response && response.success) {
      gStudentMoneySummaryData = response.data || [];
      gStudentMoneyFilteredSummaryData = gStudentMoneySummaryData;

      const stats = response.stats || {};
      renderStatsStudentMoney({
        totalIncome: stats.totalDeposited || 0,
        totalExpense: stats.totalWithdrawn || 0,
        balance: stats.totalBalance || 0
      }, stats.studentCount || gStudentMoneySummaryData.length);

      renderStudentMoneySummaryTable();
    } else {
      if (typeof showToast === 'function') showToast("ERROR", response?.message || "လက်ကျန်ချုပ် စာရင်းများ ရယူ၍ မရပါ။");
    }
  } catch (err) {
    console.error("Student Money Summary Load Error:", err);
    if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function renderStatsStudentMoney(stats, count) {
  const elInc = document.getElementById('stm-total-income');
  const elExp = document.getElementById('stm-total-expense');
  const elBal = document.getElementById('stm-balance');
  const elCount = document.getElementById('stm-entries-count');

  if (elInc) elInc.textContent = `${Number(stats.totalIncome || 0).toLocaleString('en-US')} MMK`;
  if (elExp) elExp.textContent = `${Number(stats.totalExpense || 0).toLocaleString('en-US')} MMK`;
  if (elBal) elBal.textContent = `${Number(stats.balance || 0).toLocaleString('en-US')} MMK`;
  if (elCount) elCount.textContent = (count || 0).toLocaleString('en-US');
}

/**
 * 💡 Tab 1: Render History Table
 */
function applyStudentMoneySearchAndRender() {
  const searchInput = document.getElementById('stm-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const fromEl = document.getElementById('stm-date-from');
  const toEl = document.getElementById('stm-date-to');
  const fromDate = fromEl ? fromEl.value : '';
  const toDate = toEl ? toEl.value : '';

  gStudentMoneyFilteredData = gStudentMoneyHistoryData.filter(row => {
    if (typeof window.isDateInRange === 'function') {
      if (!window.isDateInRange(row.date, fromDate, toDate)) return false;
    }

    if (!query) return true;
    const nameMatch = String(row.fyidName || '').toLowerCase().includes(query);
    const fyidMatch = String(row.fyid || '').toLowerCase().includes(query);
    const idMatch = String(row.studentId || row.id || '').includes(query);
    const remarkMatch = String(row.remark || '').toLowerCase().includes(query);

    return nameMatch || fyidMatch || idMatch || remarkMatch;
  });

  gStudentMoneyPage = 1;
  renderStudentMoneyHistoryTable();
}

function onSearchInputStudentMoney() {
  if (searchTimeoutStudentMoney) clearTimeout(searchTimeoutStudentMoney);
  searchTimeoutStudentMoney = setTimeout(() => {
    applyStudentMoneySearchAndRender();
  }, 150);
}

function clearDateFilterStudentMoney() {
  const fromEl = document.getElementById('stm-date-from');
  const toEl = document.getElementById('stm-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  applyStudentMoneySearchAndRender();
}

function renderStudentMoneyHistoryTable() {
  const tbody = document.getElementById('stm-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  const totalEntries = gStudentMoneyFilteredData.length;
  const totalPages = Math.ceil(totalEntries / gStudentMoneyLimit) || 1;
  if (gStudentMoneyPage > totalPages) gStudentMoneyPage = totalPages;

  const startIndex = (gStudentMoneyPage - 1) * gStudentMoneyLimit;
  const endIndex = Math.min(startIndex + gStudentMoneyLimit, totalEntries);
  const pageItems = gStudentMoneyFilteredData.slice(startIndex, endIndex);

  const isViewer = (window.AppState ? window.AppState.currentUserRole : '') === "Viewer";

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော စာရင်း မရှိပါ။</td></tr>`;
    updateStudentMoneyPaginationInfo(0, 0, 0);
    return;
  }

  pageItems.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 text-slate-300 text-xs border-b border-slate-800/40';

    const displayNo = Math.floor(parseFloat(row.no || (startIndex + idx + 1))) || 1;
    const uid = row.uniqueId || '';
    const debitStr = row.debit > 0 ? Number(row.debit).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';
    const creditStr = row.credit > 0 ? Number(row.credit).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';
    const balStr = Number(row.balances || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    tr.innerHTML = `
      <td class="text-center font-mono font-semibold text-slate-400 py-3 px-2">${displayNo}</td>
      <td class="font-mono text-xs py-3 px-2">${escapeHtml(row.date)}</td>
      <td class="font-mono font-bold text-indigo-300 py-3 px-2">${escapeHtml(row.fy)}</td>
      <td class="font-mono font-bold py-3 px-2">${escapeHtml(row.studentId)}</td>
      <td class="font-mono font-bold text-indigo-400 py-3 px-2">${escapeHtml(row.fyid)}</td>
      <td class="font-bold text-slate-100 py-3 px-2">${escapeHtml(row.fyidName)}</td>
      <td class="py-3 px-2">${escapeHtml(row.class)}</td>
      <td class="font-semibold py-3 px-2">${escapeHtml(row.method)}</td>
      <td class="text-right text-emerald-400 font-mono font-bold py-3 px-2">${debitStr}</td>
      <td class="text-right text-rose-400 font-mono font-bold py-3 px-2">${creditStr}</td>
      <td class="text-right text-indigo-400 font-mono font-bold py-3 px-2">${balStr}</td>
      <td class="max-w-xs truncate text-xs text-slate-400 py-3 px-2" title="${escapeHtml(row.remark)}">${escapeHtml(row.remark || '-')}</td>
      <td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">
        <div class="flex items-center justify-center gap-2">
          <button onclick="openStudentStatementModal(${row.studentId})" class="p-1 text-amber-400 hover:text-amber-300 transition" title="View Statement"><i class="fa-solid fa-file-invoice"></i></button>
          <button onclick="editStudentMoneyEntry('${uid}')" class="p-1 text-indigo-400 hover:text-indigo-300 transition ${isViewer ? 'hidden' : ''}" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteStudentMoneyEntry('${uid}')" class="p-1 text-rose-400 hover:text-rose-300 transition btn-delete ${isViewer ? 'hidden' : ''}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  updateStudentMoneyPaginationInfo(startIndex + 1, endIndex, totalEntries);
}

function updateStudentMoneyPaginationInfo(start, end, total) {
  const info = document.getElementById('stm-pagination-info');
  if (info) info.textContent = `Showing ${start} to ${end} of ${total} entries`;

  const btnPrev = document.getElementById('stm-btn-prev');
  const btnNext = document.getElementById('stm-btn-next');

  if (btnPrev) btnPrev.disabled = (gStudentMoneyPage <= 1);
  if (btnNext) btnNext.disabled = (end >= total);
}

function changePageStudentMoney(delta) {
  gStudentMoneyPage += delta;
  renderStudentMoneyHistoryTable();
}

/**
 * 💡 Tab 2: Render Individual Student Wallet Summary Table (1 Student = 1 Row)
 */
function onSearchInputStudentMoneySummary() {
  const searchInput = document.getElementById('stm-summary-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  gStudentMoneyFilteredSummaryData = gStudentMoneySummaryData.filter(r => {
    if (!query) return true;
    const nameMatch = String(r.fyidName || '').toLowerCase().includes(query);
    const fyidMatch = String(r.fyid || '').toLowerCase().includes(query);
    const idMatch = String(r.studentId || '').includes(query);
    const classMatch = String(r.class || '').toLowerCase().includes(query);

    return nameMatch || fyidMatch || idMatch || classMatch;
  });

  renderStudentMoneySummaryTable();
}

function renderStudentMoneySummaryTable() {
  const tbody = document.getElementById('stm-summary-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  if (!gStudentMoneyFilteredSummaryData || gStudentMoneyFilteredSummaryData.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ကျောင်းသား လက်ကျန်စာရင်း မရှိပါ။</td></tr>`;
    return;
  }

  gStudentMoneyFilteredSummaryData.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 text-slate-300 text-xs border-b border-slate-800/40';

    const bal = Number(row.netBalance || 0);
    const statusBadge = bal > 0
      ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active Balance</span>'
      : (bal < 0 ? '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">Overdrawn (အနုတ်)</span>' : '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-700/50">Zero (လက်ကျန်မရှိ)</span>');

    tr.innerHTML = `
      <td class="text-center font-mono font-semibold text-slate-400 py-3 px-2">${idx + 1}</td>
      <td class="font-mono font-bold text-indigo-300 py-3 px-2">${row.studentId}</td>
      <td class="font-mono font-bold py-3 px-2 text-slate-300">${escapeHtml(row.fyid)}</td>
      <td class="font-bold text-white py-3 px-2">${escapeHtml(row.fyidName)}</td>
      <td class="py-3 px-2">${escapeHtml(row.class)}</td>
      <td class="text-right font-mono font-bold text-emerald-400 py-3 px-2">${Number(row.totalDeposit || 0).toLocaleString()} MMK</td>
      <td class="text-right font-mono font-bold text-rose-400 py-3 px-2">${Number(row.totalWithdraw || 0).toLocaleString()} MMK</td>
      <td class="text-right font-mono font-extrabold ${bal < 0 ? 'text-rose-400' : 'text-amber-300'} text-xs py-3 px-2">${bal.toLocaleString()} MMK</td>
      <td class="text-center py-3 px-2">${statusBadge}</td>
      <td class="text-center right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg py-3 px-2">
        <button onclick="openStudentStatementModal(${row.studentId})" class="px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600 text-indigo-300 hover:text-white rounded text-[11px] font-bold transition flex items-center gap-1 mx-auto">
          <i class="fa-solid fa-file-invoice"></i> Statement
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/**
 * 💡 3. Student Statement Timeline Modal (View complete individual history)
 */
async function openStudentStatementModal(studentId) {
  if (!studentId) return;

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const res = await callApi('getStudentMoneyData', {
      studentId: studentId,
      limit: 1000,
      forceRefresh: true
    }, 'GET');

    if (res && res.success) {
      const records = res.data || [];
      if (records.length === 0) {
        if (typeof showToast === 'function') showToast("ERROR", "ဤကျောင်းသားအတွက် ငွေသွင်း/ငွေထုတ် စာရင်း မရှိသေးပါ။");
        return;
      }

      const firstRow = records[0];
      const nameEl = document.getElementById('stm-stmt-student-name');
      const infoEl = document.getElementById('stm-stmt-student-info');

      if (nameEl) nameEl.textContent = `${firstRow.fyidName} - Pocket Money Statement`;
      if (infoEl) infoEl.textContent = `FY: ${firstRow.fy} | Class: ${firstRow.class} | ID: ${firstRow.studentId}`;

      let totDep = 0, totWith = 0;
      records.forEach(r => {
        totDep += Number(r.debit || 0);
        totWith += Number(r.credit || 0);
      });
      const netBal = totDep - totWith;

      const depEl = document.getElementById('stm-stmt-total-deposit');
      const withEl = document.getElementById('stm-stmt-total-withdraw');
      const balEl = document.getElementById('stm-stmt-current-balance');

      if (depEl) depEl.textContent = `${totDep.toLocaleString()} MMK`;
      if (withEl) withEl.textContent = `${totWith.toLocaleString()} MMK`;
      if (balEl) balEl.textContent = `${netBal.toLocaleString()} MMK`;

      const tbody = document.getElementById('stm-stmt-table-body');
      if (tbody) {
        // Chronological order for statement
        const chronoList = [...records].reverse();
        let running = 0;

        tbody.innerHTML = chronoList.map((r, i) => {
          running = running + Number(r.debit || 0) - Number(r.credit || 0);
          return `
            <tr class="hover:bg-slate-800/30 text-xs">
              <td class="text-center font-mono py-2 px-3 text-slate-400">${i + 1}</td>
              <td class="font-mono py-2 px-3 text-slate-300">${r.date}</td>
              <td class="py-2 px-3 font-semibold">${r.method}</td>
              <td class="text-right font-mono font-bold text-emerald-400 py-2 px-3">${r.debit > 0 ? Number(r.debit).toLocaleString() : '-'}</td>
              <td class="text-right font-mono font-bold text-rose-400 py-2 px-3">${r.credit > 0 ? Number(r.credit).toLocaleString() : '-'}</td>
              <td class="text-right font-mono font-bold text-indigo-400 py-2 px-3">${running.toLocaleString()}</td>
              <td class="py-2 px-3 text-slate-400 max-w-xs truncate" title="${escapeHtml(r.remark)}">${escapeHtml(r.remark || '-')}</td>
            </tr>
          `;
        }).join('');
      }

      const modal = document.getElementById('stm-statement-modal');
      if (modal) modal.classList.remove('hidden');
    }
  } catch (err) {
    console.error("Statement Load Error:", err);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function closeStudentStatementModal() {
  document.getElementById('stm-statement-modal')?.classList.add('hidden');
}

/**
 * 💡 Student Lookup & Live Remaining Balance in Entry Form
 */
async function onStudentIdOrFYChangeMoney() {
  const fyVal = document.getElementById('stm-fy')?.value || '2026-2027';
  const idVal = document.getElementById('stm-id-search')?.value.trim();

  const fyidShow = document.getElementById('stm-fyid-show');
  const fyidNameShow = document.getElementById('stm-fyidname-show');
  const classEl = document.getElementById('stm-class');

  const liveBadge = document.getElementById('stm-wallet-live-badge');
  const liveAmountEl = document.getElementById('stm-wallet-live-amount');

  if (!idVal) {
    if (fyidShow) fyidShow.value = "";
    if (fyidNameShow) fyidNameShow.value = "";
    if (classEl) classEl.value = "";
    if (liveBadge) liveBadge.classList.add('hidden');
    return;
  }

  const targetIdNum = parseInt(idVal, 10);
  if (!gStudentCacheForMoney[fyVal]) {
    try {
      const res = await callApi('getStudentData', { fy: fyVal, limit: 5000 }, 'GET');
      if (res && res.success) {
        gStudentCacheForMoney[fyVal] = res.data || [];
      }
    } catch (e) {
      console.warn("Student cache preload warning:", e);
    }
  }

  const list = gStudentCacheForMoney[fyVal] || [];
  const matched = list.find(s => {
    const sId = parseInt(s.studentId || s.student_id || s.id, 10);
    return sId === targetIdNum;
  });

  if (matched) {
    const actualFyid = sanitizeFyidStr(matched.fyid);
    const actualName = matched.name || matched.fyidName || '';

    if (fyidShow) fyidShow.value = actualFyid;
    if (fyidNameShow) fyidNameShow.value = `[${actualFyid}] ${actualName}`;
    if (classEl) classEl.value = matched.class || '';

    // 💡 Fetch & Show Live Wallet Balance for this student
    try {
      const sumRes = await callApi('getStudentMoneySummary', { fy: fyVal, searchVal: actualFyid }, 'GET');
      if (sumRes && sumRes.success && sumRes.data && sumRes.data.length > 0) {
        const studentSum = sumRes.data.find(r => r.studentId === targetIdNum);
        if (studentSum && liveBadge && liveAmountEl) {
          liveAmountEl.textContent = `${Number(studentSum.netBalance || 0).toLocaleString()} MMK`;
          liveBadge.classList.remove('hidden');
        }
      }
    } catch (err) {}
  } else {
    if (fyidShow) fyidShow.value = `${getFyShortCode(fyVal)}-STU-${String(targetIdNum).padStart(4, '0')}`;
    if (fyidNameShow) fyidNameShow.value = "ကျောင်းသား ရှာမတွေ့ပါ";
    if (classEl) classEl.value = "";
    if (liveBadge) liveBadge.classList.add('hidden');
  }
}

function openAddModalStudentMoney() {
  const form = document.getElementById('student-money-form');
  if (form) form.reset();

  const uidEl = document.getElementById('stm-uniqueId');
  if (uidEl) uidEl.value = '';

  const dateEl = document.getElementById('stm-date');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  const debEl = document.getElementById('stm-debit');
  if (debEl) debEl.value = 0;

  const credEl = document.getElementById('stm-credit');
  if (credEl) credEl.value = 0;

  populateFYDropdownMoney();

  const title = document.getElementById('stm-form-title');
  if (title) title.textContent = 'Add Student Money Entry';

  const liveBadge = document.getElementById('stm-wallet-live-badge');
  if (liveBadge) liveBadge.classList.add('hidden');

  const modal = document.getElementById('student-money-modal');
  if (modal) modal.classList.remove('hidden');
}

function closeStudentMoneyModal() {
  document.getElementById('student-money-modal')?.classList.add('hidden');
}

function populateFYDropdownMoney() {
  const select = document.getElementById('stm-fy');
  if (!select) return;

  const year = new Date().getFullYear();
  select.innerHTML = `
    <option value="${year - 1}-${year}">${year - 1}-${year}</option>
    <option value="${year}-${year + 1}" selected>${year}-${year + 1}</option>
    <option value="${year + 1}-${year + 2}">${year + 1}-${year + 2}</option>
  `;
}

async function saveStudentMoneyForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (isStudentMoneySubmitting) return;
  isStudentMoneySubmitting = true;

  const idVal = parseInt(document.getElementById('stm-id-search')?.value, 10);
  const fyidShowVal = document.getElementById('stm-fyid-show')?.value;
  const fyidNameVal = document.getElementById('stm-fyidname-show')?.value;

  if (!idVal || !fyidShowVal || fyidNameVal.includes("ကျောင်းသား ရှာမတွေ့ပါ")) {
    isStudentMoneySubmitting = false;
    if (typeof showToast === 'function') showToast("ERROR", "ကျောင်းသား အချက်အလက် မပြည့်စုံပါ။");
    return;
  }

  const uid = document.getElementById('stm-uniqueId')?.value || '';
  const payload = {
    uniqueId: uid,
    studentId: idVal,
    fyid: fyidShowVal,
    fyidName: fyidNameVal,
    class: document.getElementById('stm-class')?.value || '',
    fy: document.getElementById('stm-fy')?.value || '2026-2027',
    date: document.getElementById('stm-date')?.value || new Date().toISOString().slice(0, 10),
    method: document.getElementById('stm-method')?.value || 'Cash',
    debit: parseFloat(document.getElementById('stm-debit')?.value || 0),
    credit: parseFloat(document.getElementById('stm-credit')?.value || 0),
    remark: document.getElementById('stm-remark')?.value || ''
  };

  closeStudentMoneyModal();
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    const actionName = uid ? 'updateStudentMoneyEntry' : 'saveStudentMoneyEntry';
    const res = await callApi(actionName, payload);

    if (res && res.success) {
      if (typeof showToast === 'function') showToast('SUCCESS', 'ကျောင်းသားငွေစာရင်း အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။');
      if (typeof clearAllApiCache === 'function') clearAllApiCache();
      
      if (gCurrentStudentMoneyTab === 'history') {
        loadStudentMoneyData(false);
      } else {
        loadStudentMoneySummaryData(false);
      }
    } else {
      if (typeof showToast === 'function') showToast("ERROR", res?.message || "သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
  } finally {
    isStudentMoneySubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function editStudentMoneyEntry(uniqueId) {
  const row = gStudentMoneyHistoryData.find(item => item.uniqueId === uniqueId);
  if (!row) {
    if (typeof showToast === 'function') showToast("ERROR", "မူရင်း စာရင်း ရှာမတွေ့ပါ။");
    return;
  }

  openAddModalStudentMoney();

  document.getElementById('stm-uniqueId').value = row.uniqueId;
  document.getElementById('stm-date').value = row.date;
  document.getElementById('stm-id-search').value = row.studentId;
  document.getElementById('stm-fyid-show').value = row.fyid;
  document.getElementById('stm-fyidname-show').value = row.fyidName;
  document.getElementById('stm-class').value = row.class;
  document.getElementById('stm-fy').value = row.fy.replace(/^FY\s*/i, '');
  document.getElementById('stm-method').value = row.method || 'Cash';
  document.getElementById('stm-debit').value = row.debit || 0;
  document.getElementById('stm-credit').value = row.credit || 0;
  document.getElementById('stm-remark').value = row.remark || '';

  const title = document.getElementById('stm-form-title');
  if (title) title.textContent = 'Edit Student Money Entry';

  onStudentIdOrFYChangeMoney();
}

async function deleteStudentMoneyEntry(uniqueId) {
  if (!confirm("ဤ ကျောင်းသားငွေစာရင်းအား အပြီးတိုင် ဖျက်သိမ်းလိုပါသလား။")) return;

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    const res = await callApi('deleteStudentMoneyEntry', { uniqueId });

    if (res && res.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", "ကျောင်းသားငွေစာရင်း ဖျက်သိမ်းပြီးပါပြီ။");
      if (typeof clearAllApiCache === 'function') clearAllApiCache();
      loadStudentMoneyData(false);
    } else {
      if (typeof showToast === 'function') showToast("ERROR", res?.message || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function exportToCSVStudentMoney() {
  if (!gStudentMoneyHistoryData || gStudentMoneyHistoryData.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် စာရင်း မရှိပါ။");
    return;
  }
  let csv = "NO,DATE,FY,ID,FYID,NAME,CLASS,METHOD,DEBIT,CREDIT,BALANCES,REMARK\n";
  gStudentMoneyHistoryData.forEach(r => {
    csv += `${r.no},${r.date},${r.fy},${r.studentId},${r.fyid},"${r.fyidName}",${r.class},${r.method},${r.debit},${r.credit},${r.balances},"${r.remark || ''}"\n`;
  });
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Student_Money_Transactions_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

function exportStudentMoneySummaryToCSV() {
  if (!gStudentMoneySummaryData || gStudentMoneySummaryData.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် လက်ကျန်စာရင်း မရှိပါ။");
    return;
  }
  let csv = "NO,STUDENT_ID,FYID,NAME,CLASS,TOTAL_DEPOSITED,TOTAL_WITHDRAWN,WALLET_BALANCE,TOTAL_TRANSACTIONS,LAST_DATE\n";
  gStudentMoneySummaryData.forEach(r => {
    csv += `${r.no},${r.studentId},${r.fyid},"${r.fyidName}",${r.class},${r.totalDeposit},${r.totalWithdraw},${r.netBalance},${r.transactionCount},${r.lastDate}\n`;
  });
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Student_Wallet_Balances_Summary_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// 💡 EXPOSE GLOBALLY
window.switchStudentMoneySubTab = switchStudentMoneySubTab;
window.loadStudentMoneyData = loadStudentMoneyData;
window.loadStudentMoneySummaryData = loadStudentMoneySummaryData;
window.openStudentStatementModal = openStudentStatementModal;
window.closeStudentStatementModal = closeStudentStatementModal;
window.onStudentIdOrFYChangeMoney = onStudentIdOrFYChangeMoney;
window.openAddModalStudentMoney = openAddModalStudentMoney;
window.closeStudentMoneyModal = closeStudentMoneyModal;
window.saveStudentMoneyForm = saveStudentMoneyForm;
window.editStudentMoneyEntry = editStudentMoneyEntry;
window.deleteStudentMoneyEntry = deleteStudentMoneyEntry;
window.exportToCSVStudentMoney = exportToCSVStudentMoney;
window.exportStudentMoneySummaryToCSV = exportStudentMoneySummaryToCSV;
window.onSearchInputStudentMoney = onSearchInputStudentMoney;
window.onSearchInputStudentMoneySummary = onSearchInputStudentMoneySummary;
window.clearDateFilterStudentMoney = clearDateFilterStudentMoney;
window.changePageStudentMoney = changePageStudentMoney;
