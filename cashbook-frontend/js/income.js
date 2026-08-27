/**
 * GOLDEN ERP SYSTEM - MAIN INCOME BOOK MODULE
 * File: js/income.js 
 * 💡 Features: Precision FY-Scoped Student Lookup, Dynamic Promotion Matrix AUT Calculator (FY+Class+Category+Promo),
 *              Auto-Fill Credit Amount, Split Payment & Universal Invoice Printer
 */

var incomePage = 1;
var incomeLimit = 20;
var incomeTotalRows = 0;
var incomeActiveData = [];
var studentsByFyCache = {};
var promoMatrixCache = null;
var searchTimeoutIncome = null;
var isIncomeSubmitting = false;

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
 * 💡 Safe escaper for values injected into inline onclick="...('VALUE')" handlers.
 * Escapes backslashes/quotes for the JS string literal, then HTML-escapes the
 * result so it can't break out of the surrounding double-quoted HTML attribute.
 */
function escapeJsAttr(str) {
  if (str === null || str === undefined) return '';
  var jsEscaped = String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return escapeHtml(jsEscaped);
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
 * 💡 Safe Integer ID Parser
 */
function parseCleanIntId(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.trunc(val);
  var n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 💡 System-Wide FY Short Code Generator (Format: 2026-2027 -> 2627)
 */
function getFyShortCode(fyStr) {
  if (!fyStr) return '2627';
  var parts = String(fyStr).split(/[-/]/);
  if (parts.length >= 2) {
    var y1 = parts[0].trim().slice(-2);
    var y2 = parts[1].trim().slice(-2);
    return y1 + y2;
  }
  return '2627';
}

/**
 * 💡 FYID Sanitizer
 */
function sanitizeFyidStr(fyidStr) {
  var s = String(fyidStr || '').trim();
  if (!s) return s;
  if (s.indexOf('.0') === -1) return s;
  var cleaned = s.replace(/\.0/g, '');
  var parts = cleaned.split('-STU-');
  if (parts.length === 2) {
    var numPart = parseInt(parts[1], 10) || 0;
    return parts[0] + '-STU-' + String(numPart).padStart(4, '0');
  }
  return cleaned;
}

/**
 * 💡 Strict Search Filter Function for Main Income Book
 */
function filterIncomeData(list, searchVal, fromDate, toDate) {
  var safeList = Array.isArray(list) ? list : [];
  return safeList.filter(function(row) {
    if (typeof window.isDateInRange === 'function') {
      if (!window.isDateInRange(row.effDate || row.date, fromDate, toDate)) return false;
    }

    if (!searchVal || !searchVal.trim()) return true;
    var q = searchVal.trim().toLowerCase();

    var nameMatch = String(row.fyidName || row.name || '').toLowerCase().includes(q);
    var fyidMatch = String(row.fyid || '').toLowerCase().includes(q);
    var idMatch = String(row.id || '').toLowerCase().includes(q);
    var accMatch = String(row.accountName || '').toLowerCase().includes(q);

    return nameMatch || fyidMatch || idMatch || accMatch;
  });
}

function clearDateFilterIncome() {
  var fromEl = document.getElementById('income-date-from');
  var toEl = document.getElementById('income-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  renderTableIncome();
}

function onSearchInputIncome() {
  if (searchTimeoutIncome) clearTimeout(searchTimeoutIncome);
  searchTimeoutIncome = setTimeout(function() {
    renderTableIncome();
  }, 200);
}

/**
 * 💡 Load Main Income Book Data
 */
async function loadIncomeData(isSilent, forceRefresh) {
  var token = localStorage.getItem('golden_auth_token');
  if (!token) return;

  try {
    var searchInput = document.getElementById('income-search');
    var searchVal = searchInput ? searchInput.value.trim() : '';

    var cacheKey = `getIncomeData_${JSON.stringify({ page: incomePage, limit: incomeLimit, searchVal: searchVal })}`;
    var hasCache = !forceRefresh && !!window.getApiCache(cacheKey);

    if (!isSilent && !hasCache && typeof toggleLoading === 'function') {
      toggleLoading(true);
    }

    var res = await callApi('getIncomeData', {
      page: incomePage,
      limit: incomeLimit,
      searchVal: searchVal,
      forceRefresh: forceRefresh
    });

    if (!res || !res.success) {
      throw new Error(res?.message || "ဝင်ငွေစာရင်း အချက်အလက်များ ခေါ်ယူခြင်း မအောင်မြင်ပါ။");
    }

    incomeActiveData = res.data || [];
    incomeTotalRows = res.totalRows || incomeActiveData.length || 0;

    renderStatsIncome(res.stats || { totalIncome: 0, totalExpense: 0, balance: 0 });
    renderTableIncome();
    updatePaginationUIIncome();

    // 💡 Preload Promotion Matrix Rates into Cache in Background
    preloadPromotionMatrix();

  } catch (err) {
    console.error("Income Data Load Error:", err);
    if (!isSilent && typeof showToast === 'function') {
      showToast("ERROR", "ဝင်ငွေစာရင်း အချက်အလက်များ ရယူ၍ မရပါ: " + err.message);
    }
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 Preload Promotion Matrix Rates
 */
async function preloadPromotionMatrix() {
  try {
    var res = await callApi('getPromotionData', {}, 'GET');
    if (res && res.success) {
      promoMatrixCache = res.data || [];
    }
  } catch (e) {
    console.warn("Promotion Matrix Preload Warning:", e);
  }
}

function renderStatsIncome(stats) {
  var incTotal = document.getElementById('inc-total-income');
  var expTotal = document.getElementById('inc-total-expense');
  var balTotal = document.getElementById('inc-balance');
  var countTotal = document.getElementById('inc-entries-count');

  if (incTotal) incTotal.textContent = Number(stats.totalIncome || 0).toLocaleString('en-US') + ' MMK';
  if (expTotal) expTotal.textContent = Number(stats.totalExpense || 0).toLocaleString('en-US') + ' MMK';
  if (balTotal) balTotal.textContent = Number(stats.balance || 0).toLocaleString('en-US') + ' MMK';
  if (countTotal) countTotal.textContent = Number(incomeTotalRows || 0).toLocaleString('en-US');
}

function renderTableIncome() {
  var tbody = document.getElementById('income-table-body');
  if (!tbody) return;

  var searchInput = document.getElementById('income-search');
  var searchVal = searchInput ? searchInput.value.trim() : '';

  var fromEl = document.getElementById('income-date-from');
  var toEl = document.getElementById('income-date-to');
  var fromDate = fromEl ? fromEl.value : '';
  var toDate = toEl ? toEl.value : '';

  var filteredRows = filterIncomeData(incomeActiveData, searchVal, fromDate, toDate);

  if (!filteredRows || filteredRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="19" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ဝင်ငွေစာရင်း မရှိပါ။</td></tr>';
    return;
  }

  var isViewer = (localStorage.getItem('golden_user_role') === "Viewer");

  tbody.innerHTML = filteredRows.map(function(row) {
    var isLocked = Boolean(row.isLocked || isViewer);
    var lockClass = isLocked ? "opacity-30 cursor-not-allowed pointer-events-none" : "hover:text-white";
    var lockTitle = row.isLocked ? "Older than 7 days (Locked)" : "";
    var disabledAttr = isLocked ? 'disabled' : '';

    var catBadge = typeof window.formatCategoryBadgeHtml === 'function' ? window.formatCategoryBadgeHtml(row.category) : escapeHtml(row.category);
    var debitStr = row.debit > 0 ? Number(row.debit).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';
    var creditStr = row.credit > 0 ? Number(row.credit).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';
    var autStr = row.autAmount > 0 ? Number(row.autAmount).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';

    var displayNo = Math.floor(parseCleanNum(row.no || row.id)) || 1;

    return '<tr class="hover:bg-slate-800/30 text-slate-300">' +
        '<td class="text-center font-mono font-semibold text-slate-500 py-3 px-2">' + displayNo + '</td>' +
        '<td class="font-mono text-xs py-3 px-2">' + (escapeHtml(row.effDate) || '-') + '</td>' +
        '<td class="font-mono text-xs py-3 px-2">' + (escapeHtml(row.date) || '-') + '</td>' +
        '<td class="font-mono font-bold text-indigo-300 py-3 px-2">' + (escapeHtml(row.fy) || '-') + '</td>' +
        '<td class="font-mono font-bold py-3 px-2">' + (escapeHtml(row.id) || '-') + '</td>' +
        '<td class="font-mono font-bold text-indigo-400 py-3 px-2">' + (escapeHtml(row.fyid) || '-') + '</td>' +
        '<td class="font-bold text-slate-100 py-3 px-2">' + (escapeHtml(row.fyidName) || '-') + '</td>' +
        '<td class="py-3 px-2">' + (escapeHtml(row.class) || '-') + '</td>' +
        '<td class="py-3 px-2">' + catBadge + '</td>' +
        '<td class="font-semibold text-slate-200 py-3 px-2">' + (escapeHtml(row.accountName) || '-') + '</td>' +
        '<td class="font-bold text-slate-400 py-3 px-2">' + (escapeHtml(row.method) || '-') + '</td>' +
        '<td class="text-right text-rose-400 font-mono font-bold py-3 px-2">' + debitStr + '</td>' +
        '<td class="text-right text-emerald-400 font-mono font-bold py-3 px-2">' + creditStr + '</td>' +
        '<td class="text-right text-indigo-400 font-mono font-bold py-3 px-2">' + autStr + '</td>' +
        '<td class="text-xs py-3 px-2">' + (escapeHtml(row.promo) || '-') + '</td>' +
        '<td class="font-mono text-xs py-3 px-2">' + (escapeHtml(row.my) || '-') + '</td>' +
        '<td class="font-mono text-xs text-slate-400 py-3 px-2">' + (escapeHtml(row.vrNo) || '-') + '</td>' +
        '<td class="max-w-xs truncate text-xs text-slate-400 py-3 px-2" title="' + escapeHtml(row.remark) + '">' + (escapeHtml(row.remark) || '-') + '</td>' +
        '<td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">' +
          '<div class="flex items-center justify-center gap-2">' +
            '<button onclick="printInvoice(\'' + escapeJsAttr(row.uniqueId) + '\')" class="p-1 text-emerald-400 hover:text-emerald-300 transition" title="Print Receipt"><i class="fa-solid fa-print"></i></button>' +
            '<button onclick="editIncomeEntry(\'' + escapeJsAttr(row.uniqueId) + '\')" class="p-1 text-indigo-400 hover:text-indigo-300 transition ' + lockClass + '" title="Edit ' + lockTitle + '" ' + disabledAttr + '><i class="fa-solid fa-pen-to-square"></i></button>' +
            '<button onclick="deleteIncomeEntry(\'' + escapeJsAttr(row.uniqueId) + '\')" class="p-1 text-rose-400 hover:text-rose-300 transition ' + lockClass + '" title="Delete ' + lockTitle + '" ' + disabledAttr + '><i class="fa-solid fa-trash"></i></button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join('');
}

/**
 * 💡 FY-Scoped Student Lookup
 */
async function onStudentIdOrFYChangeIncome() {
  var fyVal = document.getElementById('inc-fy')?.value || '2026-2027';
  var idVal = document.getElementById('inc-id-search')?.value.trim();

  var fyidShow = document.getElementById('inc-fyid-show');
  var fyidNameShow = document.getElementById('inc-fyidname-show');

  if (!idVal) {
    if (fyidShow) fyidShow.value = "";
    if (fyidNameShow) fyidNameShow.value = "";
    return;
  }

  var fyShort = getFyShortCode(fyVal);
  var paddedId = String(idVal).padStart(4, '0');
  var targetFyid = `${fyShort}-STU-${paddedId}`;

  if (!studentsByFyCache[fyVal]) {
    if (fyidNameShow) fyidNameShow.value = "ကျောင်းသား စာရင်း ရှာဖွေနေပါသည်...";
    try {
      var res = await callApi('getStudentData', { fy: fyVal, limit: 5000 }, 'GET');
      if (res && res.success) {
        studentsByFyCache[fyVal] = res.data || [];
      }
    } catch (e) {
      console.error("Failed to load students for FY " + fyVal, e);
    }
  }

  var list = studentsByFyCache[fyVal] || [];
  var idValNum = parseCleanIntId(idVal);

  var student = list.find(function(s) {
    var sFyid = sanitizeFyidStr(s.fyid).toLowerCase();
    var sStudentIdNum = parseCleanIntId(s.student_id ?? s.studentId ?? s.id);

    var fyidMatches = (sFyid === targetFyid.toLowerCase());
    var idMatches = (!isNaN(sStudentIdNum) && !isNaN(idValNum) && sStudentIdNum === idValNum);

    return fyidMatches || idMatches;
  });

  if (student) {
    var actualFyid = sanitizeFyidStr(student.fyid) || targetFyid;
    var actualName = student.name || student.fyidName || student.fyid_name || '';

    if (fyidShow) fyidShow.value = actualFyid;
    if (fyidNameShow) fyidNameShow.value = actualName;

    var classEl = document.getElementById('inc-class');
    var catEl = document.getElementById('inc-category');
    var promoEl = document.getElementById('inc-promo');

    if (classEl) classEl.value = student.class || '';
    if (catEl) catEl.value = student.category || 'Boarder';
    if (promoEl) promoEl.value = student.promo || 'Original price';

    // 💡 Auto calculate fee rate instantly
    await onAccountNameOrCategoryChangeIncome();
  } else {
    if (fyidShow) fyidShow.value = targetFyid;
    if (fyidNameShow) fyidNameShow.value = "ကျောင်းသား စာရင်း ရှာမတွေ့ပါ။";
    
    if (document.getElementById('inc-class')) document.getElementById('inc-class').value = "";
    if (document.getElementById('inc-promo')) document.getElementById('inc-promo').value = "";
    
    var autAmtEl = document.getElementById('inc-autamount') || document.getElementById('inc-aut-amount');
    if (autAmtEl) autAmtEl.value = 0;
  }
}

/**
 * 💡 Precision Promotion Matrix Rate Auto-Calculation Engine
 */
async function onAccountNameOrCategoryChangeIncome() {
  var fyVal = document.getElementById('inc-fy')?.value || '2026-2027';
  var cleanFy = String(fyVal).trim().replace(/^FY\s*/i, '');
  var accountName = document.getElementById('inc-account')?.value || 'Registration';
  var classVal = String(document.getElementById('inc-class')?.value || '').trim();
  var categoryVal = String(document.getElementById('inc-category')?.value || '').trim();
  var promoVal = String(document.getElementById('inc-promo')?.value || 'Original price').trim();

  var autAmtEl = document.getElementById('inc-autamount') || document.getElementById('inc-aut-amount');
  var creditEl = document.getElementById('inc-credit');

  if (!autAmtEl) return;

  if (accountName !== "Registration" && accountName !== "Services") {
    autAmtEl.value = 0;
    return;
  }

  // Load promo matrix if cache is missing
  if (!promoMatrixCache || !Array.isArray(promoMatrixCache) || promoMatrixCache.length === 0) {
    try {
      var res = await callApi('getPromotionData', {}, 'GET');
      if (res && res.success) {
        promoMatrixCache = res.data || [];
      }
    } catch (e) {
      console.error("Failed to fetch promo matrix", e);
    }
  }

  if (promoMatrixCache && Array.isArray(promoMatrixCache)) {
    // 💡 1. Strict Match: Match by FY, Class AND Category
    var match = promoMatrixCache.find(function(r) {
      var rFy = String(r.fy || '').trim().replace(/^FY\s*/i, '');
      var rClass = String(r.class || '').trim().toLowerCase();
      var rCat = String(r.category || '').trim().toLowerCase();

      var fyMatches = (!rFy || rFy === cleanFy);
      var classMatches = (rClass === classVal.toLowerCase());
      var catMatches = (rCat === categoryVal.toLowerCase());

      return classMatches && (catMatches || !categoryVal) && fyMatches;
    });

    // 💡 2. Fallback Match without FY
    if (!match) {
      match = promoMatrixCache.find(function(r) {
        var rClass = String(r.class || '').trim().toLowerCase();
        var rCat = String(r.category || '').trim().toLowerCase();
        return (rClass === classVal.toLowerCase()) && (rCat === categoryVal.toLowerCase());
      });
    }

    if (match) {
      var calculatedFee = 0;

      if (accountName === "Registration") {
        calculatedFee = Number(match.registration ?? match.Registration ?? 0);
      } else if (accountName === "Services") {
        var promoKeyMap = {
          'Original price': match.originalPrice ?? match.original_price ?? 0,
          'Pro A': match.proA ?? match.pro_a ?? 0,
          'Pro B': match.proB ?? match.pro_b ?? 0,
          'Pro C': match.proC ?? match.pro_c ?? 0,
          'Pro D': match.proD ?? match.pro_d ?? 0,
          'Pro E': match.proE ?? match.pro_e ?? 0,
          'Half scholar': match.halfScholar ?? match.half_scholar ?? 0,
          'Full scholar': match.fullScholar ?? match.full_scholar ?? 0
        };

        calculatedFee = Number(promoKeyMap[promoVal] !== undefined ? promoKeyMap[promoVal] : (match.originalPrice || match.original_price || 0));
      }

      autAmtEl.value = calculatedFee;

      // 💡 Auto-fill Credit amount if currently empty or 0
      if (creditEl && (parseFloat(creditEl.value || 0) === 0 || creditEl.value === '')) {
        creditEl.value = calculatedFee;
      }
      return;
    }
  }

  autAmtEl.value = 0;
}

/**
 * 💡 Toggle Split Payment UI
 */
function toggleSplitPaymentIncome() {
  var isSplit = document.getElementById('inc-is-split')?.checked;
  var normalDiv = document.getElementById('inc-normal-payment-div');
  var splitDiv = document.getElementById('inc-split-payment-div');

  if (isSplit) {
    if (normalDiv) normalDiv.classList.add('hidden');
    if (splitDiv) splitDiv.classList.remove('hidden');
  } else {
    if (normalDiv) normalDiv.classList.remove('hidden');
    if (splitDiv) splitDiv.classList.add('hidden');
  }
}

/**
 * 💡 Modal Form Controls
 */
async function openAddModalIncome() {
  var form = document.getElementById('income-form');
  if (form) form.reset();
  
  var uidEl = document.getElementById('inc-uniqueId');
  if (uidEl) uidEl.value = "";
  
  var today = new Date().toISOString().slice(0, 10);
  var dateEl = document.getElementById('inc-date');
  if (dateEl) dateEl.value = today;

  var effDateEl = document.getElementById('inc-effdate');
  if (effDateEl) effDateEl.value = today;

  var autAmtEl = document.getElementById('inc-autamount') || document.getElementById('inc-aut-amount');
  if (autAmtEl) autAmtEl.value = 0;

  populateFYDropdownIncome();
  toggleSplitPaymentIncome();

  var titleEl = document.getElementById('inc-form-title');
  if (titleEl) titleEl.innerText = "Add Income Entry";

  var modalEl = document.getElementById('income-modal');
  if (modalEl) modalEl.classList.remove('hidden');

  // Preload Promo Matrix to be 100% ready for instant calculation
  await preloadPromotionMatrix();
}

function closeIncomeModal() {
  var modal = document.getElementById('income-modal');
  if (modal) modal.classList.add('hidden');
}

function populateFYDropdownIncome() {
  var fySelect = document.getElementById('inc-fy');
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

/**
 * 💡 Save / Submit Income Entry with Double Submit Lock
 */
async function saveIncomeForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (isIncomeSubmitting) return;
  isIncomeSubmitting = true;

  var isSplit = document.getElementById('inc-is-split')?.checked;
  var fyidShowVal = document.getElementById('inc-fyid-show')?.value;

  if (fyidShowVal === "Not Found" || !fyidShowVal || fyidShowVal.includes("ကျောင်းသား ရှာမတွေ့ပါ")) {
    isIncomeSubmitting = false;
    if (typeof showToast === 'function') showToast("ERROR", "ကျောင်းသား စာရင်း ရှာမတွေ့သဖြင့် သွင်းယူ၍ မရပါ။");
    return;
  }

  var autAmtEl = document.getElementById('inc-autamount') || document.getElementById('inc-aut-amount');

  var payload = {
    uniqueId: document.getElementById('inc-uniqueId')?.value || "",
    id: parseInt(document.getElementById('inc-id-search')?.value, 10) || 0,
    date: document.getElementById('inc-date')?.value || "",
    effDate: document.getElementById('inc-effdate')?.value || "",
    fy: document.getElementById('inc-fy')?.value || "",
    fyid: fyidShowVal,
    fyidName: document.getElementById('inc-fyidname-show')?.value || "",
    class: document.getElementById('inc-class')?.value || "",
    category: document.getElementById('inc-category')?.value || "",
    promo: document.getElementById('inc-promo')?.value || "",
    accountName: document.getElementById('inc-account')?.value || "",
    autAmount: parseFloat(autAmtEl?.value) || 0,
    remark: document.getElementById('inc-remark')?.value || "",
    isSplit: isSplit,

    method: document.getElementById('inc-method')?.value || "Cash",
    debit: parseFloat(document.getElementById('inc-debit')?.value) || 0,
    credit: parseFloat(document.getElementById('inc-credit')?.value) || 0,

    cashAmount: parseFloat(document.getElementById('inc-cash-amount')?.value) || 0,
    bankAmount: parseFloat(document.getElementById('inc-bank-amount')?.value) || 0
  };

  try {
    closeIncomeModal();
    if (typeof toggleLoading === 'function') toggleLoading(true);

    var actionName = payload.uniqueId ? 'updateIncomeEntry' : 'saveIncomeEntry';
    var res = await callApi(actionName, payload);

    if (res && res.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", "ဝင်ငွေစာရင်း သိမ်းဆည်းမှု အောင်မြင်ပါသည်။");
      await loadIncomeData(true, true);
    } else {
      throw new Error(res?.message || "သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "မအောင်မြင်ပါ: " + err.message);
  } finally {
    isIncomeSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 Edit Entry
 */
function editIncomeEntry(uniqueId) {
  var row = incomeActiveData.find(function(item) { return item.uniqueId === uniqueId; });
  if (!row) {
    if (typeof showToast === 'function') showToast("ERROR", "မူရင်း အချက်အလက် ရှာမတွေ့ပါ။");
    return;
  }

  openAddModalIncome();

  var uidEl = document.getElementById('inc-uniqueId');
  if (uidEl) uidEl.value = row.uniqueId || "";

  var dateEl = document.getElementById('inc-date');
  if (dateEl) dateEl.value = row.date || "";

  var effDateEl = document.getElementById('inc-effdate');
  if (effDateEl) effDateEl.value = row.effDate || "";

  var fyEl = document.getElementById('inc-fy');
  if (fyEl) fyEl.value = row.fy || "";

  var idSearchEl = document.getElementById('inc-id-search');
  if (idSearchEl) idSearchEl.value = row.id || "";

  onStudentIdOrFYChangeIncome();

  var catEl = document.getElementById('inc-category');
  if (catEl) catEl.value = row.category || "Boarder";

  var accEl = document.getElementById('inc-account');
  if (accEl) accEl.value = row.accountName || "Registration";

  var methodEl = document.getElementById('inc-method');
  if (methodEl) methodEl.value = row.method || "Cash";

  var debitEl = document.getElementById('inc-debit');
  if (debitEl) debitEl.value = row.debit || 0;

  var creditEl = document.getElementById('inc-credit');
  if (creditEl) creditEl.value = row.credit || 0;

  var autAmtEl = document.getElementById('inc-autamount') || document.getElementById('inc-aut-amount');
  if (autAmtEl) autAmtEl.value = row.autAmount || 0;

  var remarkEl = document.getElementById('inc-remark');
  if (remarkEl) remarkEl.value = row.remark || "";

  var titleEl = document.getElementById('inc-form-title');
  if (titleEl) titleEl.innerText = "Edit Income Entry";
}

/**
 * 💡 Delete Entry
 */
async function deleteIncomeEntry(uniqueId) {
  if (!confirm("ဤ ဝင်ငွေမှတ်တမ်းအား အပြီးတိုင် ဖျက်သိမ်းလိုပါသလား။\n(ခွဲပေးချေမှုဖြစ်ပါက သက်ဆိုင်သော စာရင်းများပါ အတူတကွ ဖျက်သိမ်းသွားမည် ဖြစ်ပါသည်။)")) {
    return;
  }

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    var res = await callApi('deleteIncomeEntry', { uniqueId: uniqueId });

    if (res && res.success) {
      if (typeof showToast === 'function') showToast("SUCCESS", "ဝင်ငွေစာရင်း ဖျက်သိမ်းခြင်း အောင်မြင်ပါသည်။");
      await loadIncomeData(true, true);
    } else {
      throw new Error(res?.message || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "ဖျက်သိမ်းမှု အမှား: " + err.message);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function changePageIncome(dir) {
  if (dir === -1 && incomePage > 1) {
    incomePage--;
    loadIncomeData(false);
  } else if (dir === 1 && (incomePage * incomeLimit) < incomeTotalRows) {
    incomePage++;
    loadIncomeData(false);
  }
}

function updatePaginationUIIncome() {
  var info = document.getElementById('inc-pagination-info');
  if (info) {
    var start = incomeTotalRows === 0 ? 0 : (incomePage - 1) * incomeLimit + 1;
    var end = Math.min(incomePage * incomeLimit, incomeTotalRows);
    info.innerHTML = 'Showing <span class="text-indigo-400 font-extrabold">' + start + '</span> to <span class="text-indigo-400 font-extrabold">' + end + '</span> of <span class="text-indigo-400 font-extrabold">' + incomeTotalRows + '</span> entries';
  }

  var prevBtn = document.getElementById('inc-btn-prev');
  if (prevBtn) prevBtn.disabled = (incomePage === 1);

  var nextBtn = document.getElementById('inc-btn-next');
  if (nextBtn) nextBtn.disabled = (incomePage * incomeLimit >= incomeTotalRows);
}

function exportToCSVIncome() {
  if (!incomeActiveData || incomeActiveData.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  var csv = "NO,EFFECT DATE,DATE,FY,ID,FYID,FYID NAME,CLASS,CATEGORY,ACCOUNT NAME,METHOD,DEBIT,CREDIT,AUT AMOUNT,PROMO,MY,VR NO,REMARK,UNIQUEID\n";
  incomeActiveData.forEach(function(r) {
    var name = '"' + (r.fyidName || '').replace(/"/g, '""') + '"';
    var remark = '"' + (r.remark || '').replace(/"/g, '""') + '"';
    csv += (r.no || '') + ',' + (r.effDate || '') + ',' + (r.date || '') + ',' + (r.fy || '') + ',' + (r.id || '') + ',' + (r.fyid || '') + ',' + name + ',' + (r.class || '') + ',' + (r.category || '') + ',' + (r.accountName || '') + ',' + (r.method || '') + ',' + (r.debit || 0) + ',' + (r.credit || 0) + ',' + (r.autAmount || 0) + ',' + (r.promo || '') + ',' + (r.my || '') + ',' + (r.vrNo || '') + ',' + remark + ',' + (r.uniqueId || '') + '\n';
  });

  var blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `income_book_${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * 💡 Universal Invoice Printer
 */
function printInvoice(uniqueId) {
  var row = incomeActiveData.find(function(item) { return (item.uniqueId === uniqueId || item.uniqueid === uniqueId); });

  if (!row && window.allCashierData && Array.isArray(window.allCashierData)) {
    row = window.allCashierData.find(function(item) { return (item.uniqueId === uniqueId || item.uniqueid === uniqueId); });
  }

  if (!row) {
    if (typeof showToast === 'function') showToast("ERROR", "ပြေစာ ထုတ်ယူရန် အချက်အလက် ရှာမတွေ့ပါ။");
    return;
  }

  var nameParts = (row.fyidName || row.name || '').split(" ");
  var studentName = nameParts.length > 3 ? nameParts.slice(3).join(" ") : (row.fyidName || row.name || '-');

  var displayAmount = Number(row.credit || 0);
  var displayDesc = row.accountName || row.category || "Tuition & Fees";

  if (Number(row.debit || 0) > 0) {
    displayAmount = -Number(row.debit);
    displayDesc = (row.accountName || row.category || 'Fee') + " (Student Refund)";
  }

  var copies = ['customer', 'received'];
  copies.forEach(function(copy) {
    var nameEl = document.getElementById(`print-${copy}-name`);
    if (nameEl) nameEl.textContent = studentName;

    var dateEl = document.getElementById(`print-${copy}-date`);
    if (dateEl) {
      var rawDate = row.date || row.effDate || '';
      if (rawDate && rawDate.includes('-')) {
        var p = rawDate.split('-');
        if (p.length === 3) rawDate = `${p[2]}-${p[1]}-${p[0]}`;
      }
      dateEl.textContent = rawDate || '-';
    }

    var classEl = document.getElementById(`print-${copy}-class`);
    if (classEl) classEl.textContent = row.class || '-';

    var catEl = document.getElementById(`print-${copy}-category`);
    if (catEl) catEl.textContent = row.category || '-';

    var idEl = document.getElementById(`print-${copy}-id`);
    if (idEl) idEl.textContent = row.fyid || '-';

    var bodyEl = document.getElementById(`print-${copy}-table-body`);
    if (bodyEl) {
      bodyEl.innerHTML = 
        '<tr class="border-b border-black">' +
          '<td class="border border-black p-1 text-center font-bold text-[10px]">1</td>' +
          '<td class="border border-black p-1 font-semibold text-[10px]">' + escapeHtml(displayDesc) + '</td>' +
          '<td class="border border-black p-1 text-center text-[10px]">' + escapeHtml(row.my || '-') + '</td>' +
          '<td class="border border-black p-1 text-center font-bold text-[10px]">' + escapeHtml(row.method || '-') + '</td>' +
          '<td class="border border-black p-1 text-right font-bold text-[10px]">' + Number(displayAmount).toLocaleString('en-US') + ' MMK</td>' +
        '</tr>';
    }

    var totEl = document.getElementById(`print-${copy}-total`);
    if (totEl) totEl.textContent = Number(displayAmount).toLocaleString('en-US') + " MMK";
  });

  window.print();
}

// 💡 EXPOSE GLOBALLY
window.loadIncomeData = loadIncomeData;
window.onSearchInputIncome = onSearchInputIncome;
window.clearDateFilterIncome = clearDateFilterIncome;
window.onStudentIdOrFYChangeIncome = onStudentIdOrFYChangeIncome;
window.onAccountNameOrCategoryChangeIncome = onAccountNameOrCategoryChangeIncome;
window.toggleSplitPaymentIncome = toggleSplitPaymentIncome;
window.openAddModalIncome = openAddModalIncome;
window.closeIncomeModal = closeIncomeModal;
window.saveIncomeForm = saveIncomeForm;
window.editIncomeEntry = editIncomeEntry;
window.deleteIncomeEntry = deleteIncomeEntry;
window.changePageIncome = changePageIncome;
window.exportToCSVIncome = exportToCSVIncome;
window.printInvoice = printInvoice;
