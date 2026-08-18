/**
 * GOLDEN ERP SYSTEM - OFFICE EXPENSE & INVENTORY MODULE 
 * File: js/office-kit.js 
 * 💡 Features: Cloudflare D1 Database Sync, Direct Uniform Inventory Binding, Profit Calculator & Multi-Book Context Engine
 */

window.OfficeState = {
  page: 1,
  limit: 50,
  totalRows: 0,
  activeData: [],
  searchVal: '',
  stats: { totalIncome: 0, totalExpense: 0, balance: 0 },
  uniformProducts: []
};

window.currentExpenseBook = 'office'; // 'office' | 'kitchen'

var searchTimeoutOffice = null;
var isOfficeSubmitting = false; // 💡 Double Submit Protection Flag

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
 * 💡 Extract Product ID from Description String
 */
function extractProductIdFromDescription(description) {
  if (!description) return null;
  var str = String(description).trim();
  
  var match = str.match(/PID\s*(\d+)/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  
  var pidMatch = str.match(/^([A-Z0-9]+)\s/);
  if (pidMatch && pidMatch[1]) {
    return pidMatch[1];
  }
  
  var numMatch = str.match(/^(\d+)\s/);
  if (numMatch && numMatch[1]) {
    return numMatch[1];
  }
  
  return null;
}

/**
 * 💡 Switch between Office and Kitchen Expense Books
 */
function switchExpenseBook(bookType) {
  window.currentExpenseBook = bookType ? String(bookType).toLowerCase() : 'office';
  window.OfficeState.page = 1;
  loadOfficeData(false);
}

/**
 * 💡 Get Context for Expense Books (Office / Kitchen)
 */
function getExpenseBookContext() {
  var isKitchen = (window.currentExpenseBook === 'kitchen' || window.AppState?.currentModule === 'kitchen');
  return {
    isKitchen: isKitchen,
    bookName: isKitchen ? 'Kitchen Exp Book' : 'Office Exp Book',
    dropdownKey: isKitchen ? 'kitchenExpBook' : 'officeExpBook',
    label: isKitchen ? 'Kitchen' : 'Office'
  };
}

/**
 * 💡 Keeps the "+ Add ... Entry" toolbar button in sync with the current book
 */
function updateOfficeAddButtonLabel() {
  var ctx = getExpenseBookContext();
  var labelEl = document.getElementById('office-add-btn-label');
  if (labelEl) labelEl.innerText = 'Add ' + ctx.label + ' Entry';
}

/**
 * 💡 Helper to normalize Uniform Item Properties
 */
function getUniformItemProps(p) {
  if (!p) return { id: '', name: '', type: '', size: '', unitPrice: 0, sellingPrice: 0, stock: 0, uniqueKey: '' };
  
  var pid = p.product_id ?? p.productId ?? p.id ?? '';
  var pname = p.product_name ?? p.productName ?? '';
  var ptype = p.type ?? '';
  var psize = p.size ?? '';
  var uPrice = parseCleanNum(p.unit_price ?? p.unitPrice ?? 0);
  var sPrice = parseCleanNum(p.selling_price ?? p.sellingPrice ?? 0);

  var openStock = parseCleanNum(p.opening_stock ?? p.openingStock ?? 0);
  var sellUnit = parseCleanNum(p.selling_unit ?? p.sellingUnit ?? 0);
  var cQty = (p.current_qty !== undefined && p.current_qty !== null) 
    ? parseCleanNum(p.current_qty) 
    : ((p.currentQty !== undefined && p.currentQty !== null) ? parseCleanNum(p.currentQty) : (openStock - sellUnit));

  var uniqueKey = p.uniqueid || p.uniqueId || (String(pid).trim() + '|' + String(psize).trim() + '|' + String(ptype).trim());

  return {
    id: String(pid).trim(),
    name: String(pname).trim(),
    type: String(ptype).trim(),
    size: String(psize).trim(),
    unitPrice: uPrice,
    sellingPrice: sPrice,
    stock: cQty,
    uniqueKey: uniqueKey
  };
}

/**
 * 💡 Single Source of Truth for Uniform Products
 */
function getAvailableUniformProducts() {
  if (window.OfficeState.uniformProducts && window.OfficeState.uniformProducts.length > 0) {
    return window.OfficeState.uniformProducts;
  }
  if (window.UniformState && window.UniformState.activeData && window.UniformState.activeData.length > 0) {
    window.OfficeState.uniformProducts = window.UniformState.activeData;
    return window.UniformState.activeData;
  }
  return [];
}

/**
 * 💡 Helper to build Options HTML for Product ID Select Dropdown
 */
function buildUniformDropdownOptions(list) {
  var select = document.getElementById('office-product-id');
  if (!select) return;

  if (!list || list.length === 0) {
    select.innerHTML = '<option value="">-- No Uniform Products Found --</option>';
    return;
  }

  var html = '<option value="">-- Select Product ID --</option>';
  list.forEach(function(p) {
    var item = getUniformItemProps(p);
    if (item.id) {
      var sizeStr = item.size ? ' (' + item.size + ')' : '';
      var typeStr = item.type ? ' - ' + item.type : '';
      html += '<option value="' + escapeHtml(item.uniqueKey) + '" data-pid="' + escapeHtml(item.id) + '">' + escapeHtml(item.id) + ' - ' + escapeHtml(item.name) + escapeHtml(typeStr) + escapeHtml(sizeStr) + '</option>';
    }
  });
  select.innerHTML = html;
}

/**
 * 💡 Fetch Uniform Products List for Dropdown
 */
async function fetchUniformProductsListOffice() {
  var select = document.getElementById('office-product-id');
  if (!select) return;

  var localProducts = getAvailableUniformProducts();
  if (localProducts.length > 0) {
    buildUniformDropdownOptions(localProducts);
    return;
  }

  select.innerHTML = '<option value="">Loading Products from Uniform Ledger...</option>';
  try {
    var res = null;
    if (typeof callApi === 'function') {
      res = await callApi('getUniformData', { page: 1, limit: 1000, forceRefresh: true }, 'GET');
    }

    if (res && res.data && Array.isArray(res.data) && res.data.length > 0) {
      window.OfficeState.uniformProducts = res.data;
      buildUniformDropdownOptions(res.data);
    } else {
      select.innerHTML = '<option value="">-- No Uniform Products Found --</option>';
    }
  } catch (err) {
    console.warn("Failed to fetch uniform products for office kit:", err);
    select.innerHTML = '<option value="">-- Error Loading Products --</option>';
  }
}

/**
 * 💡 Strict Filter Function for Office Expenses
 */
function filterOfficeData(list, searchVal, fromDate, toDate) {
  var safeList = Array.isArray(list) ? list : [];
  return safeList.filter(function(row) {
    if (typeof window.isDateInRange === 'function') {
      if (!window.isDateInRange(row.date, fromDate, toDate)) return false;
    }

    if (!searchVal || !searchVal.trim()) return true;
    var q = searchVal.trim().toLowerCase();
    var desc = String(row.description || '').toLowerCase();
    var cat = String(row.category || '').toLowerCase();
    var debit = String(row.debit || '');
    var credit = String(row.credit || '');
    var vrNo = String(row.vrNo || row.vr_no || '').toLowerCase();

    return desc.includes(q) || cat.includes(q) || debit.includes(q) || credit.includes(q) || vrNo.includes(q);
  });
}

function clearDateFilterOffice() {
  var fromEl = document.getElementById('office-date-from');
  var toEl = document.getElementById('office-date-to');
  if (fromEl) fromEl.value = '';
  if (toEl) toEl.value = '';
  onSearchInputOffice();
}

/**
 * 💡 Populate Dropdown Options from Config
 */
async function populateDropdownsOffice() {
  var ctx = getExpenseBookContext();
  var def = (window.DROPDOWNS && window.DROPDOWNS[ctx.dropdownKey]) || {};

  var catSelect = document.getElementById('office-category');
  if (catSelect && def.category) {
    catSelect.innerHTML = def.category.map(function(c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
  }

  var methodSelect = document.getElementById('office-method');
  if (methodSelect && def.method) {
    methodSelect.innerHTML = def.method.map(function(m) { return '<option value="' + m + '">' + m + '</option>'; }).join('');
  }

  var transSelect = document.getElementById('office-transfer');
  if (transSelect) {
    if (def.transfer) {
      transSelect.innerHTML = '<option value="">-- No Transfer --</option>' +
        def.transfer.map(function(t) { return '<option value="' + t + '">' + t + '</option>'; }).join('');
    } else {
      transSelect.innerHTML = '<option value="">-- No Transfer --</option>';
    }
  }

  await onCategoryChangeOffice();
}

/**
 * 💡 Dynamic Form Controls based on Selected Category
 */
async function onCategoryChangeOffice() {
  var catEl = document.getElementById('office-category');
  var category = catEl ? catEl.value : '';

  var prodContainer = document.getElementById('office-product-container');
  var profitPreviewContainer = document.getElementById('office-profit-preview-container');
  var qtyPriceContainer = document.getElementById('office-qty-price-container');
  var liabilitiesContainer = document.getElementById('office-liabilities-container');

  var debitInput = document.getElementById('office-debit');
  var creditInput = document.getElementById('office-credit');
  var methodSelect = document.getElementById('office-method');
  var transSelect = document.getElementById('office-transfer');
  var liabilitiesInput = document.getElementById('office-liabilities');

  var ctx = getExpenseBookContext();
  var isUniform = (category === "Advance Uniform" || category === "Advance Unifrom");
  var isLiabilities = (category === "Liabilities") && !ctx.isKitchen;

  if (isUniform) {
    if (prodContainer) prodContainer.classList.remove('hidden');
    if (profitPreviewContainer) profitPreviewContainer.classList.remove('hidden');
    if (qtyPriceContainer) qtyPriceContainer.classList.remove('hidden');
    if (liabilitiesContainer) liabilitiesContainer.classList.add('hidden');

    if (debitInput) debitInput.disabled = false;
    if (creditInput) creditInput.disabled = false;
    if (methodSelect) methodSelect.disabled = false;
    if (transSelect) transSelect.disabled = false;

    await fetchUniformProductsListOffice();
    onProductChangeOffice();
  } 
  else if (isLiabilities) {
    if (prodContainer) prodContainer.classList.add('hidden');
    if (profitPreviewContainer) profitPreviewContainer.classList.add('hidden');
    if (qtyPriceContainer) qtyPriceContainer.classList.add('hidden');
    if (liabilitiesContainer) liabilitiesContainer.classList.remove('hidden');

    if (debitInput) { debitInput.value = 0; debitInput.disabled = true; }
    if (creditInput) { creditInput.value = 0; creditInput.disabled = true; }
    if (methodSelect) methodSelect.disabled = true;
    if (transSelect) { transSelect.value = ""; transSelect.disabled = true; }
  } 
  else {
    if (prodContainer) prodContainer.classList.add('hidden');
    if (profitPreviewContainer) profitPreviewContainer.classList.add('hidden');
    if (qtyPriceContainer) qtyPriceContainer.classList.add('hidden');
    if (liabilitiesContainer) liabilitiesContainer.classList.add('hidden');

    if (debitInput) debitInput.disabled = false;
    if (creditInput) creditInput.disabled = false;
    if (methodSelect) methodSelect.disabled = false;
    if (transSelect) transSelect.disabled = false;
    if (liabilitiesInput) liabilitiesInput.value = 0;
  }
}

/**
 * 💡 Auto-fill Description on Transfer Selection
 */
function onTransferTargetChangeOffice() {
  var transSelect = document.getElementById('office-transfer');
  var descInput = document.getElementById('office-description');
  if (!transSelect || !descInput) return;

  var targetBook = transSelect.value;
  if (targetBook && targetBook !== 'None' && targetBook !== '-') {
    descInput.value = '[Transfer to ' + targetBook + '] ';
  }
}

/**
 * 💡 Handle Product Selection for Advance Uniform
 */
function onProductChangeOffice() {
  var prodEl = document.getElementById('office-product-id');
  var selectedKey = prodEl ? prodEl.value : '';
  var stockBadge = document.getElementById('office-stock-badge');
  var unitEl = document.getElementById('office-unit');
  var unit = parseCleanNum(unitEl ? unitEl.value : 1) || 1;

  var productsList = getAvailableUniformProducts();

  if (selectedKey && productsList.length > 0) {
    var rawProd = productsList.find(function(p) {
      var item = getUniformItemProps(p);
      return item.uniqueKey.toLowerCase() === String(selectedKey).trim().toLowerCase() ||
             item.id.toLowerCase() === String(selectedKey).trim().toLowerCase();
    });

    if (rawProd) {
      var prod = getUniformItemProps(rawProd);
      var descEl = document.getElementById('office-description');
      if (descEl) {
        descEl.value = (prod.id + ' ' + prod.name + ' ' + prod.type + ' ' + prod.size + ' - ' + unit + 'Nos').replace(/\s+/g, ' ').trim();
      }

      var unitPriceEl = document.getElementById('office-unit-price');
      if (unitPriceEl && parseCleanNum(unitPriceEl.value) === 0) {
        unitPriceEl.value = prod.unitPrice || 0;
      }

      if (stockBadge) {
        stockBadge.innerText = 'Stock: ' + prod.stock;
        stockBadge.classList.remove('hidden');
      }

      calculateDebitOffice();
    }
  } else {
    if (stockBadge) stockBadge.classList.add('hidden');
    var profitDisplayEl = document.getElementById('office-calculated-profit');
    if (profitDisplayEl) profitDisplayEl.innerText = "0 MMK";
  }
}

/**
 * 💡 Debit & Uniform Profit Preview Calculator
 */
function calculateDebitOffice() {
  var categoryEl = document.getElementById('office-category');
  var category = categoryEl ? categoryEl.value : '';

  if (category === "Advance Uniform" || category === "Advance Unifrom") {
    var prodEl = document.getElementById('office-product-id');
    var selectedKey = prodEl ? prodEl.value : '';
    var unitEl = document.getElementById('office-unit');
    var unit = parseCleanNum(unitEl ? unitEl.value : 0);
    var unitPrice = parseCleanNum(document.getElementById('office-unit-price')?.value);
    var creditVal = parseCleanNum(document.getElementById('office-credit')?.value);

    if (creditVal === 0 && document.getElementById('office-debit')) {
      document.getElementById('office-debit').value = unit * unitPrice;
    }

    var productsList = getAvailableUniformProducts();

    if (selectedKey && productsList.length > 0) {
      var rawProd = productsList.find(function(p) {
        var item = getUniformItemProps(p);
        return item.uniqueKey.toLowerCase() === String(selectedKey).trim().toLowerCase() ||
               item.id.toLowerCase() === String(selectedKey).trim().toLowerCase();
      });

      if (rawProd) {
        var prod = getUniformItemProps(rawProd);
        var descEl = document.getElementById('office-description');
        if (descEl && descEl.value.includes('-')) {
          var baseDesc = descEl.value.split('-')[0].trim();
          descEl.value = baseDesc + ' - ' + unit + 'Nos';
        }

        var sellingPrice = prod.sellingPrice;
        var profitPerUnit = sellingPrice - unitPrice;
        var totalProfit = unit * profitPerUnit;

        var profitDisplayEl = document.getElementById('office-calculated-profit');
        if (profitDisplayEl) {
          profitDisplayEl.innerText = Number(totalProfit || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " MMK";
        }
      }
    }
  }
}

/**
 * 💡 Load Expense Data from Cloudflare D1 Backend
 */
async function loadOfficeData(isSilent, forceRefresh) {
  var state = window.OfficeState;
  var ctx = getExpenseBookContext();
  var bookName = ctx.bookName;

  updateOfficeAddButtonLabel();

  try {
    if (!isSilent && typeof toggleLoading === 'function') {
      toggleLoading(true);
    }

    var response = await callApi('getExpenseData', {
      bookName: bookName,
      page: state.page,
      limit: state.limit,
      searchVal: state.searchVal,
      forceRefresh: forceRefresh
    });

    if (response && response.data) {
      state.activeData = response.data;
      state.totalRows = response.totalRows || response.data.length || 0;
      state.stats = response.stats || { totalIncome: 0, totalExpense: 0, balance: 0 };

      updateStatsOffice();
      renderOfficeTable();
      updatePaginationOffice();
    }
  } catch (err) {
    console.error("Error loading Expense data:", err);
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') {
      toggleLoading(false);
    }
  }
}

function updateStatsOffice() {
  var stats = window.OfficeState.stats;
  var setT = function(id, val) { var el = document.getElementById(id); if (el) el.innerText = val; };

  setT('off-total-income', Number(stats.totalIncome || 0).toLocaleString('en-US') + " MMK");
  setT('off-total-expense', Number(stats.totalExpense || 0).toLocaleString('en-US') + " MMK");
  setT('off-balance', Number(stats.balance || 0).toLocaleString('en-US') + " MMK");
  setT('off-entries-count', window.OfficeState.totalRows.toLocaleString('en-US'));
}

/**
 * 💡 Render Office Table Grid Rows
 */
function renderOfficeTable() {
  var tableBody = document.getElementById('office-table-body');
  if (!tableBody) return;

  var rawData = window.OfficeState.activeData || [];
  var searchVal = window.OfficeState.searchVal || '';

  var fromEl = document.getElementById('office-date-from');
  var toEl = document.getElementById('office-date-to');
  var fromDate = fromEl ? fromEl.value : '';
  var toDate = toEl ? toEl.value : '';

  var data = filterOfficeData(rawData, searchVal, fromDate, toDate);
  var ctx = getExpenseBookContext();

  if (!data || data.length === 0) {
    var emptyColspan = ctx.isKitchen ? 15 : 16;
    tableBody.innerHTML = '<tr><td colspan="' + emptyColspan + '" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော စာရင်း မရှိပါ။</td></tr>';
    toggleOfficeLiabilitiesColumn();
    return;
  }

  var userRole = (window.AppState ? window.AppState.currentUserRole : 'Viewer');
  var isViewer = (userRole === "Viewer");

  tableBody.innerHTML = data.map(function(row) {
    var displayDate = row.date || "";
    if (displayDate) {
      var parts = displayDate.split('-');
      if (parts.length === 3) displayDate = parts[2] + '-' + parts[1] + '-' + parts[0];
    }

    var isLocked = Boolean(row.isLocked || isViewer);
    var lockClass = isLocked ? "opacity-30 cursor-not-allowed pointer-events-none" : "hover:text-white";
    var lockTitle = row.isLocked ? "Locked (Must be edited from Source Book)" : "";
    var disabledAttr = isLocked ? 'disabled' : '';

    var catBadge = typeof window.formatCategoryBadgeHtml === 'function' ? window.formatCategoryBadgeHtml(row.category) : escapeHtml(row.category);
    var debitStr = row.debit > 0 ? Number(row.debit).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';
    var creditStr = row.credit > 0 ? Number(row.credit).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : '-';
    var balStr = Number(row.balances || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    var liabStr = Number(row.liabilities || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});
    var priceStr = Number(row.unitPrice || 0).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2});

    var displayNo = Math.floor(parseCleanNum(row.no || row.id)) || 1;

    return '<tr class="hover:bg-slate-800/20 text-slate-300">' +
        '<td class="text-center font-mono font-semibold text-slate-500 py-3 px-2">' + displayNo + '</td>' +
        '<td class="font-mono text-xs py-3 px-2">' + escapeHtml(displayDate) + '</td>' +
        '<td class="py-3 px-2">' + catBadge + '</td>' +
        '<td class="min-w-[280px] max-w-md truncate py-3 px-2" title="' + escapeHtml(row.description) + '">' + escapeHtml(row.description) + '</td>' +
        '<td class="text-right font-mono py-3 px-2">' + (row.unit || '0') + '</td>' +
        '<td class="text-right font-mono py-3 px-2">' + priceStr + '</td>' +
        '<td class="font-bold py-3 px-2">' + escapeHtml(row.method || '-') + '</td>' +
        '<td class="text-right text-emerald-400 font-mono font-semibold py-3 px-2">' + debitStr + '</td>' +
        '<td class="text-right text-rose-400 font-mono font-semibold py-3 px-2">' + creditStr + '</td>' +
        '<td class="text-right text-slate-400 font-mono font-bold py-3 px-2">' + balStr + '</td>' +
        '<td class="office-liab-col text-right text-rose-400 font-mono font-bold py-3 px-2">' + liabStr + '</td>' +
        '<td class="text-xs text-indigo-400 py-3 px-2">' + escapeHtml(row.transfer || '-') + '</td>' +
        '<td class="font-mono text-xs text-slate-400 py-3 px-2">' + escapeHtml(row.vrNo || '-') + '</td>' +
        '<td class="font-mono text-xs py-3 px-2">' + escapeHtml(row.my || '-') + '</td>' +
        '<td class="font-mono text-xs font-bold text-indigo-300 py-3 px-2">' + escapeHtml(row.fy || '-') + '</td>' +
        '<td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">' +
          '<div class="flex items-center justify-center gap-3">' +
            '<button onclick="editOfficeEntry(\'' + row.uniqueId + '\')" class="text-indigo-400 hover:text-indigo-300 transition ' + lockClass + '" title="' + lockTitle + '" ' + disabledAttr + '>' +
              '<i class="fa-solid fa-pen-to-square"></i>' +
            '</button>' +
            '<button onclick="deleteOfficeEntry(\'' + row.uniqueId + '\')" class="text-rose-400 hover:text-rose-300 transition ' + lockClass + '" title="' + lockTitle + '" ' + disabledAttr + '>' +
              '<i class="fa-solid fa-trash"></i>' +
            '</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
  }).join('');

  toggleOfficeLiabilitiesColumn();
}

/**
 * 💡 Show/Hide the LIABILITIES column entirely for Kitchen Exp Book
 */
function toggleOfficeLiabilitiesColumn() {
  var ctx = getExpenseBookContext();
  var show = !ctx.isKitchen;

  var th = document.getElementById('office-th-liabilities');
  if (th) th.classList.toggle('hidden', !show);

  var cells = document.querySelectorAll('#office-table-body .office-liab-col');
  cells.forEach(function(td) {
    td.classList.toggle('hidden', !show);
  });
}

function updatePaginationOffice() {
  var state = window.OfficeState;
  var info = document.getElementById('off-pagination-info');
  if (info) {
    var start = state.totalRows === 0 ? 0 : (state.page - 1) * state.limit + 1;
    var end = Math.min(state.page * state.limit, state.totalRows);
    info.innerHTML = 'Showing <span class="text-indigo-400 font-extrabold">' + start + '</span> to <span class="text-indigo-400 font-extrabold">' + end + '</span> of <span class="text-indigo-400 font-extrabold">' + state.totalRows + '</span> entries';
  }

  var prevBtn = document.getElementById('off-btn-prev');
  if (prevBtn) prevBtn.disabled = (state.page === 1);

  var nextBtn = document.getElementById('off-btn-next');
  if (nextBtn) nextBtn.disabled = (state.page * state.limit >= state.totalRows);
}

function changePageOffice(dir) {
  var state = window.OfficeState;
  if (dir === -1 && state.page > 1) {
    state.page--;
    loadOfficeData(false);
  } else if (dir === 1 && (state.page * state.limit) < state.totalRows) {
    state.page++;
    loadOfficeData(false);
  }
}

function onSearchInputOffice() {
  clearTimeout(searchTimeoutOffice);
  searchTimeoutOffice = setTimeout(function() {
    var input = document.getElementById('office-search');
    window.OfficeState.searchVal = input ? input.value.trim() : '';
    window.OfficeState.page = 1;
    renderOfficeTable();
  }, 200);
}

function bindModalOfficeListeners() {
  var unitInput = document.getElementById('office-unit');
  if (unitInput) {
    unitInput.oninput = onProductChangeOffice;
  }

  var unitPriceInput = document.getElementById('office-unit-price');
  if (unitPriceInput) {
    unitPriceInput.oninput = calculateDebitOffice;
  }

  var prodSelect = document.getElementById('office-product-id');
  if (prodSelect) {
    prodSelect.onchange = onProductChangeOffice;
  }
}

async function openAddModalOffice() {
  var form = document.getElementById('office-form');
  if (form) form.reset();

  var uidEl = document.getElementById('office-uniqueId');
  if (uidEl) uidEl.value = "";

  var dateEl = document.getElementById('office-date');
  if (dateEl) {
    var now = new Date();
    var yyyy = now.getFullYear();
    var mm = String(now.getMonth() + 1).padStart(2, '0');
    var dd = String(now.getDate()).padStart(2, '0');
    dateEl.value = yyyy + '-' + mm + '-' + dd;
  }

  var titleEl = document.getElementById('office-form-title');
  if (titleEl) titleEl.innerText = 'Add ' + getExpenseBookContext().label + ' Expense Entry';

  await populateDropdownsOffice();
  bindModalOfficeListeners();

  var modalEl = document.getElementById('office-modal');
  if (modalEl) modalEl.classList.remove('hidden');
}

function closeOfficeModal() {
  var modalEl = document.getElementById('office-modal');
  if (modalEl) modalEl.classList.add('hidden');
}

function parseLiabilityAmount(val) {
  if (!val) return 0;
  var str = String(val).trim();
  var isNeg = (str.includes('(') && str.includes(')')) || str.startsWith('-');
  var num = parseCleanNum(str);
  return isNeg ? -num : num;
}

/**
 * 💡 Save Office / Kitchen Form with Double Submit Lock
 */
async function saveOfficeForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (isOfficeSubmitting) return;
  isOfficeSubmitting = true;

  var uniqueId = document.getElementById('office-uniqueId')?.value || '';
  var isAdd = (!uniqueId);
  var category = document.getElementById('office-category')?.value || '';
  var prodEl = document.getElementById('office-product-id');
  var selectedKey = prodEl ? prodEl.value : '';
  
  var selectedOpt = prodEl && prodEl.selectedIndex >= 0 ? prodEl.options[prodEl.selectedIndex] : null;
  var cleanPid = selectedOpt ? (selectedOpt.getAttribute('data-pid') || selectedKey) : selectedKey;

  var unit = parseCleanNum(document.getElementById('office-unit')?.value);
  var unitPrice = parseCleanNum(document.getElementById('office-unit-price')?.value);

  var productsList = getAvailableUniformProducts();
  var calculatedProfit = 0;

  if ((category === "Advance Uniform" || category === "Advance Unifrom") && selectedKey && productsList.length > 0) {
    var rawProd = productsList.find(function(p) {
      var item = getUniformItemProps(p);
      return item.uniqueKey.toLowerCase() === String(selectedKey).trim().toLowerCase() ||
             item.id.toLowerCase() === String(selectedKey).trim().toLowerCase();
    });
    if (rawProd) {
      var prod = getUniformItemProps(rawProd);
      var sellingPrice = prod.sellingPrice;
      var profitPerUnit = sellingPrice - unitPrice;
      calculatedProfit = unit * profitPerUnit;
      cleanPid = prod.id;
    }
  }

  var entry = {
    uniqueId: uniqueId,
    date: document.getElementById('office-date')?.value || '',
    category: category,
    id: cleanPid,
    unit: unit,
    unitPrice: unitPrice,
    profit: calculatedProfit,
    method: document.getElementById('office-method')?.value || 'Cash',
    debit: parseCleanNum(document.getElementById('office-debit')?.value),
    credit: parseCleanNum(document.getElementById('office-credit')?.value),
    liabilities: parseLiabilityAmount(document.getElementById('office-liabilities')?.value),
    transfer: document.getElementById('office-transfer')?.value || '',
    description: document.getElementById('office-description')?.value || '',
    bookName: getExpenseBookContext().bookName,
    createdBy: (window.AppState && window.AppState.currentUser) ? window.AppState.currentUser : "Admin"
  };

  closeOfficeModal();
  var action = isAdd ? 'saveExpenseEntry' : 'updateExpenseEntry';
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    var response = await callApi(action, entry);

    if (response && response.success) {
      if (typeof showToast === 'function') {
        var label = getExpenseBookContext().label;
        showToast("SUCCESS", isAdd ? (label + " Expense စာရင်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။") : (label + " Expense စာရင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။"));
      }
      
      if (category === "Advance Uniform" || category === "Advance Unifrom") {
        window.OfficeState.uniformProducts = [];
        if (typeof window.loadUniformData === 'function') {
          window.loadUniformData(true);
        }
      }

      loadOfficeData(true, true);
    } else {
      if (typeof showToast === 'function') showToast("ERROR", "မအောင်မြင်ပါ: " + (response ? response.message : ""));
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာချိတ်ဆက်မှု အမှား: " + err.message);
  } finally {
    isOfficeSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 EDIT OFFICE ENTRY (Race Condition & Dropdown Matching Fixed)
 */
async function editOfficeEntry(uniqueId) {
  var row = window.OfficeState.activeData.find(function(item) { return item.uniqueId === uniqueId; });
  if (!row) {
    if (typeof showToast === 'function') showToast("ERROR", "မူရင်းဒေတာကို ရှာမတွေ့ပါ။");
    return;
  }

  await openAddModalOffice();

  var uidEl = document.getElementById('office-uniqueId');
  if (uidEl) uidEl.value = row.uniqueId;

  var dateEl = document.getElementById('office-date');
  if (dateEl) dateEl.value = row.date;

  var catEl = document.getElementById('office-category');
  if (catEl) {
    catEl.value = row.category;
    await onCategoryChangeOffice();
  }

  var prodSelect = document.getElementById('office-product-id');
  if (prodSelect) {
    var extractedPid = extractProductIdFromDescription(row.description);
    var pidToSearch = (row.productId && String(row.productId).trim()) ? String(row.productId).trim() : extractedPid;

    if (pidToSearch && pidToSearch.trim()) {
      pidToSearch = pidToSearch.replace(/^PID\s*/i, '').trim();
      var searchTerm = pidToSearch.toLowerCase();

      var matchingOpt = Array.from(prodSelect.options).find(function(opt) {
        var optValue = (opt.value || '').toLowerCase();
        var optDataPid = (opt.getAttribute('data-pid') || '').toLowerCase();
        var optText = (opt.text || '').toLowerCase();

        return optDataPid === searchTerm || optValue.includes(searchTerm) || optText.includes(searchTerm);
      });

      if (matchingOpt) {
        prodSelect.value = matchingOpt.value;
      }
    }
  }

  var unitEl = document.getElementById('office-unit');
  if (unitEl) unitEl.value = row.unit || 1;

  var unitPriceEl = document.getElementById('office-unit-price');
  if (unitPriceEl) unitPriceEl.value = row.unitPrice || 0;

  onProductChangeOffice();

  var methodEl = document.getElementById('office-method');
  if (methodEl) methodEl.value = row.method || "Cash";

  var debitEl = document.getElementById('office-debit');
  if (debitEl) debitEl.value = row.debit || 0;

  var creditEl = document.getElementById('office-credit');
  if (creditEl) creditEl.value = row.credit || 0;

  var liabEl = document.getElementById('office-liabilities');
  if (liabEl) liabEl.value = row.liabilities || 0;

  var transferEl = document.getElementById('office-transfer');
  if (transferEl) transferEl.value = row.transfer || "";

  var descEl = document.getElementById('office-description');
  if (descEl) descEl.value = row.description || "";

  var titleEl = document.getElementById('office-form-title');
  if (titleEl) titleEl.innerText = 'Edit ' + getExpenseBookContext().label + ' Expense Entry';
}

async function deleteOfficeEntry(uniqueId) {
  var ctx = getExpenseBookContext();
  if (confirm('ဤ ' + ctx.label + ' Expense စာရင်းအား အပြီးတိုင် ဖျက်သိမ်းလိုပါသလား။')) {
    if (typeof toggleLoading === 'function') toggleLoading(true);

    try {
      var response = await callApi('deleteExpenseEntry', {
        uniqueId: uniqueId,
        bookName: ctx.bookName
      });

      if (response && response.success) {
        if (typeof showToast === 'function') showToast("SUCCESS", "စာရင်းအား အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။");
        loadOfficeData(true, true);
      } else {
        if (typeof showToast === 'function') showToast("ERROR", "ဖျက်သိမ်းမှု မအောင်မြင်ပါ: " + (response ? response.message : ""));
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာချိတ်ဆက်မှု အမှား- " + err.message);
    } finally {
      if (typeof toggleLoading === 'function') toggleLoading(false);
    }
  }
}

function exportToCSVOffice() {
  var data = window.OfficeState.activeData;
  if (!data || data.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့်စာရင်းမျှ မရှိပါ။");
    return;
  }

  var csv = "NO,DATE,CATEGORY,DESCRIPTION,UNIT,UNIT PRICE,METHOD,DEBIT,CREDIT,BALANCES,LIABILITIES,TRANSFER,VR NO,MY,FY,UNIQUEID\n";
  data.forEach(function(row) {
    var desc = '"' + (row.description || '').replace(/"/g, '""') + '"';
    var cat = '"' + (row.category || '').replace(/"/g, '""') + '"';
    csv += (row.no || '') + ',' + (row.date || '') + ',' + cat + ',' + desc + ',' + (row.unit || 0) + ',' + (row.unitPrice || 0) + ',' + (row.method || '') + ',' + (row.debit || 0) + ',' + (row.credit || 0) + ',' + (row.balances || 0) + ',' + (row.liabilities || 0) + ',' + (row.transfer || '') + ',' + (row.vrNo || '') + ',' + (row.my || '') + ',' + (row.fy || '') + ',' + (row.uniqueId || '') + '\n';
  });

  var blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  var link = document.createElement("a");
  var url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", 'office_expense_' + new Date().toISOString().slice(0,10) + '.csv');
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 EXPOSE GLOBALLY
window.extractProductIdFromDescription = extractProductIdFromDescription;
window.loadOfficeData = loadOfficeData;
window.openAddModalOffice = openAddModalOffice;
window.closeOfficeModal = closeOfficeModal;
window.saveOfficeForm = saveOfficeForm;
window.editOfficeEntry = editOfficeEntry;
window.deleteOfficeEntry = deleteOfficeEntry;
window.exportToCSVOffice = exportToCSVOffice;
window.onCategoryChangeOffice = onCategoryChangeOffice;
window.onTransferTargetChangeOffice = onTransferTargetChangeOffice;
window.onProductChangeOffice = onProductChangeOffice;
window.calculateDebitOffice = calculateDebitOffice;
window.onSearchInputOffice = onSearchInputOffice;
window.clearDateFilterOffice = clearDateFilterOffice;
window.changePageOffice = changePageOffice;
window.switchExpenseBook = switchExpenseBook;
window.getExpenseBookContext = getExpenseBookContext;
window.updateOfficeAddButtonLabel = updateOfficeAddButtonLabel;
window.fetchUniformProductsListOffice = fetchUniformProductsListOffice;
window.toggleOfficeLiabilitiesColumn = toggleOfficeLiabilitiesColumn;
