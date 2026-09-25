/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - SPMMS (3-LEDGERS ARCHITECTURE)
 * File: js/student-money.js
 * 💡 Features: Finance Vault + PM Cashier + Canteen Book + Auto-Reconciliation
 * ==============================================================================
 */

var gCurrentStudentMoneyTab = 'main'; // 'main', 'canteen', 'cashier', 'reconcile'

var gStudentMoneyHistoryData = [];
var gStudentMoneyFilteredData = [];
var gStudentMoneyPage = 1, gStudentMoneyLimit = 20;

var gCanteenBookData = [];
var gCanteenBookFilteredData = [];
var gCanteenPage = 1, gCanteenLimit = 20;

var gPmCashierBookData = [];
var gPmCashierBookFilteredData = [];
var gPmCashierPage = 1, gPmCashierLimit = 20;

var gStudentCacheForMoney = {};
var isSubmitting = false;
var searchTimeout = null;

// ==============================================================================
// 💡 1. MAIN TAB SWITCHER
// ==============================================================================
function switchStudentMoneySubTab(tabName) {
  gCurrentStudentMoneyTab = tabName || 'main';
  const tabs = ['main', 'canteen', 'cashier', 'reconcile'];
  
  const activeClass = 'px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 bg-indigo-600 text-white shadow-lg shadow-indigo-600/20';
  const inactiveClass = 'px-4 py-2 rounded-lg text-xs font-black transition-all flex items-center gap-2 bg-slate-800 text-slate-400 hover:text-white border border-slate-700/50';

  tabs.forEach(t => {
    const btn = document.getElementById(`stm-tab-${t}`);
    const view = document.getElementById(`stm-${t}-view`);
    if (btn) btn.className = (t === gCurrentStudentMoneyTab) ? activeClass : inactiveClass;
    if (view) view.classList.toggle('hidden', t !== gCurrentStudentMoneyTab);
  });

  const kpi1 = document.getElementById('stm-kpi-1-label');
  const kpi2 = document.getElementById('stm-kpi-2-label');
  const kpi3 = document.getElementById('stm-kpi-3-label');
  const kpi4 = document.getElementById('stm-kpi-4-label');

  if (gCurrentStudentMoneyTab === 'main') {
    if (kpi1) kpi1.textContent = 'TOTAL DEPOSITED (အပ်ငွေ)';
    if (kpi2) kpi2.textContent = 'TOTAL WITHDRAWN/TRANSFER (ထုတ်ငွေ)';
    if (kpi3) kpi3.textContent = 'CURRENT TRUST BALANCE';
    if (kpi4) kpi4.textContent = 'TOTAL ENTRIES';
    loadStudentMoneyData(false);
  } else if (gCurrentStudentMoneyTab === 'canteen') {
    loadCanteenBookData(false);
  } else if (gCurrentStudentMoneyTab === 'cashier') {
    loadPmCashierBookData(false);
  } else if (gCurrentStudentMoneyTab === 'reconcile') {
    loadSpmmsReconciliationData();
  }
}

function renderTopKPIs(inc, exp, bal, count) {
  document.getElementById('stm-total-income').textContent = `${Number(inc || 0).toLocaleString('en-US')} MMK`;
  document.getElementById('stm-total-expense').textContent = `${Number(exp || 0).toLocaleString('en-US')} MMK`;
  document.getElementById('stm-balance').textContent = `${Number(bal || 0).toLocaleString('en-US')} MMK`;
  document.getElementById('stm-entries-count').textContent = Number(count || 0).toLocaleString('en-US');
}

// ==============================================================================
// 💡 2. STUDENT MONEY BOOK (MAIN FINANCE & VIRTUAL WALLET)
// ==============================================================================
async function loadStudentMoneyData(isSilent) {
  try {
    if (!isSilent) toggleLoading(true);
    const res = await callApi('getStudentMoneyData', { page: 1, limit: 5000, forceRefresh: true }, 'GET');
    if (res && res.success) {
      gStudentMoneyHistoryData = res.data || [];
      renderTopKPIs(res.stats.totalIncome, res.stats.totalExpense, res.stats.balance, gStudentMoneyHistoryData.length);
      applyStudentMoneySearchAndRender();
    }
  } catch (err) {} finally { if (!isSilent) toggleLoading(false); }
}

function applyStudentMoneySearchAndRender() {
  const query = (document.getElementById('stm-search')?.value || '').trim().toLowerCase();
  const fDate = document.getElementById('stm-date-from')?.value || '';
  const tDate = document.getElementById('stm-date-to')?.value || '';

  gStudentMoneyFilteredData = gStudentMoneyHistoryData.filter(r => {
    if (typeof window.isDateInRange === 'function' && !window.isDateInRange(r.date, fDate, tDate)) return false;
    if (!query) return true;
    return String(r.fyidName || '').toLowerCase().includes(query) ||
           String(r.remark || '').toLowerCase().includes(query) ||
           String(r.studentId || '').includes(query);
  });
  gStudentMoneyPage = 1;
  renderStudentMoneyTable();
}

function renderStudentMoneyTable() {
  const tbody = document.getElementById('stm-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const total = gStudentMoneyFilteredData.length;
  const start = (gStudentMoneyPage - 1) * gStudentMoneyLimit;
  const items = gStudentMoneyFilteredData.slice(start, start + gStudentMoneyLimit);

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="13" class="text-center py-8 text-slate-500 font-bold">စာရင်း မရှိပါ။</td></tr>`;
    document.getElementById('stm-pagination-info').textContent = "Showing 0 entries";
    return;
  }

  items.forEach((row, idx) => {
    const isSys = row.studentId === 0;
    const cleanFyid = window.sanitizeFyidStr(row.fyid);
    const balStr = Number(row.balances || 0).toLocaleString('en-US', {minimumFractionDigits: 2});
    
    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/30 text-slate-300 text-xs border-b border-slate-800/40">
        <td class="text-center font-mono py-3 px-2">${start + idx + 1}</td>
        <td class="font-mono text-xs py-3 px-2">${window.escapeHtml(row.date)}</td>
        <td class="font-mono font-bold text-indigo-300 py-3 px-2">${window.escapeHtml(row.fy)}</td>
        <td class="font-mono font-bold py-3 px-2">${isSys ? 'SYS' : row.studentId}</td>
        <td class="font-mono font-bold ${isSys ? 'text-amber-400' : 'text-indigo-400'} py-3 px-2">${window.escapeHtml(cleanFyid)}</td>
        <td class="font-bold ${isSys ? 'text-amber-300' : 'text-slate-100'} py-3 px-2">${window.escapeHtml(row.fyidName)}</td>
        <td class="py-3 px-2">${window.escapeHtml(row.class)}</td>
        <td class="font-semibold py-3 px-2">${window.escapeHtml(row.method)}</td>
        <td class="text-right text-emerald-400 font-mono font-bold py-3 px-2">${row.debit > 0 ? Number(row.debit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right text-rose-400 font-mono font-bold py-3 px-2">${row.credit > 0 ? Number(row.credit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right text-indigo-400 font-mono font-bold py-3 px-2">${balStr}</td>
        <td class="max-w-xs truncate text-[11px] text-slate-400 py-3 px-2" title="${window.escapeHtml(row.remark)}">${window.escapeHtml(row.remark || '-')}</td>
        <td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 text-center py-3 px-2">
          <div class="flex justify-center gap-2">
            ${!isSys ? `<button onclick="openStudentStatementModal(${row.studentId})" class="text-amber-400 hover:text-amber-300"><i class="fa-solid fa-file-invoice"></i></button>` : ''}
            <button onclick="deleteStudentMoneyEntry('${window.escapeJsAttr(row.uniqueId)}')" class="text-rose-400 hover:text-rose-300"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
  
  document.getElementById('stm-pagination-info').textContent = `Showing ${start + 1} to ${Math.min(start + gStudentMoneyLimit, total)} of ${total} entries`;
}

function onSearchInputStudentMoney() { clearTimeout(searchTimeout); searchTimeout = setTimeout(applyStudentMoneySearchAndRender, 150); }
function clearDateFilterStudentMoney() { document.getElementById('stm-date-from').value = ''; document.getElementById('stm-date-to').value = ''; applyStudentMoneySearchAndRender(); }
function changePageStudentMoney(delta) { gStudentMoneyPage += delta; renderStudentMoneyTable(); }

// 💡 Student Money Modal Controls
function openAddModalStudentMoney() {
  document.getElementById('student-money-form').reset();
  document.getElementById('stm-date').value = new Date().toISOString().slice(0, 10);
  onStudentMoneyEntryTypeChange();
  document.getElementById('student-money-modal').classList.remove('hidden');
}

function closeStudentMoneyModal() { document.getElementById('student-money-modal').classList.add('hidden'); }

function onStudentMoneyEntryTypeChange() {
  const type = document.getElementById('stm-entry-type').value;
  const stuBox = document.getElementById('stm-student-fields');
  const respBox = document.getElementById('stm-resp-person-box');
  const deb = document.getElementById('stm-debit');
  const cred = document.getElementById('stm-credit');
  const desc = document.getElementById('stm-remark');

  if (type === 'Transfer to PM Cashier') {
    stuBox.classList.add('hidden');
    respBox.classList.remove('hidden');
    deb.disabled = true; deb.value = 0; cred.disabled = false;
    desc.value = "Finance မှ PM Cashier သို့ အရင်းငွေလွှဲပေးခြင်း";
  } else {
    stuBox.classList.remove('hidden');
    respBox.classList.add('hidden');
    if (type === 'Deposit') { deb.disabled = false; cred.disabled = true; cred.value = 0; desc.value = "ကျောင်းသား မုန့်ဖိုးအပ်ငွေ"; }
    else { deb.disabled = true; deb.value = 0; cred.disabled = false; desc.value = "ကျောင်းသားအား ငွေသားပြန်ထုတ်ပေးခြင်း"; }
  }
}

async function onStudentIdOrFYChangeMoney() {
  const idVal = document.getElementById('stm-id-search')?.value.trim();
  if (!idVal) return;
  const targetId = parseInt(idVal, 10);
  try {
    const res = await callApi('getStudentMoneySummary', { searchVal: targetId }, 'GET');
    if (res && res.success && res.data && res.data.length > 0) {
      const stu = res.data.find(r => r.studentId === targetId);
      if (stu) {
        document.getElementById('stm-fyid-show').value = stu.fyid || '';
        document.getElementById('stm-fyidname-show').value = stu.fyidName || '';
        document.getElementById('stm-class').value = stu.class || '';
        document.getElementById('stm-wallet-live-amount').textContent = `${Number(stu.netBalance || 0).toLocaleString('en-US')} MMK`;
        document.getElementById('stm-wallet-live-badge').classList.remove('hidden');
      }
    }
  } catch(e) {}
}

async function saveStudentMoneyForm(e) {
  e.preventDefault();
  if (isSubmitting) return;
  isSubmitting = true;

  const entryType = document.getElementById('stm-entry-type').value;
  const credit = parseFloat(document.getElementById('stm-credit').value || 0);
  const debit = parseFloat(document.getElementById('stm-debit').value || 0);
  const studentId = parseInt(document.getElementById('stm-id-search').value, 10) || 0;

  if (entryType === 'Transfer to PM Cashier' && credit <= 0) {
    isSubmitting = false; return showToast("ERROR", "PM Cashier သို့ လွှဲမည့် Credit ပမာဏ ထည့်ပါ။");
  }
  if (entryType !== 'Transfer to PM Cashier' && (!studentId || (debit <= 0 && credit <= 0))) {
    isSubmitting = false; return showToast("ERROR", "ကျောင်းသား ID နှင့် ပမာဏ အတိအကျ ထည့်ပါ။");
  }

  const payload = {
    uniqueId: document.getElementById('stm-uniqueId').value || '',
    date: document.getElementById('stm-date').value,
    fy: document.getElementById('stm-fy')?.value || window.getCurrentAcademicYear(),
    entryType: entryType,
    method: document.getElementById('stm-method').value,
    debit: debit, credit: credit,
    remark: document.getElementById('stm-remark').value,
    studentId: entryType === 'Transfer to PM Cashier' ? 0 : studentId,
    fyid: document.getElementById('stm-fyid-show')?.value || '',
    name: document.getElementById('stm-fyidname-show')?.value || '',
    class: document.getElementById('stm-class')?.value || '',
    responsibilityPerson: document.getElementById('stm-responsibility-person')?.value || ''
  };

  closeStudentMoneyModal();
  toggleLoading(true);
  try {
    const res = await callApi('saveStudentMoneyEntry', payload);
    if (res && res.success) {
      showToast('SUCCESS', 'စာရင်းမှတ်တမ်းတင်ပြီးပါပြီ။ Double-Entry စနစ်ဖြင့် အလုပ်လုပ်ပါသည်။');
      loadStudentMoneyData(false);
    } else { showToast('ERROR', res.message); }
  } catch (err) { showToast('ERROR', err.message); }
  finally { isSubmitting = false; toggleLoading(false); }
}

async function deleteStudentMoneyEntry(uniqueId) {
  if (!confirm("ဤစာရင်းအား ဖျက်ပါက ဆက်စပ်နေသော Cashier စာရင်းများပါ ပယ်ဖျက်သွားပါမည်။ သေချာပါသလား?")) return;
  toggleLoading(true);
  try {
    const res = await callApi('deleteStudentMoneyEntry', { uniqueId });
    if (res && res.success) loadStudentMoneyData(false);
  } catch (err) {} finally { toggleLoading(false); }
}

// ==============================================================================
// 💡 3. CANTEEN BOOK (WITH DAILY KPI)
// ==============================================================================
async function loadCanteenBookData(isSilent) {
  try {
    if (!isSilent) toggleLoading(true);
    const res = await callApi('getCanteenBookData', { forceRefresh: true }, 'GET');
    if (res && res.success) {
      gCanteenBookData = res.data || [];
      applyCanteenBookSearchAndRender(); // This will also calculate KPIs
    }
  } catch (err) {} finally { if (!isSilent) toggleLoading(false); }
}

function applyCanteenBookSearchAndRender() {
  const query = (document.getElementById('canteen-search')?.value || '').trim().toLowerCase();
  const fDate = document.getElementById('canteen-date-from')?.value || '';
  const tDate = document.getElementById('canteen-date-to')?.value || '';

  let todaySales = 0;
  const todayStr = new Date().toISOString().slice(0, 10);

  gCanteenBookFilteredData = gCanteenBookData.filter(row => {
    if (row.date === todayStr && row.category === 'POS Sales') todaySales += Number(row.debit || 0);

    if (typeof window.isDateInRange === 'function' && !window.isDateInRange(row.date, fDate, tDate)) return false;
    if (!query) return true;
    return String(row.description || '').toLowerCase().includes(query) || String(row.vrNo || '').toLowerCase().includes(query);
  });

  // Calculate Filtered KPIs
  let filteredSales = 0;
  gCanteenBookFilteredData.forEach(r => { if (r.category === 'POS Sales') filteredSales += Number(r.debit || 0); });

  document.getElementById('canteen-today-sales').textContent = `${todaySales.toLocaleString('en-US')} MMK`;
  document.getElementById('canteen-filtered-sales').textContent = `${filteredSales.toLocaleString('en-US')} MMK`;
  document.getElementById('canteen-filtered-count').textContent = gCanteenBookFilteredData.length;

  gCanteenPage = 1;
  renderCanteenBookTable();
}

function setFilterCanteenToday() {
  const t = new Date().toISOString().slice(0, 10);
  document.getElementById('canteen-date-from').value = t;
  document.getElementById('canteen-date-to').value = t;
  applyCanteenBookSearchAndRender();
}

function renderCanteenBookTable() {
  const tbody = document.getElementById('canteen-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const total = gCanteenBookFilteredData.length;
  const start = (gCanteenPage - 1) * gCanteenLimit;
  const items = gCanteenBookFilteredData.slice(start, start + gCanteenLimit);

  items.forEach((row, idx) => {
    const balStr = Number(row.balances || 0).toLocaleString('en-US', {minimumFractionDigits: 2});
    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/30 text-slate-300 text-xs border-b border-slate-800/40">
        <td class="text-center font-mono py-3 px-2">${start + idx + 1}</td>
        <td class="font-mono py-3 px-2">${window.escapeHtml(row.date)}</td>
        <td class="py-3 px-2 font-bold text-emerald-400">${window.escapeHtml(row.category)}</td>
        <td class="py-3 px-2 truncate max-w-xs">${window.escapeHtml(row.description || '')}</td>
        <td class="py-3 px-2">${window.escapeHtml(row.method)}</td>
        <td class="text-right font-mono text-emerald-400 py-3 px-2">${row.debit > 0 ? Number(row.debit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right font-mono text-rose-400 py-3 px-2">${row.credit > 0 ? Number(row.credit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right font-mono text-indigo-400 font-bold py-3 px-2">${balStr}</td>
        <td class="font-mono text-slate-500 py-3 px-2">${window.escapeHtml(row.vrNo || '-')}</td>
        <td class="font-mono text-slate-500 py-3 px-2">${window.escapeHtml(row.fy)}</td>
        <td class="text-center right-0 sticky bg-[#0c1322] py-3 px-2">
          <button onclick="deleteCanteenBookEntry('${window.escapeJsAttr(row.uniqueId)}')" class="text-rose-400"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
  document.getElementById('canteen-pagination-info').textContent = `Showing ${start + 1} to ${Math.min(start + gCanteenLimit, total)} of ${total} entries`;
}

function onSearchInputCanteenBook() { clearTimeout(searchTimeout); searchTimeout = setTimeout(applyCanteenBookSearchAndRender, 150); }
function clearDateFilterCanteenBook() { document.getElementById('canteen-date-from').value = ''; document.getElementById('canteen-date-to').value = ''; applyCanteenBookSearchAndRender(); }
function changePageCanteenBook(delta) { gCanteenPage += delta; renderCanteenBookTable(); }

async function deleteCanteenBookEntry(uniqueId) {
  if (!confirm("ဖျက်မည်မှာ သေချာပါသလား?")) return;
  toggleLoading(true);
  try {
    const res = await callApi('deleteCanteenBookEntry', { uniqueId });
    if (res && res.success) loadCanteenBookData(false);
  } catch (err) {} finally { toggleLoading(false); }
}

// ==============================================================================
// 💡 4. PM CASHIER BOOK
// ==============================================================================
async function loadPmCashierBookData(isSilent) {
  try {
    if (!isSilent) toggleLoading(true);
    const res = await callApi('getPmCashierBookData', { forceRefresh: true }, 'GET');
    if (res && res.success) {
      gPmCashierBookData = res.data || [];
      applyPmCashierBookSearchAndRender();
    }
  } catch (err) {} finally { if (!isSilent) toggleLoading(false); }
}

function applyPmCashierBookSearchAndRender() {
  const query = (document.getElementById('pm-cashier-search')?.value || '').trim().toLowerCase();
  const fDate = document.getElementById('pm-cashier-date-from')?.value || '';
  const tDate = document.getElementById('pm-cashier-date-to')?.value || '';
  const respFilter = document.getElementById('pm-cashier-resp-filter')?.value || '';

  gPmCashierBookFilteredData = gPmCashierBookData.filter(row => {
    if (typeof window.isDateInRange === 'function' && !window.isDateInRange(row.date, fDate, tDate)) return false;
    if (respFilter && row.responsibility_person !== respFilter) return false;
    if (!query) return true;
    return String(row.description || '').toLowerCase().includes(query) || String(row.vrNo || '').toLowerCase().includes(query);
  });

  gPmCashierPage = 1;
  renderPmCashierBookTable();
}

function renderPmCashierBookTable() {
  const tbody = document.getElementById('pm-cashier-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';
  
  const total = gPmCashierBookFilteredData.length;
  const start = (gPmCashierPage - 1) * gPmCashierLimit;
  const items = gPmCashierBookFilteredData.slice(start, start + gPmCashierLimit);

  items.forEach((row, idx) => {
    const balStr = Number(row.balances || 0).toLocaleString('en-US', {minimumFractionDigits: 2});
    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/30 text-slate-300 text-xs border-b border-slate-800/40">
        <td class="text-center font-mono py-3 px-2">${start + idx + 1}</td>
        <td class="font-mono py-3 px-2">${window.escapeHtml(row.date)}</td>
        <td class="font-bold text-sky-400 py-3 px-2">${window.escapeHtml(row.responsibility_person || '-')}</td>
        <td class="py-3 px-2">${window.escapeHtml(row.category)}</td>
        <td class="py-3 px-2 truncate max-w-xs">${window.escapeHtml(row.description || '')}</td>
        <td class="py-3 px-2">${window.escapeHtml(row.method)}</td>
        <td class="text-right font-mono text-emerald-400 py-3 px-2">${row.debit > 0 ? Number(row.debit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right font-mono text-rose-400 py-3 px-2">${row.credit > 0 ? Number(row.credit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right font-mono text-indigo-400 font-bold py-3 px-2">${balStr}</td>
        <td class="font-mono text-slate-500 py-3 px-2">${window.escapeHtml(row.vrNo || '-')}</td>
        <td class="font-mono text-slate-500 py-3 px-2">${window.escapeHtml(row.fy)}</td>
        <td class="text-center right-0 sticky bg-[#0c1322] py-3 px-2">
          <button onclick="deletePmCashierBookEntry('${window.escapeJsAttr(row.uniqueId)}')" class="text-rose-400"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
  document.getElementById('pm-cashier-pagination-info').textContent = `Showing ${start + 1} to ${Math.min(start + gPmCashierLimit, total)} of ${total} entries`;
}

function onSearchInputPmCashierBook() { clearTimeout(searchTimeout); searchTimeout = setTimeout(applyPmCashierBookSearchAndRender, 150); }
function onPmCashierFilterChange() { applyPmCashierBookSearchAndRender(); }
function clearDateFilterPmCashierBook() { document.getElementById('pm-cashier-date-from').value = ''; document.getElementById('pm-cashier-date-to').value = ''; applyPmCashierBookSearchAndRender(); }
function changePagePmCashierBook(delta) { gPmCashierPage += delta; renderPmCashierBookTable(); }

function openAddModalPmCashierBook() {
  document.getElementById('pm-cashier-form').reset();
  document.getElementById('pm-cashier-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('pm-cashier-modal').classList.remove('hidden');
}

function closePmCashierBookModal() { document.getElementById('pm-cashier-modal').classList.add('hidden'); }

async function onPmStudentLookup() {
  const idVal = document.getElementById('pm-student-id-search')?.value.trim();
  if (!idVal) return;
  const targetId = parseInt(idVal, 10);
  try {
    const res = await callApi('getStudentMoneySummary', { searchVal: targetId }, 'GET');
    if (res && res.success && res.data && res.data.length > 0) {
      const stu = res.data.find(r => r.studentId === targetId);
      if (stu) {
        document.getElementById('pm-student-fyid').value = stu.fyid || '';
        document.getElementById('pm-student-name').value = stu.fyidName || '';
        document.getElementById('pm-student-class').value = stu.class || '';
        document.getElementById('pm-student-wallet-bal').textContent = `${Number(stu.netBalance || 0).toLocaleString('en-US')} MMK`;
        document.getElementById('pm-student-wallet-badge').classList.remove('hidden');
      }
    }
  } catch (e) {}
}

async function savePmCashierBookForm(e) {
  e.preventDefault();
  if (isSubmitting) return;
  isSubmitting = true;

  const credit = parseFloat(document.getElementById('pm-cashier-credit').value || 0);
  const studentId = parseInt(document.getElementById('pm-student-id-search').value, 10) || 0;

  if (!studentId || credit <= 0) {
    isSubmitting = false; return showToast("ERROR", "ကျောင်းသား ID နှင့် ထုတ်ပေးငွေ ထည့်ပါ။");
  }

  const payload = {
    date: document.getElementById('pm-cashier-date').value,
    category: 'PM Withdraw',
    studentId: studentId,
    studentName: document.getElementById('pm-student-name').value,
    fyid: document.getElementById('pm-student-fyid').value,
    studentClass: document.getElementById('pm-student-class').value,
    responsibilityPerson: document.getElementById('pm-cashier-responsibility-person').value,
    method: document.getElementById('pm-cashier-method').value,
    debit: 0, credit: credit,
    description: document.getElementById('pm-cashier-description').value
  };

  closePmCashierBookModal();
  toggleLoading(true);
  try {
    const res = await callApi('savePmCashierBookEntry', payload);
    if (res && res.success) {
      showToast('SUCCESS', 'မုန့်ဖိုးထုတ်ပေးပြီးပါပြီ။');
      loadPmCashierBookData(false);
    } else { showToast('ERROR', res.message); }
  } catch (err) {} finally { isSubmitting = false; toggleLoading(false); }
}

async function deletePmCashierBookEntry(uniqueId) {
  if(!confirm("ဖျက်မည်မှာ သေချာပါသလား?")) return;
  toggleLoading(true);
  try {
    const res = await callApi('deletePmCashierBookEntry', { uniqueId });
    if(res && res.success) loadPmCashierBookData(false);
  } catch(err) {} finally { toggleLoading(false); }
}

// ==============================================================================
// 💡 5. RECONCILIATION AUDIT CONTROLLER
// ==============================================================================
async function loadSpmmsReconciliationData() {
  try {
    toggleLoading(true);
    const res = await callApi('getSpmmsReconciliation', { forceRefresh: true }, 'GET');
    if (res && res.success) {
      const data = res.data;
      
      document.getElementById('rec-total-virtual').textContent = `${Number(data.totalVirtual).toLocaleString('en-US', {minimumFractionDigits:2})} MMK`;
      document.getElementById('rec-total-physical').textContent = `${Number(data.totalPhysicalCash).toLocaleString('en-US', {minimumFractionDigits:2})} MMK`;
      document.getElementById('rec-finance-cash').textContent = `${Number(data.totalFinance).toLocaleString('en-US')} MMK`;
      document.getElementById('rec-cashier-cash').textContent = `${Number(data.totalCashier).toLocaleString('en-US')} MMK`;
      document.getElementById('rec-variance').textContent = `${Number(Math.abs(data.variance)).toLocaleString('en-US', {minimumFractionDigits:2})} MMK`;
      
      document.getElementById('rec-eq-virtual').textContent = `${Number(data.totalVirtual).toLocaleString('en-US')} MMK`;
      document.getElementById('rec-eq-finance').textContent = `${Number(data.totalFinance).toLocaleString('en-US')} MMK`;
      document.getElementById('rec-eq-cashier').textContent = `${Number(data.totalCashier).toLocaleString('en-US')} MMK`;

      const badge = document.getElementById('rec-status-badge');
      const verdict = document.getElementById('rec-eq-verdict');
      const desc = document.getElementById('rec-status-desc');

      if (data.isMatched) {
        badge.className = "px-2 py-0.5 rounded text-[10px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
        badge.textContent = "MATCHED";
        verdict.className = "text-xs font-mono font-black text-emerald-400 uppercase";
        verdict.textContent = "100% Balanced";
        desc.className = "text-[11px] text-emerald-400";
        desc.textContent = "စာရင်းနှင့် လက်ကျန်ငွေသား အတိအကျ ကိုက်ညီနေပါသည်။";
      } else {
        badge.className = "px-2 py-0.5 rounded text-[10px] font-black bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse";
        badge.textContent = "UNMATCHED";
        verdict.className = "text-xs font-mono font-black text-rose-400 uppercase";
        verdict.textContent = "Imbalanced!";
        desc.className = "text-[11px] text-rose-400";
        desc.textContent = "သတိပြုရန်! စာရင်းနှင့် ငွေသား ကိုက်ညီမှု မရှိပါ။";
      }
    }
  } catch (err) {} finally { toggleLoading(false); }
}

// Expose to window
window.switchStudentMoneySubTab = switchStudentMoneySubTab;
window.loadStudentMoneyData = loadStudentMoneyData;
window.onSearchInputStudentMoney = onSearchInputStudentMoney;
window.clearDateFilterStudentMoney = clearDateFilterStudentMoney;
window.changePageStudentMoney = changePageStudentMoney;
window.openAddModalStudentMoney = openAddModalStudentMoney;
window.closeStudentMoneyModal = closeStudentMoneyModal;
window.onStudentMoneyEntryTypeChange = onStudentMoneyEntryTypeChange;
window.onStudentIdOrFYChangeMoney = onStudentIdOrFYChangeMoney;
window.saveStudentMoneyForm = saveStudentMoneyForm;
window.deleteStudentMoneyEntry = deleteStudentMoneyEntry;

window.loadCanteenBookData = loadCanteenBookData;
window.onSearchInputCanteenBook = onSearchInputCanteenBook;
window.clearDateFilterCanteenBook = clearDateFilterCanteenBook;
window.changePageCanteenBook = changePageCanteenBook;
window.setFilterCanteenToday = setFilterCanteenToday;
window.deleteCanteenBookEntry = deleteCanteenBookEntry;

window.loadPmCashierBookData = loadPmCashierBookData;
window.onSearchInputPmCashierBook = onSearchInputPmCashierBook;
window.clearDateFilterPmCashierBook = clearDateFilterPmCashierBook;
window.changePagePmCashierBook = changePagePmCashierBook;
window.onPmCashierFilterChange = onPmCashierFilterChange;
window.openAddModalPmCashierBook = openAddModalPmCashierBook;
window.closePmCashierBookModal = closePmCashierBookModal;
window.onPmStudentLookup = onPmStudentLookup;
window.savePmCashierBookForm = savePmCashierBookForm;
window.deletePmCashierBookEntry = deletePmCashierBookEntry;

window.loadSpmmsReconciliationData = loadSpmmsReconciliationData;

// Statement View Modal functions
async function openStudentStatementModal(studentId) {
  if (!studentId) return;
  try {
    toggleLoading(true);
    const res = await callApi('getStudentMoneyData', { studentId: studentId, limit: 1000, forceRefresh: true }, 'GET');
    if (res && res.success) {
      const records = res.data || [];
      if (records.length === 0) return;
      const firstRow = records[0];
      document.getElementById('stm-stmt-student-name').textContent = `${firstRow.fyidName} - Pocket Money Statement`;
      document.getElementById('stm-stmt-student-info').textContent = `FY: ${firstRow.fy} | Class: ${firstRow.class} | ID: ${firstRow.studentId}`;
      let totDep = 0, totWith = 0;
      records.forEach(r => { totDep += Number(r.debit || 0); totWith += Number(r.credit || 0); });
      document.getElementById('stm-stmt-total-deposit').textContent = `${totDep.toLocaleString('en-US')} MMK`;
      document.getElementById('stm-stmt-total-withdraw').textContent = `${totWith.toLocaleString('en-US')} MMK`;
      document.getElementById('stm-stmt-current-balance').textContent = `${(totDep - totWith).toLocaleString('en-US')} MMK`;

      const tbody = document.getElementById('stm-stmt-table-body');
      if (tbody) {
        let running = 0;
        tbody.innerHTML = [...records].reverse().map((r, i) => {
          running += Number(r.debit || 0) - Number(r.credit || 0);
          return `
            <tr class="hover:bg-slate-800/30 text-xs">
              <td class="text-center font-mono py-2 px-3 text-slate-400">${i + 1}</td>
              <td class="font-mono py-2 px-3 text-slate-300">${window.escapeHtml(r.date)}</td>
              <td class="py-2 px-3 font-semibold">${window.escapeHtml(r.method)}</td>
              <td class="text-right font-mono font-bold text-emerald-400 py-2 px-3">${r.debit > 0 ? Number(r.debit).toLocaleString('en-US') : '-'}</td>
              <td class="text-right font-mono font-bold text-rose-400 py-2 px-3">${r.credit > 0 ? Number(r.credit).toLocaleString('en-US') : '-'}</td>
              <td class="text-right font-mono font-bold text-indigo-400 py-2 px-3">${running.toLocaleString('en-US')}</td>
              <td class="py-2 px-3 text-slate-400 truncate max-w-xs">${window.escapeHtml(r.remark || '-')}</td>
            </tr>
          `;
        }).join('');
      }
      document.getElementById('stm-statement-modal').classList.remove('hidden');
    }
  } catch (err) {} finally { toggleLoading(false); }
}
function closeStudentStatementModal() { document.getElementById('stm-statement-modal').classList.add('hidden'); }
window.openStudentStatementModal = openStudentStatementModal;
window.closeStudentStatementModal = closeStudentStatementModal;