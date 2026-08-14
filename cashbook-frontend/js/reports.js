/**
 * GOLDEN ERP SYSTEM - FINANCIAL & DEMOGRAPHIC REPORTS CONTROLLER
 * File: js/reports.js
 * 💡 Features: Active Sub-Tab Highlights, InDetail Matrix (1 Student = 1 Row), InRep 13-Month Fiscal Engine, Demographics & Full Global Handlers
 */

var gStudentReportRawData = null;
var gIncomeDetailRawData = null;
var gFinancialReportRawData = null;
var gMonthlyIncomeRawData = null;
var gStaffFundRawData = null;

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

function populateReportFyDropdowns() {
  const options = ['2025-2026', '2026-2027', '2027-2028'];
  const dropdownIds = ['report-fin-fy', 'report-income-fy', 'report-general-fy', 'report-student-fy', 'report-staff-fund-fy'];
  dropdownIds.forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      select.innerHTML = options.map(fy => `<option value="${fy}" ${fy === '2026-2027' ? 'selected' : ''}>FY ${fy}</option>`).join('');
    }
  });
}

function safeShowLoading(show) {
  if (typeof window.toggleLoading === 'function') {
    window.toggleLoading(show);
  } else {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      if (show) overlay.classList.remove('hidden');
      else overlay.classList.add('hidden');
    }
  }
}

function safeShowToast(msg, type = 'info') {
  if (typeof window.showToast === 'function') {
    const toastType = (type === 'error') ? 'ERROR' : 'SUCCESS';
    window.showToast(toastType, msg);
  } else {
    console.log(`[Toast ${type}]: ${msg}`);
  }
}

function formatNumWithCommas(val) {
  if (val === null || val === undefined || val === '') return '0';
  const num = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return String(val);
  return num.toLocaleString('en-US');
}

/**
 * Clean decimal formatted IDs like "1.0" -> "1"
 */
function cleanIntegerStr(val) {
  if (val === null || val === undefined) return '-';
  const str = String(val).trim();
  return str.replace(/\.0+$/, '');
}

/**
 * 💡 Active Tab Highlight Engine
 */
function showReportPanel(panelId) {
  populateReportFyDropdowns();
  document.querySelectorAll('.report-panel').forEach(el => el.classList.add('hidden'));

  const tabBtnMap = {
    'panel-report-financial': { btnId: 'btn-rep-fin', activeClass: 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/20 ring-2 ring-emerald-400/50 font-black' },
    'panel-report-income-detail': { btnId: 'btn-rep-indetail', activeClass: 'bg-sky-600 text-white shadow-lg shadow-sky-600/20 ring-2 ring-sky-400/50 font-black' },
    'panel-report-monthly-income': { btnId: 'btn-rep-inrep', activeClass: 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 ring-2 ring-indigo-400/50 font-black' },
    'panel-report-student': { btnId: 'btn-rep-student', activeClass: 'bg-amber-600 text-white shadow-lg shadow-amber-600/20 ring-2 ring-amber-400/50 font-black' },
    'panel-report-staff-fund': { btnId: 'btn-rep-staff-fund', activeClass: 'bg-teal-600 text-white shadow-lg shadow-teal-600/20 ring-2 ring-teal-400/50 font-black' }
  };

  Object.values(tabBtnMap).forEach(cfg => {
    const btn = document.getElementById(cfg.btnId);
    if (btn) {
      btn.className = 'rep-sub-tab-btn px-4 py-2 rounded-lg text-xs font-bold transition-all bg-slate-800 text-slate-400 hover:text-white flex items-center gap-2';
    }
  });

  const activeCfg = tabBtnMap[panelId];
  if (activeCfg) {
    const btn = document.getElementById(activeCfg.btnId);
    if (btn) {
      btn.className = `rep-sub-tab-btn px-4 py-2 rounded-lg text-xs transition-all flex items-center gap-2 ${activeCfg.activeClass}`;
    }
  }

  const targetPanel = document.getElementById(panelId);
  if (targetPanel) targetPanel.classList.remove('hidden');

  if (panelId === 'panel-report-financial') {
    loadReportFinancialData();
  } else if (panelId === 'panel-report-income-detail') {
    loadReportIncomeData();
  } else if (panelId === 'panel-report-monthly-income') {
    loadReportGeneralData();
  } else if (panelId === 'panel-report-student') {
    loadReportStudentData();
  } else if (panelId === 'panel-report-staff-fund') {
    loadReportStaffFundData();
  }
}

// ==========================================
// 💡 1. FINANCIAL STATEMENT HANDLERS
// ==========================================

async function loadReportFinancialData(forceRefresh = false) {
  try {
    const fyVal = document.getElementById('report-fin-fy')?.value || '2026-2027';
    safeShowLoading(true);

    const res = await callApi('getFinancialReportData', { fy: fyVal, forceRefresh });
    if (res && res.success && res.data) {
      gFinancialReportRawData = res.data;
      renderFinancialReportData(res.data);
    }
  } catch (err) {
    safeShowToast('ဘဏ္ဍာရေး အစီရင်ခံစာ ရယူ၍ မရပါ: ' + err.message, 'error');
  } finally {
    safeShowLoading(false);
  }
}

function renderFinancialReportData(data) {
  const catBody = document.getElementById('report-fin-inc-cat-body');
  if (catBody && data.categories) {
    catBody.innerHTML = `
      <tr><td class="text-center font-bold text-slate-400 py-2">1</td><td class="font-semibold text-slate-300 py-2">Boarder</td><td class="text-right font-extrabold text-emerald-400 font-mono pr-2 py-2">${formatNumWithCommas(data.categories.boarder)} MMK</td></tr>
      <tr><td class="text-center font-bold text-slate-400 py-2">2</td><td class="font-semibold text-slate-300 py-2">Semi Boarder</td><td class="text-right font-extrabold text-emerald-400 font-mono pr-2 py-2">${formatNumWithCommas(data.categories.semiBoarder)} MMK</td></tr>
      <tr><td class="text-center font-bold text-slate-400 py-2">3</td><td class="font-semibold text-slate-300 py-2">Day Student</td><td class="text-right font-extrabold text-emerald-400 font-mono pr-2 py-2">${formatNumWithCommas(data.categories.dayStudent)} MMK</td></tr>
      <tr class="bg-emerald-500/10 font-black text-emerald-300 border-t border-emerald-500/30"><td colspan="2" class="py-2.5 uppercase tracking-wider pl-2 text-xs">Total Category Income</td><td class="text-right font-mono pr-2 text-sm">${formatNumWithCommas(data.categories.total)} MMK</td></tr>
    `;
  }

  const accBody = document.getElementById('report-fin-inc-acc-body');
  if (accBody && data.accounts) {
    accBody.innerHTML = `
      <tr><td class="text-center font-bold text-slate-400 py-2">1</td><td class="font-semibold text-slate-300 py-2">Registration</td><td class="text-right font-extrabold text-indigo-400 font-mono pr-2 py-2">${formatNumWithCommas(data.accounts.registration)} MMK</td></tr>
      <tr><td class="text-center font-bold text-slate-400 py-2">2</td><td class="font-semibold text-slate-300 py-2">Services</td><td class="text-right font-extrabold text-indigo-400 font-mono pr-2 py-2">${formatNumWithCommas(data.accounts.services)} MMK</td></tr>
      <tr><td class="text-center font-bold text-slate-400 py-2">3</td><td class="font-semibold text-slate-300 py-2">Ferry</td><td class="text-right font-extrabold text-indigo-400 font-mono pr-2 py-2">${formatNumWithCommas(data.accounts.ferry)} MMK</td></tr>
      <tr><td class="text-center font-bold text-slate-400 py-2">4</td><td class="font-semibold text-slate-300 py-2">Night Study Fees</td><td class="text-right font-extrabold text-indigo-400 font-mono pr-2 py-2">${formatNumWithCommas(data.accounts.nightStudy)} MMK</td></tr>
      <tr><td class="text-center font-bold text-slate-400 py-2">5</td><td class="font-semibold text-slate-300 py-2">Others</td><td class="text-right font-extrabold text-indigo-400 font-mono pr-2 py-2">${formatNumWithCommas(data.accounts.others)} MMK</td></tr>
      <tr class="bg-indigo-500/10 font-black text-indigo-300 border-t border-indigo-500/30"><td colspan="2" class="py-2.5 uppercase tracking-wider pl-2 text-xs">Total Account Income</td><td class="text-right font-mono pr-2 text-sm">${formatNumWithCommas(data.accounts.total)} MMK</td></tr>
    `;
  }

  const expBody = document.getElementById('report-fin-exp-body');
  if (expBody) {
    const o = data.office || {};
    const k = data.kitchen || {};
    const p = data.payroll || {};

    const items = [
      { no: 1, head: 'Admin Expenses (ရုံးအုပ်ချုပ်ရေး စရိတ်)', amt: o.adminExp || 0 },
      { no: 2, head: 'Vehicle Expenses (ယာဉ်မောင်း/စက်သုံးဆီ)', amt: o.vehicleExp || 0 },
      { no: 3, head: 'Donation & Social (လှူဒါန်း/လူမှုရေး)', amt: o.donationSocial || 0 },
      { no: 4, head: 'Assets & Materials (ပစ္စည်း/ကိရိယာ)', amt: o.assetsMaterials || 0 },
      { no: 5, head: 'Construction (ဆောက်လုပ်ရေး)', amt: o.construction || 0 },
      { no: 6, head: 'HR & Staff Benefits (ဝန်ထမ်း ခံစားခွင့်)', amt: o.hrStaffBenefit || 0 },
      { no: 7, head: 'Student Refund (ကျောင်းသား ပြန်အမ်းငွေ)', amt: o.studentRefund || 0 },
      { no: 8, head: 'Ferry Payment (ဖယ်ရီကြေး ပေးချေမှု)', amt: o.ferryPayment || 0 },
      { no: 9, head: 'Drawing Acc 1 (အမှန်ထုတ်ယူငွေ ၁)', amt: o.drawingAcc1 || 0 },
      { no: 10, head: 'Drawing Acc 2 (အမှန်ထုတ်ယူငွေ ၂)', amt: o.drawingAcc2 || 0 },
      { no: 11, head: 'Kitchen - Rice & Oil (ဆန်နှင့် ဆီ)', amt: k.riceOil || 0 },
      { no: 12, head: 'Kitchen - Fish, Meat & Eggs (သားငါး ကြက်ဥ)', amt: k.fishMeatEggs || 0 },
      { no: 13, head: 'Kitchen - Beans & Vegetables (ပဲနှင့် ဟင်းသီးဟင်းရွက်)', amt: k.beansVegetables || 0 },
      { no: 14, head: 'Kitchen - Others (အထွေထွေ မီးဖိုချောင်)', amt: k.others || 0 },
      { no: 15, head: 'Kitchen - Home 1 Exp (အိမ် ၁ စရိတ်)', amt: k.home1Exp || 0 },
      { no: 16, head: 'Kitchen - Home 2 Exp (အိမ် ၂ စရိတ်)', amt: k.home2Exp || 0 },
      { no: 17, head: 'Full Time Salary (အမြဲတမ်း ဝန်ထမ်းလစာ)', amt: p.fullTimeSalary || 0 },
      { no: 18, head: 'Part Time Salary (အချိန်ပိုင်း ဝန်ထမ်းလစာ)', amt: p.partTimeSalary || 0 },
      { no: 19, head: 'Full Time Bonus (အမြဲတမ်း အပိုဆုကြေး)', amt: p.fullTimeBonus || 0 },
      { no: 20, head: 'Full Time Fund (အမြဲတမ်း ရန်ပုံငွေ)', amt: p.fullTimeFund || 0 }
    ];

    const grandTotalExp = (o.total || 0) + (k.total || 0) + (p.total || 0);

    expBody.innerHTML = items.map(item => `
      <tr class="hover:bg-slate-800/30 transition border-b border-slate-800/40">
        <td class="text-center font-bold text-slate-400 py-2.5 px-2">${item.no}</td>
        <td class="font-semibold text-slate-300 py-2.5 px-2">${item.head}</td>
        <td class="text-right font-bold text-rose-400 font-mono pr-2 py-2.5 px-2">${formatNumWithCommas(item.amt)} MMK</td>
      </tr>
    `).join('') + `
      <tr class="bg-rose-500/10 font-black text-rose-300 border-t-2 border-rose-500/30">
        <td colspan="2" class="py-3 uppercase tracking-wider pl-2 text-xs">Grand Total Expenses (စုစုပေါင်း ထွက်ငွေ)</td>
        <td class="text-right font-mono pr-2 py-3 text-sm font-black text-rose-400">${formatNumWithCommas(grandTotalExp)} MMK</td>
      </tr>
    `;
  }
}

function onSearchInputReportFinancial() {
  const searchVal = (document.getElementById('report-financial-search')?.value || '').toLowerCase().trim();
  const rows = document.querySelectorAll('#report-fin-inc-cat-body tr, #report-fin-inc-acc-body tr, #report-fin-exp-body tr');

  rows.forEach(row => {
    if (row.classList.contains('font-black') || row.innerText.includes('Total')) return;
    const text = row.innerText.toLowerCase();
    row.style.display = (!searchVal || text.includes(searchVal)) ? '' : 'none';
  });
}

function exportToCSVReportFinancial() {
  if (!gFinancialReportRawData) {
    safeShowToast('ထုတ်ယူရန် ဘဏ္ဍာရေး အစီရင်ခံစာ အချက်အလက် မရှိပါ။', 'warning');
    return;
  }

  const d = gFinancialReportRawData;
  let csv = "SECTION,HEAD / CATEGORY,AMOUNT (MMK)\n";

  if (d.categories) {
    csv += `"Income by Category","Boarder",${d.categories.boarder || 0}\n`;
    csv += `"Income by Category","Semi Boarder",${d.categories.semiBoarder || 0}\n`;
    csv += `"Income by Category","Day Student",${d.categories.dayStudent || 0}\n`;
    csv += `"Income by Category","Total Category Income",${d.categories.total || 0}\n\n`;
  }

  if (d.accounts) {
    csv += `"Income by Account","Registration",${d.accounts.registration || 0}\n`;
    csv += `"Income by Account","Services",${d.accounts.services || 0}\n`;
    csv += `"Income by Account","Ferry",${d.accounts.ferry || 0}\n`;
    csv += `"Income by Account","Night Study Fees",${d.accounts.nightStudy || 0}\n`;
    csv += `"Income by Account","Others",${d.accounts.others || 0}\n`;
    csv += `"Income by Account","Total Account Income",${d.accounts.total || 0}\n\n`;
  }

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `financial_statement_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// 💡 2. INCOME DETAIL HANDLERS (InDetail Matrix)
// ==========================================

async function loadReportIncomeData(forceRefresh = false) {
  try {
    const fyVal = document.getElementById('report-income-fy')?.value || '2026-2027';
    safeShowLoading(true);
    const res = await callApi('getIncomeDetailReportData', { fy: fyVal, forceRefresh });
    if (res && res.success) {
      gIncomeDetailRawData = res;
      renderIncomeDetailMatrixTable();
    }
  } catch (err) {
    safeShowToast('ဝင်ငွေ အသေးစိတ် အစီရင်ခံစာ ရယူ၍ မရပါ: ' + err.message, 'error');
  } finally {
    safeShowLoading(false);
  }
}

function renderIncomeDetailMatrixTable() {
  const table = document.getElementById('report-income-main-table');
  if (!table || !gIncomeDetailRawData) return;

  const headers = gIncomeDetailRawData.headers || [];
  const rawData = gIncomeDetailRawData.data || [];
  const grandTotalRow = gIncomeDetailRawData.grandTotalRow || [];

  const searchVal = (document.getElementById('report-income-search')?.value || '').toLowerCase().trim();

  let filteredData = rawData;
  if (searchVal) {
    filteredData = rawData.filter(row =>
      Array.isArray(row) && row.some(cell => String(cell || '').toLowerCase().includes(searchVal))
    );
  }

  let headHtml = '<thead><tr class="bg-[#0e172a] text-slate-300 text-xs uppercase font-extrabold border-b border-slate-800">';
  headers.forEach((h, i) => {
    const alignClass = (i >= 10) ? 'text-right' : 'text-left';
    headHtml += `<th class="px-3 py-3 border border-slate-800 ${alignClass}">${h || ''}</th>`;
  });
  headHtml += '</tr></thead>';

  let bodyHtml = '<tbody class="divide-y divide-slate-800/40 text-xs text-slate-300">';
  if (filteredData.length === 0) {
    bodyHtml += `<tr><td colspan="${headers.length}" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ဝင်ငွေ အသေးစိတ် မရှိပါ။</td></tr>`;
  } else {
    filteredData.forEach(row => {
      bodyHtml += '<tr class="hover:bg-slate-800/30 transition">';
      row.forEach((cell, i) => {
        if (i === 2) {
          bodyHtml += `<td class="px-3 py-2 border border-slate-800/60 font-mono font-bold text-slate-200">${escapeHtml(cleanIntegerStr(cell))}</td>`;
        } else if (i === 5) {
          let promoBadge = 'bg-slate-800 text-slate-400 border-slate-700';
          const pStr = String(cell || '').toLowerCase();
          if (pStr.includes('pro')) {
            promoBadge = 'bg-teal-500/10 text-teal-300 border-teal-500/20 font-bold';
          } else if (pStr.includes('scholar')) {
            promoBadge = 'bg-amber-500/10 text-amber-300 border-amber-500/20 font-bold';
          }
          bodyHtml += `<td class="px-3 py-2 border border-slate-800/60"><span class="px-2 py-0.5 rounded text-[10px] border ${promoBadge}">${escapeHtml(cell || '-')}</span></td>`;
        } else if (i === 8) {
          const isAct = String(cell || '').toLowerCase() === 'active';
          const statBadge = isAct ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 font-bold' : 'bg-rose-500/10 text-rose-400 border-rose-500/20 font-bold';
          bodyHtml += `<td class="px-3 py-2 border border-slate-800/60"><span class="px-2 py-0.5 rounded text-[10px] border ${statBadge}">${escapeHtml(cell || 'Active')}</span></td>`;
        } else if (i >= 10) {
          const numVal = parseFloat(cell) || 0;
          bodyHtml += `<td class="px-3 py-2 border border-slate-800/60 text-right font-mono font-bold ${i === row.length - 1 ? 'text-emerald-300 bg-emerald-500/5' : 'text-slate-300'}">${numVal !== 0 ? formatNumWithCommas(numVal) : '-'}</td>`;
        } else {
          bodyHtml += `<td class="px-3 py-2 border border-slate-800/60 ${i === 4 ? 'font-bold text-slate-100' : ''}">${escapeHtml(cell || '-')}</td>`;
        }
      });
      bodyHtml += '</tr>';
    });
  }
  bodyHtml += '</tbody>';

  let footHtml = '';
  if (grandTotalRow && grandTotalRow.length > 0 && filteredData.length > 0) {
    footHtml += '<tfoot><tr class="bg-indigo-500/10 font-black text-indigo-300 border-t-2 border-indigo-500/40 text-xs">';
    grandTotalRow.forEach((cell, i) => {
      if (i === 0) {
        footHtml += `<td colspan="10" class="px-3 py-3 uppercase tracking-wider text-xs border border-indigo-500/20">Total</td>`;
      } else if (i >= 10) {
        const numVal = parseFloat(cell) || 0;
        footHtml += `<td class="px-3 py-3 text-right font-mono border border-indigo-500/20 text-indigo-200">${formatNumWithCommas(numVal)}</td>`;
      }
    });
    footHtml += '</tr></tfoot>';
  }

  table.innerHTML = headHtml + bodyHtml + footHtml;
}

function onSearchInputReportIncome() {
  renderIncomeDetailMatrixTable();
}

function exportToCSVReportIncome() {
  if (!gIncomeDetailRawData || !gIncomeDetailRawData.data) {
    return safeShowToast('ထုတ်ယူရန် ဝင်ငွေ အသေးစိတ် အချက်အလက် မရှိပါ။', 'warning');
  }

  let csvRows = [];
  if (gIncomeDetailRawData.headers) csvRows.push(gIncomeDetailRawData.headers.map(h => `"${h || ''}"`));
  gIncomeDetailRawData.data.forEach(r => csvRows.push(r.map(c => `"${c || ''}"`)));
  if (gIncomeDetailRawData.grandTotalRow) csvRows.push(gIncomeDetailRawData.grandTotalRow.map(c => `"${c || ''}"`));

  const csvContent = "\uFEFF" + csvRows.map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Income_Detail_Report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// 💡 3. MONTHLY INCOME HANDLERS (InRep)
// ==========================================

async function loadReportGeneralData(forceRefresh = false) {
  try {
    const fyVal = document.getElementById('report-general-fy')?.value || '2026-2027';
    safeShowLoading(true);
    const res = await callApi('getMonthlyIncomeReportData', { fy: fyVal, forceRefresh });
    if (res && res.success) {
      gMonthlyIncomeRawData = res;
      if (res.table1) renderInRepTable('report-general-table-1', res.table1.headers || [], res.table1.data || [], res.table1.totalRow, 'emerald');
      if (res.table2) renderInRepTable('report-general-table-2', res.table2.headers || [], res.table2.data || [], res.table2.totalRow, 'indigo');
    }
  } catch (err) {
    safeShowToast('လအလိုက် ဝင်ငွေ အစီရင်ခံစာ ရယူ၍ မရပါ: ' + err.message, 'error');
  } finally {
    safeShowLoading(false);
  }
}

function renderInRepTable(tableId, headers, rows, totalRow, themeColor) {
  const table = document.getElementById(tableId);
  if (!table) return;

  const headerColorClass = themeColor === 'emerald' ? 'text-emerald-300' : 'text-indigo-300';
  const totalBgClass = themeColor === 'emerald' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/40' : 'bg-indigo-500/10 text-indigo-300 border-indigo-500/40';
  const totalCellBorder = themeColor === 'emerald' ? 'border-emerald-500/20' : 'border-indigo-500/20';

  let headHtml = `<thead><tr class="bg-[#0e172a] ${headerColorClass} text-xs uppercase font-extrabold border-b border-slate-800">`;
  headers.forEach((h, i) => {
    headHtml += `<th class="px-3 py-3 border border-slate-800 ${i > 0 ? 'text-right' : 'text-left'}">${h || ''}</th>`;
  });
  headHtml += '</tr></thead>';

  let bodyHtml = '<tbody class="divide-y divide-slate-800/40 text-xs text-slate-300">';
  rows.forEach(r => {
    bodyHtml += '<tr class="hover:bg-slate-800/30 transition">';
    r.forEach((cell, i) => {
      if (i === 0) {
        bodyHtml += `<td class="px-3 py-2.5 font-bold text-slate-200 border border-slate-800/60">${escapeHtml(cell || '')}</td>`;
      } else {
        const numVal = parseFloat(cell) || 0;
        bodyHtml += `<td class="px-3 py-2.5 text-right font-mono font-bold border border-slate-800/60 ${i === r.length - 1 ? `${headerColorClass} bg-slate-800/40` : 'text-slate-300'}">${numVal !== 0 ? formatNumWithCommas(numVal) : '-'}</td>`;
      }
    });
    bodyHtml += '</tr>';
  });
  bodyHtml += '</tbody>';

  let footHtml = '';
  if (totalRow && totalRow.length > 0) {
    footHtml += `<tfoot class="${totalBgClass} font-black border-t-2 text-xs"><tr>`;
    totalRow.forEach((cell, i) => {
      if (i === 0) {
        footHtml += `<td class="px-3 py-3 uppercase tracking-wider border ${totalCellBorder}">${cell || 'Total'}</td>`;
      } else {
        const numVal = parseFloat(cell) || 0;
        footHtml += `<td class="px-3 py-3 text-right font-mono border ${totalCellBorder}">${formatNumWithCommas(numVal)}</td>`;
      }
    });
    footHtml += '</tr></tfoot>';
  }

  table.innerHTML = headHtml + bodyHtml + footHtml;
}

function exportToCSVReportGeneral() {
  if (!gMonthlyIncomeRawData) {
    return safeShowToast('ထုတ်ယူရန် လအလိုက် ဝင်ငွေ အချက်အလက် မရှိပါ။', 'warning');
  }

  let csvRows = [];
  const { table1, table2 } = gMonthlyIncomeRawData;

  if (table1) {
    csvRows.push(['"Primary Revenue Breakdown (EFFECT DATE BASIS)"']);
    if (table1.headers) csvRows.push(table1.headers.map(h => `"${h || ''}"`));
    if (table1.data) table1.data.forEach(r => csvRows.push(r.map(c => `"${c || ''}"`)));
    if (table1.totalRow) csvRows.push(table1.totalRow.map(c => `"${c || ''}"`));
    csvRows.push([]);
  }

  if (table2) {
    csvRows.push(['"Secondary Category Summary (CASH FLOW DATE BASIS)"']);
    if (table2.headers) csvRows.push(table2.headers.map(h => `"${h || ''}"`));
    if (table2.data) table2.data.forEach(r => csvRows.push(r.map(c => `"${c || ''}"`)));
    if (table2.totalRow) csvRows.push(table2.totalRow.map(c => `"${c || ''}"`));
  }

  const csvContent = "\uFEFF" + csvRows.map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Monthly_Income_Report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// 💡 4. STUDENT DEMOGRAPHICS HANDLERS
// ==========================================

async function loadReportStudentData(forceRefresh = false) {
  try {
    const fyVal = document.getElementById('report-student-fy')?.value || '2026-2027';
    safeShowLoading(true);
    const res = await callApi('getStudentReportDetails', { fy: fyVal, forceRefresh });
    if (res && res.success) {
      gStudentReportRawData = res;
      renderStudentReportTables();
    }
  } catch (err) {
    safeShowToast('ကျောင်းသား လူဦးရေစာရင်း အစီရင်ခံစာ ရယူ၍ မရပါ: ' + err.message, 'error');
  } finally {
    safeShowLoading(false);
  }
}

function renderStudentReportTables() {
  const container = document.getElementById('report-student-tables-container');
  if (!container || !gStudentReportRawData) return;

  const searchVal = (document.getElementById('report-student-search')?.value || '').toLowerCase().trim();
  const { table1 } = gStudentReportRawData;

  const filterRows = (dataRows) => {
    if (!searchVal || !Array.isArray(dataRows)) return dataRows || [];
    return dataRows.filter(row =>
      Array.isArray(row) && row.some(cell => String(cell || '').toLowerCase().includes(searchVal))
    );
  };

  const rows1 = filterRows(table1?.data);

  let html = `
    <div class="bg-[#0c1322] border border-emerald-500/30 rounded-2xl p-5 shadow-2xl space-y-4">
      <div class="flex justify-between items-center border-b border-emerald-500/20 pb-3">
        <h3 class="text-xs font-black text-emerald-400 uppercase tracking-wider flex items-center gap-2">
          <i class="fa-solid fa-graduation-cap text-base"></i> ${table1?.title || 'Student Demographics Report'}
        </h3>
        <span class="text-[10px] font-bold text-emerald-300 bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-500/20">
          Showing ${rows1.length} Classes
        </span>
      </div>

      <div class="overflow-x-auto table-container">
        <table class="w-full text-left border-collapse text-xs min-w-[1100px]">
          <thead>
            <tr class="bg-emerald-950/40 text-emerald-300 font-extrabold uppercase border-b border-emerald-500/30">
              ${(table1?.headers || []).map((h, i) => `<th class="py-3 px-3 ${i >= 3 ? 'text-right' : 'text-left'}">${h || ''}</th>`).join('')}
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/40 text-slate-200">
            ${rows1.map(r => `
              <tr class="hover:bg-emerald-500/5 transition">
                <td class="py-2.5 px-3 text-center font-bold text-slate-400">${r[0] || ''}</td>
                <td class="py-2.5 px-3 font-semibold text-slate-300">${r[1] || ''}</td>
                <td class="py-2.5 px-3 font-extrabold text-white">${r[2] || ''}</td>
                <td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-400">${formatNumWithCommas(r[3])}</td>
                <td class="py-2.5 px-3 text-right font-mono font-bold text-teal-300">${formatNumWithCommas(r[4])}</td>
                <td class="py-2.5 px-3 text-right font-mono font-bold text-teal-300">${formatNumWithCommas(r[5])}</td>
                <td class="py-2.5 px-3 text-right font-mono font-black text-emerald-300">${formatNumWithCommas(r[6])}</td>
                <td class="py-2.5 px-3 text-right font-mono font-bold text-rose-400"><span class="px-2 py-0.5 rounded text-[10px] bg-rose-500/10 border border-rose-500/20">${formatNumWithCommas(r[7])}</span></td>
                <td class="py-2.5 px-3 text-right font-mono text-slate-300">${formatNumWithCommas(r[8])}</td>
                <td class="py-2.5 px-3 text-right font-mono text-slate-300">${formatNumWithCommas(r[9])}</td>
              </tr>
            `).join('')}
          </tbody>
          ${table1?.total && table1.total.length > 0 ? `
            <tfoot>
              <tr class="bg-emerald-500/10 font-black text-emerald-300 border-t-2 border-emerald-500/40">
                <td colspan="3" class="py-3 px-3 uppercase text-xs tracking-wider">${table1.total[0] || 'Total'}</td>
                <td class="py-3 px-3 text-right font-mono text-emerald-300">${formatNumWithCommas(table1.total[3])}</td>
                <td class="py-3 px-3 text-right font-mono">${formatNumWithCommas(table1.total[4])}</td>
                <td class="py-3 px-3 text-right font-mono">${formatNumWithCommas(table1.total[5])}</td>
                <td class="py-3 px-3 text-right font-mono text-sm">${formatNumWithCommas(table1.total[6])}</td>
                <td class="py-3 px-3 text-right font-mono text-rose-400">${formatNumWithCommas(table1.total[7])}</td>
                <td class="py-3 px-3 text-right font-mono text-slate-300">${formatNumWithCommas(table1.total[8])}</td>
                <td class="py-3 px-3 text-right font-mono text-slate-300">${formatNumWithCommas(table1.total[9])}</td>
              </tr>
            </tfoot>
          ` : ''}
        </table>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

function onSearchInputReportStudent() {
  renderStudentReportTables();
}

function exportToCSVReportStudent() {
  if (!gStudentReportRawData) return safeShowToast('ထုတ်ယူရန် ကျောင်းသား လူဦးရေ အချက်အလက် မရှိပါ။', 'warning');

  const { table1 } = gStudentReportRawData;
  let csvRows = [];

  csvRows.push([`"${table1?.title || 'Student Demographics Report'}"`]);
  if (table1?.headers) csvRows.push(table1.headers.map(h => `"${h || ''}"`));
  if (table1?.data) table1.data.forEach(r => csvRows.push(r.map(c => `"${c || ''}"`)));
  if (table1?.total) csvRows.push(table1.total.map(c => `"${c || ''}"`));

  const csvContent = "\uFEFF" + csvRows.map(e => e.join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `Student_Demographics_Report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// 💡 5. STAFF FUND REPORT HANDLERS
// ==========================================

async function loadReportStaffFundData(forceRefresh = false) {
  try {
    const fyVal = document.getElementById('report-staff-fund-fy')?.value || '2026-2027';
    safeShowLoading(true);

    const res = await callApi('getFundReportData', { fy: fyVal, forceRefresh });
    if (res && res.success && Array.isArray(res.data)) {
      gStaffFundRawData = res.data;
      renderStaffFundReportData(res.data);
    }
  } catch (err) {
    safeShowToast('ဝန်ထမ်း ရန်ပုံငွေ အစီရင်ခံစာ ရယူ၍ မရပါ: ' + err.message, 'error');
  } finally {
    safeShowLoading(false);
  }
}

function renderStaffFundReportData(list) {
  const tbody = document.getElementById('report-staff-fund-table-body');
  if (!tbody) return;

  const searchVal = (document.getElementById('report-staff-fund-search')?.value || '').toLowerCase().trim();
  let filtered = list;
  if (searchVal) {
    filtered = list.filter(r =>
      (r.name || '').toLowerCase().includes(searchVal) ||
      cleanIntegerStr(r.staffId).toLowerCase().includes(searchVal)
    );
  }

  let totBonus = 0, totFund = 0, totAll = 0;
  list.forEach(r => {
    totBonus += r.bonusBalance || 0;
    totFund += r.fundBalance || 0;
    totAll += r.totalBalances || 0;
  });

  const elBonus = document.getElementById('report-fund-total-bonus');
  const elFund = document.getElementById('report-fund-total-fund');
  const elAll = document.getElementById('report-fund-total-all');
  const elCount = document.getElementById('report-fund-total-count');

  if (elBonus) elBonus.innerText = formatNumWithCommas(totBonus);
  if (elFund) elFund.innerText = formatNumWithCommas(totFund);
  if (elAll) elAll.innerText = formatNumWithCommas(totAll);
  if (elCount) elCount.innerText = list.length;

  if (!filtered || filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ရန်ပုံငွေ စာရင်း မရှိပါ။</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((r, i) => `
    <tr class="hover:bg-slate-800/30 transition">
      <td class="py-2.5 px-2 text-center font-bold text-slate-400">${r.no || (i + 1)}</td>
      <td class="py-2.5 px-2 text-center font-mono">${r.fundDate || '-'}</td>
      <td class="py-2.5 px-2 font-mono font-bold text-indigo-400">${cleanIntegerStr(r.staffId)}</td>
      <td class="py-2.5 px-2 font-extrabold text-white">${r.name || '-'}</td>
      <td class="py-2.5 px-2 text-right font-mono font-bold text-emerald-400">${formatNumWithCommas(r.bonusBalance)}</td>
      <td class="py-2.5 px-2 text-right font-mono font-bold text-teal-400">${formatNumWithCommas(r.fundBalance)}</td>
      <td class="py-2.5 px-2 text-right font-mono font-black text-indigo-300 bg-indigo-500/5 pr-4">${formatNumWithCommas(r.totalBalances)}</td>
      <td class="py-2.5 px-2 text-center font-bold text-xs"><span class="px-2 py-0.5 rounded ${r.status === 'Active' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}">${r.status || 'Active'}</span></td>
    </tr>
  `).join('');
}

function onSearchInputReportStaffFund() {
  if (gStaffFundRawData) {
    renderStaffFundReportData(gStaffFundRawData);
  } else {
    loadReportStaffFundData();
  }
}

function exportToCSVReportStaffFund() {
  const list = gStaffFundRawData || [];
  if (!list || list.length === 0) {
    return safeShowToast('ထုတ်ယူရန် ဝန်ထမ်း ရန်ပုံငွေ အချက်အလက် မရှိပါ။', 'warning');
  }

  let csv = "NO,FUND DATE,STAFF ID,STAFF NAME,BONUS BALANCE,FUND BALANCE,TOTAL BALANCES,STATUS\n";
  list.forEach((r, i) => {
    let name = `"${(r.name || '').replace(/"/g, '""')}"`;
    csv += `${r.no || i + 1},${r.fundDate || ''},${cleanIntegerStr(r.staffId)},${name},${r.bonusBalance || 0},${r.fundBalance || 0},${r.totalBalances || 0},${r.status || 'Active'}\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `staff_fund_report_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 EXPOSE GLOBALLY FOR APP.JS ROUTER & HTML BUTTONS
window.showReportPanel = showReportPanel;
window.populateReportFyDropdowns = populateReportFyDropdowns;
window.loadReportFinancialData = loadReportFinancialData;
window.loadReportIncomeData = loadReportIncomeData;
window.loadReportGeneralData = loadReportGeneralData;
window.loadReportStudentData = loadReportStudentData;
window.loadReportStaffFundData = loadReportStaffFundData;

window.onSearchInputReportFinancial = onSearchInputReportFinancial;
window.onSearchInputReportIncome = onSearchInputReportIncome;
window.onSearchInputReportStudent = onSearchInputReportStudent;
window.onSearchInputReportStaffFund = onSearchInputReportStaffFund;

window.exportToCSVReportFinancial = exportToCSVReportFinancial;
window.exportToCSVReportIncome = exportToCSVReportIncome;
window.exportToCSVReportGeneral = exportToCSVReportGeneral;
window.exportToCSVReportStudent = exportToCSVReportStudent;
window.exportToCSVReportStaffFund = exportToCSVReportStaffFund;