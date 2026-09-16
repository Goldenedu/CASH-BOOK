/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - SYSTEM SETTINGS, BACKUP & D1 MONITOR CONTROLLER
 * File: js/settings.js 
 * 💡 Features: 3-Sub-Tab Responsive Navigation Engine (Balances / Export / D1 Monitor),
 *              1-Click Full Database Balance & Sequence Recalculator Engine,
 *              Balanced 2-Line Subtitle Layout (student_money on top line),
 *              Full-Width FY Dropdowns (w-36), Zero-Overflow Action Buttons,
 *              SheetJS Multi-Tab Real Excel (.xlsx) Generator & Resend Email Backup,
 *              📊 Cloudflare D1 Storage & Health Quota Visual Monitor (Dynamic % Bar & Alerts)
 * ==============================================================================
 */

var gSettingsData = null;
var gAvailableFys = [];
var currentSettingsSubTab = 'balances'; // 'balances' | 'export' | 'd1'

/**
 * 💡 1. Sub-Tab Switching Controller (Balances / Export / D1 Monitor)
 */
function switchSettingsSubTab(tabName) {
  currentSettingsSubTab = tabName || 'balances';

  const tabBtnBalances = document.getElementById('btn-settings-tab-balances');
  const tabBtnExport = document.getElementById('btn-settings-tab-export');
  const tabBtnD1 = document.getElementById('btn-settings-tab-d1');

  const panelBalances = document.getElementById('panel-settings-balances');
  const panelExport = document.getElementById('panel-settings-export');
  const panelD1 = document.getElementById('panel-settings-d1');

  const activeBtnClass = "px-4 py-2.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 border bg-indigo-600 text-white border-indigo-500/40 shadow-lg shadow-indigo-600/20";
  const inactiveBtnClass = "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border bg-slate-900/90 text-slate-400 border-slate-800 hover:text-white hover:border-slate-700";

  // Reset All Panels
  if (panelBalances) panelBalances.classList.add('hidden');
  if (panelExport) panelExport.classList.add('hidden');
  if (panelD1) panelD1.classList.add('hidden');

  // Reset All Button Styles
  if (tabBtnBalances) tabBtnBalances.className = inactiveBtnClass;
  if (tabBtnExport) tabBtnExport.className = inactiveBtnClass;
  if (tabBtnD1) tabBtnD1.className = inactiveBtnClass;

  // Activate Target Tab & Panel
  if (tabName === 'export') {
    if (panelExport) panelExport.classList.remove('hidden');
    if (tabBtnExport) tabBtnExport.className = activeBtnClass;
  } else if (tabName === 'd1') {
    if (panelD1) panelD1.classList.remove('hidden');
    if (tabBtnD1) tabBtnD1.className = activeBtnClass;
  } else {
    // Default to Balances Tab
    if (panelBalances) panelBalances.classList.remove('hidden');
    if (tabBtnBalances) tabBtnBalances.className = activeBtnClass;
  }
}

/**
 * 💡 2. Load Settings Data (Balances Control, FY List & D1 Database Usage)
 */
async function loadSettingsData(forceRefresh) {
  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const res = await callApi('getSettingsData', { forceRefresh: !!forceRefresh }, 'GET');

    if (res && res.success) {
      gSettingsData = res;
      gAvailableFys = res.availableFys || ["2026-2027", "2025-2026", "2027-2028"];
      
      // 1. Render Balances Control (Tab 1)
      renderBalancesControlTable(res.balancesControl);

      // 2. Render Export Table (Tab 2)
      renderExportTable();

      // 3. Render D1 Database Monitor (Tab 3)
      if (res.d1Usage) {
        renderD1UsageMonitor(res.d1Usage);
      }
    } else {
      if (typeof showToast === 'function') showToast("ERROR", res?.message || "Settings ဒေတာ ရယူ၍ မရပါ။");
    }
  } catch (err) {
    console.error("Error loading settings data:", err);
    if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 3. Render D1 Database Health & Quota Monitor (Tab 3)
 */
function renderD1UsageMonitor(usageData) {
  if (!usageData) return;

  const storage = usageData.storage || {};
  const records = usageData.records || {};
  const health = usageData.health || {};
  const breakdown = records.breakdown || [];

  const usedMB = Number(storage.usedMB || 0);
  const maxMB = Number(storage.maxMB || 5000);
  const pct = Number(storage.usagePercentage || 0);
  const totalRows = Number(records.totalRows || 0);
  const totalTables = Number(records.totalTables || 18);

  // 1. Storage Numbers & Progress Bar
  const elUsedMB = document.getElementById('d1-storage-used-mb');
  const elMaxMB = document.getElementById('d1-storage-max-mb');
  const elPercent = document.getElementById('d1-storage-percent');
  const elProgressBar = document.getElementById('d1-storage-bar');
  const elTabStatusDot = document.getElementById('d1-tab-status-dot');

  if (elUsedMB) elUsedMB.textContent = usedMB.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (elMaxMB) elMaxMB.textContent = maxMB.toLocaleString('en-US');
  if (elPercent) elPercent.textContent = `${pct.toFixed(2)}%`;

  if (elProgressBar) {
    elProgressBar.style.width = `${Math.min(100, Math.max(0.5, pct))}%`;
  }

  // 2. Color Shifting based on Quota Percentage (Healthy / Warning / Critical)
  let statusColor = 'emerald';
  if (pct >= 90 || health.status === 'CRITICAL') {
    statusColor = 'rose';
  } else if (pct >= 75 || health.status === 'WARNING') {
    statusColor = 'amber';
  }

  if (elProgressBar) {
    elProgressBar.className = `h-full rounded-full transition-all duration-700 ${
      statusColor === 'rose' ? 'bg-rose-500' : (statusColor === 'amber' ? 'bg-amber-500' : 'bg-emerald-500')
    }`;
  }

  if (elPercent) {
    elPercent.className = `font-mono font-black px-2 py-0.5 rounded border text-${statusColor}-400 bg-${statusColor}-500/10 border-${statusColor}-500/20`;
  }

  if (elTabStatusDot) {
    elTabStatusDot.className = `w-2 h-2 rounded-full animate-pulse ml-1 ${
      statusColor === 'rose' ? 'bg-rose-500' : (statusColor === 'amber' ? 'bg-amber-500' : 'bg-emerald-400')
    }`;
  }

  // 3. Health & Plan Upgrade Reminder Banner
  const elBanner = document.getElementById('d1-health-banner');
  const elIconBox = document.getElementById('d1-health-icon-box');
  const elIcon = document.getElementById('d1-health-icon');
  const elTitle = document.getElementById('d1-health-title');
  const elBadge = document.getElementById('d1-health-badge');
  const elDesc = document.getElementById('d1-health-desc');

  if (elBanner && elIconBox && elIcon && elTitle && elBadge && elDesc) {
    if (statusColor === 'rose') {
      elBanner.className = 'p-4 rounded-2xl border transition-all duration-300 bg-rose-950/25 border-rose-500/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4';
      elIconBox.className = 'p-3 rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 text-lg';
      elIcon.className = 'fa-solid fa-triangle-exclamation';
      elTitle.className = 'text-xs font-black uppercase tracking-wider text-rose-300';
      elTitle.textContent = 'Cloudflare D1 Database Status: Critical (Action Required)';
      elBadge.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-rose-500/20 text-rose-300 border border-rose-500/40';
      elBadge.textContent = 'Quota Exceeded (>90%)';
      elDesc.textContent = health.message || 'သတိပေးချက်: ဒေတာသိုလှောင်မှု ၉၀% ကျော်လွန်နေပါပြီ။ စာရင်းများ ရပ်တန့်မသွားစေရန် Cloudflare Paid Plan ($5/mo) သို့ ချက်ချင်း Upgrade ပြုလုပ်ပါ။';
    } else if (statusColor === 'amber') {
      elBanner.className = 'p-4 rounded-2xl border transition-all duration-300 bg-amber-950/25 border-amber-500/40 flex flex-col md:flex-row items-start md:items-center justify-between gap-4';
      elIconBox.className = 'p-3 rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 text-lg';
      elIcon.className = 'fa-solid fa-circle-exclamation';
      elTitle.className = 'text-xs font-black uppercase tracking-wider text-amber-300';
      elTitle.textContent = 'Cloudflare D1 Database Status: Storage Warning';
      elBadge.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-amber-500/20 text-amber-300 border border-amber-500/40';
      elBadge.textContent = 'Warning (>75%)';
      elDesc.textContent = health.message || 'သတိပေးချက်: ဒေတာသိုလှောင်မှု ၇၅% ကျော်လွန်လာပါပြီ။ မကြာမီ Paid Plan သို့ Upgrade ပြုလုပ်ရန် စဉ်းစားပါ။';
    } else {
      elBanner.className = 'p-4 rounded-2xl border transition-all duration-300 bg-emerald-950/20 border-emerald-500/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4';
      elIconBox.className = 'p-3 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 text-lg';
      elIcon.className = 'fa-solid fa-shield-heart';
      elTitle.className = 'text-xs font-black uppercase tracking-wider text-emerald-300';
      elTitle.textContent = 'Cloudflare D1 Database Status: Healthy';
      elBadge.className = 'px-2.5 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
      elBadge.textContent = 'Free Tier (5 GB)';
      elDesc.textContent = health.message || 'လက်ရှိတွင် Cloudflare Free Plan ၏ သတ်မှတ်ချက်အတွင်း စာရင်းများအား လုံလောက်စွာ သိမ်းဆည်းသုံးစွဲနိုင်သော အခြေအနေ ဖြစ်ပါသည်။';
    }
  }

  // 4. Total Records Counters
  const elTotalRows = document.getElementById('d1-total-rows');
  const elTotalTables = document.getElementById('d1-total-tables');
  if (elTotalRows) elTotalRows.textContent = totalRows.toLocaleString('en-US');
  if (elTotalTables) elTotalTables.textContent = totalTables;

  // 5. Table-by-Table Data Breakdown Rows
  const tbodyBreakdown = document.getElementById('d1-table-breakdown-body');
  if (!tbodyBreakdown) return;

  if (breakdown.length === 0) {
    tbodyBreakdown.innerHTML = `<tr><td colspan="5" class="py-6 text-center italic text-slate-500">Table စာရင်းများ မရှိပါ။</td></tr>`;
    return;
  }

  const maxRowsCount = Math.max(...breakdown.map(t => t.rowCount || 0), 1);

  tbodyBreakdown.innerHTML = breakdown.map((t, idx) => {
    const rCount = Number(t.rowCount || 0);
    const relativeBarWidth = Math.min(100, Math.max(1, Math.round((rCount / maxRowsCount) * 100)));
    const totalDbPercent = totalRows > 0 ? ((rCount / totalRows) * 100).toFixed(1) : '0.0';

    return `
      <tr class="hover:bg-slate-800/30 transition">
        <td class="py-2.5 px-3 text-center font-mono font-bold text-slate-500">${idx + 1}</td>
        <td class="py-2.5 px-3 font-bold text-slate-200">${t.tableName}</td>
        <td class="py-2.5 px-3 font-mono text-xs text-indigo-300">
          <span class="px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">${t.tableKey}</span>
        </td>
        <td class="py-2.5 px-3 text-right font-mono font-extrabold text-white">${rCount.toLocaleString()}</td>
        <td class="py-2.5 px-3">
          <div class="flex items-center gap-2.5">
            <div class="flex-grow bg-slate-800/90 rounded-full h-2 overflow-hidden border border-slate-700/40 max-w-[120px]">
              <div class="h-full bg-sky-500 rounded-full" style="width: ${relativeBarWidth}%;"></div>
            </div>
            <span class="font-mono text-[10px] text-slate-400 min-w-[35px] text-right">${totalDbPercent}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * 💡 4. 1-Click Full Database Running Balances & NO Sequence Recalculator Engine
 */
async function triggerGlobalRecalculateBalances() {
  if (!confirm("D1 Database ထဲရှိ စာရင်းအုပ်အားလုံး၏ Running Balances နှင့် NO စဉ်နံပါတ်များကို အစမှအဆုံး အလိုအလျောက် ပြန်လည်ညှိယူလိုပါသလား။")) {
    return;
  }

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const res = await callApi('recalculateAllBalances', {});

    if (res && res.success) {
      if (typeof showToast === 'function') {
        showToast("SUCCESS", res.message || "Database ထဲရှိ စာအုပ်အားလုံး၏ Balance များကို အောင်မြင်စွာ ပြန်လည်ညှိယူပြီးပါပြီ။");
      }
      if (typeof clearAllApiCache === 'function') clearAllApiCache();
      await loadSettingsData(true);
    } else {
      if (typeof showToast === 'function') {
        showToast("ERROR", res?.message || "Balance ပြန်ညှိခြင်း မအောင်မြင်ပါ။");
      }
    }
  } catch (err) {
    console.error("Global Recalculate Error:", err);
    if (typeof showToast === 'function') {
      showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
    }
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

// 💡 Alias for the Tab 1 Recalculate button in views/settings.html
const triggerAutoRecalculateAllBalances = triggerGlobalRecalculateBalances;

/**
 * 💡 5. Render Balances Control Table (Tab 1: Accountant vs Cashier)
 */
function renderBalancesControlTable(data) {
  const tbody = document.getElementById('settings-balances-table-body');
  const tfoot = document.getElementById('settings-balances-table-foot');
  if (!tbody) return;

  if (!data || !data.data || data.data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-500 italic">Balances Control ဒေတာ မရှိပါ။</td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = data.data.map(row => {
    const bookName = row[0];
    const accBal = Number(row[1] || 0);
    const casBal = Number(row[2] || 0);
    const diff = Number(row[3] || 0);

    const isMatch = (diff === 0);
    const diffColor = isMatch ? 'text-slate-400' : 'text-rose-400 font-extrabold';

    return `
      <tr class="hover:bg-slate-800/30 transition">
        <td class="py-2.5 px-3 font-semibold text-slate-300">${bookName}</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">${accBal.toLocaleString()}</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold text-slate-200">${casBal.toLocaleString()}</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold ${diffColor}">${diff.toLocaleString()}</td>
      </tr>
    `;
  }).join('');

  if (tfoot && data.total) {
    const totAcc = Number(data.total[1] || 0);
    const totCas = Number(data.total[2] || 0);
    const totDiff = Number(data.total[3] || 0);

    tfoot.innerHTML = `
      <tr class="bg-indigo-500/10 border-t border-indigo-500/30 font-black text-xs text-indigo-300">
        <td class="py-3 px-3 uppercase tracking-wider">TOTAL</td>
        <td class="py-3 px-3 text-right font-mono text-emerald-400 font-black">${totAcc.toLocaleString()}</td>
        <td class="py-3 px-3 text-right font-mono text-white font-black">${totCas.toLocaleString()}</td>
        <td class="py-3 px-3 text-right font-mono font-black ${totDiff === 0 ? 'text-indigo-300' : 'text-rose-400'}">${totDiff.toLocaleString()}</td>
      </tr>
    `;
  }
}

/**
 * 💡 6. Render Export Table (Tab 2: Strict 2-Line Balanced Layout & Full FY Dropdowns)
 * 🎯 Auto-selects Current Active FY (e.g. FY 2026-2027)
 */
function renderExportTable() {
  const tbody = document.getElementById('settings-export-table-body');
  if (!tbody) return;

  const fys = (gAvailableFys && gAvailableFys.length > 0) ? gAvailableFys : ["2026-2027", "2025-2026"];

  // 🎯 လက်ရှိ ရောက်ရှိနေသော ပညာသင်နှစ် (ဥပမာ: "2026-2027") ကို Auto ရယူခြင်း
  const currentActiveFy = (typeof window.getCurrentAcademicYear === 'function') 
    ? window.getCurrentAcademicYear() 
    : '2026-2027';

  // 💡 လက်ရှိနှစ်နှင့် ကိုက်ညီသော option တွင် 'selected' attribute ထည့်သွင်းခြင်း
  const fyOptions = fys.map(fy => {
    const cleanFy = String(fy).trim().replace(/^FY\s*/i, '');
    const isSelected = (cleanFy === currentActiveFy);
    return `<option value="${cleanFy}" ${isSelected ? 'selected' : ''}>FY ${cleanFy}</option>`;
  }).join('');

  tbody.innerHTML = `
    <!-- ROW 1: MAIN CASH BOOK (13 TABS SPLIT EVENLY INTO 2 CLEAN LINES) -->
    <tr class="hover:bg-slate-800/30 transition">
      <td class="py-3.5 px-2 text-center font-mono font-bold text-slate-500">1</td>
      <td class="py-3.5 px-3">
        <div class="font-bold text-white text-xs sm:text-sm tracking-wide">Main Cash Book</div>
        <div class="text-[10px] text-slate-400 leading-normal mt-1 font-mono">
          <div>bank, cash, office, kitchen, payroll, income, student, student_money,</div>
          <div>uniform, promotion, staff_fulltime, staff_parttime, salary_grade_matrix</div>
        </div>
      </td>
      <td class="py-3.5 px-2 text-center">
        <span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-300 border border-slate-700 whitespace-nowrap shadow-sm">
          13 Master Tabs
        </span>
      </td>
      <td class="py-3.5 px-2 text-center">
        <select id="export-fy-main" class="w-36 bg-[#0f172a] border border-slate-800 text-slate-200 text-xs font-bold rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition font-mono text-center">
          ${fyOptions}
        </select>
      </td>
      <td class="py-3.5 px-3 text-center">
        <div class="flex items-center justify-center gap-2 flex-nowrap">
          <button onclick="handleExportWorkbook('main')" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-lg transition flex items-center gap-1.5 shadow-sm whitespace-nowrap" title="Download Excel (.xlsx)">
            <i class="fa-solid fa-file-excel text-emerald-400"></i> Excel (.xlsx)
          </button>
          <button onclick="handleSendEmailBackup('main')" class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-lg transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20 whitespace-nowrap" title="Send Email Backup">
            <i class="fa-solid fa-paper-plane text-[10px]"></i> Email
          </button>
        </div>
      </td>
    </tr>

    <!-- ROW 2: CASHIER CASH BOOK (5 TABS) -->
    <tr class="hover:bg-slate-800/30 transition">
      <td class="py-3.5 px-2 text-center font-mono font-bold text-slate-500">2</td>
      <td class="py-3.5 px-3">
        <div class="font-bold text-white text-xs sm:text-sm tracking-wide">Cashier Cash Book</div>
        <div class="text-[10px] text-slate-400 leading-normal mt-1 font-mono">
          <div>ca_bank, ca_cash, ca_office, ca_kitchen, ca_payroll (5 Tabs)</div>
        </div>
      </td>
      <td class="py-3.5 px-2 text-center">
        <span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-300 border border-slate-700 whitespace-nowrap shadow-sm">
          5 Cashier Tabs
        </span>
      </td>
      <td class="py-3.5 px-2 text-center">
        <select id="export-fy-cashier" class="w-36 bg-[#0f172a] border border-slate-800 text-slate-200 text-xs font-bold rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition font-mono text-center">
          ${fyOptions}
        </select>
      </td>
      <td class="py-3.5 px-3 text-center">
        <div class="flex items-center justify-center gap-2 flex-nowrap">
          <button onclick="handleExportWorkbook('cashier')" class="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-lg transition flex items-center gap-1.5 shadow-sm whitespace-nowrap" title="Download Excel (.xlsx)">
            <i class="fa-solid fa-file-excel text-emerald-400"></i> Excel (.xlsx)
          </button>
          <button onclick="handleSendEmailBackup('cashier')" class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-lg transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20 whitespace-nowrap" title="Send Email Backup">
            <i class="fa-solid fa-paper-plane text-[10px]"></i> Email
          </button>
        </div>
      </td>
    </tr>
  `;
}

/**
 * 💡 7. Generate SheetJS Multi-Tab Excel Workbook
 */
async function generateMultiTabExcelWorkbook(groupKey, fy) {
  const res = await callApi('exportGroupDataByFy', { groupKey, fy }, 'GET');
  if (!res || !res.success || !res.tables) {
    throw new Error(res?.message || "Export Data ရယူ၍ မရပါ။");
  }

  if (typeof XLSX === 'undefined') {
    throw new Error("SheetJS (XLSX) Library ရှာမတွေ့ပါ။");
  }

  const wb = XLSX.utils.book_new();

  Object.keys(res.tables).forEach(tabKey => {
    const tableDef = res.tables[tabKey];
    const headers = tableDef.headers || [];
    const rows = tableDef.rows || [];

    const sheetData = [];
    sheetData.push(headers);

    rows.forEach((r, idx) => {
      const rowArr = headers.map(h => {
        const hKey = h.toLowerCase().replace(/\s+/g, '_');
        if (h === 'NO') return idx + 1;
        let val = r[hKey] !== undefined ? r[hKey] : (r[h] !== undefined ? r[h] : '');
        return val !== null && val !== undefined ? val : '';
      });
      sheetData.push(rowArr);
    });

    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(wb, ws, tabKey.slice(0, 31));
  });

  return { wb, groupTitle: res.groupTitle, totalRecords: res.totalRecords };
}

/**
 * 💡 8. Download Native Multi-Tab Excel (.xlsx) File
 */
async function handleExportWorkbook(groupKey) {
  const fySelectId = groupKey === 'cashier' ? 'export-fy-cashier' : 'export-fy-main';
  const selectedFy = document.getElementById(fySelectId)?.value || '2026-2027';

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const { wb, groupTitle, totalRecords } = await generateMultiTabExcelWorkbook(groupKey, selectedFy);
    const cleanFyStr = selectedFy.replace(/^FY\s*/i, '');
    const fileName = `${groupTitle.replace(/\s+/g, '_')}_FY${cleanFyStr}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    XLSX.writeFile(wb, fileName);

    if (typeof showToast === 'function') {
      showToast("SUCCESS", `"${groupTitle}" (${selectedFy}) Multi-Tab Excel ဖိုင် (Total: ${totalRecords} rows) အား အောင်မြင်စွာ ဒေါင်းလုဒ်ဆွဲပြီးပါပြီ။`);
    }
  } catch (err) {
    console.error("Export Error:", err);
    if (typeof showToast === 'function') showToast("ERROR", "Excel ဒေါင်းလုဒ် အမှား: " + err.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 9. Send Real Multi-Tab Excel (.xlsx) Backup to Gmail via Resend API
 */
async function handleSendEmailBackup(groupKey) {
  const fySelectId = groupKey === 'cashier' ? 'export-fy-cashier' : 'export-fy-main';
  const selectedFy = document.getElementById(fySelectId)?.value || '2026-2027';
  const targetEmail = "goldeneduprivateschool@gmail.com";

  if (!confirm(`"${groupKey === 'cashier' ? 'Cashier Cash Book' : 'Main Cash Book'}" (${selectedFy}) ၏ Multi-Tab Excel (.xlsx) Backup အား ${targetEmail} သို့ ပို့ဆောင်လိုပါသလား။`)) {
    return;
  }

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const { wb, groupTitle } = await generateMultiTabExcelWorkbook(groupKey, selectedFy);
    const excelBase64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
    const cleanFyStr = selectedFy.replace(/^FY\s*/i, '');
    const attachmentFileName = `${groupTitle.replace(/\s+/g, '_')}_FY${cleanFyStr}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    const emailRes = await callApi('sendEmailBackupByFy', {
      groupKey: groupKey,
      fy: selectedFy,
      excelBase64: excelBase64,
      fileName: attachmentFileName
    });

    if (emailRes && emailRes.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", `အီးမေးလ် ပေးပို့မှု အောင်မြင်ပါသည်! ${targetEmail} သို့ Backup ရောက်ရှိသွားပါပြီ။`);
    } else {
      if (typeof showToast === 'function') showToast("ERROR", emailRes?.message || "အီးမေးလ် ပေးပို့မှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    console.error("Email Backup Error:", err);
    if (typeof showToast === 'function') showToast("ERROR", "အီးမေးလ် ပေးပို့မှု အမှား: " + err.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

// 💡 EXPOSE GLOBALLY FOR DOM ONCLICK HANDLERS & ROUTERS
window.switchSettingsSubTab = switchSettingsSubTab;
window.loadSettingsData = loadSettingsData;
window.renderBalancesControlTable = renderBalancesControlTable;
window.renderExportTable = renderExportTable;
window.renderD1UsageMonitor = renderD1UsageMonitor;
window.handleExportWorkbook = handleExportWorkbook;
window.handleSendEmailBackup = handleSendEmailBackup;
window.triggerGlobalRecalculateBalances = triggerGlobalRecalculateBalances;
window.triggerAutoRecalculateAllBalances = triggerAutoRecalculateAllBalances;
