/**
 * GOLDEN ERP SYSTEM - SYSTEM SETTINGS & BACKUP CONTROLLER
 * File: js/settings.js 
 * 💡 Features: Exact 2-Line Subtitle Layout (Zero Cut-Offs), Balances Cross-Control,
 *              SheetJS Multi-Tab Real Excel (.xlsx) Generator & Resend Email Backup
 */

var gSettingsData = null;
var gAvailableFys = [];

/**
 * 💡 Load Settings Data (Balances Control & FY List)
 */
async function loadSettingsData(forceRefresh) {
  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const res = await callApi('getSettingsData', { forceRefresh: !!forceRefresh }, 'GET');

    if (res && res.success) {
      gSettingsData = res;
      gAvailableFys = res.availableFys || ["2026-2027", "2025-2026", "2027-2028"];
      
      renderBalancesControlTable(res.balancesControl);
      renderExportTable();
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
 * 💡 Render Balances Control (Real-Time Comparison Table)
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
 * 💡 Render Export Table (Strict 2-Line Layout for 100% Screen Visibility)
 */
function renderExportTable() {
  const tbody = document.getElementById('settings-export-table-body');
  if (!tbody) return;

  const fys = (gAvailableFys && gAvailableFys.length > 0) ? gAvailableFys : ["2026-2027", "2025-2026"];
  const fyOptions = fys.map(fy => `<option value="${fy}">${fy}</option>`).join('');

  tbody.innerHTML = `
    <!-- ROW 1: MAIN CASH BOOK (13 TABS SPLIT INTO 2 CLEAN LINES) -->
    <tr class="hover:bg-slate-800/30 transition">
      <td class="py-3 px-2 text-center font-mono font-bold text-slate-500">1</td>
      <td class="py-3 px-3">
        <div class="font-bold text-white text-xs tracking-wide">Main Cash Book</div>
        <!-- 💡 ၂ ကြောင်း အညီအမျှ ခွဲထုတ်ထားသော စာတန်း -->
        <div class="text-[10px] text-slate-400 leading-tight mt-1 font-mono">
          <div>bank, cash, office, kitchen, payroll, income, student,</div>
          <div>student_money, uniform, promotion, staff_fulltime, staff_parttime, salary_grade_matrix</div>
        </div>
      </td>
      <td class="py-3 px-2 text-center">
        <span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-300 border border-slate-700 whitespace-nowrap shadow-sm">
          13 Master Tabs
        </span>
      </td>
      <td class="py-3 px-2 text-center">
        <select id="export-fy-main" class="w-full bg-[#0f172a] border border-slate-800 text-slate-200 text-xs font-bold rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition font-mono">
          ${fyOptions}
        </select>
      </td>
      <td class="py-3 px-3 text-center">
        <div class="flex items-center justify-center gap-1.5">
          <button onclick="handleExportWorkbook('main')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-lg transition flex items-center gap-1.5 shadow-sm whitespace-nowrap" title="Download Excel (.xlsx)">
            <i class="fa-solid fa-file-excel text-emerald-400"></i> Excel (.xlsx)
          </button>
          <button onclick="handleSendEmailBackup('main')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-lg transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20 whitespace-nowrap" title="Send Email Backup">
            <i class="fa-solid fa-paper-plane text-xs"></i> Email
          </button>
        </div>
      </td>
    </tr>

    <!-- ROW 2: CASHIER CASH BOOK (5 TABS) -->
    <tr class="hover:bg-slate-800/30 transition">
      <td class="py-3 px-2 text-center font-mono font-bold text-slate-500">2</td>
      <td class="py-3 px-3">
        <div class="font-bold text-white text-xs tracking-wide">Cashier Cash Book</div>
        <div class="text-[10px] text-slate-400 leading-tight mt-1 font-mono">
          <div>ca_bank, ca_cash, ca_office, ca_kitchen, ca_payroll (5 Tabs)</div>
        </div>
      </td>
      <td class="py-3 px-2 text-center">
        <span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-300 border border-slate-700 whitespace-nowrap shadow-sm">
          5 Cashier Tabs
        </span>
      </td>
      <td class="py-3 px-2 text-center">
        <select id="export-fy-cashier" class="w-full bg-[#0f172a] border border-slate-800 text-slate-200 text-xs font-bold rounded-lg px-2.5 py-1.5 outline-none focus:border-indigo-500 transition font-mono">
          ${fyOptions}
        </select>
      </td>
      <td class="py-3 px-3 text-center">
        <div class="flex items-center justify-center gap-1.5">
          <button onclick="handleExportWorkbook('cashier')" class="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold rounded-lg transition flex items-center gap-1.5 shadow-sm whitespace-nowrap" title="Download Excel (.xlsx)">
            <i class="fa-solid fa-file-excel text-emerald-400"></i> Excel (.xlsx)
          </button>
          <button onclick="handleSendEmailBackup('cashier')" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-lg transition flex items-center gap-1.5 shadow-md shadow-indigo-600/20 whitespace-nowrap" title="Send Email Backup">
            <i class="fa-solid fa-paper-plane text-xs"></i> Email
          </button>
        </div>
      </td>
    </tr>
  `;
}

/**
 * 💡 Generate SheetJS Multi-Tab Excel Workbook
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
 * 💡 Download Native Multi-Tab Excel (.xlsx) File
 */
async function handleExportWorkbook(groupKey) {
  const fySelectId = groupKey === 'cashier' ? 'export-fy-cashier' : 'export-fy-main';
  const selectedFy = document.getElementById(fySelectId)?.value || '2026-2027';

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const { wb, groupTitle, totalRecords } = await generateMultiTabExcelWorkbook(groupKey, selectedFy);
    const fileName = `${groupTitle.replace(/\s+/g, '_')}_FY${selectedFy}_${new Date().toISOString().slice(0, 10)}.xlsx`;

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
 * 💡 Send Real Multi-Tab Excel (.xlsx) Backup to Gmail via Resend API
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
    const attachmentFileName = `${groupTitle.replace(/\s+/g, '_')}_FY${selectedFy}_${new Date().toISOString().slice(0, 10)}.xlsx`;

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

// 💡 EXPOSE GLOBALLY
window.loadSettingsData = loadSettingsData;
window.handleExportWorkbook = handleExportWorkbook;
window.handleSendEmailBackup = handleSendEmailBackup;
