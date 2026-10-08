/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN STORE CLOSING, SETTLEMENT & OFFLINE PENDING SYNC
 * File: js/canteen/canteen-closing.js (Enterprise V9.3 Full Production Edition)
 * 💡 Features:
 *   1. 🕒 Strict MMT (UTC+06:30) Timezone Universal Engine (Recursion-Free)
 *   2. 📊 Live Dashboard: Real-time Today, THIS MONTH, Capital & Net Loss Aggregator
 *   3. 🔒 Canteen Store Day Closure (Cashier & Admin Allowed, Pending Guarded)
 *   4. 💵 Evening Finance Settlement (Closure Interlocked)
 *   5. ⏳ Resilient Offline Pending Queue Management & QUIC Settle Auto-Sync
 *   6. 🧾 20-Row Paginated Sales History with Slip Thermal Printer
 *   7. 🛡️ Defensive Null-Safe DOM Renderers (Zero Crash Guarantee)
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

// 🛡️ Safe Fallback for HTML Escape
var esc = window.esc || (s => s ? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '');
var escAttr = window.escAttr || (s => s ? String(s).replace(/'/g, "\\'") : '');

// 🛡️ Sync Mutex Lock (Prevents Socket Storm & ERR_CONNECTION_RESET)
var _isAutoSyncing = false;

// ------------------------------------------------------------------------------
// 📊 0. LIVE CANTEEN DASHBOARD CONTROLLER (TODAY + THIS MONTH + ALL-TIME)
// ------------------------------------------------------------------------------
async function loadCanteenDashboard() {
  try {
    const res = await callApi('getCanteenDashboardMetrics', { _t: Date.now() }, 'POST');
    if (!res || !res.success || !res.data) return;

    const { 
      today, thisMonth, allTime, totalStockCapital, lowStockCount, 
      todayLossCost, todaySurplusValue, todayNetLoss, 
      monthLossCost, monthSurplusValue, monthNetLoss,
      allTimeLossCost, allTimeSurplusValue, allTimeNetLoss, date 
    } = res.data;

    // ရက်စွဲ Label
    const dateLabel = document.getElementById('dash-date-label');
    if (dateLabel) dateLabel.textContent = date || getMMTDateString();

    // ၁။ Settlement Status Badge
    const settleBadge = document.getElementById('dash-settle-badge');
    if (settleBadge) {
      if (today?.isSettled) {
        settleBadge.className = "px-2.5 py-1 rounded-xl text-[11px] font-black bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 font-mono";
        settleBadge.textContent = `SETTLED (${today.settlement?.settlementNo || 'DONE'})`;
      } else {
        settleBadge.className = "px-2.5 py-1 rounded-xl text-[11px] font-black bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30 font-mono animate-pulse";
        settleBadge.textContent = "PENDING CLEARING";
      }
    }

    // ၂။ Closure Status Badge
    const closureBadge = document.getElementById('dash-closure-badge');
    if (closureBadge) {
      if (today?.isClosed) {
        closureBadge.className = "px-2.5 py-1 rounded-xl text-[11px] font-black bg-rose-500/20 text-rose-500 border border-rose-500/30 font-mono";
        closureBadge.textContent = `CLOSED (${today.closure?.closedBy || 'DONE'})`;
      } else {
        closureBadge.className = "px-2.5 py-1 rounded-xl text-[11px] font-black bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 font-mono";
        closureBadge.textContent = "REGISTER OPEN";
      }
    }

    // Header Close Button Status Text
    const headerCloseBtnText = document.getElementById('header-close-status-text');
    if (headerCloseBtnText) {
      headerCloseBtnText.textContent = today?.isClosed ? "ဆိုင်ပိတ်ပြီး" : "ဆိုင်ပိတ်မည်";
    }

    // ၃။ Today's Operations KPI Render (Defensive Null-Safe)
    const elTodaySales = document.getElementById('dash-today-sales');
    if (elTodaySales) elTodaySales.textContent = `${Number(today?.totalSales || 0).toLocaleString()} MMK`;

    const elTodayOrders = document.getElementById('dash-today-orders');
    if (elTodayOrders) elTodayOrders.textContent = `${today?.totalOrders || 0} Orders`;

    const elTodayWallet = document.getElementById('dash-today-wallet');
    if (elTodayWallet) elTodayWallet.textContent = `${Number(today?.pocketMoneyShare || 0).toLocaleString()} MMK`;

    const elTodayCash = document.getElementById('dash-today-cash');
    if (elTodayCash) elTodayCash.textContent = `${Number(today?.cashSalesShare || 0).toLocaleString()} MMK`;

    const elTodayProfit = document.getElementById('dash-today-profit');
    if (elTodayProfit) elTodayProfit.textContent = `+${Number(today?.totalProfit || 0).toLocaleString()} MMK`;

    // 🎯 NET LOSS DASHBOARD RENDER (Waste - Surplus)
    const wasteSubEl = document.getElementById('dash-today-waste-sub');
    if (wasteSubEl) wasteSubEl.textContent = Number(todayLossCost || 0).toLocaleString();

    const surplusSubEl = document.getElementById('dash-today-surplus-sub');
    if (surplusSubEl) surplusSubEl.textContent = Number(todaySurplusValue || 0).toLocaleString();

    const todayLossEl = document.getElementById('dash-today-loss');
    if (todayLossEl) {
      const netVal = Number(todayNetLoss || 0);
      if (netVal > 0) {
        todayLossEl.className = "text-lg font-black text-rose-500 font-mono mt-1";
        todayLossEl.textContent = `-${netVal.toLocaleString()} MMK`;
      } else if (netVal < 0) {
        todayLossEl.className = "text-lg font-black text-emerald-500 font-mono mt-1";
        todayLossEl.textContent = `+${Math.abs(netVal).toLocaleString()} MMK`;
      } else {
        todayLossEl.className = "text-lg font-black text-slate-400 font-mono mt-1";
        todayLossEl.textContent = `0 MMK`;
      }
    }

    // --------------------------------------------------------------------------
    // ၄။ 🎯 THIS MONTH'S OPERATIONS KPI RENDER (NEW)
    // --------------------------------------------------------------------------
    const monthData = thisMonth || {};
    const elMonthLabel = document.getElementById('dash-month-label');
    if (elMonthLabel) elMonthLabel.textContent = monthData.monthPrefix || (date ? date.slice(0, 7) : '');

    const elMonthSales = document.getElementById('dash-month-sales');
    if (elMonthSales) elMonthSales.textContent = `${Number(monthData.totalSales || 0).toLocaleString()} MMK`;

    const elMonthOrders = document.getElementById('dash-month-orders');
    if (elMonthOrders) elMonthOrders.textContent = `${monthData.totalOrders || 0} Orders`;

    const elMonthWallet = document.getElementById('dash-month-wallet');
    if (elMonthWallet) elMonthWallet.textContent = `${Number(monthData.pocketMoneyShare || 0).toLocaleString()} MMK`;

    const elMonthCash = document.getElementById('dash-month-cash');
    if (elMonthCash) elMonthCash.textContent = `${Number(monthData.cashSalesShare || 0).toLocaleString()} MMK`;

    const elMonthProfit = document.getElementById('dash-month-profit');
    if (elMonthProfit) elMonthProfit.textContent = `+${Number(monthData.totalProfit || 0).toLocaleString()} MMK`;

    const elMonthWasteSub = document.getElementById('dash-month-waste-sub');
    if (elMonthWasteSub) elMonthWasteSub.textContent = Number(monthLossCost || monthData.monthLossCost || 0).toLocaleString();

    const elMonthSurplusSub = document.getElementById('dash-month-surplus-sub');
    if (elMonthSurplusSub) elMonthSurplusSub.textContent = Number(monthSurplusValue || monthData.monthSurplusValue || 0).toLocaleString();

    const elMonthLoss = document.getElementById('dash-month-loss');
    if (elMonthLoss) {
      const mNetVal = Number(monthNetLoss !== undefined ? monthNetLoss : (monthData.monthNetLoss || 0));
      if (mNetVal > 0) {
        elMonthLoss.className = "text-lg font-black text-rose-500 font-mono mt-1";
        elMonthLoss.textContent = `-${mNetVal.toLocaleString()} MMK`;
      } else if (mNetVal < 0) {
        elMonthLoss.className = "text-lg font-black text-emerald-500 font-mono mt-1";
        elMonthLoss.textContent = `+${Math.abs(mNetVal).toLocaleString()} MMK`;
      } else {
        elMonthLoss.className = "text-lg font-black text-slate-400 font-mono mt-1";
        elMonthLoss.textContent = `0 MMK`;
      }
    }

    // --------------------------------------------------------------------------
    // ၅။ All-Time & Capital Investment Render (Defensive Null-Safe)
    // --------------------------------------------------------------------------
    const elAllSales = document.getElementById('dash-all-sales');
    if (elAllSales) elAllSales.textContent = `${Number(allTime?.totalSales || 0).toLocaleString()} MMK`;

    const elAllWallet = document.getElementById('dash-all-wallet');
    if (elAllWallet) elAllWallet.textContent = `${Number(allTime?.pocketMoneyShare || 0).toLocaleString()} MMK`;

    const elAllCash = document.getElementById('dash-all-cash');
    if (elAllCash) elAllCash.textContent = `${Number(allTime?.cashSalesShare || 0).toLocaleString()} MMK`;

    const elAllOrders = document.getElementById('dash-all-orders');
    if (elAllOrders) elAllOrders.textContent = `${Number(allTime?.totalOrders || 0)} Invoices`;

    // 💰 Surplus ကြောင့် Capital မတက်စေသော တိကျသည့် စတော့ရင်းနှီးငွေ
    const capitalEl = document.getElementById('dash-stock-capital');
    if (capitalEl) {
      const capitalVal = totalStockCapital !== undefined ? totalStockCapital : (allTime?.totalStockCapital || 0);
      capitalEl.textContent = `${Number(capitalVal).toLocaleString()} MMK`;
    }

    const allLossEl = document.getElementById('dash-all-loss');
    if (allLossEl) {
      const allNetVal = Number(allTimeNetLoss || 0);
      if (allNetVal > 0) {
        allLossEl.className = "text-xs font-black text-rose-500 font-mono";
        allLossEl.textContent = `-${allNetVal.toLocaleString()} MMK`;
      } else if (allNetVal < 0) {
        allLossEl.className = "text-xs font-black text-emerald-500 font-mono";
        allLossEl.textContent = `+${Math.abs(allNetVal).toLocaleString()} MMK`;
      } else {
        allLossEl.className = "text-xs font-black text-slate-400 font-mono";
        allLossEl.textContent = `0 MMK`;
      }
    }

    const lowStockAlert = document.getElementById('dash-low-stock-alert');
    if (lowStockAlert) {
      if (lowStockCount > 0) {
        lowStockAlert.textContent = `⚠️ Low Stock: ${lowStockCount} မျိုး`;
        lowStockAlert.classList.remove('hidden');
      } else {
        lowStockAlert.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error("[CanteenClosing] Dashboard Load Error:", err);
  }
}

// ------------------------------------------------------------------------------
// 🔒 1. CANTEEN STORE DAY CLOSURE (CASHIER & ADMIN BOTH ALLOWED)
// ------------------------------------------------------------------------------
async function openDayCloseModal() {
  const role = getNormalizedRole();
  // 🎯 Cashier နှင့် Admin နှစ်ဦးစလုံး ဆိုင်ပိတ်ခွင့်ရှိသည်
  const canClose = role.includes('admin') || role.includes('cashier') || role.includes('owner');
  
  if (!canClose) {
    return showToast("ERROR", "ဆိုင်ပိတ်သိမ်းခွင့် မရှိပါ။");
  }

  const todayStr = getMMTDateString(); // 🕒 Strict MMT Today
  const dateEl = document.getElementById('close-modal-date');
  if (dateEl) dateEl.textContent = todayStr;

  try {
    const res = await callApi('getCanteenDailySummary', { date: todayStr, _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      const dt = res.data;
      
      const elOrders = document.getElementById('close-modal-orders');
      if (elOrders) elOrders.textContent = `${dt.totalOrders || 0} စောင်`;

      const elTotal = document.getElementById('close-modal-total');
      if (elTotal) elTotal.textContent = `${Number(dt.totalSales || 0).toLocaleString()} MMK`;

      const elCash = document.getElementById('close-modal-cash');
      if (elCash) elCash.textContent = `${Number(dt.cashSalesShare || 0).toLocaleString()} MMK`;

      const elWallet = document.getElementById('close-modal-wallet');
      if (elWallet) elWallet.textContent = `${Number(dt.pocketMoneyShare || 0).toLocaleString()} MMK`;

      const btnClose = document.getElementById('btn-confirm-day-close');
      if (btnClose) {
        if (dt.isClosed) {
          btnClose.disabled = true;
          btnClose.textContent = "ယနေ့အတွက် ဆိုင်ပိတ်သိမ်းပြီးဖြစ်ပါသည်";
          btnClose.className = "w-full py-3.5 bg-slate-200 dark:bg-slate-800 text-slate-400 rounded-xl font-black text-xs cursor-not-allowed";
        } else {
          btnClose.disabled = false;
          btnClose.textContent = "အတည်ပြု ဆိုင်ပိတ်သိမ်းမည် (CLOSE REGISTER)";
          btnClose.className = "w-full py-3.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white rounded-xl font-black text-xs shadow-lg shadow-amber-950/20 active:scale-95 transition font-sans";
        }
      }

      document.getElementById('pos-closure-modal')?.classList.remove('hidden');
    } else {
      showToast("ERROR", res?.message || "ဆိုင်ပိတ်စာရင်း ဆွဲယူ၍ မရပါ");
    }
  } catch (err) {
    showToast("ERROR", "ဆိုင်ပိတ်စာရင်း အချက်အလက် ဆွဲမရပါ: " + err.message);
  }
}

async function executeCanteenDayClose() {
  const todayStr = getMMTDateString(); // 🕒 Strict MMT Today
  const remark = document.getElementById('close-modal-remark')?.value.trim();

  // 🛡️ Pending Guard: မရောက်သေးသော အော့ဖ်လိုင်းအရောင်းများ ရှိနေပါက ဆိုင်ပိတ်ခွင့် မပြုပါ
  if (typeof dbGetPendingOrders === 'function') {
    const pendingOrders = await dbGetPendingOrders();
    if (pendingOrders.length > 0) {
      return showToast("ERROR", `ဆိုင်မပိတ်မီ D1 ပေါ်သို့ မရောက်သေးသော Pending အော့ဖ်လိုင်းအရောင်း (${pendingOrders.length}) စောင်အား ဦးစွာ Sync လုပ်ပေးပါ!`);
    }
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
  if (typeof dbGetPendingOrders !== 'function') return;
  const pendingOrders = await dbGetPendingOrders();
  const tbody = document.getElementById('pending-orders-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let totalAmt = 0;
  pendingOrders.forEach(o => { totalAmt += Number(o.totalAmount || 0); });

  const elOrders = document.getElementById('pending-modal-orders');
  if (elOrders) elOrders.textContent = `${pendingOrders.length} စောင်`;

  const elAmount = document.getElementById('pending-modal-amount');
  if (elAmount) elAmount.textContent = `${totalAmt.toLocaleString()} MMK`;

  if (pendingOrders.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400 font-bold">D1 သို့ ပေးပို့ရန် ကျန်ရှိသော အော့ဖ်လိုင်းအရောင်း မရှိပါ။</td></tr>`;
    return;
  }

  pendingOrders.forEach((o, idx) => {
    const isWallet = (o.paymentMethod === 'Student Pocket Money');
    tbody.innerHTML += `
      <tr class="hover:bg-slate-500/10 text-xs border-b border-[var(--border-color)]">
        <td class="text-center font-mono py-2.5 px-3 text-slate-400">${idx + 1}</td>
        <td class="font-mono font-bold text-amber-500 py-2.5 px-3">${esc(o.invoiceNo)}</td>
        <td class="py-2.5 px-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isWallet ? 'bg-indigo-500/20 text-indigo-500' : 'bg-emerald-500/20 text-emerald-500'}">
            ${isWallet ? 'Wallet' : 'Cash'}
          </span>
        </td>
        <td class="py-2.5 px-3 truncate max-w-xs">${esc(o.itemsSummary)}</td>
        <td class="text-right font-mono font-bold py-2.5 px-3">${Number(o.totalAmount || 0).toLocaleString()} MMK</td>
        <td class="text-center py-2.5 px-3">
          <span class="px-2 py-0.5 rounded text-[9px] font-black bg-amber-500/20 text-amber-500 border border-amber-500/30">PENDING</span>
        </td>
      </tr>
    `;
  });
}

async function triggerManualOfflineSync() {
  if (!navigator.onLine) {
    return showToast("ERROR", "အင်တာနက်လိုင်း မရှိသေးပါ! လိုင်းပြန်ရမှသာ Sync လုပ်နိုင်ပါမည်။");
  }

  if (typeof dbGetPendingOrders !== 'function') return;
  const pendingOrders = await dbGetPendingOrders();
  if (pendingOrders.length === 0) {
    return showToast("SUCCESS", "Sync လုပ်ရန် အော့ဖ်လိုင်းအရောင်း မရှိပါ။");
  }

  const btnSync = document.getElementById('btn-trigger-sync');
  if (btnSync) {
    btnSync.disabled = true;
    btnSync.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Sync လုပ်နေပါသည်...`;
  }

  _isAutoSyncing = true;
  try {
    const res = await callApi('syncOfflinePosOrders', { orders: pendingOrders });
    if (res && res.success) {
      if (typeof dbClearPendingOrders === 'function') await dbClearPendingOrders();
      if (typeof updatePendingBadgeCount === 'function') await updatePendingBadgeCount();
      await renderPendingOrdersTable();
      showToast("SUCCESS", res.message || "အော့ဖ်လိုင်းအရောင်းများ အားလုံး D1 သို့ Sync ပြီးပါပြီ။");
      closeModal('pos-pending-modal');
      if (typeof loadCanteenDashboard === 'function') await loadCanteenDashboard();
    } else {
      showToast("ERROR", res?.message || "Sync မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", "Sync လုပ်ဆောင်မှု အမှား: " + err.message);
  } finally {
    _isAutoSyncing = false;
    if (btnSync) {
      btnSync.disabled = false;
      btnSync.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span>Sync Now (D1 သို့ ပေးပို့မည်)</span>`;
    }
  }
}

// 🛡️ Resilient Background Auto-Sync with QUIC Settle Guard & Silent Retry
async function autoSyncPendingOrders(retryCount = 0) {
  if (!navigator.onLine || typeof dbGetPendingOrders !== 'function') return;
  if (_isAutoSyncing && retryCount === 0) return;

  const pending = await dbGetPendingOrders();
  if (!pending || pending.length === 0) return;

  _isAutoSyncing = true;
  try {
    // 🛡️ Settle Guard: On initial attempt after network restoration, pause briefly
    // to allow browser connection pool to purge stale/dead QUIC (HTTP/3) UDP sessions.
    if (retryCount === 0) {
      await new Promise(r => setTimeout(r, 1200));
    }

    // Verify still online and pending items still exist
    if (!navigator.onLine) return;
    const currentPending = await dbGetPendingOrders();
    if (!currentPending || currentPending.length === 0) return;

    const res = await callApi('syncOfflinePosOrders', { orders: currentPending });
    if (res && res.success) {
      if (typeof dbClearPendingOrders === 'function') await dbClearPendingOrders();
      if (typeof updatePendingBadgeCount === 'function') await updatePendingBadgeCount();
      
      const modal = document.getElementById('pos-pending-modal');
      if (modal && !modal.classList.contains('hidden')) {
        await renderPendingOrdersTable();
      }

      if (typeof loadCanteenDashboard === 'function' && gActiveView === 'dashboard') {
        await loadCanteenDashboard();
      }

      showToast("SUCCESS", `[Auto-Sync] အော့ဖ်လိုင်းအရောင်း (${res.syncedCount || currentPending.length}) စောင် D1 သို့ အောင်မြင်စွာ တင်ပို့ပြီးပါပြီ။`);
    } else if (retryCount < 2 && navigator.onLine) {
      setTimeout(() => autoSyncPendingOrders(retryCount + 1), 3000);
    }
  } catch (err) {
    // Graceful silent retry for background task - prevents showing red error toast during connection stabilization
    if (retryCount < 2 && navigator.onLine) {
      setTimeout(() => autoSyncPendingOrders(retryCount + 1), 3000);
    }
  } finally {
    _isAutoSyncing = false;
  }
}

// ------------------------------------------------------------------------------
// 💵 3. EVENING SETTLEMENT MODAL (CASHIER & ADMIN BOTH ALLOWED)
// ------------------------------------------------------------------------------
async function openSettlementModal() {
  const role = getNormalizedRole();
  // 🎯 Cashier နှင့် Admin နှစ်ဦးစလုံး ညနေစာရင်းရှင်းခွင့်ရှိသည်
  const canSettle = role.includes('admin') || role.includes('cashier') || role.includes('owner');

  if (!canSettle) {
    return showToast("ERROR", "ငွေရှင်းလင်းခွင့် မရှိပါ။");
  }

  const todayStr = getMMTDateString(); // 🕒 Strict MMT Today
  try {
    const res = await callApi('getCanteenDailySummary', { date: todayStr, _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      const dt = res.data;

      const elOrders = document.getElementById('set-orders');
      if (elOrders) elOrders.textContent = `${dt.totalOrders || 0} Orders`;

      const elTotal = document.getElementById('set-total');
      if (elTotal) elTotal.textContent = `${Number(dt.totalSales || 0).toLocaleString()} MMK`;

      const elCash = document.getElementById('set-cash');
      if (elCash) elCash.textContent = `${Number(dt.cashSalesShare || 0).toLocaleString()} MMK`;

      const elPocket = document.getElementById('set-pocket');
      if (elPocket) elPocket.textContent = `${Number(dt.pocketMoneyShare || 0).toLocaleString()} MMK`;

      const elPayout = document.getElementById('set-payout-text');
      if (elPayout) elPayout.textContent = `${Number(dt.pocketMoneyShare || 0).toLocaleString()} MMK`;

      const box = document.getElementById('set-closure-status-box');
      const icon = document.getElementById('set-closure-icon');
      const text = document.getElementById('set-closure-text');
      const btnConfirm = document.getElementById('btn-confirm-settlement');

      if (dt.isSettled) {
        if (box) box.className = "p-2.5 rounded-xl border text-[11px] font-sans flex items-center gap-2 bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400";
        if (icon) icon.className = "fa-solid fa-circle-check text-emerald-500";
        if (text) text.textContent = `ဤရက်စွဲအတွက် Finance နှင့် ငွေရှင်းပြီးဖြစ်ပါသည် (${dt.settlement?.settlement_no || dt.settlement?.settlementNo})`;
        if (btnConfirm) btnConfirm.disabled = true;
      } else if (!dt.isClosed) {
        if (box) box.className = "p-2.5 rounded-xl border text-[11px] font-sans flex items-center gap-2 bg-rose-500/10 border-rose-500/30 text-rose-500";
        if (icon) icon.className = "fa-solid fa-triangle-exclamation text-rose-500";
        if (text) text.textContent = "သတိပြုရန်: ကန်တင်းဘက်မှ ဆိုင်မပိတ်ရသေးပါ! ဆိုင်ပိတ်ပြီးမှသာ ငွေရှင်းပေးနိုင်ပါမည်။";
        if (btnConfirm) btnConfirm.disabled = true;
      } else {
        if (box) box.className = "p-2.5 rounded-xl border text-[11px] font-sans flex items-center gap-2 bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400";
        if (icon) icon.className = "fa-solid fa-circle-check text-emerald-500";
        if (text) text.textContent = `ကန်တင်းဆိုင်ပိတ်သိမ်းပြီးဖြစ်ပါသည် (${dt.closure?.closedBy || 'Done'})။ ငွေရှင်းလင်းနိုင်ပါပြီ။`;
        if (btnConfirm) btnConfirm.disabled = false;
      }

      document.getElementById('pos-settlement-modal')?.classList.remove('hidden');
    } else {
      showToast("ERROR", res?.message || "Summary ခေါ်ယူ၍ မရပါ");
    }
  } catch (e) {
    showToast("ERROR", "Summary ခေါ်ယူ၍ မရပါ: " + e.message);
  }
}

async function confirmCanteenSettlement(pocketShare, cashShare) {
  if (!confirm("Finance မှ Pocket Money ရောင်းရငွေ အပြင်တွင် အမှန်တကယ် လက်ရောက်ရှင်းပြီးပြီလား?")) return;

  const todayStr = getMMTDateString(); // 🕒 Strict MMT Today
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
// ⚙️ 4. SYSTEM SETTINGS (DAILY ALLOWANCE CAP CONTROLLER - ADMIN ONLY)
// ------------------------------------------------------------------------------
async function loadPosSettings() {
  try {
    const res = await callApi('getPosSettings', { _t: Date.now() }, 'POST');
    if (res && res.success && res.data) {
      if (res.data.daily_spending_cap) {
        gDailySpendingCap = Number(res.data.daily_spending_cap);
        if (typeof dbSaveSetting === 'function') {
          await dbSaveSetting('daily_spending_cap', gDailySpendingCap);
        }
      }
    }
  } catch (e) {
    if (typeof dbGetSetting === 'function') {
      const cachedCap = await dbGetSetting('daily_spending_cap');
      if (cachedCap) gDailySpendingCap = Number(cachedCap);
    }
  }
}

function openSettingsModal() {
  const role = getNormalizedRole();
  // 🎯 Settings သည် Admin/Owner သီးသန့်ဖြစ်သည်
  if (!role.includes('admin') && !role.includes('owner')) {
    return showToast("ERROR", "ဆက်တင် ပြင်ဆင်ခွင့် မရှိပါ။ (Admin Only)");
  }

  const inputCap = document.getElementById('m-set-daily-cap');
  if (inputCap) inputCap.value = gDailySpendingCap;
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
      if (typeof dbSaveSetting === 'function') {
        await dbSaveSetting('daily_spending_cap', gDailySpendingCap);
      }
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
  const sInput = document.getElementById('sales-search');
  if (sInput) sInput.value = '';

  const mFilter = document.getElementById('sales-method-filter');
  if (mFilter) mFilter.value = '';

  const dFrom = document.getElementById('sales-date-from');
  if (dFrom) dFrom.value = '';

  const dTo = document.getElementById('sales-date-to');
  if (dTo) dTo.value = '';

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
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-slate-400 font-bold">အရောင်းမှတ်တမ်း မရှိပါ။</td></tr>`;
      } else {
        records.forEach((r, idx) => {
          const displayNo = gSalesTotalRows - ((gSalesPage - 1) * gSalesLimit + idx);
          const isWallet = (r.paymentMethod === 'Student Pocket Money');

          tbody.innerHTML += `
            <tr class="hover:bg-slate-500/10 text-xs border-b border-[var(--border-color)]">
              <td class="text-center font-mono py-2.5 px-3 text-slate-400">${displayNo}</td>
              <td class="font-mono text-slate-400 py-2.5 px-3">${esc(r.date)}</td>
              <td class="font-mono font-bold text-sky-500 py-2.5 px-3">${esc(r.invoiceNo)}</td>
              <td class="py-2.5 px-3">
                <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isWallet ? 'bg-indigo-500/20 text-indigo-500' : 'bg-emerald-500/20 text-emerald-500'}">
                  ${isWallet ? 'Wallet' : 'Cash'}
                </span>
              </td>
              <td class="font-mono py-2.5 px-3 text-slate-400">${r.studentId ? `ID ${r.studentId}` : '-'}</td>
              <td class="py-2.5 px-3 text-slate-300 font-bold">${esc(r.itemsSummary)}</td>
              <td class="text-right font-mono font-bold py-2.5 px-3">${Number(r.totalAmount || 0).toLocaleString()} MMK</td>
              <td class="text-right font-mono font-bold text-teal-500 py-2.5 px-3">+${Number(r.netProfit || 0).toLocaleString()}</td>
              <td class="text-center py-2.5 px-3">
                <button onclick="reprintSalesSlip('${escAttr(r.invoiceNo)}')" class="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-lg transition" title="Print Receipt">
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
    console.error("[CanteenClosing] Sales History Load Error:", err);
  }
}

function reprintSalesSlip(invoiceNo) {
  const order = gSalesOrdersData.find(o => o.invoiceNo === invoiceNo);
  if (!order) return showToast("ERROR", "ပြေစာ အချက်အလက် မတွေ့ပါ။");
  const stuObj = order.studentId ? { studentId: order.studentId, name: `Student ID ${order.studentId}` } : null;
  if (typeof printPosReceipt === 'function') {
    printPosReceipt(order.invoiceNo, order.totalAmount, order.itemsSummary, order.paymentMethod, stuObj);
  }
}

// ------------------------------------------------------------------------------
// 🌐 6. WINDOW GLOBAL EXPORTS
// ------------------------------------------------------------------------------
window.loadCanteenDashboard = loadCanteenDashboard;
window.openDayCloseModal = openDayCloseModal;
window.executeCanteenDayClose = executeCanteenDayClose;
window.openPendingSyncModal = openPendingSyncModal;
window.renderPendingOrdersTable = renderPendingOrdersTable;
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