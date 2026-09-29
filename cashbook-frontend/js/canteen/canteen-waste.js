/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN WASTAGE & LOSS AUDITOR
 * File: js/canteen/canteen-waste.js
 * ==============================================================================
 */

function openWasteModal() {
  document.getElementById('waste-barcode-input').value = '';
  document.getElementById('m-waste-remark').value = '';
  document.getElementById('m-waste-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('m-waste-reason').value = 'ပျက်စီးကွဲရှ';
  gWasteCart = [];
  renderWasteCart();
  document.getElementById('pos-waste-modal')?.classList.remove('hidden');
}

function handleWasteBarcodeInput(e) {
  const val = e.target.value.trim();
  const dropdown = document.getElementById('waste-search-dropdown');

  if (e.key === 'Enter') {
    e.preventDefault();
    searchAndAddWasteItem(val);
    return;
  }

  if (val.length >= 2) {
    const matches = gItemsCache.filter(it => 
      it.itemName.toLowerCase().includes(val.toLowerCase()) || 
      it.barcode.toLowerCase().includes(val.toLowerCase())
    );

    if (matches.length > 0) {
      dropdown.innerHTML = matches.map(m => `
        <div onclick="selectDropdownWasteItem('${escAttr(m.barcode)}')" class="p-2 hover:bg-slate-800 cursor-pointer border-b border-slate-700/60 flex items-center justify-between text-xs bg-[#0c1527] transition">
          <div>
            <span class="font-bold text-white">${esc(m.itemName)}</span>
            <span class="text-[10px] font-mono text-slate-400 block">${esc(m.barcode)}</span>
          </div>
          <span class="font-mono text-slate-300">Cost: ${Number(m.costPrice || 0).toLocaleString()} MMK</span>
        </div>
      `).join('');
      dropdown.classList.remove('hidden');
    } else {
      dropdown.classList.add('hidden');
    }
  } else {
    dropdown.classList.add('hidden');
  }
}

function selectDropdownWasteItem(barcode) {
  document.getElementById('waste-search-dropdown')?.classList.add('hidden');
  searchAndAddWasteItem(barcode);
}

function searchAndAddWasteItem(targetCode) {
  const input = document.getElementById('waste-barcode-input');
  const code = (targetCode || input.value || '').trim();
  if (!code) return;

  const item = gItemsCache.find(it => it.barcode === code || it.itemName.toLowerCase() === code.toLowerCase());
  if (!item) return showToast("ERROR", `ပစ္စည်း ရှာမတွေ့ပါ: ${code}`);

  const existing = gWasteCart.find(wi => wi.barcode === item.barcode);
  if (existing) {
    existing.qty += 1;
  } else {
    gWasteCart.push({
      barcode: item.barcode,
      name: item.itemName,
      costPrice: Number(item.costPrice || 0),
      currentStock: Number(item.currentStock || 0),
      qty: 1
    });
  }

  input.value = '';
  document.getElementById('waste-search-dropdown')?.classList.add('hidden');
  renderWasteCart();
}

function renderWasteCart() {
  const list = document.getElementById('waste-items-list');
  const emptyBox = document.getElementById('waste-items-empty');
  const badge = document.getElementById('waste-cart-badge');

  if (gWasteCart.length === 0) {
    list.innerHTML = '';
    if (emptyBox) list.appendChild(emptyBox);
    badge.textContent = "0 items";
    document.getElementById('waste-modal-total-qty').textContent = "0 ခု";
    document.getElementById('waste-modal-total-cost').textContent = "0 MMK";
    return;
  }

  list.innerHTML = '';
  let totalQty = 0;
  let totalCost = 0;

  gWasteCart.forEach((item, idx) => {
    const subtotal = item.qty * item.costPrice;
    totalQty += item.qty;
    totalCost += subtotal;

    list.innerHTML += `
      <div class="p-2 bg-[#080f1e]/80 border border-slate-800 rounded-lg flex items-center justify-between gap-2 text-xs">
        <div class="min-w-0 flex-1">
          <h5 class="font-bold text-white truncate">${esc(item.name)}</h5>
          <span class="text-[10px] font-mono text-slate-400">ဝယ်ရင်းဈေး: ${Number(item.costPrice).toLocaleString()} MMK</span>
        </div>

        <div class="flex items-center gap-1 shrink-0 bg-[#060c18] border border-slate-800 rounded-md p-0.5">
          <button type="button" onclick="changeWasteCartQty(${idx}, -1)" class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs">-</button>
          <input type="number" value="${item.qty}" min="1" onchange="setWasteCartQty(${idx}, this.value)" class="w-8 bg-transparent text-center font-mono font-bold text-white text-xs outline-none">
          <button type="button" onclick="changeWasteCartQty(${idx}, 1)" class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs">+</button>
        </div>

        <div class="text-right shrink-0 min-w-[70px]">
          <strong class="font-mono text-rose-400 font-bold block">${Number(subtotal).toLocaleString()}</strong>
          <button type="button" onclick="removeWasteCartItem(${idx})" class="text-[10px] text-slate-500 hover:text-rose-400 transition"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;
  });

  badge.textContent = `${gWasteCart.length} items`;
  document.getElementById('waste-modal-total-qty').textContent = `${totalQty} ခု`;
  document.getElementById('waste-modal-total-cost').textContent = `${Number(totalCost).toLocaleString()} MMK`;
}

function changeWasteCartQty(idx, delta) {
  if (!gWasteCart[idx]) return;
  const target = gWasteCart[idx].qty + delta;
  if (target <= 0) return removeWasteCartItem(idx);
  gWasteCart[idx].qty = target;
  renderWasteCart();
}

function setWasteCartQty(idx, val) {
  const q = parseInt(val, 10) || 1;
  if (q <= 0) return removeWasteCartItem(idx);
  gWasteCart[idx].qty = q;
  renderWasteCart();
}

function removeWasteCartItem(idx) {
  gWasteCart.splice(idx, 1);
  renderWasteCart();
}

async function submitPosWaste() {
  if (gWasteCart.length === 0) return showToast("ERROR", "အပျက်စာရင်းသွင်းမည့် ပစ္စည်း အနည်းဆုံး ၁ ခု ရွေးချယ်ပါ။");

  const payload = {
    date: document.getElementById('m-waste-date').value || new Date().toISOString().slice(0, 10),
    reason: document.getElementById('m-waste-reason').value,
    remark: document.getElementById('m-waste-remark').value.trim(),
    items: gWasteCart,
    uniqueId: 'WST_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
  };

  try {
    const res = await callApi('savePosWasteEntry', payload);
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အပျက်/အပျောက်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။");
      closeModal('pos-waste-modal');

      gWasteCart.forEach(wi => {
        const item = gItemsCache.find(it => it.barcode === wi.barcode);
        if (item) item.currentStock = Math.max(0, Number(item.currentStock || 0) - wi.qty);
      });

      gWasteCart = [];
      await Promise.all([loadWasteHistory(1), loadStockInventory(gStockPage), loadCanteenDashboard()]);
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

function onSearchWasteDebounced() {
  clearTimeout(gWasteSearchTimeout);
  gWasteSearchTimeout = setTimeout(() => { loadWasteHistory(1); }, 250);
}

function clearWasteFilter() {
  document.getElementById('waste-search').value = '';
  document.getElementById('waste-reason-filter').value = '';
  document.getElementById('waste-date-from').value = '';
  document.getElementById('waste-date-to').value = '';
  loadWasteHistory(1);
}

function changeWastePage(delta) {
  loadWasteHistory(gWastePage + delta);
}

async function loadWasteHistory(page = 1) {
  gWastePage = Math.max(1, page);
  const searchVal = document.getElementById('waste-search')?.value.trim() || '';
  const reason = document.getElementById('waste-reason-filter')?.value || '';
  const dateFrom = document.getElementById('waste-date-from')?.value || '';
  const dateTo = document.getElementById('waste-date-to')?.value || '';

  try {
    const res = await callApi('getPosWasteHistory', { searchVal, reason, dateFrom, dateTo, page: gWastePage, limit: gWasteLimit, _t: Date.now() }, 'POST');
    if (res && res.success) {
      const records = res.data || [];
      gWasteData = records;
      gWasteTotalRows = res.totalRows || 0;

      const totalLossBadge = document.getElementById('waste-total-loss-badge');
      if (totalLossBadge) totalLossBadge.textContent = `${Number(res.totalLossAmount || 0).toLocaleString()} MMK`;

      const tbody = document.getElementById('waste-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-500 font-bold">အပျက်/အပျောက်စာရင်း မရှိပါ။</td></tr>`;
      } else {
        records.forEach((r, idx) => {
          const displayNo = gWasteTotalRows - ((gWastePage - 1) * gWasteLimit + idx);
          tbody.innerHTML += `
            <tr class="hover:bg-slate-800/40 text-xs border-b border-slate-800/40">
              <td class="text-center font-mono py-2.5 px-3 text-slate-500">${displayNo}</td>
              <td class="font-mono text-slate-300 py-2.5 px-3">${esc(r.date)}</td>
              <td class="font-mono font-bold text-rose-400 py-2.5 px-3">${esc(r.wasteNo)}</td>
              <td class="text-center py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">${esc(r.reason)}</span></td>
              <td class="py-2.5 px-3 text-white font-bold">${esc(r.itemsSummary)}</td>
              <td class="text-center font-mono font-black text-white py-2.5 px-3">${r.totalItemsQty}</td>
              <td class="text-right font-mono font-bold text-rose-400 py-2.5 px-3">${Number(r.totalLossCost).toLocaleString()} MMK</td>
              <td class="py-2.5 px-3 text-slate-400">${esc(r.reportedBy)}</td>
              <td class="py-2.5 px-3 text-slate-400 truncate max-w-xs">${esc(r.remark || '-')}</td>
            </tr>
          `;
        });
      }

      const start = (gWastePage - 1) * gWasteLimit + 1;
      const end = Math.min(start + gWasteLimit - 1, gWasteTotalRows);
      const info = document.getElementById('waste-pagination-info');
      if (info) info.textContent = gWasteTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gWasteTotalRows} entries`;

      const prevBtn = document.getElementById('waste-btn-prev');
      const nextBtn = document.getElementById('waste-btn-next');
      if (prevBtn) prevBtn.disabled = (gWastePage <= 1);
      if (nextBtn) nextBtn.disabled = (end >= gWasteTotalRows);
    }
  } catch (err) {
    console.error("Waste History Load Error:", err);
  }
}

// Global Exports
window.openWasteModal = openWasteModal;
window.handleWasteBarcodeInput = handleWasteBarcodeInput;
window.selectDropdownWasteItem = selectDropdownWasteItem;
window.searchAndAddWasteItem = searchAndAddWasteItem;
window.changeWasteCartQty = changeWasteCartQty;
window.setWasteCartQty = setWasteCartQty;
window.removeWasteCartItem = removeWasteCartItem;
window.submitPosWaste = submitPosWaste;
window.loadWasteHistory = loadWasteHistory;
window.onSearchWasteDebounced = onSearchWasteDebounced;
window.clearWasteFilter = clearWasteFilter;
window.changeWastePage = changeWastePage;