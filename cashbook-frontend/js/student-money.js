/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - SPMMS (3-LEDGERS ARCHITECTURE)
 * File: js/student-money.js
 * 💡 Features: Master Student Lookup Cache, Auto-FY Populator, 
 *              Multi-Ledger Double-Entry & Financial Reconciliation
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
  const elInc = document.getElementById('stm-total-income');
  const elExp = document.getElementById('stm-total-expense');
  const elBal = document.getElementById('stm-balance');
  const elCount = document.getElementById('stm-entries-count');

  if (elInc) elInc.textContent = `${Number(inc || 0).toLocaleString('en-US')} MMK`;
  if (elExp) elExp.textContent = `${Number(exp || 0).toLocaleString('en-US')} MMK`;
  if (elBal) elBal.textContent = `${Number(bal || 0).toLocaleString('en-US')} MMK`;
  if (elCount) elCount.textContent = Number(count || 0).toLocaleString('en-US');
}

// ==============================================================================
// 💡 2. STUDENT MONEY BOOK (MAIN FINANCE & VIRTUAL WALLET)
// ==============================================================================
async function loadStudentMoneyData(isSilent) {
  try {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);
    const res = await callApi('getStudentMoneyData', { page: 1, limit: 5000, forceRefresh: true }, 'GET');
    if (res && res.success) {
      gStudentMoneyHistoryData = res.data || [];
      renderTopKPIs(res.stats.totalIncome, res.stats.totalExpense, res.stats.balance, gStudentMoneyHistoryData.length);
      applyStudentMoneySearchAndRender();
    }
  } catch (err) {
    console.error("Student Money Load Error:", err);
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function applyStudentMoneySearchAndRender() {
  const query = (document.getElementById('stm-search')?.value || '').trim().toLowerCase();
  const fDate = document.getElementById('stm-date-from')?.value || '';
  const tDate = document.getElementById('stm-date-to')?.value || '';

  gStudentMoneyFilteredData = gStudentMoneyHistoryData.filter(r => {
    if (typeof window.isDateInRange === 'function' && !window.isDateInRange(r.date, fDate, tDate)) return false;
    if (!query) return true;
    return String(r.fyidName || '').toLowerCase().includes(query) ||
           String(r.fyid || '').toLowerCase().includes(query) ||
           String(r.remark || '').toLowerCase().includes(query) ||
           String(r.class || '').toLowerCase().includes(query) ||
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
    const info = document.getElementById('stm-pagination-info');
    if (info) info.textContent = "Showing 0 entries";
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
            ${!isSys ? `<button onclick="openStudentStatementModal(${row.studentId})" class="text-amber-400 hover:text-amber-300" title="Statement"><i class="fa-solid fa-file-invoice"></i></button>` : ''}
            <button onclick="deleteStudentMoneyEntry('${window.escapeJsAttr(row.uniqueId)}')" class="text-rose-400 hover:text-rose-300" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  });
  
  const info = document.getElementById('stm-pagination-info');
  if (info) info.textContent = `Showing ${start + 1} to ${Math.min(start + gStudentMoneyLimit, total)} of ${total} entries`;
  
  const prevBtn = document.getElementById('stm-btn-prev');
  const nextBtn = document.getElementById('stm-btn-next');
  if (prevBtn) prevBtn.disabled = (gStudentMoneyPage <= 1);
  if (nextBtn) nextBtn.disabled = (start + gStudentMoneyLimit >= total);
}

function onSearchInputStudentMoney() { clearTimeout(searchTimeout); searchTimeout = setTimeout(applyStudentMoneySearchAndRender, 150); }
function clearDateFilterStudentMoney() { document.getElementById('stm-date-from').value = ''; document.getElementById('stm-date-to').value = ''; applyStudentMoneySearchAndRender(); }
function changePageStudentMoney(delta) { gStudentMoneyPage += delta; renderStudentMoneyTable(); }

// 💡 Populate Academic FY Dropdown
function populateFYDropdownMoney() {
  const select = document.getElementById('stm-fy');
  if (!select) return;

  const currentFY = (typeof window.getCurrentAcademicYear === 'function') 
    ? window.getCurrentAcademicYear() 
    : '2026-2027';
  const startYear = parseInt(currentFY.split('-')[0], 10) || 2026;

  const prevFY = `${startYear - 1}-${startYear}`;
  const nextFY = `${startYear + 1}-${startYear + 2}`;
  const currentVal = select.value || currentFY;

  select.innerHTML = `
    <option value="${prevFY}" ${prevFY === currentVal ? 'selected' : ''}>${prevFY}</option>
    <option value="${currentFY}" ${currentFY === currentVal ? 'selected' : ''}>${currentFY}</option>
    <option value="${nextFY}" ${nextFY === currentVal ? 'selected' : ''}>${nextFY}</option>
  `;
}

// 💡 Student Money Modal Controls
function openAddModalStudentMoney() {
  const form = document.getElementById('student-money-form');
  if (form) form.reset();

  const uid = document.getElementById('stm-uniqueId');
  if (uid) uid.value = '';

  const dateEl = document.getElementById('stm-date');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  populateFYDropdownMoney();
  onStudentMoneyEntryTypeChange();

  const liveBadge = document.getElementById('stm-wallet-live-badge');
  if (liveBadge) liveBadge.classList.add('hidden');

  document.getElementById('student-money-modal')?.classList.remove('hidden');
}

function closeStudentMoneyModal() { 
  document.getElementById('student-money-modal')?.classList.add('hidden'); 
}

// 💡 Action Type ပြောင်းလဲမှု ထိန်းချုပ်ခြင်း (Deposit နှင့် Withdraw အကွက် ၂ ခုလုံးကို အမြဲ Unlock ပေးထားသည်)
function onStudentMoneyEntryTypeChange() {
  const type = document.getElementById('stm-entry-type')?.value || 'Deposit';
  const stuBox = document.getElementById('stm-student-fields');
  const respBox = document.getElementById('stm-resp-person-box');
  const deb = document.getElementById('stm-debit');
  const cred = document.getElementById('stm-credit');
  const desc = document.getElementById('stm-remark');

  if (type === 'Transfer to PM Cashier') {
    if (stuBox) stuBox.classList.add('hidden');
    if (respBox) respBox.classList.remove('hidden');
    if (deb) { deb.disabled = true; deb.value = 0; }
    if (cred) { cred.disabled = false; }
    if (desc) desc.value = "Finance မှ PM Cashier သို့ အရင်းငွေလွှဲပေးခြင်း";
  } else {
    if (stuBox) stuBox.classList.remove('hidden');
    if (respBox) respBox.classList.add('hidden');
    
    // 🎯 FIX: အကွက် ၂ ခုလုံးကို ဘယ်တော့မှ Lock မချဘဲ အမြဲ ရိုက်ထည့်ခွင့်ပြုထားသည်
    if (deb) deb.disabled = false;
    if (cred) cred.disabled = false;

    if (type === 'Deposit') {
      if (cred) cred.value = 0;
      if (desc && (!desc.value || desc.value.includes('ငွေပြန်ထုတ်'))) desc.value = "ကျောင်းသား မုန့်ဖိုးအပ်ငွေ";
    } else if (type === 'Withdraw') {
      if (deb) deb.value = 0;
      if (desc && (!desc.value || desc.value.includes('မုန့်ဖိုးအပ်ငွေ'))) desc.value = "ကျောင်းသားအား ငွေသားပြန်ထုတ်ပေးခြင်း";
    }
  }
}

// 💡 DEBIT (အပ်ငွေ) တွင် ရိုက်ထည့်လိုက်ပါက CREDIT အား 0 လုပ်ပြီး Action Type ကို Deposit သို့ အလိုအလျောက် ချိန်ညှိခြင်း
function onDebitInputStudentMoney() {
  const debVal = parseFloat(document.getElementById('stm-debit')?.value || 0);
  if (debVal > 0) {
    const cred = document.getElementById('stm-credit');
    if (cred) cred.value = 0;

    const typeSelect = document.getElementById('stm-entry-type');
    if (typeSelect && typeSelect.value !== 'Transfer to PM Cashier') {
      typeSelect.value = 'Deposit';
      const desc = document.getElementById('stm-remark');
      if (desc && (!desc.value || desc.value.includes('ငွေပြန်ထုတ်'))) desc.value = "ကျောင်းသား မုန့်ဖိုးအပ်ငွေ";
    }
  }
}

// 💡 WITHDRAW (ထုတ်ငွေ) တွင် ရိုက်ထည့်လိုက်ပါက DEBIT အား 0 လုပ်ပြီး Action Type ကို Withdraw သို့ အလိုအလျောက် ချိန်ညှိခြင်း
function onCreditInputStudentMoney() {
  const credVal = parseFloat(document.getElementById('stm-credit')?.value || 0);
  if (credVal > 0) {
    const deb = document.getElementById('stm-debit');
    if (deb) deb.value = 0;

    const typeSelect = document.getElementById('stm-entry-type');
    if (typeSelect && typeSelect.value !== 'Transfer to PM Cashier') {
      typeSelect.value = 'Withdraw';
      const desc = document.getElementById('stm-remark');
      if (desc && (!desc.value || desc.value.includes('မုန့်ဖိုးအပ်ငွေ'))) desc.value = "ကျောင်းသားအား ငွေသားပြန်ထုတ်ပေးခြင်း";
    }
  }
}

// Modal ဖွင့်ချိန်တွင် အကွက်များ အားလုံး ပွင့်နေစေရန် သေချာစေခြင်း
function openAddModalStudentMoney() {
  const form = document.getElementById('student-money-form');
  if (form) form.reset();

  const uid = document.getElementById('stm-uniqueId');
  if (uid) uid.value = '';

  const dateEl = document.getElementById('stm-date');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  const deb = document.getElementById('stm-debit');
  const cred = document.getElementById('stm-credit');
  if (deb) { deb.disabled = false; deb.value = 0; }
  if (cred) { cred.disabled = false; cred.value = 0; }

  populateFYDropdownMoney();
  onStudentMoneyEntryTypeChange();

  const liveBadge = document.getElementById('stm-wallet-live-badge');
  if (liveBadge) liveBadge.classList.add('hidden');

  document.getElementById('student-money-modal')?.classList.remove('hidden');
}

// 🎯 FIXED: Master Student Directory Cache & Instant Lookup
async function onStudentIdOrFYChangeMoney() {
  const fyVal = document.getElementById('stm-fy')?.value || (typeof window.getCurrentAcademicYear === 'function' ? window.getCurrentAcademicYear() : '2026-2027');
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

  // 1. Fetch from Master Student Directory (Cache)
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
  let matched = list.find(s => parseInt(s.studentId || s.student_id || s.id, 10) === targetIdNum);

  // Fallback single lookup if not yet loaded in cache
  if (!matched) {
    try {
      const singleRes = await callApi('lookupStudentById', { studentId: targetIdNum, fy: fyVal }, 'GET');
      if (singleRes && singleRes.success && singleRes.data) {
        matched = singleRes.data;
      }
    } catch (e) {}
  }

  if (matched) {
    const actualFyid = window.sanitizeFyidStr(matched.fyid || '');
    const actualName = matched.name || matched.fyidName || '';

    if (fyidShow) fyidShow.value = actualFyid;
    if (fyidNameShow) fyidNameShow.value = `[${actualFyid}] ${actualName}`;
    if (classEl) classEl.value = matched.class || '';

    // 2. Fetch live wallet balance from student_money
    try {
      const sumRes = await callApi('getStudentMoneySummary', { fy: fyVal, searchVal: actualFyid }, 'GET');
      if (sumRes && sumRes.success && sumRes.data && sumRes.data.length > 0) {
        const studentSum = sumRes.data.find(r => r.studentId === targetIdNum);
        if (studentSum && liveBadge && liveAmountEl) {
          liveAmountEl.textContent = `${Number(studentSum.netBalance || 0).toLocaleString('en-US')} MMK`;
          liveBadge.classList.remove('hidden');
        }
      } else {
        if (liveBadge && liveAmountEl) {
          liveAmountEl.textContent = "0 MMK";
          liveBadge.classList.remove('hidden');
        }
      }
    } catch (err) {}
  } else {
    if (fyidShow) fyidShow.value = "Not Found";
    if (fyidNameShow) fyidNameShow.value = "ကျောင်းသား ရှာမတွေ့ပါ";
    if (classEl) classEl.value = "";
    if (liveBadge) liveBadge.classList.add('hidden');
  }
}

async function saveStudentMoneyForm(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isSubmitting) return;
  isSubmitting = true;

  const entryType = document.getElementById('stm-entry-type')?.value || 'Deposit';
  const credit = parseFloat(document.getElementById('stm-credit')?.value || 0);
  const debit = parseFloat(document.getElementById('stm-debit')?.value || 0);
  const studentId = parseInt(document.getElementById('stm-id-search')?.value, 10) || 0;

  if (entryType === 'Transfer to PM Cashier') {
    if (credit <= 0) {
      isSubmitting = false; 
      return showToast("ERROR", "PM Cashier သို့ လွှဲမည့် Credit ပမာဏ ထည့်ပါ။");
    }
  } else {
    if (!studentId || (debit <= 0 && credit <= 0)) {
      isSubmitting = false; 
      return showToast("ERROR", "ကျောင်းသား ID နှင့် ငွေပမာဏ အတိအကျ ထည့်ပါ။");
    }
  }

  const payload = {
    uniqueId: document.getElementById('stm-uniqueId')?.value || '',
    date: document.getElementById('stm-date')?.value || new Date().toISOString().slice(0, 10),
    fy: document.getElementById('stm-fy')?.value || (typeof window.getCurrentAcademicYear === 'function' ? window.getCurrentAcademicYear() : '2026-2027'),
    entryType: entryType,
    method: document.getElementById('stm-method')?.value || 'Cash',
    debit: debit,
    credit: credit,
    remark: document.getElementById('stm-remark')?.value || '',
    studentId: entryType === 'Transfer to PM Cashier' ? 0 : studentId,
    fyid: document.getElementById('stm-fyid-show')?.value || '',
    name: document.getElementById('stm-fyidname-show')?.value || '',
    class: document.getElementById('stm-class')?.value || '',
    responsibilityPerson: document.getElementById('stm-responsibility-person')?.value || 'Cashier 1'
  };

  closeStudentMoneyModal();
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    const res = await callApi('saveStudentMoneyEntry', payload);
    if (res && res.success) {
      showToast('SUCCESS', 'စာရင်းမှတ်တမ်းတင်ပြီးပါပြီ။ Double-Entry စနစ်ဖြင့် အလုပ်လုပ်ပါသည်။');
      loadStudentMoneyData(false);
    } else { 
      showToast('ERROR', res?.message || 'သိမ်းဆည်းမှု မအောင်မြင်ပါ။'); 
    }
  } catch (err) { 
    showToast('ERROR', err.message); 
  } finally { 
    isSubmitting = false; 
    if (typeof toggleLoading === 'function') toggleLoading(false); 
  }
}

async function deleteStudentMoneyEntry(uniqueId) {
  if (!confirm("ဤစာရင်းအား ဖျက်ပါက ဆက်စပ်နေသော Cashier စာရင်းများပါ ပယ်ဖျက်သွားပါမည်။ သေချာပါသလား?")) return;
  if (typeof toggleLoading === 'function') toggleLoading(true);
  try {
    const res = await callApi('deleteStudentMoneyEntry', { uniqueId });
    if (res && res.success) {
      showToast('SUCCESS', 'စာရင်း ဖျက်သိမ်းပြီးပါပြီ။');
      loadStudentMoneyData(false);
    }
  } catch (err) {
    showToast('ERROR', err.message);
  } finally { 
    if (typeof toggleLoading === 'function') toggleLoading(false); 
  }
}

function exportToCSVStudentMoney() {
  if (!gStudentMoneyHistoryData || gStudentMoneyHistoryData.length === 0) return showToast("ERROR", "ထုတ်ယူရန် စာရင်း မရှိပါ။");
  let csv = "NO,DATE,FY,ID,FYID,NAME,CLASS,METHOD,DEBIT,CREDIT,BALANCES,REMARK\n";
  gStudentMoneyHistoryData.forEach((r, idx) => {
    csv += `${idx + 1},${window.safeCsvCell(r.date || '')},${window.safeCsvCell(r.fy || '')},${r.studentId},${window.safeCsvCell(window.sanitizeFyidStr(r.fyid))},${window.safeCsvCell(r.fyidName || '')},${window.safeCsvCell(r.class || '')},${window.safeCsvCell(r.method || '')},${r.debit || 0},${r.credit || 0},${r.balances || 0},${window.safeCsvCell(r.remark || '')}\n`;
  });
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Student_Money_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ==============================================================================
// 💡 3. CANTEEN BOOK (WITH DAILY KPI)
// ==============================================================================
async function loadCanteenBookData(isSilent) {
  try {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);
    const res = await callApi('getCanteenBookData', { forceRefresh: true }, 'GET');
    if (res && res.success) {
      gCanteenBookData = res.data || [];
      applyCanteenBookSearchAndRender();
    }
  } catch (err) {
    console.error("Canteen Load Error:", err);
  } finally { 
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false); 
  }
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

  let filteredSales = 0;
  gCanteenBookFilteredData.forEach(r => { if (r.category === 'POS Sales') filteredSales += Number(r.debit || 0); });

  const todayEl = document.getElementById('canteen-today-sales');
  const filteredEl = document.getElementById('canteen-filtered-sales');
  const countEl = document.getElementById('canteen-filtered-count');

  if (todayEl) todayEl.textContent = `${todaySales.toLocaleString('en-US')} MMK`;
  if (filteredEl) filteredEl.textContent = `${filteredSales.toLocaleString('en-US')} MMK`;
  if (countEl) countEl.textContent = gCanteenBookFilteredData.length;

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

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-slate-500 font-bold">စာရင်း မရှိပါ။</td></tr>`;
    document.getElementById('canteen-pagination-info').textContent = "Showing 0 entries";
    return;
  }

  items.forEach((row, idx) => {
    const balStr = Number(row.balances || 0).toLocaleString('en-US', {minimumFractionDigits: 2});
    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/30 text-slate-300 text-xs border-b border-slate-800/40">
        <td class="text-center font-mono py-3 px-2">${start + idx + 1}</td>
        <td class="font-mono py-3 px-2">${window.escapeHtml(row.date)}</td>
        <td class="py-3 px-2 font-bold text-emerald-400">${window.escapeHtml(row.category)}</td>
        <td class="py-3 px-2 truncate max-w-xs" title="${window.escapeHtml(row.description)}">${window.escapeHtml(row.description || '')}</td>
        <td class="py-3 px-2">${window.escapeHtml(row.method)}</td>
        <td class="text-right font-mono text-emerald-400 py-3 px-2">${row.debit > 0 ? Number(row.debit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right font-mono text-rose-400 py-3 px-2">${row.credit > 0 ? Number(row.credit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right font-mono text-indigo-400 font-bold py-3 px-2">${balStr}</td>
        <td class="font-mono text-slate-500 py-3 px-2">${window.escapeHtml(row.vrNo || '-')}</td>
        <td class="font-mono text-slate-500 py-3 px-2">${window.escapeHtml(row.fy)}</td>
        <td class="text-center right-0 sticky bg-[#0c1322] py-3 px-2">
          <button onclick="deleteCanteenBookEntry('${window.escapeJsAttr(row.uniqueId)}')" class="text-rose-400 hover:text-rose-300"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
  document.getElementById('canteen-pagination-info').textContent = `Showing ${start + 1} to ${Math.min(start + gCanteenLimit, total)} of ${total} entries`;
  
  const prevBtn = document.getElementById('canteen-btn-prev');
  const nextBtn = document.getElementById('canteen-btn-next');
  if (prevBtn) prevBtn.disabled = (gCanteenPage <= 1);
  if (nextBtn) nextBtn.disabled = (start + gCanteenLimit >= total);
}

function onSearchInputCanteenBook() { clearTimeout(searchTimeout); searchTimeout = setTimeout(applyCanteenBookSearchAndRender, 150); }
function clearDateFilterCanteenBook() { document.getElementById('canteen-date-from').value = ''; document.getElementById('canteen-date-to').value = ''; applyCanteenBookSearchAndRender(); }
function changePageCanteenBook(delta) { gCanteenPage += delta; renderCanteenBookTable(); }

async function deleteCanteenBookEntry(uniqueId) {
  if (!confirm("ဖျက်မည်မှာ သေချာပါသလား?")) return;
  if (typeof toggleLoading === 'function') toggleLoading(true);
  try {
    const res = await callApi('deleteCanteenBookEntry', { uniqueId });
    if (res && res.success) loadCanteenBookData(false);
  } catch (err) {} finally { if (typeof toggleLoading === 'function') toggleLoading(false); }
}

function exportToCSVCanteenBook() {
  if (!gCanteenBookData || gCanteenBookData.length === 0) return showToast("ERROR", "ထုတ်ယူရန် စာရင်း မရှိပါ။");
  let csv = "NO,DATE,CATEGORY,DESCRIPTION,METHOD,DEBIT,CREDIT,BALANCES,VR_NO,FY\n";
  gCanteenBookData.forEach((r, idx) => {
    csv += `${idx + 1},${window.safeCsvCell(r.date || '')},${window.safeCsvCell(r.category || '')},${window.safeCsvCell(r.description || '')},${window.safeCsvCell(r.method || '')},${r.debit || 0},${r.credit || 0},${r.balances || 0},${window.safeCsvCell(r.vrNo || '')},${window.safeCsvCell(r.fy || '')}\n`;
  });
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Canteen_Book_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// ==============================================================================
// 💡 4. PM CASHIER BOOK
// ==============================================================================
async function loadPmCashierBookData(isSilent) {
  try {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);
    const res = await callApi('getPmCashierBookData', { forceRefresh: true }, 'GET');
    if (res && res.success) {
      gPmCashierBookData = res.data || [];
      applyPmCashierBookSearchAndRender();
    }
  } catch (err) {
    console.error("PM Cashier Load Error:", err);
  } finally { 
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false); 
  }
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
    return String(row.description || '').toLowerCase().includes(query) || 
           String(row.vrNo || '').toLowerCase().includes(query) ||
           String(row.responsibility_person || '').toLowerCase().includes(query);
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

  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-slate-500 font-bold">စာရင်း မရှိပါ။</td></tr>`;
    document.getElementById('pm-cashier-pagination-info').textContent = "Showing 0 entries";
    return;
  }

  items.forEach((row, idx) => {
    const balStr = Number(row.balances || 0).toLocaleString('en-US', {minimumFractionDigits: 2});
    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/30 text-slate-300 text-xs border-b border-slate-800/40">
        <td class="text-center font-mono py-3 px-2">${start + idx + 1}</td>
        <td class="font-mono text-xs py-3 px-2">${window.escapeHtml(row.date)}</td>
        <td class="font-bold text-sky-400 py-3 px-2">${window.escapeHtml(row.responsibility_person || '-')}</td>
        <td class="py-3 px-2 font-semibold">${window.escapeHtml(row.category)}</td>
        <td class="py-3 px-2 truncate max-w-xs" title="${window.escapeHtml(row.description)}">${window.escapeHtml(row.description || '')}</td>
        <td class="py-3 px-2">${window.escapeHtml(row.method)}</td>
        <td class="text-right font-mono text-emerald-400 py-3 px-2">${row.debit > 0 ? Number(row.debit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right font-mono text-rose-400 py-3 px-2">${row.credit > 0 ? Number(row.credit).toLocaleString('en-US') : '-'}</td>
        <td class="text-right font-mono text-indigo-400 font-bold py-3 px-2">${balStr}</td>
        <td class="font-mono text-slate-500 py-3 px-2">${window.escapeHtml(row.vrNo || '-')}</td>
        <td class="font-mono text-slate-500 py-3 px-2">${window.escapeHtml(row.fy)}</td>
        <td class="text-center right-0 sticky bg-[#0c1322] py-3 px-2">
          <button onclick="deletePmCashierBookEntry('${window.escapeJsAttr(row.uniqueId)}')" class="text-rose-400 hover:text-rose-300"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>
    `;
  });
  document.getElementById('pm-cashier-pagination-info').textContent = `Showing ${start + 1} to ${Math.min(start + gPmCashierLimit, total)} of ${total} entries`;
  
  const prevBtn = document.getElementById('pm-cashier-btn-prev');
  const nextBtn = document.getElementById('pm-cashier-btn-next');
  if (prevBtn) prevBtn.disabled = (gPmCashierPage <= 1);
  if (nextBtn) nextBtn.disabled = (start + gPmCashierLimit >= total);
}

function onSearchInputPmCashierBook() { clearTimeout(searchTimeout); searchTimeout = setTimeout(applyPmCashierBookSearchAndRender, 150); }
function onPmCashierFilterChange() { applyPmCashierBookSearchAndRender(); }
function clearDateFilterPmCashierBook() { document.getElementById('pm-cashier-date-from').value = ''; document.getElementById('pm-cashier-date-to').value = ''; applyPmCashierBookSearchAndRender(); }
function changePagePmCashierBook(delta) { gPmCashierPage += delta; renderPmCashierBookTable(); }

function openAddModalPmCashierBook() {
  const form = document.getElementById('pm-cashier-form');
  if (form) form.reset();

  const uid = document.getElementById('pm-cashier-uniqueId');
  if (uid) uid.value = '';

  const dateEl = document.getElementById('pm-cashier-date');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  const badge = document.getElementById('pm-student-wallet-badge');
  if (badge) badge.classList.add('hidden');

  document.getElementById('pm-cashier-modal')?.classList.remove('hidden');
}

function closePmCashierBookModal() { 
  document.getElementById('pm-cashier-modal')?.classList.add('hidden'); 
}

// 🎯 FIXED: Master Student Directory Cache & Instant Lookup for Cashier
async function onPmStudentLookup() {
  const idVal = document.getElementById('pm-student-id-search')?.value.trim();
  const fyidShow = document.getElementById('pm-student-fyid');
  const nameShow = document.getElementById('pm-student-name');
  const classShow = document.getElementById('pm-student-class');
  const badge = document.getElementById('pm-student-wallet-badge');
  const balEl = document.getElementById('pm-student-wallet-bal');
  const desc = document.getElementById('pm-cashier-description');

  if (!idVal) {
    if (fyidShow) fyidShow.value = '';
    if (nameShow) nameShow.value = '';
    if (classShow) classShow.value = '';
    if (badge) badge.classList.add('hidden');
    return;
  }

  const targetId = parseInt(idVal, 10);
  const fyVal = typeof window.getCurrentAcademicYear === 'function' ? window.getCurrentAcademicYear() : '2026-2027';

  if (!gStudentCacheForMoney[fyVal]) {
    try {
      const res = await callApi('getStudentData', { fy: fyVal, limit: 5000 }, 'GET');
      if (res && res.success) gStudentCacheForMoney[fyVal] = res.data || [];
    } catch (e) {}
  }

  const list = gStudentCacheForMoney[fyVal] || [];
  let matched = list.find(s => parseInt(s.studentId || s.student_id || s.id, 10) === targetId);

  if (!matched) {
    try {
      const singleRes = await callApi('lookupStudentById', { studentId: targetId, fy: fyVal }, 'GET');
      if (singleRes && singleRes.success && singleRes.data) matched = singleRes.data;
    } catch (e) {}
  }

  if (matched) {
    const cleanFyid = window.sanitizeFyidStr(matched.fyid || '');
    const actualName = matched.name || matched.fyidName || '';

    if (fyidShow) fyidShow.value = cleanFyid;
    if (nameShow) nameShow.value = actualName;
    if (classShow) classShow.value = matched.class || '';
    if (desc && !desc.value) desc.value = `[${cleanFyid}] ${actualName} - မုန့်ဖိုးထုတ်ပေးငွေ`;

    // Fetch live balance
    try {
      const sumRes = await callApi('getStudentMoneySummary', { fy: fyVal, searchVal: cleanFyid }, 'GET');
      if (sumRes && sumRes.success && sumRes.data && sumRes.data.length > 0) {
        const stu = sumRes.data.find(r => r.studentId === targetId);
        if (stu && balEl && badge) {
          balEl.textContent = `${Number(stu.netBalance || 0).toLocaleString('en-US')} MMK`;
          badge.classList.remove('hidden');
        }
      } else {
        if (balEl && badge) {
          balEl.textContent = "0 MMK";
          badge.classList.remove('hidden');
        }
      }
    } catch (e) {}
  } else {
    if (fyidShow) fyidShow.value = "Not Found";
    if (nameShow) nameShow.value = "ကျောင်းသား ရှာမတွေ့ပါ";
    if (classShow) classShow.value = "";
    if (badge) badge.classList.add('hidden');
  }
}

async function savePmCashierBookForm(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isSubmitting) return;
  isSubmitting = true;

  const credit = parseFloat(document.getElementById('pm-cashier-credit')?.value || 0);
  const studentId = parseInt(document.getElementById('pm-student-id-search')?.value, 10) || 0;

  if (!studentId || credit <= 0) {
    isSubmitting = false; 
    return showToast("ERROR", "ကျောင်းသား ID နှင့် ထုတ်ပေးငွေ ထည့်ပါ။");
  }

  const payload = {
    date: document.getElementById('pm-cashier-date')?.value || new Date().toISOString().slice(0, 10),
    category: 'PM Withdraw',
    studentId: studentId,
    studentName: document.getElementById('pm-student-name')?.value || '',
    fyid: document.getElementById('pm-student-fyid')?.value || '',
    studentClass: document.getElementById('pm-student-class')?.value || '',
    responsibilityPerson: document.getElementById('pm-cashier-responsibility-person')?.value || 'Cashier 1',
    method: document.getElementById('pm-cashier-method')?.value || 'Cash',
    debit: 0,
    credit: credit,
    description: document.getElementById('pm-cashier-description')?.value || ''
  };

  closePmCashierBookModal();
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    const res = await callApi('savePmCashierBookEntry', payload);
    if (res && res.success) {
      showToast('SUCCESS', 'မုန့်ဖိုးထုတ်ပေးပြီးပါပြီ။ ကျောင်းသားလက်ကျန်ကိုပါ အလိုအလျောက် ဖြတ်တောက်ပြီးပါပြီ။');
      loadPmCashierBookData(false);
    } else { 
      showToast('ERROR', res?.message || 'သိမ်းဆည်းမှု မအောင်မြင်ပါ။'); 
    }
  } catch (err) { 
    showToast('ERROR', err.message); 
  } finally { 
    isSubmitting = false; 
    if (typeof toggleLoading === 'function') toggleLoading(false); 
  }
}

async function deletePmCashierBookEntry(uniqueId) {
  if (!confirm("ဖျက်မည်မှာ သေချာပါသလား? ကျောင်းသားလက်ကျန်ပါ ပြန်လည်ညှိသွားပါမည်။")) return;
  if (typeof toggleLoading === 'function') toggleLoading(true);
  try {
    const res = await callApi('deletePmCashierBookEntry', { uniqueId });
    if (res && res.success) {
      showToast('SUCCESS', 'စာရင်း ဖျက်သိမ်းပြီးပါပြီ။');
      loadPmCashierBookData(false);
    }
  } catch (err) {} finally { if (typeof toggleLoading === 'function') toggleLoading(false); }
}

function exportToCSVPmCashierBook() {
  if (!gPmCashierBookData || gPmCashierBookData.length === 0) return showToast("ERROR", "ထုတ်ယူရန် စာရင်း မရှိပါ။");
  let csv = "NO,DATE,RESPONSIBILITY_PERSON,CATEGORY,DESCRIPTION,METHOD,DEBIT,CREDIT,BALANCES,VR_NO,FY\n";
  gPmCashierBookData.forEach((r, idx) => {
    csv += `${idx + 1},${window.safeCsvCell(r.date || '')},${window.safeCsvCell(r.responsibility_person || '')},${window.safeCsvCell(r.category || '')},${window.safeCsvCell(r.description || '')},${window.safeCsvCell(r.method || '')},${r.debit || 0},${r.credit || 0},${r.balances || 0},${window.safeCsvCell(r.vrNo || '')},${window.safeCsvCell(r.fy || '')}\n`;
  });
  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `PM_Cashier_Book_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
}

// 💡 PM Cashier Modal Action Change
function onPmCashierCategoryChange() {
  const cat = document.getElementById('pm-cashier-category')?.value || 'PM Withdraw';
  const stuBox = document.getElementById('pm-student-lookup-container');
  const desc = document.getElementById('pm-cashier-description');

  if (cat === 'Return to Finance') {
    if (stuBox) stuBox.classList.add('hidden');
    if (desc) desc.value = "PM Cashier မှ Finance သို့ လက်ကျန်ငွေ ပြန်လည်အပ်နှံခြင်း";
  } else {
    if (stuBox) stuBox.classList.remove('hidden');
    if (desc) desc.value = "";
  }
}

function openAddModalPmCashierBook() {
  const form = document.getElementById('pm-cashier-form');
  if (form) form.reset();

  const uid = document.getElementById('pm-cashier-uniqueId');
  if (uid) uid.value = '';

  const dateEl = document.getElementById('pm-cashier-date');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  const badge = document.getElementById('pm-student-wallet-badge');
  if (badge) badge.classList.add('hidden');

  onPmCashierCategoryChange();
  document.getElementById('pm-cashier-modal')?.classList.remove('hidden');
}

async function savePmCashierBookForm(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (isSubmitting) return;
  isSubmitting = true;

  const category = document.getElementById('pm-cashier-category')?.value || 'PM Withdraw';
  const credit = parseFloat(document.getElementById('pm-cashier-credit')?.value || 0);
  const studentId = parseInt(document.getElementById('pm-student-id-search')?.value, 10) || 0;

  if (category === 'PM Withdraw' && (!studentId || credit <= 0)) {
    isSubmitting = false; 
    return showToast("ERROR", "ကျောင်းသား ID နှင့် ထုတ်ပေးငွေ ထည့်ပါ။");
  }

  if (category === 'Return to Finance' && credit <= 0) {
    isSubmitting = false;
    return showToast("ERROR", "Finance သို့ ပြန်လွှဲမည့် ငွေပမာဏ ထည့်သွင်းပါ။");
  }

  const payload = {
    date: document.getElementById('pm-cashier-date')?.value || new Date().toISOString().slice(0, 10),
    category: category,
    studentId: category === 'PM Withdraw' ? studentId : null,
    studentName: document.getElementById('pm-student-name')?.value || '',
    fyid: document.getElementById('pm-student-fyid')?.value || '',
    studentClass: document.getElementById('pm-student-class')?.value || '',
    responsibilityPerson: document.getElementById('pm-cashier-responsibility-person')?.value || 'Cashier 1',
    method: document.getElementById('pm-cashier-method')?.value || 'Cash',
    debit: 0,
    credit: credit,
    description: document.getElementById('pm-cashier-description')?.value || ''
  };

  closePmCashierBookModal();
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    const res = await callApi('savePmCashierBookEntry', payload);
    if (res && res.success) {
      showToast('SUCCESS', category === 'Return to Finance' 
        ? 'Finance သို့ ငွေပြန်လွှဲပြီးပါပြီ။ Student Money စာအုပ်ထဲသို့ အလိုအလျောက် ငွေဝင်သွားပါပြီ။' 
        : 'မုန့်ဖိုးထုတ်ပေးပြီးပါပြီ။ ကျောင်းသားလက်ကျန်ကိုပါ အလိုအလျောက် ဖြတ်တောက်ပြီးပါပြီ။');
      loadPmCashierBookData(false);
      loadStudentMoneyData(false);
    } else { 
      showToast('ERROR', res?.message || 'သိမ်းဆည်းမှု မအောင်မြင်ပါ။'); 
    }
  } catch (err) { 
    showToast('ERROR', err.message); 
  } finally { 
    isSubmitting = false; 
    if (typeof toggleLoading === 'function') toggleLoading(false); 
  }
}

// ==============================================================================
// 💡 5. RECONCILIATION AUDIT CONTROLLER
// ==============================================================================
async function loadSpmmsReconciliationData() {
  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
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
  } catch (err) {
    console.error("Reconciliation Error:", err);
  } finally { 
    if (typeof toggleLoading === 'function') toggleLoading(false); 
  }
}

// ==============================================================================
// 💡 6. STATEMENT TIMELINE MODAL
// ==============================================================================
async function openStudentStatementModal(studentId) {
  if (!studentId) return;
  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    const res = await callApi('getStudentMoneyData', { studentId: studentId, limit: 1000, forceRefresh: true }, 'GET');
    if (res && res.success) {
      const records = res.data || [];
      if (records.length === 0) return showToast("ERROR", "ဤကျောင်းသားအတွက် မှတ်တမ်း မရှိသေးပါ။");
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
      document.getElementById('stm-statement-modal')?.classList.remove('hidden');
    }
  } catch (err) {} finally { if (typeof toggleLoading === 'function') toggleLoading(false); }
}

function closeStudentStatementModal() { 
  document.getElementById('stm-statement-modal')?.classList.add('hidden'); 
}

// Global Window Exports
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
window.exportToCSVStudentMoney = exportToCSVStudentMoney;

window.loadCanteenBookData = loadCanteenBookData;
window.onSearchInputCanteenBook = onSearchInputCanteenBook;
window.clearDateFilterCanteenBook = clearDateFilterCanteenBook;
window.changePageCanteenBook = changePageCanteenBook;
window.setFilterCanteenToday = setFilterCanteenToday;
window.deleteCanteenBookEntry = deleteCanteenBookEntry;
window.exportToCSVCanteenBook = exportToCSVCanteenBook;

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
window.exportToCSVPmCashierBook = exportToCSVPmCashierBook;

window.loadSpmmsReconciliationData = loadSpmmsReconciliationData;
window.openStudentStatementModal = openStudentStatementModal;
window.closeStudentStatementModal = closeStudentStatementModal;

window.onDebitInputStudentMoney = onDebitInputStudentMoney;
window.onCreditInputStudentMoney = onCreditInputStudentMoney;

window.onPmCashierCategoryChange = onPmCashierCategoryChange;