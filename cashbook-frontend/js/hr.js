/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - HR PAYROLL EXP BOOK CONTROLLER (D1 DATABASE EDITION)
 * File: js/hr.js (Location: cashbook-frontend/js/hr.js)
 * 💡 Features: Refactored with Global api.js for DRY Principle,
 *              Crash-Proof Pure Helpers (Prevents Table Render Crash),
 *              Auto-scaling Font Size & Header Labels update (MMK),
 *              Double-Submit Protection Lock & Precision Payslip Print Isolation
 * ==============================================================================
 */

// ==============================================================================
// 💡 SAFE PURE LOGIC HELPERS (Crash-Proof Fallbacks)
// ==============================================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof window.escapeHtml === 'function' && window.escapeHtml !== escapeHtml) {
    return window.escapeHtml(str);
  }
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeJsAttr(str) {
  if (str === null || str === undefined) return '';
  if (typeof window.escapeJsAttr === 'function' && window.escapeJsAttr !== escapeJsAttr) {
    return window.escapeJsAttr(str);
  }
  const jsEscaped = String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return escapeHtml(jsEscaped);
}

function safeCsvCell(val) {
  if (typeof window.safeCsvCell === 'function') return window.safeCsvCell(val);
  if (val === null || val === undefined) return '""';
  if (typeof val === 'number') return isNaN(val) ? '0' : String(val);

  let str = String(val).trim();
  if (str === '') return '""';

  const cleanNumStr = str.replace(/,/g, '');
  if (!isNaN(Number(cleanNumStr)) && cleanNumStr !== '') {
    return `"${str.replace(/"/g, '""')}"`;
  }
  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }
  return `"${str.replace(/"/g, '""')}"`;
}

// ==============================================================================
// 💡 GLOBAL VARIABLES & STATE
// ==============================================================================

var gHrPayrollData = [];
var gHrPayrollFilteredData = [];
var gHrPayrollPage = 1;
var gHrPayrollLimit = 20;
var gHrPayrollTotalRows = 0;
var gHrPayrollStats = { totalIncome: 0, totalExpense: 0, balance: 0 }; // 💡 Memory-backed KPI Cache

var gHrStaffFT = []; // Full-Time Staff Cache
var gHrStaffPT = []; // Part-Time Staff Cache
var gHrStaffCache = []; // Fallback Cache
var isHrPayrollSubmitting = false; // 💡 Double-Submit Protection Flag

/**
 * 💡 Update Labels to include (MMK) automatically
 */
function updateHrKpiLabels() {
  const labels = {
    'hr-pay-total-income': 'TOTAL INCOME (MMK)',
    'hr-pay-total-expense': 'TOTAL EXPENSE (MMK)',
    'hr-pay-balance': 'TOTAL BALANCES (MMK)'
  };

  for (const [id, text] of Object.entries(labels)) {
    const valueEl = document.getElementById(id);
    if (valueEl) {
      const parent = valueEl.parentElement;
      if (parent) {
        const labelEl = parent.querySelector('p');
        if (labelEl) labelEl.textContent = text;
      }
    }
  }
}

/**
 * 💡 Auto-Scale Font Size to Prevent Truncation on Large Numbers
 */
function adjustHrKpiFontSizes() {
  const kpiIds = ['hr-pay-total-income', 'hr-pay-total-expense', 'hr-pay-balance', 'hr-pay-entries-count'];
  kpiIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    el.style.fontSize = '24px';
    el.style.whiteSpace = 'nowrap';

    let currentSize = 24;
    while (el.scrollWidth > el.clientWidth && currentSize > 12) {
      currentSize--;
      el.style.fontSize = currentSize + 'px';
    }
  });
}

window.addEventListener('resize', adjustHrKpiFontSizes);

/**
 * 💡 Render KPI Stats from Memory or Calculate on-the-fly (0 D1 Quota Cost)
 */
function updateAndRenderHrStats() {
  if (!gHrPayrollStats || (gHrPayrollStats.totalIncome === 0 && gHrPayrollStats.totalExpense === 0 && gHrPayrollData.length > 0)) {
    let totInc = 0;
    let totExp = 0;
    gHrPayrollData.forEach(r => {
      totInc += Number(r.debit || 0);
      totExp += Number(r.credit || 0);
    });
    gHrPayrollStats = {
      totalIncome: totInc,
      totalExpense: totExp,
      balance: totInc - totExp
    };
  }
  renderHrPayrollStats(gHrPayrollStats);
}

async function loadHrPayrollData(useCache = true) {
  const hasDataInMemory = Array.isArray(gHrPayrollData) && gHrPayrollData.length > 0;

  // ⚡ 1. D1 QUOTA-SHIELD (0ms INSTANT RENDER):
  // စာရင်းများ Memory ထဲတွင် ရှိပြီးသားဖြစ်ပါက KPI Stats ရော Table ပါ Loading မပြဘဲ Memory မှ ချက်ချင်း Render လုပ်မည် (D1 Quota = 0)
  if (useCache && hasDataInMemory) {
    updateAndRenderHrStats();
    applyHrPayrollSearchAndRender();
    return;
  }

  try {
    if (!hasDataInMemory && typeof toggleLoading === 'function') {
      toggleLoading(true);
    }

    const response = await callApi('getExpenseData', {
      bookName: 'HR Payroll Exp Book',
      page: 1,
      limit: 1000,
      forceRefresh: !useCache
    }, 'GET');

    if (response && response.success) {
      gHrPayrollData = response.data || [];
      gHrPayrollTotalRows = response.totalRows || gHrPayrollData.length || 0;

      let totInc = 0;
      let totExp = 0;
      gHrPayrollData.forEach(r => {
        totInc += Number(r.debit || 0);
        totExp += Number(r.credit || 0);
      });

      const serverStats = response.stats || {};
      const finalIncome = serverStats.totalIncome !== undefined && serverStats.totalIncome > 0 ? serverStats.totalIncome : totInc;
      const finalExpense = serverStats.totalExpense !== undefined && serverStats.totalExpense > 0 ? serverStats.totalExpense : totExp;

      // 💡 Stats တန်ဖိုးများကို Cache ထဲတွင် မှတ်သားထားမည်
      gHrPayrollStats = {
        totalIncome: finalIncome,
        totalExpense: finalExpense,
        balance: finalIncome - finalExpense
      };

      renderHrPayrollStats(gHrPayrollStats);
      applyHrPayrollSearchAndRender();
    }

    preloadStaffCacheForPayroll();

  } catch (error) {
    console.error('Failed to load HR Payroll data:', error);
    if (typeof showToast === 'function') showToast("ERROR", "HR Payroll စာရင်းများ ဖတ်ယူ၍ မရပါ: " + error.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

async function preloadStaffCacheForPayroll() {
  // ⚡ D1 Quota-Shield: ဝန်ထမ်း Cache ရှိပြီးပါက D1 သို့ ထပ်မံ Request မပို့စေရ
  if (Array.isArray(gHrStaffFT) && gHrStaffFT.length > 0 && Array.isArray(gHrStaffPT) && gHrStaffPT.length > 0) {
    return;
  }

  try {
    const resFT = await callApi('getStaffData', { category: 'Full Time', page: 1, limit: 500, forceRefresh: false }, 'GET');
    const resPT = await callApi('getStaffData', { category: 'Part Time', page: 1, limit: 500, forceRefresh: false }, 'GET');

    gHrStaffFT = (resFT && resFT.success && Array.isArray(resFT.data)) ? resFT.data : [];
    gHrStaffPT = (resPT && resPT.success && Array.isArray(resPT.data)) ? resPT.data : [];
    gHrStaffCache = [...gHrStaffFT, ...gHrStaffPT];
  } catch (e) {
    console.warn("Staff cache preload warning:", e.message);
  }
}

async function ensureStaffCacheForCategory(isPartTime) {
  // 🎯 ၁။ Memory Cache တွင် မရှိပါက LocalStorage Pre-cache မှ အရင်ဆုံး ဖတ်ယူသည် (Offline Ready & 0 D1 Quota)
  if ((!gHrStaffFT || gHrStaffFT.length === 0) || (!gHrStaffPT || gHrStaffPT.length === 0)) {
    try {
      const localMaster = localStorage.getItem('golden_master_staff');
      if (localMaster) {
        const parsed = JSON.parse(localMaster);
        gHrStaffFT = parsed.filter(s => String(s.category || '').toLowerCase().includes('full'));
        gHrStaffPT = parsed.filter(s => String(s.category || '').toLowerCase().includes('part'));
        gHrStaffCache = parsed;
      }
    } catch (e) { }
  }

  const needsRefresh = isPartTime
    ? (!gHrStaffPT || gHrStaffPT.length === 0)
    : (!gHrStaffFT || gHrStaffFT.length === 0);

  if (!needsRefresh || !navigator.onLine) return;

  try {
    const category = isPartTime ? 'Part Time' : 'Full Time';
    const res = await callApi('getStaffData', { category, page: 1, limit: 500, forceRefresh: false }, 'GET');

    if (res && res.success && Array.isArray(res.data)) {
      if (isPartTime) {
        gHrStaffPT = res.data;
      } else {
        gHrStaffFT = res.data;
      }
      gHrStaffCache = [...gHrStaffFT, ...gHrStaffPT];
    }
  } catch (e) {
    console.warn("ensureStaffCacheForCategory warning:", e.message);
  }
}

function renderHrPayrollStats(stats) {
  updateHrKpiLabels();

  const elInc = document.getElementById('hr-pay-total-income');
  const elExp = document.getElementById('hr-pay-total-expense');
  const elBal = document.getElementById('hr-pay-balance');
  const elCount = document.getElementById('hr-pay-entries-count');

  if (elInc) elInc.textContent = `${Number(stats.totalIncome || 0).toLocaleString('en-US')}`;
  if (elExp) elExp.textContent = `${Number(stats.totalExpense || 0).toLocaleString('en-US')}`;
  if (elBal) elBal.textContent = `${Number(stats.balance || 0).toLocaleString('en-US')}`;
  if (elCount) elCount.textContent = (gHrPayrollTotalRows || gHrPayrollData.length || 0).toLocaleString('en-US');

  setTimeout(adjustHrKpiFontSizes, 50);
}

function applyHrPayrollSearchAndRender() {
  const searchInput = document.getElementById('hr-payroll-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const fromEl = document.getElementById('hr-date-from');
  const toEl = document.getElementById('hr-date-to');
  const fromDate = fromEl ? fromEl.value : '';
  const toDate = toEl ? toEl.value : '';

  gHrPayrollFilteredData = gHrPayrollData.filter(row => {
    if (typeof window.isDateInRange === 'function') {
      if (!window.isDateInRange(row.date, fromDate, toDate)) return false;
    }

    if (!query) return true;
    const descMatch = String(row.description || '').toLowerCase().includes(query);
    const catMatch = String(row.category || '').toLowerCase().includes(query);
    const vrMatch = String(row.vr_no || row.vrNo || '').toLowerCase().includes(query);

    return descMatch || catMatch || vrMatch;
  });

  gHrPayrollPage = 1;
  renderHrPayrollTable();
}

function onSearchInputHrPayroll() {
  applyHrPayrollSearchAndRender();
}

function clearDateFilterHrPayroll() {
  const fromEl = document.getElementById('hr-date-from');
  const toEl = document.getElementById('hr-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  applyHrPayrollSearchAndRender();
}

/**
 * 💡 Render Table Grid Rows (px-2 ဖြင့် Header နှင့် အတိအကျ ညီအောင် ညှိထားသည်)
 */
function renderHrPayrollTable() {
  const tbody = document.getElementById('hr-payroll-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  const totalEntries = gHrPayrollFilteredData.length;
  const totalPages = Math.ceil(totalEntries / gHrPayrollLimit) || 1;
  if (gHrPayrollPage > totalPages) gHrPayrollPage = totalPages;

  const startIndex = (gHrPayrollPage - 1) * gHrPayrollLimit;
  const endIndex = Math.min(startIndex + gHrPayrollLimit, totalEntries);
  const pageItems = gHrPayrollFilteredData.slice(startIndex, endIndex);

  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော HR Payroll စာရင်း မရှိပါ။</td></tr>`;
    updateHrPayrollPaginationInfo(0, 0, 0);
    return;
  }

  pageItems.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-slate-800/30 transition-all border-b border-slate-800/40 text-xs text-slate-300';
    const displayNo = Math.floor(parseFloat(item.no || (startIndex + index + 1)));
    const uid = String(item.uniqueid || item.uniqueId || '');
    const vrNo = String(item.vr_no || item.vrNo || '-');
    const unpaidBonus = Number(item.unpaid_bonus ?? item.unpaidBonus ?? 0);
    const unpaidFund = Number(item.unpaid_fund ?? item.unpaidFund ?? 0);

    tr.innerHTML = `
      <td class="text-center font-mono font-semibold text-slate-400 py-3 px-2">${displayNo}</td>
      <td class="font-mono py-3 px-2">${escapeHtml(item.date) || '-'}</td>
      <td class="py-3 px-2">${typeof window.formatCategoryBadgeHtml === 'function' ? window.formatCategoryBadgeHtml(item.category) : escapeHtml(item.category)}</td>
      <td class="font-bold text-slate-100 max-w-xs truncate py-3 px-2" title="${escapeHtml(item.description)}">${escapeHtml(item.description) || '-'}</td>
      <td class="font-semibold py-3 px-2">${escapeHtml(item.method) || '-'}</td>
      <td class="text-right font-mono font-bold text-emerald-400 py-3 px-2">${item.debit > 0 ? Number(item.debit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
      <td class="text-right font-mono font-bold text-rose-400 py-3 px-2">${item.credit > 0 ? Number(item.credit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}</td>
      <td class="text-right font-mono font-bold text-slate-400 py-3 px-2">${Number(item.balances || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      <td class="text-right font-mono font-bold text-emerald-400 py-3 px-2">${unpaidBonus > 0 ? Number(unpaidBonus).toLocaleString('en-US') : '-'}</td>
      <td class="text-right font-mono font-bold text-teal-400 py-3 px-2">${unpaidFund > 0 ? Number(unpaidFund).toLocaleString('en-US') : '-'}</td>
      <td class="font-mono text-slate-400 py-3 px-2">${escapeHtml(vrNo)}</td>
      <td class="font-mono py-3 px-2">${escapeHtml(item.my) || '-'}</td>
      <td class="font-mono font-bold text-indigo-300 py-3 px-2">${escapeHtml(item.fy) || '-'}</td>
      <td class="text-center right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg py-3 px-2">
        <div class="flex items-center justify-center gap-2">
          <button onclick="printPayslip('${escapeJsAttr(uid)}')" class="p-1.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 rounded-lg transition" title="Print Payslip"><i class="fa-solid fa-print"></i></button>
          <button onclick="editHrPayrollEntry('${escapeJsAttr(uid)}')" class="p-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 rounded-lg transition" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>
          <button onclick="deleteHrPayrollEntry('${escapeJsAttr(uid)}')" class="p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded-lg transition btn-delete" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    `;

    tbody.appendChild(tr);
  });

  updateHrPayrollPaginationInfo(startIndex + 1, endIndex, totalEntries);
}

function updateHrPayrollPaginationInfo(start, end, total) {
  const info = document.getElementById('hr-pay-pagination-info');
  if (info) info.textContent = `Showing ${start} to ${end} of ${total} entries`;

  const btnPrev = document.getElementById('hr-pay-btn-prev');
  const btnNext = document.getElementById('hr-pay-btn-next');

  if (btnPrev) btnPrev.disabled = (gHrPayrollPage <= 1);
  if (btnNext) btnNext.disabled = (end >= total);
}

function changePageHrPayroll(delta) {
  gHrPayrollPage += delta;
  renderHrPayrollTable();
}

async function onStaffIdChangePayroll() {
  const staffIdInput = document.getElementById('hr-pay-staff-id');
  const categorySelect = document.getElementById('hr-pay-category');
  const dateInput = document.getElementById('hr-pay-date');

  const rawStaffId = staffIdInput ? staffIdInput.value.trim() : '';
  const category = categorySelect ? categorySelect.value : 'Full Time Salary';
  const dateVal = dateInput ? dateInput.value : new Date().toISOString().slice(0, 10);

  const elDeb = document.getElementById('hr-pay-debit');
  const elCredit = document.getElementById('hr-pay-credit');
  const elBonus = document.getElementById('hr-pay-unpaid-bonus');
  const elFund = document.getElementById('hr-pay-unpaid-fund');
  const elDesc = document.getElementById('hr-pay-description');

  // 🎯 Bank Interest, Other, Opening, Closing, Transfer စသည့် Category များအတွက် Staff ID မလိုအပ်ပါ
  const isNonStaffCategory = ['Bank Interest', 'Other', 'Opening', 'Closing', 'Transfer'].includes(category);

  // Input Field များကို Category အလိုက် Lock/Unlock ပြုလုပ်ပေးခြင်း
  if (isNonStaffCategory) {
    if (staffIdInput) {
      staffIdInput.disabled = true;
      staffIdInput.value = '';
      staffIdInput.classList.add('opacity-40', 'cursor-not-allowed', 'bg-slate-900/80');
      staffIdInput.required = false;
    }

    // Bank Interest သည် Debit (ရရှိငွေ) သာ ခွင့်ပြုမည်
    if (category === 'Bank Interest') {
      if (elDeb) {
        elDeb.readOnly = false;
        elDeb.classList.remove('cursor-not-allowed');
      }
      if (elCredit) {
        elCredit.value = 0;
        elCredit.readOnly = true;
        elCredit.classList.add('cursor-not-allowed');
      }
    }
    // Other, Opening, Closing, Transfer တို့သည် Debit နှင့် Credit နှစ်မျိုးလုံးကို ကိုယ်တိုင်ရိုက်သွင်းခွင့်ပြုမည်
    else {
      if (elDeb) {
        elDeb.readOnly = false;
        elDeb.classList.remove('cursor-not-allowed');
      }
      if (elCredit) {
        elCredit.readOnly = false;
        elCredit.classList.remove('cursor-not-allowed');
      }
    }

    if (elBonus) elBonus.value = 0;
    if (elFund) elFund.value = 0;
    if (elDesc) {
      elDesc.readOnly = false;
      elDesc.classList.remove('cursor-not-allowed');
      // အသစ်ဝင်လာပါက Description အဟောင်းရှိနေလျှင် မဖျက်ဘဲထားမည်၊ မရှိမှသာ Category အမည်ကို Default ပေးမည်
      if (!elDesc.value || elDesc.value.includes('FID') || elDesc.value.includes('PID')) {
        elDesc.value = category;
      }
    }
    return; // Staff Validation အပိုင်းကို ကျော်သွားမည်
  }

  // 🎯 Salary, Bonus, Fund များဖြစ်ပါက မူလအတိုင်း Staff ID တောင်းခံပြီး Credit ကို Lock ချကာ Auto တွက်ပေးမည်
  if (staffIdInput) {
    staffIdInput.disabled = false;
    staffIdInput.classList.remove('opacity-40', 'cursor-not-allowed', 'bg-slate-900/80');
    staffIdInput.required = true;
  }

  if (elDeb) {
    elDeb.value = 0;
    elDeb.readOnly = false; // Salary မှလွဲ၍ အခြား Exception ဝင်ငွေများ ထည့်လိုပါက ထည့်ခွင့်ပြုထားဆဲဖြစ်သည်
  }
  if (elCredit) {
    elCredit.readOnly = true;
    elCredit.classList.add('cursor-not-allowed');
  }
  if (elDesc) {
    elDesc.readOnly = true;
    elDesc.classList.add('cursor-not-allowed');
  }

  if (!rawStaffId) {
    if (elCredit) elCredit.value = 0;
    if (elBonus) elBonus.value = 0;
    if (elFund) elFund.value = 0;
    if (elDesc) elDesc.value = '';
    return;
  }

  const isPartTime = category.toLowerCase().includes('part time');

  await ensureStaffCacheForCategory(isPartTime);

  let targetStaffList = isPartTime ? gHrStaffPT : gHrStaffFT;

  const targetIdNum = parseInt(rawStaffId, 10);
  const prefixKey = isPartTime ? 'pid' : 'fid';

  // 🎯 FIX: d1Id နှင့် rowNo များကို လုံးဝ မစစ်ဆေးတော့ဘဲ တကယ့် Staff ID (sId) နှင့် Format အတိအကျဖြင့်သာ ရှာဖွေသည်
  const matchedStaff = (targetStaffList || []).find((s) => {
    const sId = parseInt(s.staff_id || s.staffId || 0, 10);
    const searchPad = `00${targetIdNum}`.slice(-3);
    const sName = String(s.staff_idname || s.staffIdName || '').toLowerCase();

    return (
      sId === targetIdNum ||
      sName.includes(`${prefixKey} ${searchPad}`) ||
      sName.includes(`${prefixKey}${searchPad}`)
    );
  });

  if (!matchedStaff) {
    if (elCredit) elCredit.value = 0;
    if (elBonus) elBonus.value = 0;
    if (elFund) elFund.value = 0;
    if (elDesc) elDesc.value = `[${isPartTime ? 'PID' : 'FID'} ${rawStaffId} ဝန်ထမ်း မရှိပါ]`;
    return;
  }

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dObj = new Date(dateVal);
  const now = new Date();
  const fallbackMY = `${months[now.getMonth()]}-${String(now.getFullYear()).slice(-2)}`;
  const myStr = !isNaN(dObj.getTime()) ? `${months[dObj.getMonth()]}-${String(dObj.getFullYear()).slice(-2)}` : fallbackMY;

  let creditVal = 0;
  let bonusFieldVal = 0;
  let fundFieldVal = 0;

  const totalSalaryVal = Number(matchedStaff.total_salary ?? matchedStaff.totalSalary ?? 0);
  const bonusAmt = Number(matchedStaff.bonus ?? 0);
  const fundAmt = Number(matchedStaff.fund ?? 0);
  const unpaidBonus = Number(matchedStaff.unpaid_bonus ?? matchedStaff.unpaidBonus ?? 0);
  const unpaidFund = Number(matchedStaff.unpaid_fund ?? matchedStaff.unpaidFund ?? 0);

  if (category === 'Full Time Salary' || category === 'Part Time Salary') {
    creditVal = totalSalaryVal;
    bonusFieldVal = bonusAmt;
    fundFieldVal = fundAmt;
  } else if (category === 'Full Time Bonus' || category === 'Part Time Bonus') {
    bonusFieldVal = unpaidBonus || bonusAmt;
    creditVal = bonusFieldVal;
  } else if (category === 'Full Time Fund' || category === 'Part Time Fund') {
    fundFieldVal = unpaidFund || fundAmt;
    creditVal = fundFieldVal;
  }

  if (elCredit) elCredit.value = creditVal;
  if (elBonus) elBonus.value = bonusFieldVal;
  if (elFund) elFund.value = fundFieldVal;

  const defaultPrefix = isPartTime ? 'PID' : 'FID';
  const staffNameOnly = matchedStaff.name || '';
  const displayStaffId = matchedStaff.staff_id || matchedStaff.staffId || matchedStaff.id || targetIdNum;
  const defaultIdStr = `${defaultPrefix} ${String(displayStaffId).padStart(3, '0')} ${staffNameOnly}`;
  const staffDisplayName = matchedStaff.staff_idname || matchedStaff.staffIdName || defaultIdStr;

  if (elDesc) elDesc.value = `[${staffDisplayName}, ${category} ${myStr}]`;
}

function openAddModalHrPayroll() {
  const form = document.getElementById('hr-payroll-form');
  if (form) form.reset();

  const elId = document.getElementById('hr-pay-uniqueId');
  if (elId) elId.value = '';

  const elDate = document.getElementById('hr-pay-date');
  if (elDate) elDate.value = new Date().toISOString().slice(0, 10);

  const elDeb = document.getElementById('hr-pay-debit');
  if (elDeb) elDeb.value = 0;

  const elCred = document.getElementById('hr-pay-credit');
  if (elCred) elCred.value = 0;

  const title = document.getElementById('hr-payroll-form-title');
  if (title) title.textContent = 'Add HR Payroll Entry';

  const modal = document.getElementById('hr-payroll-modal');
  if (modal) modal.classList.remove('hidden');

  preloadStaffCacheForPayroll();
}

function closeHrPayrollModal() {
  const modalEl = document.getElementById('hr-payroll-modal');
  if (modalEl) modalEl.classList.add('hidden');
}

/**
 * 💡 Save HR Payroll Form (Double-Submit Protection & window.clearAllApiCache Guard)
 */
async function saveHrPayrollForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (isHrPayrollSubmitting) return;
  isHrPayrollSubmitting = true;

  const staffIdVal = document.getElementById('hr-pay-staff-id')?.value.trim();
  const categoryVal = document.getElementById('hr-pay-category')?.value || 'Full Time Salary';
  const creditVal = parseFloat(document.getElementById('hr-pay-credit')?.value || 0);
  const debitVal = parseFloat(document.getElementById('hr-pay-debit')?.value || 0);

  const isNonStaffCategory = ['Bank Interest', 'Other', 'Opening', 'Closing', 'Transfer'].includes(categoryVal);

  // ဝန်ထမ်းလစာ ဖြစ်ပါက Staff ID ကို မဖြစ်မနေ တောင်းခံမည်၊ Category အသစ်များအတွက် မလိုပါ
  if (!isNonStaffCategory && !staffIdVal) {
    isHrPayrollSubmitting = false;
    if (typeof showToast === 'function') showToast("ERROR", "ဝန်ထမ်း ID ဖြည့်သွင်းပါ");
    return;
  }

  // Bank Interest ဖြစ်ပါက Credit (ထုတ်ပေးငွေ) လုံးဝ မရှိစေရဘဲ Debit သာ ခွင့်ပြုမည်
  if (categoryVal === 'Bank Interest' && creditVal > 0) {
    isHrPayrollSubmitting = false;
    if (typeof showToast === 'function') showToast("ERROR", "Bank Interest အတွက် Debit (ရရှိငွေ) သာ ထည့်သွင်းခွင့်ပြုပါသည်။");
    return;
  }

  const entryDate = document.getElementById('hr-pay-date')?.value || new Date().toISOString().slice(0, 10);
  const currentAcademic = typeof window.getCurrentAcademicYear === 'function' ? window.getCurrentAcademicYear(entryDate) : '2026-2027';
  const dynamicFy = `FY ${currentAcademic}`;

  const payload = {
    bookName: 'HR Payroll Exp Book',
    uniqueId: document.getElementById('hr-pay-uniqueId')?.value || '',
    date: entryDate,
    category: categoryVal,
    staffId: isNonStaffCategory ? null : staffIdVal, // Non-staff category များအတွက် ID ကို null ပို့မည်
    method: document.getElementById('hr-pay-method')?.value || 'Cash',
    debit: debitVal,
    credit: creditVal,
    unpaidBonus: parseFloat(document.getElementById('hr-pay-unpaid-bonus')?.value || 0),
    unpaidFund: parseFloat(document.getElementById('hr-pay-unpaid-fund')?.value || 0),
    description: document.getElementById('hr-pay-description')?.value || '',
    fy: dynamicFy
  };

  closeHrPayrollModal();
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    const actionName = payload.uniqueId ? 'updateExpenseEntry' : 'saveHrPayrollForm';
    const response = await callApi(actionName, payload);

    if (response && response.success) {
      if (typeof showToast === 'function') showToast('SUCCESS', 'HR Payroll စာရင်း အချက်အလက်များ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။');
      if (typeof window.clearAllApiCache === 'function') window.clearAllApiCache();
      loadHrPayrollData(false);
    } else {
      if (typeof showToast === 'function') showToast("ERROR", (response ? response.message : "") || "သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast('ERROR', `အမှားအယွင်း ဖြစ်ပေါ်ခဲ့သည်: ${error.message}`);
  } finally {
    isHrPayrollSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function editHrPayrollEntry(uniqueId) {
  const row = gHrPayrollData.find(item => (item.uniqueid === uniqueId || item.uniqueId === uniqueId));
  if (!row) {
    if (typeof showToast === 'function') showToast("ERROR", "မူရင်း အချက်အလက် ရှာမတွေ့ပါ။");
    return;
  }

  openAddModalHrPayroll();

  const elId = document.getElementById('hr-pay-uniqueId');
  if (elId) elId.value = row.uniqueid || row.uniqueId || '';

  const elDate = document.getElementById('hr-pay-date');
  if (elDate) elDate.value = row.date || '';

  const elCat = document.getElementById('hr-pay-category');
  if (elCat) elCat.value = row.category || 'Full Time Salary';

  const elMethod = document.getElementById('hr-pay-method');
  if (elMethod) elMethod.value = row.method || 'Cash';

  const elDeb = document.getElementById('hr-pay-debit');
  if (elDeb) elDeb.value = row.debit || 0;

  const elCred = document.getElementById('hr-pay-credit');
  if (elCred) elCred.value = row.credit || 0;

  const elBonus = document.getElementById('hr-pay-unpaid-bonus');
  if (elBonus) elBonus.value = row.unpaid_bonus ?? row.unpaidBonus ?? 0;

  const elFund = document.getElementById('hr-pay-unpaid-fund');
  if (elFund) elFund.value = row.unpaid_fund ?? row.unpaidFund ?? 0;

  const elStaffId = document.getElementById('hr-pay-staff-id');
  if (elStaffId) {
    const matchId = String(row.description || '').match(/(?:FID|PID)\s*0*(\d+)/i);
    elStaffId.value = row.staff_id || row.staffId || (matchId ? matchId[1] : '');
  }

  const elDesc = document.getElementById('hr-pay-description');
  if (elDesc) elDesc.value = row.description || '';

  const title = document.getElementById('hr-payroll-form-title');
  if (title) title.textContent = 'Edit HR Payroll Entry';
}

async function deleteHrPayrollEntry(uniqueId) {
  if (!confirm("ဤ စာရင်းအား အပြီးတိုင် ဖျက်သိမ်းလိုပါသလား။")) return;

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    const response = await callApi('deleteExpenseEntry', { uniqueId, bookName: 'HR Payroll Exp Book' });

    if (response && response.success) {
      if (typeof showToast === 'function') showToast('SUCCESS', 'HR Payroll စာရင်းအား အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။');
      if (typeof window.clearAllApiCache === 'function') window.clearAllApiCache();
      loadHrPayrollData(false);
    } else {
      if (typeof showToast === 'function') showToast("ERROR", (response ? response.message : "") || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
    }
  } catch (error) {
    if (typeof showToast === 'function') showToast('ERROR', `ဖျက်သိမ်းမှု အမှား: ${error.message}`);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 Precision Payslip Printer
 */
function printPayslip(uniqueId) {
  const row = gHrPayrollData.find(item => (item.uniqueid === uniqueId || item.uniqueId === uniqueId));
  if (!row) return;

  const setTxt = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val || '-';
  };

  const netAmt = Number(row.credit || row.debit || 0).toLocaleString('en-US') + ' MMK';

  let displayMY = row.my;
  if (!displayMY && row.date) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const d = new Date(row.date);
    if (!isNaN(d.getTime())) {
      displayMY = `${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
    }
  }

  const unpaidBonus = Number(row.unpaid_bonus ?? row.unpaidBonus ?? 0);
  const unpaidFund = Number(row.unpaid_fund ?? row.unpaidFund ?? 0);

  setTxt('print-pay-desc-top', row.description);
  setTxt('print-pay-cat-top', row.category);
  setTxt('print-pay-date-top', row.date);
  setTxt('print-pay-month-top', displayMY || '-');
  setTxt('print-pay-net-top', netAmt);
  setTxt('print-pay-bonus-top', unpaidBonus.toLocaleString() + ' MMK');
  setTxt('print-pay-fund-top', unpaidFund.toLocaleString() + ' MMK');

  setTxt('print-pay-desc-bot', row.description);
  setTxt('print-pay-cat-bot', row.category);
  setTxt('print-pay-date-bot', row.date);
  setTxt('print-pay-month-bot', displayMY || '-');
  setTxt('print-pay-net-bot', netAmt);
  setTxt('print-pay-bonus-bot', unpaidBonus.toLocaleString() + ' MMK');
  setTxt('print-pay-fund-bot', unpaidFund.toLocaleString() + ' MMK');

  document.body.classList.remove('print-mode-invoice');
  document.body.classList.add('print-mode-payslip');

  setTimeout(function () {
    window.print();
    setTimeout(function () {
      document.body.classList.remove('print-mode-payslip');
    }, 500);
  }, 100);
}

function exportToCSVHrPayroll() {
  if (!gHrPayrollData || gHrPayrollData.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  let csv = "NO,DATE,CATEGORY,DESCRIPTION,METHOD,DEBIT,CREDIT,BALANCES,UNPAID BONUS,UNPAID FUND,VR NO,MY,FY\n";
  gHrPayrollData.forEach((r, idx) => {
    let unpaidBonus = r.unpaid_bonus ?? r.unpaidBonus ?? 0;
    let unpaidFund = r.unpaid_fund ?? r.unpaidFund ?? 0;
    let vrNo = r.vr_no || r.vrNo || '';

    csv += `${r.no || (idx + 1)},` +
      `${safeCsvCell(r.date || '')},` +
      `${safeCsvCell(r.category || '')},` +
      `${safeCsvCell(r.description || '')},` +
      `${safeCsvCell(r.method || '')},` +
      `${r.debit || 0},` +
      `${r.credit || 0},` +
      `${r.balances || 0},` +
      `${unpaidBonus},` +
      `${unpaidFund},` +
      `${safeCsvCell(vrNo)},` +
      `${safeCsvCell(r.my || '')},` +
      `${safeCsvCell(r.fy || '')}\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `HR_Payroll_Export_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 EXPOSE GLOBALLY
window.updateHrKpiLabels = updateHrKpiLabels;
window.adjustHrKpiFontSizes = adjustHrKpiFontSizes;
window.loadHrPayrollData = loadHrPayrollData;
window.onSearchInputHrPayroll = onSearchInputHrPayroll;
window.clearDateFilterHrPayroll = clearDateFilterHrPayroll;
window.changePageHrPayroll = changePageHrPayroll;
window.onStaffIdChangePayroll = onStaffIdChangePayroll;
window.openAddModalHrPayroll = openAddModalHrPayroll;
window.closeHrPayrollModal = closeHrPayrollModal;
window.saveHrPayrollForm = saveHrPayrollForm;
window.editHrPayrollEntry = editHrPayrollEntry;
window.deleteHrPayrollEntry = deleteHrPayrollEntry;
window.printPayslip = printPayslip;
window.exportToCSVHrPayroll = exportToCSVHrPayroll;
