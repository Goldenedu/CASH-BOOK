/**
 * GOLDEN ERP SYSTEM - BANK & CASH BOOK CONTROLLER
 * File: js/bank-cash.js 
 * 💡 Features: Strict Search Engine, Self-Transfer Prevention, Auto-Description Generator & Overwrite Bug Fixed
 */

var bckPage = 1;
var bckLimit = 30;
var bckTotalRows = 0;
var bckActiveData = [];
var currentSubBook = 'bank'; // 'bank' or 'cash'
var searchTimeoutBck = null;
var isBankCashSubmitting = false; // 💡 Double Submit Protection Flag

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
 * 💡 Strict Search Filter Function for Main Bank & Cash Books
 * Searches strictly by: Description, Category, Debit Amount, Credit Amount.
 */
function filterBankCashKitData(list, searchVal, fromDate, toDate) {
  var safeList = Array.isArray(list) ? list : [];
  return safeList.filter(function(row) {
    if (typeof window.isDateInRange === 'function') {
      if (!window.isDateInRange(row.date, fromDate, toDate)) return false;
    }

    if (!searchVal || !searchVal.trim()) return true;
    var q = searchVal.trim().toLowerCase();
    var descMatch = String(row.description || '').toLowerCase().includes(q);
    var catMatch = String(row.category || '').toLowerCase().includes(q);
    var debitMatch = String(row.debit || '').includes(q);
    var creditMatch = String(row.credit || '').includes(q);

    return descMatch || catMatch || debitMatch || creditMatch;
  });
}

function clearDateFilterBCK() {
  var fromEl = document.getElementById('bck-date-from');
  var toEl = document.getElementById('bck-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  renderTableBankCashKit();
}

/**
 * 💡 Debounced Search Input Handler
 */
function onSearchInputBankCashKit() {
  if (searchTimeoutBck) clearTimeout(searchTimeoutBck);
  searchTimeoutBck = setTimeout(function() {
    renderTableBankCashKit();
  }, 100);
}

/**
 * 💡 Switch between Bank Book and Cash Book
 */
function switchSubBook(bookType) {
  currentSubBook = bookType ? String(bookType).toLowerCase() : 'bank';
  bckPage = 1;

  var titleEl = document.getElementById('page-title');
  if (titleEl) {
    titleEl.textContent = currentSubBook === 'bank' ? 'Main Bank Book' : 'Main Cash Book';
  }

  if (typeof updateSidebarHighlight === 'function') {
    updateSidebarHighlight(currentSubBook);
  }
  loadBankCashKitData(false, false);
}

/**
 * 💡 Load Bank or Cash Ledger Data
 */
async function loadBankCashKitData(isSilent, forceRefresh) {
  var token = localStorage.getItem('golden_auth_token');
  if (!token) return;

  try {
    var searchInput = document.getElementById('bck-search');
    var searchVal = searchInput ? searchInput.value.trim() : '';
    var bookName = currentSubBook === 'bank' ? 'Main Bank Book' : 'Main Cash Book';

    var cacheKey = `getBankCashData_${JSON.stringify({ bookName: bookName, page: bckPage, limit: bckLimit, searchVal: searchVal })}`;
    var hasCache = !forceRefresh && !!window.getApiCache(cacheKey);

    if (!isSilent && !hasCache && typeof toggleLoading === 'function') {
      toggleLoading(true);
    }

    var res = await callApi('getBankCashData', {
      bookName: bookName,
      page: bckPage,
      limit: bckLimit,
      searchVal: searchVal,
      forceRefresh: forceRefresh
    });

    if (!res || !res.success) {
      throw new Error(res?.message || "စာရင်း အချက်အလက်များ ခေါ်ယူခြင်း မအောင်မြင်ပါ။");
    }

    bckActiveData = res.data || [];
    bckTotalRows = res.totalRows || bckActiveData.length || 0;

    renderStatsBankCashKit(res.stats || { totalIncome: 0, totalExpense: 0, balance: 0 });
    renderTableBankCashKit();
    updatePaginationUIBankCashKit();

  } catch (err) {
    console.error("Bank/Cash Load Error:", err);
    if (!isSilent && typeof showToast === 'function') {
      showToast("ERROR", "စာရင်း အချက်အလက်များ ရယူ၍ မရပါ: " + err.message);
    }
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function renderStatsBankCashKit(stats) {
  var incTotal = document.getElementById('bck-total-income');
  var expTotal = document.getElementById('bck-total-expense');
  var balTotal = document.getElementById('bck-balance');
  var countTotal = document.getElementById('bck-entries-count');

  if (incTotal) incTotal.textContent = Number(stats.totalIncome || 0).toLocaleString('en-US') + ' MMK';
  if (expTotal) expTotal.textContent = Number(stats.totalExpense || 0).toLocaleString('en-US') + ' MMK';
  if (balTotal) balTotal.textContent = Number(stats.balance || 0).toLocaleString('en-US') + ' MMK';
  if (countTotal) countTotal.textContent = Number(bckTotalRows || 0).toLocaleString('en-US');
}

/**
 * 💡 Render Table Grid Rows (Integer NO Fix)
 */
function renderTableBankCashKit() {
  var tbody = document.getElementById('bck-table-body');
  if (!tbody) return;

  var searchInput = document.getElementById('bck-search');
  var searchVal = searchInput ? searchInput.value.trim() : '';

  var fromEl = document.getElementById('bck-date-from');
  var toEl = document.getElementById('bck-date-to');
  var fromDate = fromEl ? fromEl.value : '';
  var toDate = toEl ? toEl.value : '';

  var filteredRows = filterBankCashKitData(bckActiveData, searchVal, fromDate, toDate);

  if (!filteredRows || filteredRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော စာရင်း မရှိပါ။</td></tr>';
    return;
  }

  var isViewer = (window.AppState ? window.AppState.currentUserRole : '') === "Viewer";

  tbody.innerHTML = filteredRows.map(function(row) {
    var isLocked = Boolean(row.isLocked || isViewer);
    var lockClass = isLocked ? "opacity-30 cursor-not-allowed pointer-events-none" : "hover:text-white";
    var lockTitle = row.isLocked ? "Locked (Must be edited from Source Book)" : "";
    var disabledAttr = isLocked ? 'disabled' : '';

    var catBadge = typeof window.formatCategoryBadgeHtml === 'function' ? window.formatCategoryBadgeHtml(row.category) : escapeHtml(row.category);
    var debitStr = row.debit > 0 ? Number(row.debit).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';
    var creditStr = row.credit > 0 ? Number(row.credit).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';
    var balStr = Number(row.balances || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    var displayNo = Math.floor(parseCleanNum(row.no || row.id)) || 1;

    return '<tr class="hover:bg-slate-800/30 text-slate-300">' +
        '<td class="text-center font-semibold text-slate-500 py-3 px-2">' + displayNo + '</td>' +
        '<td class="font-mono text-xs py-3 px-2">' + (escapeHtml(row.date) || '-') + '</td>' +
        '<td class="py-3 px-2">' + catBadge + '</td>' +
        '<td class="font-bold text-slate-100 max-w-sm truncate py-3 px-2" title="' + escapeHtml(row.description) + '">' + (escapeHtml(row.description) || '-') + '</td>' +
        '<td class="font-bold text-slate-400 py-3 px-2">' + (escapeHtml(row.method) || '-') + '</td>' +
        '<td class="text-right text-emerald-400 font-mono font-bold py-3 px-2">' + debitStr + '</td>' +
        '<td class="text-right text-rose-400 font-mono font-bold py-3 px-2">' + creditStr + '</td>' +
        '<td class="text-right text-slate-200 font-mono font-bold py-3 px-2">' + balStr + '</td>' +
        '<td class="text-xs text-indigo-400 py-3 px-2">' + (escapeHtml(row.transfer) || '-') + '</td>' +
        '<td class="font-mono text-xs text-slate-400 py-3 px-2">' + (escapeHtml(row.vrNo) || '-') + '</td>' +
        '<td class="font-mono text-xs py-3 px-2">' + (escapeHtml(row.my) || '-') + '</td>' +
        '<td class="font-mono text-xs font-bold text-indigo-300 py-3 px-2">' + (escapeHtml(row.fy) || '-') + '</td>' +
        '<td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">' +
          '<div class="flex items-center justify-center gap-3">' +
            '<button onclick="editBankCashKitEntry(\'' + row.uniqueId + '\')" class="text-indigo-400 hover:text-indigo-300 transition ' + lockClass + '" title="' + lockTitle + '" ' + disabledAttr + '>' +
              '<i class="fa-solid fa-pen-to-square"></i>' +
            '</button>' +
            '<button onclick="deleteBankCashKitEntry(\'' + row.uniqueId + '\')" class="text-rose-400 hover:text-rose-300 transition ' + lockClass + '" title="' + lockTitle + '" ' + disabledAttr + '>' +
              '<i class="fa-solid fa-trash"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join('');
}

/**
 * 💡 Open Modal for New Entry
 */
function openAddModalBankCashKit() {
  var form = document.getElementById('bck-form');
  if (form) form.reset();

  var uniqueIdEl = document.getElementById('bck-uniqueId');
  if (uniqueIdEl) uniqueIdEl.value = "";

  var dateEl = document.getElementById('bck-date');
  if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);

  var debitEl = document.getElementById('bck-debit');
  if (debitEl) debitEl.value = 0;

  var creditEl = document.getElementById('bck-credit');
  if (creditEl) creditEl.value = 0;

  populateDropdownsBCK();

  var titleEl = document.getElementById('bck-form-title');
  if (titleEl) {
    titleEl.innerText = currentSubBook === 'bank' ? "Add Bank Entry" : "Add Cash Entry";
  }

  var modalEl = document.getElementById('bck-modal');
  if (modalEl) modalEl.classList.remove('hidden');
}

function closeBankCashKitModal() {
  var modal = document.getElementById('bck-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * 💡 Dropdown Options Population
 */
function populateDropdownsBCK() {
  var catSelect = document.getElementById('bck-category');
  var methodSelect = document.getElementById('bck-method');
  var transferSelect = document.getElementById('bck-transfer');

  var key = currentSubBook === 'bank' ? 'bankBook' : 'cashBook';
  var def = (window.DROPDOWNS && window.DROPDOWNS[key]) || {};

  if (catSelect) {
    if (def.category) {
      catSelect.innerHTML = def.category.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    } else {
      catSelect.innerHTML = 
        '<option value="Opening">Opening</option>' +
        '<option value="Income">Income</option>' +
        '<option value="Expense">Expense</option>' +
        '<option value="Transfer">Transfer</option>';
    }
  }

  if (methodSelect) {
    methodSelect.innerHTML = 
      '<option value="Bank" ' + (currentSubBook === 'bank' ? 'selected' : '') + '>Bank</option>' +
      '<option value="Cash" ' + (currentSubBook === 'cash' ? 'selected' : '') + '>Cash</option>';
  }

  // 💡 SELF-TRANSFER PREVENT: Filter out active book
  if (transferSelect) {
    var allBooks = [
      { name: "Main Bank Book", key: "bank" },
      { name: "Main Cash Book", key: "cash" },
      { name: "Office Exp Book", key: "office" },
      { name: "Kitchen Exp Book", key: "kitchen" },
      { name: "HR Payroll Exp Book", key: "payroll" }
    ];

    var availableBooks = allBooks.filter(function(b) { return b.key !== currentSubBook; });

    transferSelect.innerHTML = '<option value="">-- No Transfer --</option>' +
      availableBooks.map(function(b) { return '<option value="' + b.name + '">' + b.name + '</option>'; }).join('');
  }
}

/**
 * 💡 TRANSFER AUTO-DESCRIPTION ENGINE
 */
function onCategoryChangeBCK() {
  autoFillTransferDescriptionBCK();
}

function onTransferTargetChangeBCK() {
  autoFillTransferDescriptionBCK();
}

function autoFillTransferDescriptionBCK() {
  var cat = document.getElementById('bck-category')?.value;
  var transferTo = document.getElementById('bck-transfer')?.value;
  var descEl = document.getElementById('bck-description');
  var currentBook = currentSubBook === 'bank' ? 'Main Bank Book' : 'Main Cash Book';

  if (cat === "Transfer" && transferTo && descEl) {
    descEl.value = currentBook + ' Transfer to ' + transferTo;
  }
}

/**
 * 💡 Save / Submit Entry with Double Submit Lock
 */
async function saveBankCashKitForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (isBankCashSubmitting) return;
  isBankCashSubmitting = true;

  var bookName = currentSubBook === 'bank' ? 'Main Bank Book' : 'Main Cash Book';
  var uniqueId = document.getElementById('bck-uniqueId')?.value || "";

  var payload = {
    bookName: bookName,
    date: document.getElementById('bck-date')?.value || "",
    category: document.getElementById('bck-category')?.value || "Income",
    method: document.getElementById('bck-method')?.value || (currentSubBook === 'bank' ? 'Bank' : 'Cash'),
    transfer: document.getElementById('bck-transfer')?.value || "",
    debit: parseFloat(document.getElementById('bck-debit')?.value) || 0,
    credit: parseFloat(document.getElementById('bck-credit')?.value) || 0,
    description: document.getElementById('bck-description')?.value || "",
    uniqueId: uniqueId
  };

  try {
    closeBankCashKitModal();
    if (typeof toggleLoading === 'function') toggleLoading(true);

    var actionName = uniqueId ? 'updateBankCashEntry' : 'saveBankCashEntry';
    var res = await callApi(actionName, payload);

    if (res && res.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", "စာရင်း သိမ်းဆည်းမှု အောင်မြင်ပါသည်။");
      await loadBankCashKitData(true, true);
    } else {
      throw new Error(res?.message || "သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    isBankCashSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 Edit Entry (Dropdown Overwrite Fixed)
 */
function editBankCashKitEntry(uniqueId) {
  var row = bckActiveData.find(function(item) { return item.uniqueId === uniqueId; });
  if (!row) {
    if (typeof showToast === 'function') showToast("ERROR", "မူရင်း အချက်အလက် ရှာမတွေ့ပါ။");
    return;
  }

  openAddModalBankCashKit();

  // ✅ FIX: Populate dropdown options BEFORE setting row values to avoid innerHTML wiping!
  populateDropdownsBCK();

  var uidEl = document.getElementById('bck-uniqueId');
  if (uidEl) uidEl.value = row.uniqueId || "";

  var dateEl = document.getElementById('bck-date');
  if (dateEl) dateEl.value = row.date || "";

  var catEl = document.getElementById('bck-category');
  if (catEl) catEl.value = row.category || "Income";

  var methodEl = document.getElementById('bck-method');
  if (methodEl) methodEl.value = row.method || (currentSubBook === 'bank' ? 'Bank' : 'Cash');
  
  var transferEl = document.getElementById('bck-transfer');
  if (transferEl) transferEl.value = row.transfer || "";
  
  var debitEl = document.getElementById('bck-debit');
  if (debitEl) debitEl.value = row.debit || 0;

  var creditEl = document.getElementById('bck-credit');
  if (creditEl) creditEl.value = row.credit || 0;

  var descEl = document.getElementById('bck-description');
  if (descEl) descEl.value = row.description || "";

  var titleEl = document.getElementById('bck-form-title');
  if (titleEl) titleEl.innerText = "Edit Entry";
}

/**
 * 💡 Delete Entry
 */
async function deleteBankCashKitEntry(uniqueId) {
  if (!confirm("ဤ စာရင်းအား အပြီးတိုင် ဖျက်သိမ်းလိုပါသလား။")) {
    return;
  }

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    var res = await callApi('deleteBankCashEntry', { uniqueId: uniqueId, bookName: currentSubBook === 'bank' ? 'Main Bank Book' : 'Main Cash Book' });

    if (res && res.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", "စာရင်း ဖျက်သိမ်းခြင်း အောင်မြင်ပါသည်။");
      await loadBankCashKitData(true, true);
    } else {
      throw new Error(res?.message || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "ဖျက်သိမ်းမှု အမှား: " + err.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function changePageBankCashKit(dir) {
  if (dir === -1 && bckPage > 1) {
    bckPage--;
    loadBankCashKitData(false);
  } else if (dir === 1 && (bckPage * bckLimit) < bckTotalRows) {
    bckPage++;
    loadBankCashKitData(false);
  }
}

function updatePaginationUIBankCashKit() {
  var info = document.getElementById('bck-pagination-info');
  if (info) {
    var start = bckTotalRows === 0 ? 0 : (bckPage - 1) * bckLimit + 1;
    var end = Math.min(bckPage * bckLimit, bckTotalRows);
    info.innerHTML = 'Showing <span class="text-indigo-400 font-extrabold">' + start + '</span> to <span class="text-indigo-400 font-extrabold">' + end + '</span> of <span class="text-indigo-400 font-extrabold">' + bckTotalRows + '</span> entries';
  }

  var prevBtn = document.getElementById('bck-btn-prev');
  if (prevBtn) prevBtn.disabled = (bckPage === 1);

  var nextBtn = document.getElementById('bck-btn-next');
  if (nextBtn) nextBtn.disabled = (bckPage * bckLimit >= bckTotalRows);
}

function exportToCSVBankCashKit() {
  if (!bckActiveData || bckActiveData.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  var csv = "NO,DATE,CATEGORY,DESCRIPTION,METHOD,DEBIT,CREDIT,BALANCES,TRANSFER,VR NO,MY,FY,UNIQUEID\n";
  bckActiveData.forEach(function(r) {
    var desc = '"' + (r.description || '').replace(/"/g, '""') + '"';
    csv += (r.no || '') + ',' + (r.date || '') + ',' + (r.category || '') + ',' + desc + ',' + (r.method || '') + ',' + (r.debit || 0) + ',' + (r.credit || 0) + ',' + (r.balances || 0) + ',' + (r.transfer || '') + ',' + (r.vrNo || '') + ',' + (r.my || '') + ',' + (r.fy || '') + ',' + (r.uniqueId || '') + '\n';
  });

  var blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${currentSubBook}_ledger_${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 Export functions to global window object
window.switchSubBook = switchSubBook;
window.loadBankCashKitData = loadBankCashKitData;
window.openAddModalBankCashKit = openAddModalBankCashKit;
window.closeBankCashKitModal = closeBankCashKitModal;
window.saveBankCashKitForm = saveBankCashKitForm;
window.editBankCashKitEntry = editBankCashKitEntry;
window.deleteBankCashKitEntry = deleteBankCashKitEntry;
window.onSearchInputBankCashKit = onSearchInputBankCashKit;
window.clearDateFilterBCK = clearDateFilterBCK;
window.changePageBankCashKit = changePageBankCashKit;
window.exportToCSVBankCashKit = exportToCSVBankCashKit;
window.onCategoryChangeBCK = onCategoryChangeBCK;
window.onTransferTargetChangeBCK = onTransferTargetChangeBCK;
