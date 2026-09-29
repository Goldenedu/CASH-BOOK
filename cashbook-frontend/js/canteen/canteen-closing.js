/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN STORE CLOSING, SETTLEMENT & OFFLINE PENDING SYNC
 * File: js/canteen/canteen-closing.js
 * ==============================================================================
 */

// ------------------------------------------------------------------------------
// 🔒 1. CANTEEN STORE DAY CLOSURE (ဆိုင်ပိတ်သိမ်းခြင်း)
// ------------------------------------------------------------------------------
async function openDayCloseModal() {
  const role = (gSession?.role || '').trim();
  if (role !== 'canteen_admin' && role !== 'canteen_cashier' && role !== 'Owner' && role !== 'Admin') {
    return showToast("ERROR", "ဆိုင်ပိတ်သိမ်းခွင့် မရှိပါ။");
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  document.getElementById('close-modal-date').textContent = todayStr;

  try {
    const res = await callApi('getCanteenDailySummary', { date: todayStr, _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      const dt = res.data;
      document.getElementById('close-modal-orders').textContent = `${dt.totalOrders} စောင်`;
      document.getElementById('close-modal-total').textContent = `${Number(dt.totalSales).toLocaleString()} MMK`;
      document.getElementById('close-modal-cash').textContent = `${Number(dt.cashSalesShare).toLocaleString()} MMK`;
      document.getElementById('close-modal-wallet').textContent = `${Number(dt.pocketMoneyShare).toLocaleString()} MMK`;

      const btnClose = document.getElementById('btn-confirm-day-close');
      if (dt.isClosed) {
        btnClose.disabled = true;
        btnClose.textContent = "ယနေ့အတွက် ဆိုင်ပိတ်သိမ်းပြီးဖြစ်ပါသည်";
        btnClose.className = "w-full py-3.5 bg-slate-800 text-slate-500 rounded-xl font-black text-xs cursor-not-allowed";
      } else {
        btnClose.disabled = false;
        btnClose.textContent = "အတည်ပြု ဆိုင်ပိတ်သိမ်းမည် (CLOSE REGISTER)";
        btnClose.className = "w-full py-3.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl font-black text-xs shadow-lg shadow-amber-950 active:scale-95 transition font-sans";
      }

      document.getElementById('pos-closure-modal')?.classList.remove('hidden');
    }
  } catch (err) {
    showToast("ERROR", "ဆိုင်ပိတ်စာရင်း အချက်အလက် ဆွဲမရပါ: " + err.message);
  }
}

async function executeCanteenDayClose() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const remark = document.getElementById('close-modal-remark')?.value.trim();

  // 1. Pending Offline Orders Check
  const pendingOrders = await dbGetPendingOrders();
  if (pendingOrders.length > 0) {
    return showToast("ERROR", `ဆိုင်မပိတ်မီ D1 ပေါ်သို့ မရောက်သေးသော Pending အော့ဖ်လိုင်းအရောင်း (${pendingOrders.length}) စောင်အား ဦးစွာ Sync လုပ်ပေးပါ!`);
  }

  if (!confirm(`ယနေ့ရက်စွဲ (${todayStr}) အတွက် အရောင်းစာရင်းအားလုံး ပိတ်သိမ်းမည်မှာ သေချာပါသလား?\n\nသတိပြုရန်: ဆိုင်ပိတ်ပြီးပါက ယနေ့အတွက် အရောင်းဖွင့်၍ ရတော့မည်မဟုတ်ပါ။`)) {
    return;
  }

  try {
    const res = await callApi('closeCanteenDay', { date: todayStr, remark });
    if (res && res.success) {
      showToast("SUCCESS", res.message || "ကန်တင်းဆိုင်ပိတ်သိမ်းမှု အောင်မြင်ပါသည်။");
      closeModal('pos-closure-modal');
      await loadCanteenDashboard();
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// ------------------------------------------------------------------------------
// ⏳ 2. PENDING OFFLINE ORDERS SYNC MANAGER
// ------------------------------------------------------------------------------
async function openPendingSyncModal() {
  await renderPendingOrdersTable();
  document.getElementById('pos-pending-modal')?.classList.remove('hidden');
}

async function renderPendingOrdersTable() {
  const pendingOrders = await dbGetPendingOrders();
  const tbody = document.getElementById('pending-orders-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let totalAmt = 0;
  pendingOrders.forEach(o => { totalAmt += Number(o.totalAmount || 0); });

  document.getElementById('pending-modal-orders').textContent = `${pendingOrders.length} စောင်`;
  document.getElementById('pending-modal-amount').textContent = `${totalAmt.toLocaleString()} MMK`;

  if (pendingOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-500 font-bold">D1 သို့ ပေးပို့ရန် ကျန်ရှိသော အော့ဖ်လိုင်းအရောင်း မရှိပါ။</td></tr>`;
    return;
  }

  pendingOrders.forEach((o, idx) => {
    const isWallet = (o.paymentMethod === 'Student Pocket Money');
    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/40 text-xs border-b border-slate-800/40">
        <td class="text-center font-mono py-2.5 px-3 text-slate-500">${idx + 1}</td>
        <td class="font-mono font-bold text-amber-400 py-2.5 px-3">${esc(o.invoiceNo)}</td>
        <td class="py-2.5 px-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isWallet ? 'bg-indigo-500/20 text-indigo-300' : 'bg-emerald-500/20 text-emerald-300'}">
            ${isWallet ? 'Wallet' : 'Cash'}
          </span>
        </td>
        <td class="py-2.5 px-3 truncate max-w-xs text-slate-200">${esc(o.itemsSummary)}</td>
        <td class="text-right font-mono font-bold text-white py-2.5 px-3">${Number(o.totalAmount).toLocaleString()} MMK</td>
        <td class="text-center py-2.5 px-3">
          <span class="px-2 py-0.5 rounded text-[9px] font-black bg-amber-500/20 text-amber-300 border border-amber-500/30">PENDING</span>
        </td>
      </tr>
    `;
  });
}

async function triggerManualOfflineSync() {
  if (!navigator.onLine) {
    return showToast("ERROR", "အင်တာနက်လိုင်း မရှိသေးပါ! လိုင်းပြန်ရမှသာ Sync လုပ်နိုင်ပါမည်။");
  }

  const pendingOrders = await dbGetPendingOrders();
  if (pendingOrders.length === 0) {
    return showToast("SUCCESS", "Sync လုပ်ရန် အော့ဖ်လိုင်းအရောင်း မရှိပါ။");
  }

  const btnSync = document.getElementById('btn-trigger-sync');
  if (btnSync) {
    btnSync.disabled = true;
    btnSync.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Sync လုပ်နေပါသည်...`;
  }

  try {
    const res = await callApi('syncOfflinePosOrders', { orders: pendingOrders });
    if (res && res.success) {
      // Clear synced orders from IndexedDB
      await dbClearPendingOrders();
      await updatePendingBadgeCount();
      await renderPendingOrdersTable();
      showToast("SUCCESS", res.message || "အော့ဖ်လိုင်းအရောင်းများ အားလုံး D1 သို့ Sync ပြီးပါပြီ။");
      closeModal('pos-pending-modal');
      await loadCanteenDashboard();
    } else {
      showToast("ERROR", res?.message || "Sync မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", "Sync လုပ်ဆောင်မှု အမှား: " + err.message);
  } finally {
    if (btnSync) {
      btnSync.disabled = false;
      btnSync.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span>Sync Now (D1 သို့ ပေးပို့မည်)</span>`;
    }
  }
}

// 🎯 Background Auto-sync when internet comes back
async function autoSyncPendingOrders() {
  if (!navigator.onLine) return;
  const pending = await dbGetPendingOrders();
  if (pending.length === 0) return;

  try {
    const res = await callApi('syncOfflinePosOrders', { orders: pending });
    if (res && res.success) {
      await dbClearPendingOrders();
      await updatePendingBadgeCount();
      showToast("SUCCESS", `[Auto-Sync] အော့ဖ်လိုင်းအရောင်း (${res.syncedCount}) စောင် D1 သို့ အောင်မြင်စွာ တင်ပို့ပြီးပါပြီ။`);
    }
  } catch (e) {
    console.warn("[AutoSync] Background sync retry later:", e.message);
  }
}

// ------------------------------------------------------------------------------
// 💵 3. EVENING SETTLEMENT MODAL (CLOSURE INTERLOCKED)
// ------------------------------------------------------------------------------
async function openSettlementModal() {
  const todayStr = new Date().toISOString().slice(0, 10);
  try {
    const res = await callApi('getCanteenDailySummary', { date: todayStr, _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      const dt = res.data;
      document.getElementById('set-orders').textContent = `${dt.totalOrders} Orders`;
      document.getElementById('set-total').textContent = `${Number(dt.totalSales).toLocaleString()} MMK`;
      document.getElementById('set-cash').textContent = `${Number(dt.cashSalesShare).toLocaleString()} MMK`;
      document.getElementById('set-pocket').textContent = `${Number(dt.pocketMoneyShare).toLocaleString()} MMK`;
      document.getElementById('set-payout-text').textContent = `${Number(dt.pocketMoneyShare).toLocaleString()} MMK`;

      const box = document.getElementById('set-closure-status-box');
      const icon = document.getElementById('set-closure-icon');
      const text = document.getElementById('set-closure-text');
      const btnConfirm = document.getElementById('btn-confirm-settlement');

      // 🔒 CLOSURE INTERLOCK VALIDATION
      if (dt.isSettled) {
        box.className = "p-2.5 rounded-xl border text-[11px] font-sans flex items-center gap-2 bg-emerald-950/40 border-emerald-500/30 text-emerald-400";
        icon.className = "fa-solid fa-circle-check text-emerald-400";
        text.textContent = `ဤရက်စွဲအတွက် Finance နှင့် ငွေရှင်းပြီးဖြစ်ပါသည် (${dt.settlement?.settlement_no || dt.settlement?.settlementNo})`;
        btnConfirm.disabled = true;
      } else if (!dt.isClosed) {
        box.className = "p-2.5 rounded-xl border text-[11px] font-sans flex items-center gap-2 bg-rose-950/40 border-rose-500/30 text-rose-300";
        icon.className = "fa-solid fa-triangle-exclamation text-rose-400";
        text.textContent = "သတိပြုရန်: ကန်တင်းဘက်မှ ဆိုင်မပိတ်ရသေးပါ! ဆိုင်ပိတ်ပြီးမှသာ ငွေရှင်းပေးနိုင်ပါမည်။";
        btnConfirm.disabled = true;
      } else {
        box.className = "p-2.5 rounded-xl border text-[11px] font-sans flex items-center gap-2 bg-emerald-950/40 border-emerald-500/30 text-emerald-400";
        icon.className = "fa-solid fa-circle-check text-emerald-400";
        text.textContent = `ကန်တင်းဆိုင်ပိတ်သိမ်းပြီးဖြစ်ပါသည် (${dt.closure?.closedBy || 'Done'})။ ငွေရှင်းလင်းနိုင်ပါပြီ။`;
        btnConfirm.disabled = false;
      }

      document.getElementById('pos-settlement-modal')?.classList.remove('hidden');
    }
  } catch (e) {
    showToast("ERROR", "Summary ခေါ်ယူ၍ မရပါ: " + e.message);
  }
}

async function confirmCanteenSettlement(pocketShare, cashShare) {
  if (!confirm("Finance မှ Pocket Money ရောင်းရငွေ အပြင်တွင် အမှန်တကယ် လက်ရောက်ရှင်းပြီးပြီလား?")) return;

  const todayStr = new Date().toISOString().slice(0, 10);
  const pShare = pocketShare !== undefined ? pocketShare : parseFloat(document.getElementById('set-pocket')?.textContent.replace(/[^0-9.-]+/g, '') || 0);
  const cShare = cashShare !== undefined ? cashShare : parseFloat(document.getElementById('set-cash')?.textContent.replace(/[^0-9.-]+/g, '') || 0);

  const payload = {
    date: todayStr,
    pocketMoneyShare: pShare,
    cashSalesShare: cShare,
    netPayoutAmount: pShare,
    receivedBy: gSession?.name || 'Canteen Manager'
  };

  try {
    const res = await callApi('saveCanteenSettlement', payload);
    if (res && res.success) {
      showToast("SUCCESS", "ငွေရှင်းလင်းမှု မှတ်တမ်းတင်ပြီးပါပြီ။");
      closeModal('pos-settlement-modal');
      if (gActiveView === 'dashboard') loadCanteenDashboard();
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (e) {
    showToast("ERROR", e.message);
  }
}

// ------------------------------------------------------------------------------
// ⚙️ 4. SYSTEM SETTINGS (DAILY ALLOWANCE CAP CONTROLLER)
// ------------------------------------------------------------------------------
async function loadPosSettings() {
  try {
    const res = await callApi('getPosSettings', { _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      if (res.data.daily_spending_cap) {
        gDailySpendingCap = Number(res.data.daily_spending_cap);
        await dbSaveSetting('daily_spending_cap', gDailySpendingCap);
      }
    }
  } catch (e) {
    // Offline Fallback
    const cachedCap = await dbGetSetting('daily_spending_cap');
    if (cachedCap) gDailySpendingCap = Number(cachedCap);
  }
}

function openSettingsModal() {
  const role = (gSession?.role || '').trim();
  if (role !== 'canteen_admin' && role !== 'Owner' && role !== 'Admin') {
    return showToast("ERROR", "ဆက်တင် ပြင်ဆင်ခွင့် မရှိပါ။ (Admin Only)");
  }

  document.getElementById('m-set-daily-cap').value = gDailySpendingCap;
  document.getElementById('pos-settings-modal')?.classList.remove('hidden');
}

async function submitPosSettings(e) {
  if (e && e.preventDefault) e.preventDefault();
  const capVal = document.getElementById('m-set-daily-cap')?.value.trim();
  if (!capVal || isNaN(capVal)) return showToast("ERROR", "ကျောင်းသား တစ်နေ့တာ ကန့်သတ်ငွေ အတိအကျ ထည့်သွင်းပါ။");

  try {
    const res = await callApi('updatePosSettings', {
      settingKey: 'daily_spending_cap',
      settingValue: String(capVal)
    });

    if (res && res.success) {
      gDailySpendingCap = Number(capVal);
      await dbSaveSetting('daily_spending_cap', gDailySpendingCap);
      showToast("SUCCESS", `Daily Cap ကို ${Number(capVal).toLocaleString()} MMK သို့ ပြင်ဆင်ပြီးပါပြီ။`);
      closeModal('pos-settings-modal');
      
      if (gCurrentStudent && typeof renderStudentCard === 'function') renderStudentCard();
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// ------------------------------------------------------------------------------
// 🧾 5. SALES ORDERS HISTORY (20 ROWS PAGINATED)
// ------------------------------------------------------------------------------
function onSearchSalesDebounced() {
  clearTimeout(gSalesSearchTimeout);
  gSalesSearchTimeout = setTimeout(() => { loadSalesOrdersHistory(1); }, 250);
}

function clearSalesFilter() {
  document.getElementById('sales-search').value = '';
  document.getElementById('sales-method-filter').value = '';
  document.getElementById('sales-date-from').value = '';
  document.getElementById('sales-date-to').value = '';
  loadSalesOrdersHistory(1);
}

function changeSalesPage(delta) {
  loadSalesOrdersHistory(gSalesPage + delta);
}

async function loadSalesOrdersHistory(page = 1) {
  gSalesPage = Math.max(1, page);
  const searchVal = document.getElementById('sales-search')?.value.trim() || '';
  const paymentMethod = document.getElementById('sales-method-filter')?.value || '';
  const dateFrom = document.getElementById('sales-date-from')?.value || '';
  const dateTo = document.getElementById('sales-date-to')?.value || '';

  try {
    const res = await callApi('getPosSalesOrdersHistory', {
      searchVal, paymentMethod, dateFrom, dateTo,
      page: gSalesPage, limit: gSalesLimit, _t: Date.now()
    }, 'POST');

    if (res && res.success) {
      const records = res.data || [];
      gSalesOrdersData = records;
      gSalesTotalRows = res.totalRows || 0;

      const totalSalesBadge = document.getElementById('sales-total-amount-badge');
      if (totalSalesBadge) totalSalesBadge.textContent = `${Number(res.totalSalesAmount || 0).toLocaleString()} MMK`;

      const tbody = document.getElementById('sales-table-body');
      if (!tbody) return;
      tbody.innerHTML = '';

      if (records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-500 font-bold">အရောင်းမှတ်တမ်း မရှိပါ။</td></tr>`;
      } else {
        records.forEach((r, idx) => {
          const displayNo = gSalesTotalRows - ((gSalesPage - 1) * gSalesLimit + idx);
          const isWallet = (r.paymentMethod === 'Student Pocket Money');

          tbody.innerHTML += `
            <tr class="hover:bg-slate-800/40 text-xs border-b border-slate-800/40">
              <td class="text-center font-mono py-2.5 px-3 text-slate-500">${displayNo}</td>
              <td class="font-mono text-slate-300 py-2.5 px-3">${esc(r.date)}</td>
              <td class="font-mono font-bold text-sky-400 py-2.5 px-3">${esc(r.invoiceNo)}</td>
              <td class="py-2.5 px-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isWallet ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'}">
                  ${isWallet ? 'Wallet' : 'Cash'}
                </span>
              </td>
              <td class="font-mono py-2.5 px-3 text-slate-300">${r.studentId ? `ID ${r.studentId}` : '-'}</td>
              <td class="py-2.5 px-3 text-slate-200">${esc(r.itemsSummary)}</td>
              <td class="text-right font-mono font-bold text-white py-2.5 px-3">${Number(r.totalAmount).toLocaleString()} MMK</td>
              <td class="text-right font-mono font-bold text-teal-400 py-2.5 px-3">+${Number(r.netProfit).toLocaleString()}</td>
              <td class="text-center py-2.5 px-3">
                <button onclick="reprintSalesSlip('${escAttr(r.invoiceNo)}')" class="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition" title="Print Receipt">
                  <i class="fa-solid fa-print"></i>
                </button>
              </td>
            </tr>
          `;
        });
      }

      const start = (gSalesPage - 1) * gSalesLimit + 1;
      const end = Math.min(start + gSalesLimit - 1, gSalesTotalRows);
      const info = document.getElementById('sales-pagination-info');
      if (info) info.textContent = gSalesTotalRows === 0 ? "Showing 0 entries" : `Showing ${start} to ${end} of ${gSalesTotalRows} entries`;

      const prevBtn = document.getElementById('sales-btn-prev');
      const nextBtn = document.getElementById('sales-btn-next');
      if (prevBtn) prevBtn.disabled = (gSalesPage <= 1);
      if (nextBtn) nextBtn.disabled = (end >= gSalesTotalRows);
    }
  } catch (err) {
    console.error("Sales History Load Error:", err);
  }
}

function reprintSalesSlip(invoiceNo) {
  const order = gSalesOrdersData.find(o => o.invoiceNo === invoiceNo);
  if (!order) return showToast("ERROR", "ပြေစာ အချက်အလက် မတွေ့ပါ။");
  const stuObj = order.studentId ? { studentId: order.studentId, name: `Student ID ${order.studentId}` } : null;
  printPosReceipt(order.invoiceNo, order.totalAmount, order.itemsSummary, order.paymentMethod, stuObj);
}

// Global Exports
window.openDayCloseModal = openDayCloseModal;
window.executeCanteenDayClose = executeCanteenDayClose;
window.openPendingSyncModal = openPendingSyncModal;
window.triggerManualOfflineSync = triggerManualOfflineSync;
window.autoSyncPendingOrders = autoSyncPendingOrders;
window.openSettlementModal = openSettlementModal;
window.confirmCanteenSettlement = confirmCanteenSettlement;
window.loadPosSettings = loadPosSettings;
window.openSettingsModal = openSettingsModal;
window.submitPosSettings = submitPosSettings;
window.loadSalesOrdersHistory = loadSalesOrdersHistory;
window.onSearchSalesDebounced = onSearchSalesDebounced;
window.clearSalesFilter = clearSalesFilter;
window.changeSalesPage = changeSalesPage;
window.reprintSalesSlip = reprintSalesSlip;