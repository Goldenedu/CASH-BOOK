/**
 * GOLDEN ERP SYSTEM - STUDENT MONEY LEDGER MODULE
 * File: js/student-money.js
 * 💡 Features: FY-Scoped Student Lookup, Dynamic Table Grid, Pagination & D1 Sync
 *              DEBIT = Income (Green), CREDIT = Expense (Red), Balance = DEBIT - CREDIT
 */

var stmPage = 1;
var stmLimit = 50;
var stmTotalRows = 0;
var stmActiveData = [];
var stmStudentsCache = {};
var searchTimeoutStm = null;

function parseCleanIntId(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.trunc(val);
  var n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? 0 : n;
}

function cleanIntegerStr(val) {
  if (val === null || val === undefined) return '-';
  return String(val).trim().replace(/\.0+$/, '');
}

function getFyShortCode(fyStr) {
  if (!fyStr) return '2627';
  var parts = String(fyStr).split(/[-/]/);
  if (parts.length >= 2) {
    return parts[0].trim().slice(-2) + parts[1].trim().slice(-2);
  }
  return '2627';
}

function onSearchInputStudentMoney() {
  if (searchTimeoutStm) clearTimeout(searchTimeoutStm);
  searchTimeoutStm = setTimeout(function() {
    renderTableStudentMoney();
  }, 200);
}

function clearDateFilterStudentMoney() {
  var fromEl = document.getElementById('stm-date-from');
  var toEl = document.getElementById('stm-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  renderTableStudentMoney();
}

async function loadStudentMoneyData(isSilent, forceRefresh) {
  var token = localStorage.getItem('golden_auth_token');
  if (!token) return;

  try {
    var searchInput = document.getElementById('stm-search');
    var searchVal = searchInput ? searchInput.value.trim() : '';
    var fyFilter = document.getElementById('stm-filter-fy')?.value || ''; // 💡 Read FY Filter

    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);

    var res = await callApi('getStudentMoneyData', {
      page: stmPage,
      limit: stmLimit,
      searchVal: searchVal,
      fy: fyFilter, // 💡 Pass selected FY to API
      forceRefresh: forceRefresh
    });

    if (!res || !res.success) {
      throw new Error(res?.message || "အချက်အလက်များ ခေါ်ယူခြင်း မအောင်မြင်ပါ။");
    }

    stmActiveData = res.data || [];
    stmTotalRows = res.totalRows || stmActiveData.length || 0;

    renderStatsStudentMoney(res.stats || { totalIncome: 0, totalExpense: 0, balance: 0 });
    renderTableStudentMoney();
    updatePaginationUIStudentMoney();

  } catch (err) {
    console.error("Student Money Load Error:", err);
    if (!isSilent && typeof showToast === 'function') {
      showToast("ERROR", "အချက်အလက်များ ရယူ၍ မရပါ: " + err.message);
    }
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function renderStatsStudentMoney(stats) {
  var incTotal = document.getElementById('stm-total-income');
  var expTotal = document.getElementById('stm-total-expense');
  var balTotal = document.getElementById('stm-balance');
  var countTotal = document.getElementById('stm-entries-count');

  if (incTotal) incTotal.textContent = Number(stats.totalIncome || 0).toLocaleString('en-US') + ' MMK';
  if (expTotal) expTotal.textContent = Number(stats.totalExpense || 0).toLocaleString('en-US') + ' MMK';
  if (balTotal) balTotal.textContent = Number(stats.balance || 0).toLocaleString('en-US') + ' MMK';
  if (countTotal) countTotal.textContent = Number(stmTotalRows || 0).toLocaleString('en-US');
}

function filterStudentMoneyData(list, searchVal, fromDate, toDate) {
  var safeList = Array.isArray(list) ? list : [];
  return safeList.filter(function(row) {
    if (typeof window.isDateInRange === 'function') {
      if (!window.isDateInRange(row.date, fromDate, toDate)) return false;
    }

    if (!searchVal || !searchVal.trim()) return true;
    var q = searchVal.trim().toLowerCase();

    var nameMatch = String(row.fyidName || row.name || '').toLowerCase().includes(q);
    var fyidMatch = String(row.fyid || '').toLowerCase().includes(q);
    var idMatch = String(row.id || '').toLowerCase().includes(q);

    return nameMatch || fyidMatch || idMatch;
  });
}

function renderTableStudentMoney() {
  var tbody = document.getElementById('stm-table-body');
  if (!tbody) return;

  var searchInput = document.getElementById('stm-search');
  var searchVal = searchInput ? searchInput.value.trim() : '';

  var fromDate = document.getElementById('stm-date-from')?.value || '';
  var toDate = document.getElementById('stm-date-to')?.value || '';

  var filteredRows = filterStudentMoneyData(stmActiveData, searchVal, fromDate, toDate);

  if (!filteredRows || filteredRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော စာရင်း မရှိပါ။</td></tr>';
    return;
  }

  var isViewer = (localStorage.getItem('golden_user_role') === "Viewer");

  tbody.innerHTML = filteredRows.map(function(row) {
    var debitStr = row.debit > 0 ? Number(row.debit).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-';
    var creditStr = row.credit > 0 ? Number(row.credit).toLocaleString('en-US', {minimumFractionDigits: 2}) : '-';
    
    var balNum = parseFloat(row.balances || 0);
    var balStr = Number(balNum).toLocaleString('en-US', {minimumFractionDigits: 2});
    var balColorClass = balNum < 0 ? 'text-rose-400 font-extrabold' : 'text-emerald-300 font-bold';

    var displayNo = Math.floor(parseFloat(row.no || row.id)) || 1;

    return '<tr class="hover:bg-slate-800/30 text-slate-300">' +
        '<td class="text-center font-mono font-semibold text-slate-500">' + displayNo + '</td>' +
        '<td class="font-mono text-xs">' + (escapeHtml(row.date) || '-') + '</td>' +
        '<td class="font-mono font-bold text-indigo-300">' + (escapeHtml(row.fy) || '-') + '</td>' +
        '<td class="font-mono font-bold">' + cleanIntegerStr(row.id) + '</td>' +
        '<td class="font-mono font-bold text-indigo-400">' + (escapeHtml(row.fyid) || '-') + '</td>' +
        '<td class="font-bold text-slate-100">' + (escapeHtml(row.fyidName) || '-') + '</td>' +
        '<td>' + (escapeHtml(row.class) || '-') + '</td>' +
        '<td class="font-bold text-slate-400">' + (escapeHtml(row.method) || '-') + '</td>' +
        '<td class="text-right text-emerald-400 font-mono font-bold">' + debitStr + '</td>' +
        '<td class="text-right text-rose-400 font-mono font-bold">' + creditStr + '</td>' +
        '<td class="text-right font-mono ' + balColorClass + '">' + balStr + '</td>' +
        '<td class="max-w-xs truncate text-xs text-slate-400" title="' + escapeHtml(row.remark) + '">' + (escapeHtml(row.remark) || '-') + '</td>' +
        '<td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center">' +
          '<div class="flex items-center justify-center gap-3 ' + (isViewer ? 'hidden' : '') + '">' +
            '<button onclick="editStudentMoneyEntry(\'' + row.uniqueId + '\')" class="text-indigo-400 hover:text-indigo-300 transition" title="Edit"><i class="fa-solid fa-pen-to-square"></i></button>' +
            '<button onclick="deleteStudentMoneyEntry(\'' + row.uniqueId + '\')" class="text-rose-400 hover:text-rose-300 transition" title="Delete"><i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join('');
}

async function onStudentIdOrFYChangeStudentMoney() {
  var fyVal = document.getElementById('stm-fy')?.value || '2026-2027';
  var idVal = document.getElementById('stm-id-search')?.value.trim();

  var fyidShow = document.getElementById('stm-fyid-show');
  var fyidNameShow = document.getElementById('stm-fyidname-show');

  if (!idVal) {
    if (fyidShow) fyidShow.value = "";
    if (fyidNameShow) fyidNameShow.value = "";
    return;
  }

  var fyShort = getFyShortCode(fyVal);
  var paddedId = String(idVal).padStart(4, '0');
  var targetFyid = `${fyShort}-STU-${paddedId}`;

  if (!stmStudentsCache[fyVal]) {
    if (fyidNameShow) fyidNameShow.value = "ကျောင်းသား စာရင်း ရှာဖွေနေပါသည်...";
    try {
      var res = await callApi('getStudentData', { fy: fyVal, limit: 5000 }, 'GET');
      if (res && res.success) {
        stmStudentsCache[fyVal] = res.data || [];
      }
    } catch (e) {
      console.error("Failed to load students for FY " + fyVal, e);
    }
  }

  var list = stmStudentsCache[fyVal] || [];
  var idValNum = parseCleanIntId(idVal);

  var student = list.find(function(s) {
    var sFyid = String(s.fyid || '').toLowerCase();
    var sStudentIdNum = parseCleanIntId(s.student_id ?? s.studentId ?? s.id);
    return (sFyid === targetFyid.toLowerCase()) || (!isNaN(sStudentIdNum) && sStudentIdNum === idValNum);
  });

  if (student) {
    if (fyidShow) fyidShow.value = student.fyid || targetFyid;
    if (fyidNameShow) fyidNameShow.value = student.name || student.fyidName || '';
    if (document.getElementById('stm-class')) document.getElementById('stm-class').value = student.class || '';
  } else {
    if (fyidShow) fyidShow.value = targetFyid;
    if (fyidNameShow) fyidNameShow.value = "ကျောင်းသား စာရင်း ရှာမတွေ့ပါ။";
    if (document.getElementById('stm-class')) document.getElementById('stm-class').value = "";
  }
}

function openAddModalStudentMoney() {
  var form = document.getElementById('stm-form');
  if (form) form.reset();
  
  var uidEl = document.getElementById('stm-uniqueId');
  if (uidEl) uidEl.value = "";
  
  var today = new Date().toISOString().slice(0, 10);
  var dateEl = document.getElementById('stm-date');
  if (dateEl) dateEl.value = today;

  populateFYDropdownStudentMoney();

  var titleEl = document.getElementById('stm-form-title');
  if (titleEl) titleEl.innerText = "Add Student Money Entry";

  var modalEl = document.getElementById('stm-modal');
  if (modalEl) modalEl.classList.remove('hidden');
}

function closeStudentMoneyModal() {
  var modal = document.getElementById('stm-modal');
  if (modal) modal.classList.add('hidden');
}

function populateFYDropdownStudentMoney() {
  var fySelect = document.getElementById('stm-fy');
  if (!fySelect) return;

  var currentYear = new Date().getFullYear();
  var options = [
    `${currentYear - 1}-${currentYear}`,
    `${currentYear}-${currentYear + 1}`,
    `${currentYear + 1}-${currentYear + 2}`
  ];

  fySelect.innerHTML = options.map(function(fy) { return '<option value="' + fy + '">' + fy + '</option>'; }).join('');
  fySelect.value = `${currentYear}-${currentYear + 1}`;
}

async function saveStudentMoneyForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  var fyidShowVal = document.getElementById('stm-fyid-show')?.value;
  if (!fyidShowVal || fyidShowVal.includes("ကျောင်းသား ရှာမတွေ့ပါ")) {
    if (typeof showToast === 'function') showToast("ERROR", "ကျောင်းသား စာရင်း ရှာမတွေ့သဖြင့် သွင်းယူ၍ မရပါ။");
    return;
  }

  var payload = {
    uniqueId: document.getElementById('stm-uniqueId')?.value || "",
    id: parseInt(document.getElementById('stm-id-search')?.value, 10) || 0,
    date: document.getElementById('stm-date')?.value || "",
    fy: document.getElementById('stm-fy')?.value || "",
    fyid: fyidShowVal,
    fyidName: document.getElementById('stm-fyidname-show')?.value || "",
    class: document.getElementById('stm-class')?.value || "",
    method: document.getElementById('stm-method')?.value || "Cash",
    debit: parseFloat(document.getElementById('stm-debit')?.value) || 0,
    credit: parseFloat(document.getElementById('stm-credit')?.value) || 0,
    remark: document.getElementById('stm-remark')?.value || ""
  };

  try {
    closeStudentMoneyModal();
    if (typeof toggleLoading === 'function') toggleLoading(true);

    var actionName = payload.uniqueId ? 'updateStudentMoneyEntry' : 'saveStudentMoneyEntry';
    var res = await callApi(actionName, payload);

    if (res && res.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", "သိမ်းဆည်းမှု အောင်မြင်ပါသည်။");
      await loadStudentMoneyData(true, true);
    } else {
      throw new Error(res?.message || "သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function editStudentMoneyEntry(uniqueId) {
  var row = stmActiveData.find(function(item) { return item.uniqueId === uniqueId; });
  if (!row) return;

  openAddModalStudentMoney();

  document.getElementById('stm-uniqueId').value = row.uniqueId || "";
  document.getElementById('stm-date').value = row.date || "";
  document.getElementById('stm-fy').value = row.fy || "";
  document.getElementById('stm-id-search').value = cleanIntegerStr(row.id);

  onStudentIdOrFYChangeStudentMoney();

  document.getElementById('stm-method').value = row.method || "Cash";
  document.getElementById('stm-debit').value = row.debit || 0;
  document.getElementById('stm-credit').value = row.credit || 0;
  document.getElementById('stm-remark').value = row.remark || "";

  document.getElementById('stm-form-title').innerText = "Edit Student Money Entry";
}

async function deleteStudentMoneyEntry(uniqueId) {
  if (!confirm("ဤ စာရင်းအား ဖျက်သိမ်းရန် သေချာပါသလား။")) return;

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    var res = await callApi('deleteStudentMoneyEntry', { uniqueId: uniqueId });

    if (res && res.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", "ဖျက်သိမ်းမှု အောင်မြင်ပါသည်။");
      await loadStudentMoneyData(true, true);
    } else {
      throw new Error(res?.message || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "ဖျက်သိမ်းမှု အမှား: " + err.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function changePageStudentMoney(dir) {
  if (dir === -1 && stmPage > 1) {
    stmPage--;
    loadStudentMoneyData(false);
  } else if (dir === 1 && (stmPage * stmLimit) < stmTotalRows) {
    stmPage++;
    loadStudentMoneyData(false);
  }
}

function updatePaginationUIStudentMoney() {
  var info = document.getElementById('stm-pagination-info');
  if (info) {
    var start = stmTotalRows === 0 ? 0 : (stmPage - 1) * stmLimit + 1;
    var end = Math.min(stmPage * stmLimit, stmTotalRows);
    info.innerHTML = 'Showing <span class="text-indigo-400 font-extrabold">' + start + '</span> to <span class="text-indigo-400 font-extrabold">' + end + '</span> of <span class="text-indigo-400 font-extrabold">' + stmTotalRows + '</span> entries';
  }

  var prevBtn = document.getElementById('stm-btn-prev');
  if (prevBtn) prevBtn.disabled = (stmPage === 1);

  var nextBtn = document.getElementById('stm-btn-next');
  if (nextBtn) nextBtn.disabled = (stmPage * stmLimit >= stmTotalRows);
}

function exportToCSVStudentMoney() {
  if (!stmActiveData || stmActiveData.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  var csv = "NO,DATE,FY,ID,FYID,FYID NAME,CLASS,METHOD,DEBIT,CREDIT,BALANCES,REMARK,UNIQUEID\n";
  stmActiveData.forEach(function(r) {
    var name = '"' + (r.fyidName || '').replace(/"/g, '""') + '"';
    var remark = '"' + (r.remark || '').replace(/"/g, '""') + '"';
    csv += (r.no || '') + ',' + (r.date || '') + ',' + (r.fy || '') + ',' + cleanIntegerStr(r.id) + ',' + (r.fyid || '') + ',' + name + ',' + (r.class || '') + ',' + (r.method || '') + ',' + (r.debit || 0) + ',' + (r.credit || 0) + ',' + (r.balances || 0) + ',' + remark + ',' + (r.uniqueId || '') + '\n';
  });

  var blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `student_money_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 EXPOSE GLOBALLY
window.loadStudentMoneyData = loadStudentMoneyData;
window.onSearchInputStudentMoney = onSearchInputStudentMoney;
window.clearDateFilterStudentMoney = clearDateFilterStudentMoney;
window.onStudentIdOrFYChangeStudentMoney = onStudentIdOrFYChangeStudentMoney;
window.openAddModalStudentMoney = openAddModalStudentMoney;
window.closeStudentMoneyModal = closeStudentMoneyModal;
window.saveStudentMoneyForm = saveStudentMoneyForm;
window.editStudentMoneyEntry = editStudentMoneyEntry;
window.deleteStudentMoneyEntry = deleteStudentMoneyEntry;
window.changePageStudentMoney = changePageStudentMoney;
window.exportToCSVStudentMoney = exportToCSVStudentMoney;
