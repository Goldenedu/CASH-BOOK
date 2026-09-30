/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN INVENTORY & PURCHASES CONTROLLER
 * File: js/canteen/canteen-inventory.js
 * ==============================================================================
 */

async function loadItemsCatalog(isManualRefresh) {
  if (navigator.onLine) {
    try {
      const res = await callApi('getPosItems', { onlyActive: true, _t: Date.now() }, 'POST');
      if (res && res.success) {
        gItemsCache = res.data || [];
        await dbSaveItems(gItemsCache);
        if (isManualRefresh) showToast("SUCCESS", `ပစ္စည်း (${gItemsCache.length}) မျိုး အသစ်ရယူပြီးပါပြီ။`);
        return;
      }
    } catch (e) {
      console.warn("[Catalog] Online load failed, falling back to IndexedDB...");
    }
  }
  gItemsCache = await dbGetAllItems();
}

function onSearchStockDebounced() {
  clearTimeout(gStockSearchTimeout);
  gStockSearchTimeout = setTimeout(() => { loadStockInventory(1); }, 250);
}

function changeStockPage(delta) {
  loadStockInventory(gStockPage + delta);
}

async function loadStockInventory(page = 1) {
  gStockPage = Math.max(1, page);
  const searchVal = document.getElementById('stock-search')?.value.trim() || '';
  const category = document.getElementById('stock-category-filter')?.value || '';
  const stockStatus = document.getElementById('stock-status-filter')?.value || 'all';

  try {
    const res = await callApi('getPosStockInventory', {
      searchVal, category, stockStatus,
      page: gStockPage, limit: gStockLimit, _t: Date.now()
    }, 'POST');

    if (res && res.success) {
      const items = res.data || [];
      const summary = res.summary || {};
      gStockInventoryData = items;
      gStockTotalRows = res.totalRows || 0;

      document.getElementById('stock-total-items').textContent = `${summary.totalItems || 0} မျိုး`;
      document.getElementById('stock-total-qty').textContent = `${Number(summary.totalStockQty || 0).toLocaleString()} ခု`;
      document.getElementById('stock-total-val').textContent = `${Number(summary.totalStockValue || 0).toLocaleString()} MMK`;
      document.getElementById('stock-alert-count').textContent = `${(summary.outOfStockCount || 0) + (summary.lowStockCount || 0)} မျိုး`;

      const tbody = document.getElementById('stock-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ပစ္စည်း မရှိပါ။</td></tr>`;
      } else {
        const canManageStock = (gSession?.role === 'canteen_admin' || gSession?.role === 'Owner' || gSession?.role === 'Admin');

        items.forEach((item, idx) => {
          const displayNo = gStockTotalRows - ((gStockPage - 1) * gStockLimit + idx);

          let badgeHtml = '';
          if (item.currentStock <= 0) {
            badgeHtml = '<span class="px-2 py-0.5 rounded text-[9px] font-black bg-rose-500/20 text-rose-500 border border-rose-500/30">OUT OF STOCK</span>';
          } else if (item.currentStock <= 10) {
            badgeHtml = '<span class="px-2 py-0.5 rounded text-[9px] font-black bg-amber-500/20 text-amber-500 border border-amber-500/30">LOW STOCK</span>';
          } else {
            badgeHtml = '<span class="px-2 py-0.5 rounded text-[9px] font-black bg-emerald-500/20 text-emerald-500 border border-emerald-500/30">HEALTHY</span>';
          }

          const actionHtml = canManageStock ? `
            <button onclick="openQuickEditModal('${escAttr(item.barcode)}')" class="p-1.5 text-teal-500 hover:bg-teal-500/10 rounded-lg transition" title="Edit Price & Stock">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
          ` : '<span class="text-slate-400">-</span>';

          tbody.innerHTML += `
            <tr class="hover:bg-slate-500/10 text-xs border-b border-[var(--border-color)]">
              <td class="text-center font-mono py-2.5 px-3 text-slate-400">${displayNo}</td>
              <td class="font-mono text-slate-400 py-2.5 px-3 font-bold">${esc(item.barcode)}</td>
              <td class="font-bold py-2.5 px-3">${esc(item.itemName)}</td>
              <td class="text-slate-400 py-2.5 px-3">${esc(item.category)}</td>
              <td class="text-right font-mono text-slate-400 py-2.5 px-3">${Number(item.costPrice).toLocaleString()}</td>
              <td class="text-right font-mono font-bold text-emerald-500 py-2.5 px-3">${Number(item.sellingPrice).toLocaleString()} MMK</td>
              <td class="text-center font-mono font-black py-2.5 px-3 text-sm ${item.currentStock <= 0 ? 'text-rose-500' : (item.currentStock <= 10 ? 'text-amber-500' : '')}">
                ${item.currentStock}
              </td>
              <td class="text-center py-2.5 px-3">${badgeHtml}</td>
              <td class="text-center py-2.5 px-3">${actionHtml}</td>
            </tr>
          `;
        });
      }

      const start = (gStockPage - 1) * gStockLimit + 1;
      const end = Math.min(start + gStockLimit - 1, gStockTotalRows);
      const info = document.getElementById('stock-pagination-info');
      if (info) info.textContent = gStockTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gStockTotalRows} entries`;

      const prevBtn = document.getElementById('stock-btn-prev');
      const nextBtn = document.getElementById('stock-btn-next');
      if (prevBtn) prevBtn.disabled = (gStockPage <= 1);
      if (nextBtn) nextBtn.disabled = (end >= gStockTotalRows);
    }
  } catch (err) {
    console.error("Stock Inventory Load Error:", err);
  }
}

async function exportStockInventoryCSV() {
  try {
    const res = await callApi('getPosStockInventory', { page: 1, limit: 1000, _t: Date.now() }, 'POST');
    const items = res?.data || gItemsCache;
    if (!items || items.length === 0) return showToast("ERROR", "ထုတ်ယူရန် Stock စာရင်း မရှိပါ။");

    let csv = "NO,BARCODE,ITEM_NAME,CATEGORY,COST_PRICE,SELLING_PRICE,CURRENT_STOCK,STOCK_VALUE,STATUS\n";
    const safeCell = s => `"${String(s || '').replace(/"/g, '""')}"`;

    items.forEach((item, idx) => {
      let statusText = 'HEALTHY';
      if (item.currentStock <= 0) statusText = 'OUT OF STOCK';
      else if (item.currentStock <= 10) statusText = 'LOW STOCK';

      const sValue = Number(item.costPrice || 0) * Number(item.currentStock || 0);
      csv += `${idx + 1},${safeCell(item.barcode)},${safeCell(item.itemName)},${safeCell(item.category)},${item.costPrice || 0},${item.sellingPrice || 0},${item.currentStock || 0},${sValue},${safeCell(statusText)}\n`;
    });

    const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Canteen_Stock_Inventory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    showToast("SUCCESS", "Stock စာရင်း CSV ထုတ်ယူမှု အောင်မြင်ပါသည်။");
  } catch (err) {
    showToast("ERROR", "CSV ထုတ်ယူရာတွင် အမှားဖြစ်ပေါ်ခဲ့သည်: " + err.message);
  }
}

function openQuickEditModal(barcode) {
  if (gSession?.role === 'canteen_cashier') return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် လက်ကျန်စာရင်းအား ပြင်ဆင်ခွင့် မရှိပါ။ Admin ထံ တင်ပြပါ။");
  const item = gItemsCache.find(it => it.barcode === barcode) || gStockInventoryData.find(it => it.barcode === barcode);
  if (!item) return;

  document.getElementById('qe-item-name').textContent = item.itemName;
  document.getElementById('qe-barcode').textContent = item.barcode;
  document.getElementById('qe-stock').value = item.currentStock || 0;
  document.getElementById('qe-cost').value = item.costPrice || 0;
  document.getElementById('qe-price').value = item.sellingPrice || 0;
  document.getElementById('pos-quick-edit-modal')?.classList.remove('hidden');
}

async function submitQuickEdit() {
  const barcode = document.getElementById('qe-barcode')?.textContent.trim();
  const currentStock = parseFloat(document.getElementById('qe-stock')?.value || 0);
  const costPrice = parseFloat(document.getElementById('qe-cost')?.value || 0);
  const sellingPrice = parseFloat(document.getElementById('qe-price')?.value || 0);

  if (!barcode) return;
  try {
    const res = await callApi('updatePosItemQuick', { barcode, currentStock, costPrice, sellingPrice });
    if (res && res.success) {
      showToast("SUCCESS", "ပစ္စည်းအချက်အလက် ပြင်ဆင်ပြီးပါပြီ။");
      closeModal('pos-quick-edit-modal');
      await Promise.all([loadStockInventory(gStockPage), loadItemsCatalog(false)]);
    } else {
      showToast("ERROR", res?.message || "ပြင်ဆင်မှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// 🎯 Purchases: Today Filter Shortcut
function setFilterPurchasesToday() {
  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('pur-date-from').value = today;
  document.getElementById('pur-date-to').value = today;
  loadPurchasesHistory(1);
}

function onSearchPurchasesDebounced() {
  clearTimeout(gPurSearchTimeout);
  gPurSearchTimeout = setTimeout(() => { loadPurchasesHistory(1); }, 250);
}

function clearPurchasesFilter() {
  document.getElementById('pur-search').value = '';
  document.getElementById('pur-supplier-filter').value = '';
  document.getElementById('pur-date-from').value = '';
  document.getElementById('pur-date-to').value = '';
  loadPurchasesHistory(1);
}

function changePurchasesPage(delta) {
  loadPurchasesHistory(gPurchasesPage + delta);
}

// 🎯 Purchases History with Live Supplier Total Calculator
async function loadPurchasesHistory(page = 1) {
  gPurchasesPage = Math.max(1, page);
  const searchVal = document.getElementById('pur-search')?.value.trim() || '';
  const supplierId = document.getElementById('pur-supplier-filter')?.value || '';
  const dateFrom = document.getElementById('pur-date-from')?.value || '';
  const dateTo = document.getElementById('pur-date-to')?.value || '';

  try {
    const res = await callApi('getPosPurchasesHistory', {
      searchVal, supplierId, dateFrom, dateTo,
      page: gPurchasesPage, limit: gPurchasesLimit, _t: Date.now()
    }, 'POST');

    if (res && res.success) {
      const records = res.data || [];
      gPurchasesData = records;
      gPurchasesTotalRows = res.totalRows || 0;

      // 🎯 Update Supplier-specific Total Purchase Badge
      const totalPurchasesAmount = res.totalPurchasesAmount || 0;
      const badgeEl = document.getElementById('pur-supplier-total-badge');
      if (badgeEl) badgeEl.textContent = `${Number(totalPurchasesAmount).toLocaleString()} MMK`;

      const tbody = document.getElementById('pur-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 font-bold">အဝယ်စာရင်း မရှိပါ။</td></tr>`;
      } else {
        const canManagePurchases = (gSession?.role === 'canteen_admin' || gSession?.role === 'Owner' || gSession?.role === 'Admin');

        records.forEach((r, idx) => {
          const displayNo = gPurchasesTotalRows - ((gPurchasesPage - 1) * gPurchasesLimit + idx);

          const actionHtml = canManagePurchases ? `
            <div class="flex items-center justify-center gap-1.5">
              <button onclick="openEditPurchaseModal('${escAttr(r.id)}')" class="p-1 text-amber-500 hover:bg-amber-500/10 rounded transition" title="ပြင်ဆင်မည်">
                <i class="fa-solid fa-pen-to-square"></i>
              </button>
              <button onclick="deletePurchaseEntry('${escAttr(r.id)}', '${escAttr(r.purchaseNo)}')" class="p-1 text-rose-500 hover:bg-rose-500/10 rounded transition" title="ဖျက်မည်">
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          ` : '<span class="text-slate-400">-</span>';

          tbody.innerHTML += `
            <tr class="hover:bg-slate-500/10 text-xs border-b border-[var(--border-color)]">
              <td class="text-center font-mono py-2.5 px-3 text-slate-400">${displayNo}</td>
              <td class="font-mono text-slate-400 py-2.5 px-3">${esc(r.date)}</td>
              <td class="font-mono font-bold text-amber-500 py-2.5 px-3">${esc(r.purchaseNo)}</td>
              <td class="font-bold py-2.5 px-3">
                <span>${esc(r.supplierName)}</span>
                ${r.supplierPhone && r.supplierPhone !== '-' ? `<span class="text-[10px] text-slate-400 block font-mono">Ph: ${esc(r.supplierPhone)}</span>` : ''}
              </td>
              <td class="py-2.5 px-3">
                <span class="font-bold block">${esc(r.itemName)}</span>
                <span class="text-[10px] font-mono text-slate-400 block font-bold">${esc(r.barcode)}</span>
              </td>
              <td class="text-center font-mono font-black py-2.5 px-3">${r.qty}</td>
              <td class="text-right font-mono text-slate-400 py-2.5 px-3">${Number(r.costPrice).toLocaleString()}</td>
              <td class="text-right font-mono font-bold text-emerald-500 py-2.5 px-3">${Number(r.sellingPrice).toLocaleString()}</td>
              <td class="text-right font-mono font-black text-amber-500 py-2.5 px-3">${Number(r.totalCost).toLocaleString()} MMK</td>
              <td class="text-center py-2.5 px-3 right-0 sticky bg-[var(--table-header)] border-l border-[var(--border-color)]">${actionHtml}</td>
            </tr>
          `;
        });
      }

      const start = (gPurchasesPage - 1) * gPurchasesLimit + 1;
      const end = Math.min(start + gPurchasesLimit - 1, gPurchasesTotalRows);
      const info = document.getElementById('pur-pagination-info');
      if (info) info.textContent = gPurchasesTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gPurchasesTotalRows} entries`;

      const prevBtn = document.getElementById('pur-btn-prev');
      const nextBtn = document.getElementById('pur-btn-next');
      if (prevBtn) prevBtn.disabled = (gPurchasesPage <= 1);
      if (nextBtn) nextBtn.disabled = (end >= gPurchasesTotalRows);
    }
  } catch (err) {
    console.error("Purchases History Load Error:", err);
  }
}

function triggerSmartPriceCalc() {
  const cost = parseFloat(document.getElementById('m-cost-price')?.value || 0);
  const markup = parseFloat(document.getElementById('m-markup-percent')?.value || 20);
  if (cost <= 0) {
    document.getElementById('m-suggested-price').textContent = '0 MMK';
    return;
  }
  const rawPrice = cost * (1 + markup / 100);
  const rounded = Math.ceil(rawPrice / 50) * 50;

  document.getElementById('m-suggested-price').textContent = `${rounded.toLocaleString()} MMK`;
  const sellingInput = document.getElementById('m-selling-price');
  if (sellingInput) sellingInput.value = rounded;
}

function openItemModal() {
  document.getElementById('m-barcode').value = '';
  document.getElementById('m-item-name').value = '';
  document.getElementById('m-qty').value = '1';
  document.getElementById('m-cost-price').value = '';
  document.getElementById('m-markup-percent').value = '20';
  document.getElementById('m-suggested-price').textContent = '0 MMK';
  document.getElementById('m-selling-price').value = '';
  loadSuppliersList();
  document.getElementById('pos-item-modal')?.classList.remove('hidden');
}

function lookupExistingBarcode() {
  const bCode = document.getElementById('m-barcode').value.trim();
  const existing = gItemsCache.find(it => it.barcode === bCode);
  if (existing) {
    document.getElementById('m-item-name').value = existing.itemName;
    document.getElementById('m-category').value = existing.category || 'Snack';
    document.getElementById('m-cost-price').value = existing.costPrice;
    document.getElementById('m-markup-percent').value = existing.markupPercent || 20;
    triggerSmartPriceCalc();
  }
}

async function submitPosPurchase(e) {
  e.preventDefault();
  const payload = {
    date: new Date().toISOString().slice(0, 10),
    barcode: document.getElementById('m-barcode').value.trim(),
    itemName: document.getElementById('m-item-name').value.trim(),
    category: document.getElementById('m-category').value,
    supplierId: parseInt(document.getElementById('m-supplier-id')?.value, 10) || null,
    qty: parseFloat(document.getElementById('m-qty').value || 1),
    costPrice: parseFloat(document.getElementById('m-cost-price').value || 0),
    markupPercent: parseFloat(document.getElementById('m-markup-percent').value || 20),
    sellingPrice: parseFloat(document.getElementById('m-selling-price').value || 0)
  };

  try {
    const res = await callApi('savePosPurchase', payload);
    if (res && res.success) {
      showToast("SUCCESS", "အဝယ်စာရင်းနှင့် ဈေးနှုန်း မှတ်တမ်းတင်ပြီးပါပြီ။");
      closeModal('pos-item-modal');
      await Promise.all([
        loadItemsCatalog(false),
        loadStockInventory(1),
        loadPurchasesHistory(1),
        loadCanteenDashboard()
      ]);
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

function openEditPurchaseModal(id) {
  if (gSession?.role === 'canteen_cashier') return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် အဝယ်စာရင်းဟောင်းများအား ပြင်ဆင်ခွင့် မရှိပါ။");
  const item = gPurchasesData.find(p => String(p.id) === String(id));
  if (!item) return showToast("ERROR", "အဝယ်စာရင်း အချက်အလက် မတွေ့ပါ။");

  document.getElementById('edit-pur-id').value = item.id;
  document.getElementById('edit-pur-no').textContent = item.purchaseNo;
  document.getElementById('edit-pur-item-name').textContent = `${item.itemName} (${item.barcode})`;
  document.getElementById('edit-pur-date').value = item.date;

  const supSelect = document.getElementById('edit-pur-supplier');
  if (supSelect) supSelect.value = item.supplierId || '';

  document.getElementById('edit-pur-qty').value = item.qty;
  document.getElementById('edit-pur-cost').value = item.costPrice;
  document.getElementById('edit-pur-markup').value = item.markupPercent || 20;
  document.getElementById('edit-pur-selling').value = item.sellingPrice;
  document.getElementById('edit-pur-remark').value = item.remark || '';
  document.getElementById('pos-edit-purchase-modal')?.classList.remove('hidden');
}

function triggerEditPurSmartPriceCalc() {
  const cost = parseFloat(document.getElementById('edit-pur-cost')?.value || 0);
  const markup = parseFloat(document.getElementById('edit-pur-markup')?.value || 20);
  if (cost <= 0) return;
  const rawPrice = cost * (1 + markup / 100);
  const rounded = Math.ceil(rawPrice / 50) * 50;
  const sellingInput = document.getElementById('edit-pur-selling');
  if (sellingInput) sellingInput.value = rounded;
}

async function submitEditPurchase(e) {
  if (e && e.preventDefault) e.preventDefault();
  const id = parseInt(document.getElementById('edit-pur-id')?.value, 10);
  const purchaseNo = document.getElementById('edit-pur-no')?.textContent.trim();
  const date = document.getElementById('edit-pur-date')?.value;
  const supplierId = parseInt(document.getElementById('edit-pur-supplier')?.value, 10) || null;
  const qty = parseFloat(document.getElementById('edit-pur-qty')?.value || 1);
  const costPrice = parseFloat(document.getElementById('edit-pur-cost')?.value || 0);
  const markupPercent = parseFloat(document.getElementById('edit-pur-markup')?.value || 20);
  const sellingPrice = parseFloat(document.getElementById('edit-pur-selling')?.value || 0);
  const remark = document.getElementById('edit-pur-remark')?.value.trim();

  try {
    const res = await callApi('updatePosPurchase', { id, purchaseNo, date, supplierId, qty, costPrice, markupPercent, sellingPrice, remark });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အဝယ်စာရင်း ပြင်ဆင်ပြီးပါပြီ။");
      closeModal('pos-edit-purchase-modal');
      await Promise.all([loadPurchasesHistory(gPurchasesPage), loadItemsCatalog(false), loadStockInventory(gStockPage)]);
    } else {
      showToast("ERROR", res?.message || "ပြင်ဆင်မှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

async function deletePurchaseEntry(id, purchaseNo) {
  if (gSession?.role === 'canteen_cashier') return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် အဝယ်စာရင်းဟောင်းများအား ဖျက်သိမ်းခွင့် မရှိပါ။");
  if (!confirm(`အဝယ်ဘောက်ချာ (${purchaseNo}) အား ဖျက်သိမ်းမည်မှာ သေချာပါသလား?`)) return;

  try {
    const res = await callApi('deletePosPurchase', { id: parseInt(id, 10), purchaseNo });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အဝယ်စာရင်း ဖျက်သိမ်းပြီးပါပြီ။");
      await Promise.all([loadPurchasesHistory(gPurchasesPage), loadItemsCatalog(false), loadStockInventory(gStockPage)]);
    } else {
      showToast("ERROR", res?.message || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

async function loadSuppliersList() {
  try {
    const res = await callApi('getPosSuppliers', { _t: Date.now() }, 'POST');
    if (res && res.success) {
      gSuppliersCache = res.data || [];
      const filterSelect = document.getElementById('pur-supplier-filter');
      const modalSelect = document.getElementById('m-supplier-id');
      const editPurSupplier = document.getElementById('edit-pur-supplier');

      const options = gSuppliersCache.map(s => `<option value="${s.id}">${esc(s.supplierName)}${s.phoneNo ? ' (' + esc(s.phoneNo) + ')' : ''}</option>`).join('');
      if (filterSelect) filterSelect.innerHTML = `<option value="">All Suppliers (ကုန်သည်အားလုံး)</option>` + options;
      if (modalSelect) modalSelect.innerHTML = `<option value="">-- ရွေးချယ်ပါ (အထွေထွေ) --</option>` + options;
      if (editPurSupplier) editPurSupplier.innerHTML = `<option value="">-- ရွေးချယ်ပါ (အထွေထွေ) --</option>` + options;
    }
  } catch (e) {}
}

function openSupplierModal() {
  document.getElementById('sup-name').value = '';
  document.getElementById('sup-contact').value = '';
  document.getElementById('sup-phone').value = '';
  document.getElementById('sup-address').value = '';
  document.getElementById('pos-supplier-modal')?.classList.remove('hidden');
}

async function submitNewSupplier() {
  const name = document.getElementById('sup-name')?.value.trim();
  const contactPerson = document.getElementById('sup-contact')?.value.trim();
  const phoneNo = document.getElementById('sup-phone')?.value.trim();
  const address = document.getElementById('sup-address')?.value.trim();

  if (!name) return showToast("ERROR", "ကုန်သည်အမည် ထည့်သွင်းပါ။");
  try {
    const res = await callApi('savePosSupplier', { supplierName: name, contactPerson, phoneNo, address });
    if (res && res.success) {
      showToast("SUCCESS", "ကုန်သည်အသစ် ထည့်သွင်းပြီးပါပြီ။");
      closeModal('pos-supplier-modal');
      await loadSuppliersList();
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// Global Exports
window.loadItemsCatalog = loadItemsCatalog;
window.loadStockInventory = loadStockInventory;
window.onSearchStockDebounced = onSearchStockDebounced;
window.changeStockPage = changeStockPage;
window.exportStockInventoryCSV = exportStockInventoryCSV;
window.openQuickEditModal = openQuickEditModal;
window.submitQuickEdit = submitQuickEdit;
window.setFilterPurchasesToday = setFilterPurchasesToday;
window.loadPurchasesHistory = loadPurchasesHistory;
window.onSearchPurchasesDebounced = onSearchPurchasesDebounced;
window.clearPurchasesFilter = clearPurchasesFilter;
window.changePurchasesPage = changePurchasesPage;
window.triggerSmartPriceCalc = triggerSmartPriceCalc;
window.openItemModal = openItemModal;
window.lookupExistingBarcode = lookupExistingBarcode;
window.submitPosPurchase = submitPosPurchase;
window.openEditPurchaseModal = openEditPurchaseModal;
window.triggerEditPurSmartPriceCalc = triggerEditPurSmartPriceCalc;
window.submitEditPurchase = submitEditPurchase;
window.deletePurchaseEntry = deletePurchaseEntry;
window.openSupplierModal = openSupplierModal;
window.submitNewSupplier = submitNewSupplier;