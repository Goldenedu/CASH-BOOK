/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN WASTAGE & SURPLUS AUDITOR
 * File: js/canteen/canteen-waste.js (Enterprise V9.1 Full Production Edition)
 * 💡 Features:
 *   1. 🕒 Strict MMT (UTC+06:30) Timezone Universal Support
 *   2. ⚠️ Wastage & Loss Management with Cost-Basis Loss Tracking
 *   3. 📦 Stock Surplus Ledger (Capital Invariance Synchronization)
 *   4. 🔄 Atomic Admin-Only Rollback Engine for Waste & Surplus Deletion
 *   5. 🌐 Resilient Barcode Search with IndexedDB Offline Fallback
 *   6. 🛡️ Defensive Null-Safe DOM Updaters (Zero-Crash Execution)
 *   7. 🛡️ Scope-Safe Helper (Zero 'esc' SyntaxError Guarantee)
 * ==============================================================================
 */

// 🕒 Pure Non-Recursive MMT Date Helper (UTC+06:30)
function getMMTDateString(dInput) {
  if (dInput && typeof dInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dInput.trim())) {
    return dInput.trim();
  }
  const d = dInput ? new Date(dInput) : new Date();
  const targetMs = isNaN(d.getTime()) ? Date.now() : d.getTime();
  const mmt = new Date(targetMs + (6.5 * 60 * 60 * 1000));
  return mmt.toISOString().slice(0, 10);
}

// 🛡️ Standalone Role Normalizer (Loop-Free Guaranteed)
function getNormalizedRole() {
  const raw = String(gSession?.role || localStorage.getItem('golden_user_role') || 'Cashier').trim();
  return raw.toLowerCase().replace(/[\s_-]/g, '');
}

// 🛡️ Scope-Safe Variable Declarations (Prevents Identifier SyntaxError)
var esc = window.esc || (s => s ? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '');
var escAttr = window.escAttr || (s => s ? String(s).replace(/'/g, "\\'") : '');

// ==============================================================================
// ⚠️ 1. WASTAGE & LOSS MANAGEMENT
// ==============================================================================
function openWasteModal() {
  const bInput = document.getElementById('waste-barcode-input');
  if (bInput) bInput.value = '';

  const rInput = document.getElementById('m-waste-remark');
  if (rInput) rInput.value = '';

  const dInput = document.getElementById('m-waste-date');
  if (dInput) dInput.value = getMMTDateString(); // 🕒 Strict MMT Today

  const reInput = document.getElementById('m-waste-reason');
  if (reInput) reInput.value = 'ပျက်စီးကွဲရှ';

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
      String(it.itemName || '').toLowerCase().includes(val.toLowerCase()) || 
      String(it.barcode || '').toLowerCase().includes(val.toLowerCase())
    );

    if (matches.length > 0 && dropdown) {
      dropdown.innerHTML = matches.map(m => `
        <div onclick="selectDropdownWasteItem('${escAttr(m.barcode)}')" class="p-2.5 hover:bg-slate-500/10 cursor-pointer border-b border-[var(--border-color)] flex items-center justify-between text-xs transition">
          <div>
            <span class="font-bold">${esc(m.itemName)}</span>
            <span class="text-[10px] font-mono text-slate-400 block">${esc(m.barcode)}</span>
          </div>
          <span class="font-mono text-slate-400">Cost: ${Number(m.costPrice || 0).toLocaleString()} MMK</span>
        </div>
      `).join('');
      dropdown.classList.remove('hidden');
    } else if (dropdown) {
      dropdown.classList.add('hidden');
    }
  } else if (dropdown) {
    dropdown.classList.add('hidden');
  }
}

function selectDropdownWasteItem(barcode) {
  const dropdown = document.getElementById('waste-search-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  searchAndAddWasteItem(barcode);
}

async function searchAndAddWasteItem(targetCode) {
  const input = document.getElementById('waste-barcode-input');
  const code = (targetCode || input?.value || '').trim();
  if (!code) return;

  // အဆင့် ၁။ Memory Cache အလွတ်ဖြစ်နေပါက IndexedDB မှ ဆွဲတင်ခြင်း
  if (!gItemsCache || gItemsCache.length === 0) {
    if (typeof dbGetAllItems === 'function') {
      gItemsCache = await dbGetAllItems();
    }
    if ((!gItemsCache || gItemsCache.length === 0) && typeof loadItemsCatalog === 'function') {
      await loadItemsCatalog(false);
    }
  }

  const codeLower = code.toLowerCase();
  let item = gItemsCache.find(it => 
    String(it.barcode || '').trim().toLowerCase() === codeLower || 
    String(it.itemName || '').trim().toLowerCase() === codeLower
  );

  // အဆင့် ၂။ IndexedDB Direct Fallback
  if (!item && typeof dbGetItem === 'function') {
    const dbItem = await dbGetItem(code);
    if (dbItem) {
      item = dbItem;
      gItemsCache.push(item);
    }
  }

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

  if (input) input.value = '';
  const dropdown = document.getElementById('waste-search-dropdown');
  if (dropdown) dropdown.classList.add('hidden');

  renderWasteCart();
}

function renderWasteCart() {
  const list = document.getElementById('waste-items-list');
  const emptyBox = document.getElementById('waste-items-empty');
  const badge = document.getElementById('waste-cart-badge');

  if (!list) return;

  if (gWasteCart.length === 0) {
    list.innerHTML = '';
    if (emptyBox) list.appendChild(emptyBox);
    if (badge) badge.textContent = "0 items";
    const elTotQty = document.getElementById('waste-modal-total-qty');
    if (elTotQty) elTotQty.textContent = "0 ခု";
    const elTotCost = document.getElementById('waste-modal-total-cost');
    if (elTotCost) elTotCost.textContent = "0 MMK";
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
      <div class="p-2.5 bg-[var(--bg-card-inner)] border border-[var(--border-color)] rounded-xl flex items-center justify-between gap-3 text-xs transition shadow-sm">
        <div class="min-w-0 flex-1">
          <h5 class="font-bold truncate text-slate-800 dark:text-white">${esc(item.name)}</h5>
          <span class="text-[10px] font-mono text-slate-500 dark:text-slate-400">ဝယ်ရင်းဈေး: ${Number(item.costPrice).toLocaleString()} MMK</span>
        </div>

        <div class="flex items-center gap-1 shrink-0 bg-slate-100 dark:bg-black/40 border border-[var(--border-color)] rounded-lg p-0.5">
          <button type="button" onclick="changeWasteCartQty(${idx}, -1)" class="w-6 h-6 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-xs shadow-sm transition active:scale-95">-</button>
          <input type="number" value="${item.qty}" min="1" onchange="setWasteCartQty(${idx}, this.value)" class="w-8 bg-transparent text-center font-mono font-bold text-slate-800 dark:text-white text-xs outline-none">
          <button type="button" onclick="changeWasteCartQty(${idx}, 1)" class="w-6 h-6 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-xs shadow-sm transition active:scale-95">+</button>
        </div>

        <div class="text-right shrink-0 min-w-[75px]">
          <strong class="font-mono text-rose-500 font-bold block">${Number(subtotal).toLocaleString()}</strong>
          <button type="button" onclick="removeWasteCartItem(${idx})" class="text-[10px] text-slate-400 hover:text-rose-500 p-0.5 transition" title="ဖယ်ရှားမည်"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>
    `;
  });

  if (badge) badge.textContent = `${gWasteCart.length} items`;
  const elTotQty = document.getElementById('waste-modal-total-qty');
  if (elTotQty) elTotQty.textContent = `${totalQty} ခု`;
  const elTotCost = document.getElementById('waste-modal-total-cost');
  if (elTotCost) elTotCost.textContent = `${Number(totalCost).toLocaleString()} MMK`;
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

  const todayStr = getMMTDateString();
  const payload = {
    date: document.getElementById('m-waste-date')?.value || todayStr,
    reason: document.getElementById('m-waste-reason')?.value || 'ပျက်စီးကွဲရှ',
    remark: document.getElementById('m-waste-remark')?.value.trim() || '',
    items: gWasteCart,
    uniqueId: 'WST_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
  };

  try {
    const res = await callApi('savePosWasteEntry', payload);
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အပျက်/အပျောက်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။");
      closeModal('pos-waste-modal');

      // 🎯 Capital Invariance Safe stock deduction
      for (const wi of gWasteCart) {
        const item = gItemsCache.find(it => it.barcode === wi.barcode);
        if (item) {
          item.currentStock = Math.max(0, Number(item.currentStock || 0) - wi.qty);
          if (item.surplusStock) {
            item.surplusStock = Math.max(0, Number(item.surplusStock || 0) - wi.qty);
          }
        }
      }
      if (typeof dbSaveItems === 'function') {
        await dbSaveItems(gItemsCache);
      }

      gWasteCart = [];
      await Promise.all([loadWasteHistory(1), loadStockInventory(gStockPage), loadCanteenDashboard()]);
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

async function deletePosWasteEntry(id, wasteNo) {
  const role = getNormalizedRole();
  if (role === 'canteencashier' || role === 'cashier') {
    return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် အပျက်စာရင်း ဖျက်သိမ်းခွင့် မရှိပါ။ Admin ထံ တင်ပြပါ။");
  }

  if (!confirm(`အပျက်စာရင်း (${wasteNo}) အား ဖျက်သိမ်းမည်မှာ သေချာပါသလား?\n\nနုတ်ယူထားသော ပစ္စည်းအရေအတွက်ကို စတော့ထဲသို့ အလိုအလျောက် ပြန်လည်ပေါင်းထည့်ပေးပါမည်။`)) {
    return;
  }

  try {
    const res = await callApi('deletePosWasteEntry', { id, wasteNo });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အပျက်စာရင်း ဖျက်သိမ်းပြီးပါပြီ။");
      if (typeof loadItemsCatalog === 'function') await loadItemsCatalog(false);
      await Promise.all([loadWasteHistory(gWastePage), loadStockInventory(gStockPage), loadCanteenDashboard()]);
    } else {
      showToast("ERROR", res?.message || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
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
  const sInput = document.getElementById('waste-search');
  if (sInput) sInput.value = '';

  const rFilter = document.getElementById('waste-reason-filter');
  if (rFilter) rFilter.value = '';

  const dFrom = document.getElementById('waste-date-from');
  if (dFrom) dFrom.value = '';

  const dTo = document.getElementById('waste-date-to');
  if (dTo) dTo.value = '';

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
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 font-bold">အပျက်/အပျောက်စာရင်း မရှိပါ။</td></tr>`;
      } else {
        const role = getNormalizedRole();
        const canManage = role.includes('admin') || role.includes('owner');

        records.forEach((r, idx) => {
          const displayNo = gWasteTotalRows - ((gWastePage - 1) * gWasteLimit + idx);
          const actionHtml = canManage ? `
            <button onclick="deletePosWasteEntry(${r.id}, '${escAttr(r.wasteNo)}')" class="p-1 text-rose-500 hover:bg-rose-500/10 rounded transition" title="ဖျက်မည်">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : '<span class="text-slate-400">-</span>';

          tbody.innerHTML += `
            <tr class="hover:bg-slate-500/10 text-xs border-b border-[var(--border-color)]">
              <td class="text-center font-mono py-2.5 px-3 text-slate-400">${displayNo}</td>
              <td class="font-mono text-slate-400 py-2.5 px-3">${esc(r.date)}</td>
              <td class="font-mono font-bold text-rose-500 py-2.5 px-3">${esc(r.wasteNo)}</td>
              <td class="text-center py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-500 border border-rose-500/30">${esc(r.reason)}</span></td>
              <td class="py-2.5 px-3 font-bold">${esc(r.itemsSummary)}</td>
              <td class="text-center font-mono font-black py-2.5 px-3">${r.totalItemsQty}</td>
              <td class="text-right font-mono font-bold text-rose-500 py-2.5 px-3">${Number(r.totalLossCost || 0).toLocaleString()} MMK</td>
              <td class="py-2.5 px-3 text-slate-400">${esc(r.reportedBy)}</td>
              <td class="py-2.5 px-3 text-slate-400 truncate max-w-xs">${esc(r.remark || '-')}</td>
              <td class="text-center py-2.5 px-3 right-0 sticky bg-[var(--table-header)] border-l border-[var(--border-color)]">${actionHtml}</td>
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
    console.error("[CanteenWaste] Waste History Load Error:", err);
  }
}

// ==============================================================================
// 📦 2. STOCK SURPLUS & OVERAGE MANAGEMENT (CAPITAL INVARIANCE)
// ==============================================================================
function openSurplusModal() {
  const bInput = document.getElementById('surplus-barcode-input');
  if (bInput) bInput.value = '';

  const rInput = document.getElementById('m-surplus-remark');
  if (rInput) rInput.value = '';

  const dInput = document.getElementById('m-surplus-date');
  if (dInput) dInput.value = getMMTDateString(); // 🕒 Strict MMT Today

  const reInput = document.getElementById('m-surplus-reason');
  if (reInput) reInput.value = 'ရေတွက်မှုအပို';

  gSurplusCart = [];
  renderSurplusCart();
  document.getElementById('pos-surplus-modal')?.classList.remove('hidden');
}

function handleSurplusBarcodeInput(e) {
  const val = e.target.value.trim();
  const dropdown = document.getElementById('surplus-search-dropdown');

  if (e.key === 'Enter') {
    e.preventDefault();
    searchAndAddSurplusItem(val);
    return;
  }

  if (val.length >= 2) {
    const matches = gItemsCache.filter(it => 
      String(it.itemName || '').toLowerCase().includes(val.toLowerCase()) || 
      String(it.barcode || '').toLowerCase().includes(val.toLowerCase())
    );

    if (matches.length > 0 && dropdown) {
      dropdown.innerHTML = matches.map(m => `
        <div onclick="selectDropdownSurplusItem('${escAttr(m.barcode)}')" class="p-2.5 hover:bg-slate-500/10 cursor-pointer border-b border-[var(--border-color)] flex items-center justify-between text-xs transition">
          <div>
            <span class="font-bold">${esc(m.itemName)}</span>
            <span class="text-[10px] font-mono text-slate-400 block">${esc(m.barcode)}</span>
          </div>
          <span class="font-mono text-slate-400">Cost: ${Number(m.costPrice || 0).toLocaleString()} MMK</span>
        </div>
      `).join('');
      dropdown.classList.remove('hidden');
    } else if (dropdown) {
      dropdown.classList.add('hidden');
    }
  } else if (dropdown) {
    dropdown.classList.add('hidden');
  }
}

function selectDropdownSurplusItem(barcode) {
  const dropdown = document.getElementById('surplus-search-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  searchAndAddSurplusItem(barcode);
}

async function searchAndAddSurplusItem(targetCode) {
  const input = document.getElementById('surplus-barcode-input');
  const code = (targetCode || input?.value || '').trim();
  if (!code) return;

  // အဆင့် ၁။ Memory Cache အလွတ်ဖြစ်နေပါက IndexedDB မှ ဆွဲတင်ခြင်း
  if (!gItemsCache || gItemsCache.length === 0) {
    if (typeof dbGetAllItems === 'function') {
      gItemsCache = await dbGetAllItems();
    }
    if ((!gItemsCache || gItemsCache.length === 0) && typeof loadItemsCatalog === 'function') {
      await loadItemsCatalog(false);
    }
  }

  const codeLower = code.toLowerCase();
  let item = gItemsCache.find(it => 
    String(it.barcode || '').trim().toLowerCase() === codeLower || 
    String(it.itemName || '').trim().toLowerCase() === codeLower
  );

  // အဆင့် ၂။ IndexedDB Direct Fallback
  if (!item && typeof dbGetItem === 'function') {
    const dbItem = await dbGetItem(code);
    if (dbItem) {
      item = dbItem;
      gItemsCache.push(item);
    }
  }

  if (!item) return showToast("ERROR", `ပစ္စည်း ရှာမတွေ့ပါ: ${code}`);

  const existing = gSurplusCart.find(si => si.barcode === item.barcode);
  if (existing) {
    existing.qty += 1;
  } else {
    gSurplusCart.push({
      barcode: item.barcode,
      name: item.itemName,
      costPrice: Number(item.costPrice || 0),
      currentStock: Number(item.currentStock || 0),
      qty: 1
    });
  }

  if (input) input.value = '';
  const dropdown = document.getElementById('surplus-search-dropdown');
  if (dropdown) dropdown.classList.add('hidden');

  renderSurplusCart();
}

function renderSurplusCart() {
  const list = document.getElementById('surplus-items-list');
  const emptyBox = document.getElementById('surplus-items-empty');
  const badge = document.getElementById('surplus-cart-badge');

  if (!list) return;

  if (gSurplusCart.length === 0) {
    list.innerHTML = '';
    if (emptyBox) list.appendChild(emptyBox);
    if (badge) badge.textContent = "0 items";
    const elTotQty = document.getElementById('surplus-modal-total-qty');
    if (elTotQty) elTotQty.textContent = "0 ခု";
    const elTotCost = document.getElementById('surplus-modal-total-cost');
    if (elTotCost) elTotCost.textContent = "0 MMK";
    return;
  }

  list.innerHTML = '';
  let totalQty = 0;
  let totalCost = 0;

  gSurplusCart.forEach((item, idx) => {
    const subtotal = item.qty * item.costPrice;
    totalQty += item.qty;
    totalCost += subtotal;

    list.innerHTML += `
      <div class="p-2.5 bg-[var(--bg-card-inner)] border border-[var(--border-color)] rounded-xl flex items-center justify-between gap-3 text-xs transition shadow-sm">
        <div class="min-w-0 flex-1">
          <h5 class="font-bold truncate text-slate-800 dark:text-white">${esc(item.name)}</h5>
          <span class="text-[10px] font-mono text-slate-500 dark:text-slate-400">ဝယ်ရင်းဈေး: ${Number(item.costPrice).toLocaleString()} MMK</span>
        </div>

        <div class="flex items-center gap-1 shrink-0 bg-slate-100 dark:bg-black/40 border border-[var(--border-color)] rounded-lg p-0.5">
          <button type="button" onclick="changeSurplusCartQty(${idx}, -1)" class="w-6 h-6 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-xs shadow-sm transition active:scale-95">-</button>
          <input type="number" value="${item.qty}" min="1" onchange="setSurplusCartQty(${idx}, this.value)" class="w-8 bg-transparent text-center font-mono font-bold text-slate-800 dark:text-white text-xs outline-none">
          <button type="button" onclick="changeSurplusCartQty(${idx}, 1)" class="w-6 h-6 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-xs shadow-sm transition active:scale-95">+</button>
        </div>

        <div class="text-right shrink-0 min-w-[75px]">
          <strong class="font-mono text-emerald-500 font-bold block">${Number(subtotal).toLocaleString()}</strong>
          <button type="button" onclick="removeSurplusCartItem(${idx})" class="text-[10px] text-slate-400 hover:text-rose-500 p-0.5 transition" title="ဖယ်ရှားမည်"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>
    `;
  });

  if (badge) badge.textContent = `${gSurplusCart.length} items`;
  const elTotQty = document.getElementById('surplus-modal-total-qty');
  if (elTotQty) elTotQty.textContent = `${totalQty} ခု`;
  const elTotCost = document.getElementById('surplus-modal-total-cost');
  if (elTotCost) elTotCost.textContent = `${Number(totalCost).toLocaleString()} MMK`;
}

function changeSurplusCartQty(idx, delta) {
  if (!gSurplusCart[idx]) return;
  const target = gSurplusCart[idx].qty + delta;
  if (target <= 0) return removeSurplusCartItem(idx);
  gSurplusCart[idx].qty = target;
  renderSurplusCart();
}

function setSurplusCartQty(idx, val) {
  const q = parseInt(val, 10) || 1;
  if (q <= 0) return removeSurplusCartItem(idx);
  gSurplusCart[idx].qty = q;
  renderSurplusCart();
}

function removeSurplusCartItem(idx) {
  gSurplusCart.splice(idx, 1);
  renderSurplusCart();
}

async function submitPosSurplus() {
  if (gSurplusCart.length === 0) return showToast("ERROR", "အပိုစာရင်းသွင်းမည့် ပစ္စည်း အနည်းဆုံး ၁ ခု ရွေးချယ်ပါ။");

  const todayStr = getMMTDateString(); // 🕒 Strict MMT Today
  const payload = {
    date: document.getElementById('m-surplus-date')?.value || todayStr,
    reason: document.getElementById('m-surplus-reason')?.value || 'ရေတွက်မှုအပို',
    remark: document.getElementById('m-surplus-remark')?.value.trim() || '',
    items: gSurplusCart,
    uniqueId: 'SUR_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
  };

  try {
    const res = await callApi('savePosSurplusEntry', payload);
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အပိုစာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီး စတော့လက်ကျန် တိုးမြှင့်ပြီးပါပြီ။");
      closeModal('pos-surplus-modal');

      // 🎯 Update Memory Cache and IndexedDB with Capital Invariance Guard
      for (const si of gSurplusCart) {
        const item = gItemsCache.find(it => it.barcode === si.barcode);
        if (item) {
          item.currentStock = Number(item.currentStock || 0) + si.qty;
          item.surplusStock = Number(item.surplusStock || 0) + si.qty;
        }
      }
      if (typeof dbSaveItems === 'function') {
        await dbSaveItems(gItemsCache);
      }

      gSurplusCart = [];
      await Promise.all([loadSurplusHistory(1), loadStockInventory(gStockPage), loadCanteenDashboard()]);
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// 🎯 Delete Surplus Entry (Admin Only Rollback)
async function deletePosSurplusEntry(id, surplusNo) {
  const role = getNormalizedRole();
  if (role === 'canteencashier' || role === 'cashier') {
    return showToast("ERROR", "ငွေကိုင် (Cashier) အနေဖြင့် အပိုစာရင်း ဖျက်သိမ်းခွင့် မရှိပါ။ Admin ထံ တင်ပြပါ။");
  }

  if (!confirm(`အပိုစာရင်း (${surplusNo}) အား ဖျက်သိမ်းမည်မှာ သေချာပါသလား?\n\nတိုးမြှင့်ထားသော ပစ္စည်းအရေအတွက်ကို စတော့ထဲမှ အလိုအလျောက် ပြန်လည်နုတ်ယူပါမည်။`)) {
    return;
  }

  try {
    const res = await callApi('deletePosSurplusEntry', { id, surplusNo });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "အပိုစာရင်း ဖျက်သိမ်းပြီးပါပြီ။");
      if (typeof loadItemsCatalog === 'function') await loadItemsCatalog(false);
      await Promise.all([loadSurplusHistory(gSurplusPage), loadStockInventory(gStockPage), loadCanteenDashboard()]);
    } else {
      showToast("ERROR", res?.message || "ဖျက်သိမ်းမှု မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

function onSearchSurplusDebounced() {
  clearTimeout(gSurplusSearchTimeout);
  gSurplusSearchTimeout = setTimeout(() => { loadSurplusHistory(1); }, 250);
}

function clearSurplusFilter() {
  const sInput = document.getElementById('surplus-search');
  if (sInput) sInput.value = '';

  const rFilter = document.getElementById('surplus-reason-filter');
  if (rFilter) rFilter.value = '';

  const dFrom = document.getElementById('surplus-date-from');
  if (dFrom) dFrom.value = '';

  const dTo = document.getElementById('surplus-date-to');
  if (dTo) dTo.value = '';

  loadSurplusHistory(1);
}

function changeSurplusPage(delta) {
  loadSurplusHistory(gSurplusPage + delta);
}

async function loadSurplusHistory(page = 1) {
  gSurplusPage = Math.max(1, page);
  const searchVal = document.getElementById('surplus-search')?.value.trim() || '';
  const reason = document.getElementById('surplus-reason-filter')?.value || '';
  const dateFrom = document.getElementById('surplus-date-from')?.value || '';
  const dateTo = document.getElementById('surplus-date-to')?.value || '';

  try {
    const res = await callApi('getPosSurplusHistory', { searchVal, reason, dateFrom, dateTo, page: gSurplusPage, limit: gSurplusLimit, _t: Date.now() }, 'POST');
    if (res && res.success) {
      const records = res.data || [];
      gSurplusData = records;
      gSurplusTotalRows = res.totalRows || 0;

      const totalSurplusBadge = document.getElementById('surplus-total-value-badge');
      if (totalSurplusBadge) totalSurplusBadge.textContent = `${Number(res.totalSurplusAmount || 0).toLocaleString()} MMK`;

      const tbody = document.getElementById('surplus-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-slate-400 font-bold">အပိုပစ္စည်းစာရင်း မရှိပါ။</td></tr>`;
      } else {
        const role = getNormalizedRole();
        const canManage = role.includes('admin') || role.includes('owner');

        records.forEach((r, idx) => {
          const displayNo = gSurplusTotalRows - ((gSurplusPage - 1) * gSurplusLimit + idx);
          const actionHtml = canManage ? `
            <button onclick="deletePosSurplusEntry(${r.id}, '${escAttr(r.surplusNo)}')" class="p-1 text-rose-500 hover:bg-rose-500/10 rounded transition" title="ဖျက်မည်">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          ` : '<span class="text-slate-400">-</span>';

          tbody.innerHTML += `
            <tr class="hover:bg-slate-500/10 text-xs border-b border-[var(--border-color)]">
              <td class="text-center font-mono py-2.5 px-3 text-slate-400">${displayNo}</td>
              <td class="font-mono text-slate-400 py-2.5 px-3">${esc(r.date)}</td>
              <td class="font-mono font-bold text-emerald-500 py-2.5 px-3">${esc(r.surplusNo)}</td>
              <td class="text-center py-2.5 px-3"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-500 border border-emerald-500/30">${esc(r.reason)}</span></td>
              <td class="py-2.5 px-3 font-bold">${esc(r.itemsSummary)}</td>
              <td class="text-center font-mono font-black py-2.5 px-3">${r.totalItemsQty}</td>
              <td class="text-right font-mono font-bold text-emerald-500 py-2.5 px-3">${Number(r.totalSurplusValue || 0).toLocaleString()} MMK</td>
              <td class="py-2.5 px-3 text-slate-400">${esc(r.reportedBy)}</td>
              <td class="py-2.5 px-3 text-slate-400 truncate max-w-xs">${esc(r.remark || '-')}</td>
              <td class="text-center py-2.5 px-3 right-0 sticky bg-[var(--table-header)] border-l border-[var(--border-color)]">${actionHtml}</td>
            </tr>
          `;
        });
      }

      const start = (gSurplusPage - 1) * gSurplusLimit + 1;
      const end = Math.min(start + gSurplusLimit - 1, gSurplusTotalRows);
      const info = document.getElementById('surplus-pagination-info');
      if (info) info.textContent = gSurplusTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gSurplusTotalRows} entries`;

      const prevBtn = document.getElementById('surplus-btn-prev');
      const nextBtn = document.getElementById('surplus-btn-next');
      if (prevBtn) prevBtn.disabled = (gSurplusPage <= 1);
      if (nextBtn) nextBtn.disabled = (end >= gSurplusTotalRows);
    }
  } catch (err) {
    console.error("[CanteenWaste] Surplus History Load Error:", err);
  }
}

// ------------------------------------------------------------------------------
// 🌐 3. WINDOW GLOBAL EXPORTS
// ------------------------------------------------------------------------------
window.openWasteModal = openWasteModal;
window.handleWasteBarcodeInput = handleWasteBarcodeInput;
window.selectDropdownWasteItem = selectDropdownWasteItem;
window.searchAndAddWasteItem = searchAndAddWasteItem;
window.renderWasteCart = renderWasteCart;
window.changeWasteCartQty = changeWasteCartQty;
window.setWasteCartQty = setWasteCartQty;
window.removeWasteCartItem = removeWasteCartItem;
window.submitPosWaste = submitPosWaste;
window.deletePosWasteEntry = deletePosWasteEntry;
window.loadWasteHistory = loadWasteHistory;
window.onSearchWasteDebounced = onSearchWasteDebounced;
window.clearWasteFilter = clearWasteFilter;
window.changeWastePage = changeWastePage;

window.openSurplusModal = openSurplusModal;
window.handleSurplusBarcodeInput = handleSurplusBarcodeInput;
window.selectDropdownSurplusItem = selectDropdownSurplusItem;
window.searchAndAddSurplusItem = searchAndAddSurplusItem;
window.renderSurplusCart = renderSurplusCart;
window.changeSurplusCartQty = changeSurplusCartQty;
window.setSurplusCartQty = setSurplusCartQty;
window.removeSurplusCartItem = removeSurplusCartItem;
window.submitPosSurplus = submitPosSurplus;
window.deletePosSurplusEntry = deletePosSurplusEntry;
window.loadSurplusHistory = loadSurplusHistory;
window.onSearchSurplusDebounced = onSearchSurplusDebounced;
window.clearSurplusFilter = clearSurplusFilter;
window.changeSurplusPage = changeSurplusPage;