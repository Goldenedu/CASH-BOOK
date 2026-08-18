/**
 * GOLDEN ERP SYSTEM - SYSTEM SETTINGS & CONTROLS CONTROLLER
 * File: js/settings.js  
 * 💡 Features: Live D1 Balances Control, 13-Tab/5-Tab Grouped Excel (.xlsx) Generator, Email Backup & 20MB Auto File Size Safety Guard
 */

var gSettingsAvailableFys = [];
var isSettingsProcessing = false; // 💡 Action Protection Flag

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

function formatNumWithCommas(val) {
  if (val === null || val === undefined || val === '') return '0';
  const num = parseFloat(String(val).replace(/,/g, ''));
  if (isNaN(num)) return String(val);
  return num.toLocaleString('en-US');
}

/**
 * 💡 1. LOAD SETTINGS DATA (Balances Control + Dynamic FY List)
 */
async function loadSettingsData(forceRefresh = false) {
  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    const res = await callApi('getSettingsData', { forceRefresh });

    if (res && res.success) {
      if (res.availableFys && Array.isArray(res.availableFys)) {
        gSettingsAvailableFys = res.availableFys;
      }

      if (res.balancesControl) {
        renderBalancesControlTable(res.balancesControl);
      }

      renderGroupExportTableRows();
    }
  } catch (err) {
    console.warn('loadSettingsData error:', err.message);
    if (typeof showToast === 'function') showToast("ERROR", "အချက်အလက်များ ရယူ၍ မရပါ: " + err.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 2. RENDER BALANCES CONTROL TABLE (Accountant vs Cashier Cross-Verification)
 */
function renderBalancesControlTable(bcData) {
  const tbody = document.getElementById('settings-balances-table-body');
  const tfoot = document.getElementById('settings-balances-table-foot');

  if (!tbody) return;

  const dataRows = bcData.data || [];
  const totalRow = bcData.total || [];

  if (!dataRows || dataRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-slate-500 italic">Balances Control အချက်အလက်များ ရှာမတွေ့ပါ။</td></tr>`;
    if (tfoot) tfoot.innerHTML = '';
    return;
  }

  tbody.innerHTML = dataRows.map(r => {
    const bookName = r[0] || '-';
    const accountantAmt = r[1];
    const cashierAmt = r[2];
    const controlAmt = r[3];

    const isNegAcc = String(accountantAmt || '').includes('-') || parseFloat(accountantAmt) < 0;
    const isNegCtrl = String(controlAmt || '').includes('-') || parseFloat(controlAmt) < 0;

    return `
      <tr class="hover:bg-slate-800/30 transition border-b border-slate-800/40">
        <td class="py-2.5 px-3 font-extrabold text-slate-200">${escapeHtml(bookName)}</td>
        <td class="py-2.5 px-3 text-right font-mono font-bold ${isNegAcc ? 'text-rose-400' : 'text-emerald-400'}">${formatNumWithCommas(accountantAmt)}</td>
        <td class="py-2.5 px-3 text-right font-mono text-slate-300">${formatNumWithCommas(cashierAmt)}</td>
        <td class="py-2.5 px-3 text-right font-mono font-black ${isNegCtrl ? 'text-rose-400 font-bold' : 'text-indigo-300'}">${formatNumWithCommas(controlAmt)}</td>
      </tr>
    `;
  }).join('');

  if (tfoot && totalRow && totalRow.length > 0) {
    const isNegAccTot = parseFloat(totalRow[1]) < 0;
    const isNegCtrlTot = parseFloat(totalRow[3]) < 0;

    tfoot.innerHTML = `
      <tr class="bg-indigo-500/10 font-black text-indigo-300 border-t-2 border-indigo-500/30">
        <td class="py-3 px-3 uppercase text-xs tracking-wider text-slate-200">${escapeHtml(totalRow[0] || 'Total')}</td>
        <td class="py-3 px-3 text-right font-mono text-sm ${isNegAccTot ? 'text-rose-400' : 'text-emerald-300'}">${formatNumWithCommas(totalRow[1])}</td>
        <td class="py-3 px-3 text-right font-mono text-slate-300">${formatNumWithCommas(totalRow[2])}</td>
        <td class="py-3 px-3 text-right font-mono text-sm font-black ${isNegCtrlTot ? 'text-rose-400' : 'text-indigo-300'}">${formatNumWithCommas(totalRow[3])}</td>
      </tr>
    `;
  }
}

/**
 * 💡 3. RENDER CONSOLIDATED GROUP EXPORT ROWS (13 Tabs Main & 5 Tabs Cashier)
 */
function renderGroupExportTableRows() {
  const tbody = document.getElementById('settings-export-table-body');
  if (!tbody) return;

  const groups = [
    {
      key: 'main',
      name: 'Main Cash Book',
      desc: 'bank, cash, office, kitchen, payroll, income, student, student_money, uniform, promotion, staff_fulltime, staff_parttime, salary_grade_matrix (13 Tabs)',
      badge: '13 Master Tabs',
      badgeClass: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
    },
    {
      key: 'cashier',
      name: 'Cashier Cash Book',
      desc: 'ca_bank, ca_cash, ca_office, ca_kitchen, ca_payroll (5 Tabs)',
      badge: '5 Cashier Tabs',
      badgeClass: 'bg-sky-500/10 text-sky-300 border-sky-500/20'
    }
  ];

  const fys = (gSettingsAvailableFys && gSettingsAvailableFys.length > 0) ? gSettingsAvailableFys : ['2025-2026', '2026-2027', '2027-2028'];
  let fyOptionsHtml = `<option value="">-- All FY --</option>`;
  fys.forEach(fy => {
    fyOptionsHtml += `<option value="${fy}" ${fy === '2026-2027' ? 'selected' : ''}>${fy}</option>`;
  });

  tbody.innerHTML = groups.map((g, i) => `
    <tr class="hover:bg-slate-800/30 transition">
      <td class="py-3.5 px-4 text-center font-bold text-slate-500">${i + 1}</td>
      <td class="py-3.5 px-4">
        <div class="font-extrabold text-white text-xs sm:text-sm">${escapeHtml(g.name)}</div>
        <div class="text-[10px] sm:text-[11px] text-slate-400 mt-1 leading-relaxed font-mono">${escapeHtml(g.desc)}</div>
      </td>
      <td class="py-3.5 px-4"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold border ${g.badgeClass}">${escapeHtml(g.badge)}</span></td>
      <td class="py-3.5 px-4 text-center">
        <select id="export-fy-${g.key}" class="bg-[#0f172a] border border-slate-800 text-indigo-300 font-bold text-xs rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500">
          ${fyOptionsHtml}
        </select>
      </td>
      <td class="py-3.5 px-4 text-center">
        <div class="flex items-center justify-center gap-2.5">
          <button onclick="downloadGroupExcel('${g.key}')" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-bold text-xs shadow-md flex items-center gap-1.5 transition">
            <i class="fa-solid fa-file-excel text-xs"></i> Download Excel (.xlsx)
          </button>
          <button onclick="emailGroupExcel('${g.key}')" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold text-xs shadow-md flex items-center gap-1.5 transition">
            <i class="fa-solid fa-paper-plane text-xs"></i> Email Copy
          </button>
        </div>
      </td>
    </tr>
  `).join('');
}

/**
 * 💡 Helper to generate SheetJS Workbook Object from API Tables
 */
function buildSheetJsWorkbookFromTables(resTables) {
  if (typeof window.XLSX === 'undefined' || !resTables) return null;

  const wb = XLSX.utils.book_new();

  Object.keys(resTables).forEach(tabKey => {
    const tInfo = resTables[tabKey];
    const tabTitle = tInfo.tabName || tabKey;
    const headers = tInfo.headers || [];
    const rawRows = tInfo.rows || [];

    let exportRows = [];

    if (rawRows.length > 0) {
      exportRows = rawRows.map((r, idx) => {
        const rowObj = {};
        headers.forEach(h => {
          const hKey = h.toLowerCase().replace(/\s+/g, '_');
          let val = r[hKey] !== undefined ? r[hKey] : (r[h] !== undefined ? r[h] : (h === 'NO' ? idx + 1 : ''));
          rowObj[h] = val !== null && val !== undefined ? val : '';
        });
        return rowObj;
      });
    } else {
      const emptyRow = {};
      headers.forEach(h => { emptyRow[h] = ''; });
      exportRows.push(emptyRow);
    }

    const ws = XLSX.utils.json_to_sheet(exportRows, { header: headers });
    XLSX.utils.book_append_sheet(wb, ws, tabTitle.slice(0, 31)); // Max 31 chars
  });

  return wb;
}

/**
 * 💡 4. DOWNLOAD MULTI-TAB EXCEL (.xlsx) WORKBOOK BY DYNAMIC SELECTED FY
 */
async function downloadGroupExcel(groupKey) {
  if (isSettingsProcessing) return;
  isSettingsProcessing = true;

  const fySelect = document.getElementById(`export-fy-${groupKey}`);
  const selectedFy = fySelect ? fySelect.value : '';

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    const res = await callApi('exportBookDataByFy', { groupKey: groupKey, fy: selectedFy });

    if (res && res.success && res.tables) {
      const groupTitle = res.groupTitle || (groupKey === 'cashier' ? 'Cashier_Cash_Book' : 'Main_Cash_Book');
      const fileName = `${groupTitle.replace(/\s+/g, '_')}_FY${selectedFy || 'ALL'}_${new Date().toISOString().slice(0, 10)}.xlsx`;

      const wb = buildSheetJsWorkbookFromTables(res.tables);
      if (wb && typeof XLSX !== 'undefined') {
        XLSX.writeFile(wb, fileName);
        if (typeof showToast === 'function') showToast("SUCCESS", `${res.groupTitle} (${selectedFy || 'All'}) Multi-Tab Excel (.xlsx) ဒေါင်းလုဒ် ဆွဲပြီးပါပြီ။`);
      } else {
        throw new Error("SheetJS (.xlsx) Library ဖတ်ယူ၍ မရပါ။ အင်တာနက် ချိတ်ဆက်မှု စစ်ဆေးပါ။");
      }
    } else {
      throw new Error(res?.message || "Excel ထုတ်ယူခြင်း မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", err.message);
  } finally {
    isSettingsProcessing = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 5. EMAIL REAL BACKUP COPY WITH AUTOMATIC FILE SIZE SAFETY GUARD (Max 20MB)
 */
async function emailGroupExcel(groupKey) {
  if (isSettingsProcessing) return;

  const fySelect = document.getElementById(`export-fy-${groupKey}`);
  const selectedFy = fySelect ? fySelect.value : '';

  if (!confirm(`'goldeneduprivateschool@gmail.com' သို့ ${groupKey.toUpperCase()} (FY: ${selectedFy || 'All'}) ၏ REAL Backup Data အား အီးမေးလ် ပေးပို့ရန် သေချာပါသလား။`)) {
    return;
  }

  isSettingsProcessing = true;

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    // 1. Fetch D1 Database Tables
    const res = await callApi('exportBookDataByFy', { groupKey: groupKey, fy: selectedFy });

    if (!res || !res.success || !res.tables) {
      throw new Error(res?.message || "အချက်အလက်များ ခေါ်ယူခြင်း မအောင်မြင်ပါ။");
    }

    // 2. Generate Multi-Tab Excel (.xlsx) Base64 String via SheetJS
    const wb = buildSheetJsWorkbookFromTables(res.tables);
    let excelBase64 = "";

    if (wb && typeof XLSX !== 'undefined' && typeof XLSX.write !== 'undefined') {
      excelBase64 = XLSX.write(wb, { type: 'base64', bookType: 'xlsx' });
    } else {
      throw new Error("SheetJS (.xlsx) Library အား အသုံးပြု၍ မရနိုင်ပါ။");
    }

    // 💡 2.1 AUTOMATIC FILE SIZE SAFETY GUARD (Max 20 MB Limit for Email)
    const estimatedSizeBytes = (excelBase64.length * 0.75);
    const maxLimitBytes = 20 * 1024 * 1024; // 20 MB

    if (estimatedSizeBytes > maxLimitBytes) {
      if (typeof toggleLoading === 'function') toggleLoading(false);
      const warnMsg = "ဖိုင်ဆိုဒ် ကြီးမားနေပါသဖြင့် Gmail သို့ ပေးပို့၍ မရနိုင်ပါ။ Download Excel (.xlsx) ခလုတ်ကို နှိပ်၍ စက်ထဲသို့ တိုက်ရိုက် ဒေါင်းလုဒ် ဆွဲယူပေးပါခင်ဗျာ။";
      if (typeof showToast === 'function') showToast("ERROR", warnMsg);
      else alert(warnMsg);
      return;
    }

    const groupTitle = res.groupTitle || (groupKey === 'cashier' ? 'Cashier_Cash_Book' : 'Main_Cash_Book');
    const attachmentFileName = `${groupTitle.replace(/\s+/g, '_')}_FY${selectedFy || 'ALL'}_${new Date().toISOString().slice(0, 10)}.xlsx`;

    // 3. Dispatch Email with .xlsx Base64 Attachment
    const emailRes = await callApi('sendEmailBackupByFy', {
      groupKey: groupKey,
      fy: selectedFy,
      excelBase64: excelBase64,
      fileName: attachmentFileName
    });

    if (emailRes && emailRes.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", emailRes.message || "Multi-Tab Excel အီးမေးလ် ပေးပို့ပြီးပါပြီ။");
    } else {
      throw new Error(emailRes?.message || "အီးမေးလ် ပေးပို့ခြင်း မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", err.message);
  } finally {
    isSettingsProcessing = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

// 💡 EXPOSE GLOBALLY FOR APP.JS & HTML BUTTONS
window.loadSettingsData = loadSettingsData;
window.renderBalancesControlTable = renderBalancesControlTable;
window.renderGroupExportTableRows = renderGroupExportTableRows;
window.downloadGroupExcel = downloadGroupExcel;
window.downloadGroupCsv = downloadGroupExcel; // Alias
window.emailGroupExcel = emailGroupExcel;
window.emailGroupCsv = emailGroupExcel; // Alias
