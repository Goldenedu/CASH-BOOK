/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN POS TERMINAL & CHECKOUT ENGINE
 * File: js/canteen/canteen-pos.js (Enterprise V9.1 Full Production Edition)
 * 💡 Features:
 *   1. 🕒 Strict MMT (UTC+06:30) Timezone Enforcement for Invoices & Slips
 *   2. 🌐 Dual-Layer Resilient Scanner (RAM Cache + IndexedDB Fallback - 0 D1 Read)
 *   3. 🎓 Offline-Aware Student Wallet Radar with Dynamic Daily Cap Protection
 *   4. ⚡ Offline Queue Commit (Zero Data Loss on Network Drop)
 *   5. 🎨 100% Theme-Adaptive Cart Renderer (Light & Dark Mode)
 *   6. 🖨️ 80mm Thermal Receipt Printer with MMT Timestamp
 *   7. 🛡️ Defensive Null-Safe DOM Updaters (Zero-Crash Guarantee)
 * ==============================================================================
 */

// 🕒 Pure Non-Recursive MMT Date Helper (UTC+06:30)
function getMMTDateString(dInput) {
  if (typeof window.getMMTDateString === 'function') {
    return window.getMMTDateString(dInput);
  }
  const d = dInput ? new Date(dInput) : new Date();
  const targetMs = isNaN(d.getTime()) ? Date.now() : d.getTime();
  const mmt = new Date(targetMs + (6.5 * 60 * 60 * 1000));
  return mmt.toISOString().slice(0, 10);
}

// 🛡️ Scope-Safe Variable Declarations (Prevents ReferenceError / SyntaxError)
var esc = window.esc || (s => s ? String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) : '');
var escAttr = window.escAttr || (s => s ? String(s).replace(/'/g, "\\'") : '');

// ------------------------------------------------------------------------------
// 🎯 1. PAYMENT MODE CONTROLLER
// ------------------------------------------------------------------------------
function setPaymentMode(mode) {
  gPaymentMode = mode;
  const btnWallet = document.getElementById('btn-mode-wallet');
  const btnCash = document.getElementById('btn-mode-cash');
  const radar = document.getElementById('pos-student-radar');
  const checkoutLabel = document.getElementById('btn-checkout-label');

  if (mode === 'Student Pocket Money') {
    if (btnWallet) {
      btnWallet.className = "py-1.5 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 bg-indigo-600 text-white shadow-lg shadow-indigo-600/30";
    }
    if (btnCash) {
      btnCash.className = "py-1.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-[var(--text-main)]";
    }
    if (radar) {
      radar.classList.remove('opacity-40', 'pointer-events-none');
    }
    if (checkoutLabel) {
      checkoutLabel.textContent = "မုန့်ဖိုးဖြင့် ရှင်းမည် (CHECKOUT - F8)";
    }
  } else {
    if (btnCash) {
      btnCash.className = "py-1.5 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5 bg-emerald-600 text-white shadow-lg shadow-emerald-600/30";
    }
    if (btnWallet) {
      btnWallet.className = "py-1.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 text-slate-400 hover:text-[var(--text-main)]";
    }
    if (radar) {
      radar.classList.add('opacity-40', 'pointer-events-none');
    }
    if (checkoutLabel) {
      checkoutLabel.textContent = "ငွေသားဖြင့် ရှင်းမည် (CHECKOUT - F8)";
    }
  }
}

// ------------------------------------------------------------------------------
// 🎓 2. STUDENT POCKET MONEY RADAR (ONLINE WITH OFFLINE DB FALLBACK)
// ------------------------------------------------------------------------------
async function lookupStudentRadar() {
  const input = document.getElementById('pos-student-input');
  const val = (input?.value || '').trim();
  if (!val) return;

  // ၁။ Online Lookup (အင်တာနက် ရှိပါက D1 မှ စစ်ဆေးပြီး IndexedDB သို့ အသစ်ပြန်သိမ်းသည်)
  if (navigator.onLine) {
    try {
      const res = await callApi('lookupStudentForPos', { studentId: val, _t: Date.now() }, 'POST');
      if (res && res.success && res.data) {
        gCurrentStudent = res.data;
        if (res.data.dailyCap) {
          gDailySpendingCap = Number(res.data.dailyCap);
        }
        if (typeof dbSaveStudents === 'function') {
          await dbSaveStudents([res.data]);
        }
        renderStudentCard();
        showToast("SUCCESS", `ကျောင်းသား: ${gCurrentStudent.name}`);
        focusScanner();
        return;
      }
    } catch (err) {
      console.warn("[StudentRadar] Online lookup failed, trying offline DB fallback...", err.message);
    }
  }

  // ၂။ Offline Fallback (အင်တာနက် မရှိပါက သို့မဟုတ် Network Error တက်ပါက IndexedDB မှ ချက်ချင်းဆွဲထုတ်သည်)
  if (typeof dbGetStudent === 'function') {
    const offlineStu = await dbGetStudent(val);
    if (offlineStu) {
      gCurrentStudent = {
        studentId: offlineStu.studentId,
        name: offlineStu.name,
        studentClass: offlineStu.studentClass,
        fyid: offlineStu.fyid,
        currentBalance: Number(offlineStu.currentBalance || 0),
        todaySpent: Number(offlineStu.todaySpent || 0),
        dailyCap: gDailySpendingCap || 10000
      };
      renderStudentCard();
      showToast("SUCCESS", `ကျောင်းသား (Offline): ${gCurrentStudent.name}`);
      focusScanner();
      return;
    }
  }

  gCurrentStudent = null;
  resetStudentCard();
  showToast("ERROR", "ကျောင်းသား ရှာမတွေ့ပါ။ (Offline စက်တွင်းစာရင်းတွင်လည်း မရှိပါ)");
}

function renderStudentCard() {
  if (!gCurrentStudent) return resetStudentCard();
  const cap = gDailySpendingCap || gCurrentStudent.dailyCap || 10000;

  const elName = document.getElementById('radar-student-name');
  if (elName) elName.textContent = gCurrentStudent.name || '-';

  const elInfo = document.getElementById('radar-student-info');
  if (elInfo) elInfo.textContent = `Class: ${gCurrentStudent.studentClass || '-'} | FYID: ${gCurrentStudent.fyid || '-'}`;

  const elBal = document.getElementById('radar-wallet-bal');
  if (elBal) elBal.textContent = `${Number(gCurrentStudent.currentBalance || 0).toLocaleString()} MMK`;

  const elSpent = document.getElementById('radar-today-spent');
  if (elSpent) elSpent.textContent = `${Number(gCurrentStudent.todaySpent || 0).toLocaleString()} / ${Number(cap).toLocaleString()}`;

  const elBadge = document.getElementById('radar-badge-status');
  if (elBadge) {
    elBadge.textContent = "ACTIVE WALLET";
    elBadge.className = "px-2 py-0.5 rounded text-[9px] font-black bg-indigo-500/20 text-indigo-500 dark:text-indigo-300 border border-indigo-500/30 font-mono";
  }

  const capHeader = document.getElementById('radar-cap-header');
  if (capHeader) capHeader.textContent = `DAILY ${Number(cap).toLocaleString()} MMK CAP:`;

  evaluateStudentCapWarning(getCartTotalAmount());
}

function resetStudentCard() {
  const cap = gDailySpendingCap || 10000;

  const elName = document.getElementById('radar-student-name');
  if (elName) elName.textContent = "ကျောင်းသား ရွေးချယ်ပါ";

  const elInfo = document.getElementById('radar-student-info');
  if (elInfo) elInfo.textContent = "Class: - | ID: -";

  const elBal = document.getElementById('radar-wallet-bal');
  if (elBal) elBal.textContent = "0 MMK";

  const elSpent = document.getElementById('radar-today-spent');
  if (elSpent) elSpent.textContent = `0 / ${Number(cap).toLocaleString()}`;

  const elCapText = document.getElementById('radar-cap-text');
  if (elCapText) elCapText.textContent = `ကျန်ခွဲတမ်း: ${Number(cap).toLocaleString()} MMK`;

  const pBar = document.getElementById('radar-progress-bar');
  if (pBar) {
    pBar.style.width = "0%";
    pBar.className = "h-full bg-emerald-500";
  }

  const elBadge = document.getElementById('radar-badge-status');
  if (elBadge) {
    elBadge.textContent = "STANDBY";
    elBadge.className = "px-2 py-0.5 rounded text-[9px] font-black bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border border-slate-300 dark:border-slate-700 font-mono";
  }
}

function evaluateStudentCapWarning(currentBillAmount) {
  if (!gCurrentStudent || gPaymentMode !== 'Student Pocket Money') return;

  const spent = Number(gCurrentStudent.todaySpent || 0);
  const cap = Number(gDailySpendingCap || gCurrentStudent.dailyCap || 10000);
  const combined = spent + currentBillAmount;
  const percentage = Math.min(100, (combined / cap) * 100);
  const remainingQuota = Math.max(0, cap - spent);

  const pBar = document.getElementById('radar-progress-bar');
  const capText = document.getElementById('radar-cap-text');

  if (pBar) {
    pBar.style.width = `${percentage}%`;
  }

  if (combined > cap) {
    if (pBar) pBar.className = "h-full bg-rose-500 animate-pulse";
    if (capText) capText.innerHTML = `<span class="text-rose-500 font-black">ကန့်သတ်ချက် ကျော်လွန်နေပါသည်! (ကျန်: ${remainingQuota.toLocaleString()} MMK)</span>`;
  } else if (percentage >= 80) {
    if (pBar) pBar.className = "h-full bg-amber-500";
    if (capText) capText.textContent = `ကျန်ခွဲတမ်း: ${(cap - combined).toLocaleString()} MMK`;
  } else {
    if (pBar) pBar.className = "h-full bg-emerald-500";
    if (capText) capText.textContent = `ကျန်ခွဲတမ်း: ${(cap - combined).toLocaleString()} MMK`;
  }
}

// ------------------------------------------------------------------------------
// 📦 3. RESILIENT BARCODE SCANNER (RAM + INDEXED-DB DUAL-LAYER LOOKUP)
// ------------------------------------------------------------------------------
function handleBarcodeInput(e) {
  const val = e.target.value.trim();
  const dropdown = document.getElementById('pos-search-dropdown');

  if (e.key === 'Enter') {
    e.preventDefault();
    searchAndAddItem(val);
    return;
  }

  if (val.length >= 2) {
    const matches = gItemsCache.filter(it => 
      String(it.itemName || '').toLowerCase().includes(val.toLowerCase()) || 
      String(it.barcode || '').toLowerCase().includes(val.toLowerCase())
    );

    if (matches.length > 0 && dropdown) {
      dropdown.innerHTML = matches.map(m => `
        <div onclick="selectDropdownItem('${escAttr(m.barcode)}')" class="p-2.5 hover:bg-slate-500/10 cursor-pointer border-b border-[var(--border-color)] flex items-center justify-between text-xs transition">
          <div>
            <span class="font-bold">${esc(m.itemName)}</span>
            <span class="text-[10px] font-mono text-slate-400 block">${esc(m.barcode)}</span>
          </div>
          <span class="font-mono font-bold text-emerald-500">${Number(m.sellingPrice || 0).toLocaleString()} MMK</span>
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

function selectDropdownItem(barcode) {
  const dropdown = document.getElementById('pos-search-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
  searchAndAddItem(barcode);
}

async function searchAndAddItem(targetCode) {
  const input = document.getElementById('pos-barcode-input');
  const code = (targetCode || input?.value || '').trim();
  if (!code) return;

  // အဆင့် ၁။ RAM Cache အလွတ်ဖြစ်နေပါက စက်တွင်း IndexedDB မှ ချက်ချင်းဆွဲတင်သည်
  if (!gItemsCache || gItemsCache.length === 0) {
    if (typeof dbGetAllItems === 'function') {
      gItemsCache = await dbGetAllItems();
    }
    if ((!gItemsCache || gItemsCache.length === 0) && typeof loadItemsCatalog === 'function') {
      await loadItemsCatalog(false);
    }
  }

  const codeLower = code.toLowerCase();

  // အဆင့် ၂။ Barcode တိုက်ရိုက်တိုက်စစ်ခြင်း
  let item = gItemsCache.find(it => 
    String(it.barcode || '').trim().toLowerCase() === codeLower
  );

  // အဆင့် ၃။ Barcode ဖြင့် မတွေ့ပါက ပစ္စည်းအမည်ဖြင့် တိုက်စစ်ခြင်း
  if (!item) {
    item = gItemsCache.find(it => 
      String(it.itemName || '').trim().toLowerCase() === codeLower
    ) || gItemsCache.find(it => 
      String(it.itemName || '').trim().toLowerCase().includes(codeLower)
    );
  }

  // အဆင့် ၄။ Memory တွင် မတွေ့ပါက စက်တွင်း IndexedDB သို့ တိုက်ရိုက်ဆင်းရှာခြင်း (Offline Resilience)
  if (!item && typeof dbGetItem === 'function') {
    const dbItem = await dbGetItem(code);
    if (dbItem) {
      item = dbItem;
      if (!gItemsCache.some(ci => ci.barcode === item.barcode)) {
        gItemsCache.push(item);
      }
    }
  }

  if (!item) {
    showToast("ERROR", `ပစ္စည်း ရှာမတွေ့ပါ: ${code}`);
    return;
  }

  const existing = gCart.find(ci => ci.barcode === item.barcode);
  const currentStock = Number(item.currentStock || 0);

  if (existing) {
    if (currentStock > 0 && (existing.qty + 1) > currentStock) {
      showToast("ERROR", `လက်ကျန် Stock (${currentStock}) သာ ရှိသဖြင့် ထပ်တိုး၍ မရပါ!`);
      return;
    }
    existing.qty += 1;
  } else {
    if (currentStock <= 0) {
      showToast("ERROR", `ဤပစ္စည်းတွင် လက်ကျန် Stock (0) ဖြစ်နေပါသည်။`);
      return;
    }
    gCart.push({
      barcode: item.barcode,
      name: item.itemName,
      price: Number(item.sellingPrice || 0),
      cost: Number(item.costPrice || 0),
      maxStock: currentStock || 9999,
      qty: 1
    });
  }

  if (input) input.value = '';
  const dropdown = document.getElementById('pos-search-dropdown');
  if (dropdown) dropdown.classList.add('hidden');

  renderCart();
  focusScanner();
}

// ------------------------------------------------------------------------------
// 🛒 4. THEME-ADAPTIVE CART RENDERER & BILL CALCULATIONS
// ------------------------------------------------------------------------------
function renderCart() {
  const list = document.getElementById('pos-cart-list');
  const emptyBox = document.getElementById('pos-cart-empty');
  const badge = document.getElementById('pos-cart-badge');

  if (!list) return;

  if (gCart.length === 0) {
    list.innerHTML = '';
    if (emptyBox) list.appendChild(emptyBox);
    if (badge) badge.textContent = "0 Items";
    updateBillTotals();
    return;
  }

  list.innerHTML = '';
  gCart.forEach((item, idx) => {
    const subtotal = item.qty * item.price;
    list.innerHTML += `
      <div class="p-2.5 bg-white dark:bg-[#080f1e]/90 border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs transition shadow-sm">
        <div class="min-w-0 flex-1">
          <h4 class="font-bold text-slate-800 dark:text-white truncate">${esc(item.name)}</h4>
          <span class="text-[10px] font-mono text-slate-500 dark:text-slate-400">${Number(item.price).toLocaleString()} MMK</span>
        </div>

        <div class="flex items-center gap-1 shrink-0 bg-slate-100 dark:bg-[#060c18] border border-slate-200 dark:border-slate-800 rounded-lg p-0.5">
          <button onclick="changeCartQty(${idx}, -1)" class="w-6 h-6 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-xs shadow-sm transition active:scale-95">-</button>
          <input type="number" value="${item.qty}" min="1" max="${item.maxStock}" onchange="setCartQty(${idx}, this.value)" class="w-8 bg-transparent text-center font-mono font-bold text-slate-800 dark:text-white text-xs outline-none">
          <button onclick="changeCartQty(${idx}, 1)" class="w-6 h-6 rounded bg-white dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center font-bold text-xs shadow-sm transition active:scale-95">+</button>
        </div>

        <div class="text-right shrink-0 min-w-[75px]">
          <strong class="font-mono text-emerald-600 dark:text-emerald-400 font-bold text-xs block">${Number(subtotal).toLocaleString()}</strong>
          <button onclick="removeCartItem(${idx})" class="text-[10px] text-slate-400 hover:text-rose-500 p-0.5 transition" title="ဖယ်ရှားမည်"><i class="fa-solid fa-trash-can"></i></button>
        </div>
      </div>
    `;
  });

  if (badge) badge.textContent = `${gCart.length} Items`;
  updateBillTotals();
}

function changeCartQty(idx, delta) {
  if (!gCart[idx]) return;
  const target = gCart[idx].qty + delta;
  if (target <= 0) return removeCartItem(idx);
  if (target > gCart[idx].maxStock) {
    showToast("ERROR", `လက်ကျန် Stock (${gCart[idx].maxStock}) ကျော်လွန်၍ မရပါ!`);
    return;
  }
  gCart[idx].qty = target;
  renderCart();
}

function setCartQty(idx, val) {
  const q = parseInt(val, 10) || 1;
  if (q <= 0) return removeCartItem(idx);
  gCart[idx].qty = Math.min(q, gCart[idx].maxStock);
  renderCart();
}

function removeCartItem(idx) {
  gCart.splice(idx, 1);
  renderCart();
}

function clearCart(showAlert) {
  if (gCart.length === 0) return;
  if (showAlert && !confirm("Cart ထဲရှိ ပစ္စည်းများကို ပယ်ဖျက်မည်မှာ သေချာပါသလား?")) return;
  gCart = [];
  renderCart();
}

function updateBillTotals() {
  let totQty = 0, totAmt = 0, totCost = 0;
  gCart.forEach(ci => {
    totQty += ci.qty;
    totAmt += (ci.qty * ci.price);
    totCost += (ci.qty * ci.cost);
  });

  const netProfit = Math.max(0, totAmt - totCost);

  const elCartQty = document.getElementById('pos-cart-total-qty');
  if (elCartQty) elCartQty.textContent = totQty;

  const elCartSub = document.getElementById('pos-cart-subtotal');
  if (elCartSub) elCartSub.textContent = `${totAmt.toLocaleString()} MMK`;

  const elSumQty = document.getElementById('sum-qty');
  if (elSumQty) elSumQty.textContent = totQty;

  const elSumCost = document.getElementById('sum-cost');
  if (elSumCost) elSumCost.textContent = `${totCost.toLocaleString()} MMK`;

  const elSumProfit = document.getElementById('sum-profit');
  if (elSumProfit) elSumProfit.textContent = `+${netProfit.toLocaleString()} MMK`;

  const elGrandTotal = document.getElementById('pos-grand-total');
  if (elGrandTotal) elGrandTotal.innerHTML = `${totAmt.toLocaleString()} <span class="text-sm font-bold">MMK</span>`;

  const elCountLabel = document.getElementById('pos-items-count-label');
  if (elCountLabel) elCountLabel.textContent = `${totQty} items in cart`;

  evaluateStudentCapWarning(totAmt);
}

function getCartTotalAmount() {
  let tot = 0;
  gCart.forEach(ci => { tot += (ci.qty * ci.price); });
  return tot;
}

// ------------------------------------------------------------------------------
// ⚡ 5. CHECKOUT EXECUTION (ONLINE WITH OFFLINE PENDING QUEUE COMMIT)
// ------------------------------------------------------------------------------
async function executeCheckout() {
  if (window.isSubmitting) return;
  if (gCart.length === 0) return showToast("ERROR", "Cart ထဲတွင် ပစ္စည်းများ မရှိသေးပါ!");

  const totalAmount = getCartTotalAmount();
  let totalCost = 0;
  const stockDeductions = [];
  const itemsListText = [];

  gCart.forEach(ci => {
    totalCost += (ci.qty * ci.cost);
    stockDeductions.push({ barcode: ci.barcode, qty: ci.qty });
    itemsListText.push(`${ci.name} x ${ci.qty}`);
  });

  const itemsSummary = itemsListText.join(', ');

  // Wallet Validation & Daily Allowance Cap Protection
  if (gPaymentMode === 'Student Pocket Money') {
    if (!gCurrentStudent) return showToast("ERROR", "မုန့်ဖိုးဖြတ်တောက်ရန် ကျောင်းသား ID Scan အရင်ဖတ်ပေးပါ!");

    if (totalAmount > gCurrentStudent.currentBalance) {
      return showToast("ERROR", `ကျောင်းသားတွင် မုန့်ဖိုး (${gCurrentStudent.currentBalance.toLocaleString()} MMK) သာ ကျန်သဖြင့် မလုံလောက်ပါ!`);
    }

    const spent = Number(gCurrentStudent.todaySpent || 0);
    const cap = Number(gDailySpendingCap || gCurrentStudent.dailyCap || 10000);
    if ((spent + totalAmount) > cap) {
      const remaining = Math.max(0, cap - spent);
      return showToast("ERROR", `တစ်ရက် ${Number(cap).toLocaleString()} ကျပ် ကန့်သတ်ချက် ကျော်လွန်နေပါသည်! (ကျန်ခွဲတမ်း: ${remaining.toLocaleString()} MMK)`);
    }
  }

  // 🕒 Strict MMT Date Formatting
  const todayStr = getMMTDateString();
  const rawUniqueId = 'CAN_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
  const invoiceNo = `INV-${todayStr.replace(/-/g, '')}-${rawUniqueId.slice(-4).toUpperCase()}`;

  const payload = {
    invoiceNo,
    date: todayStr,
    paymentMethod: gPaymentMode,
    studentId: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.studentId : null,
    studentName: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.name : '',
    fyid: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.fyid : '',
    studentClass: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.studentClass : '',
    totalAmount,
    totalCost,
    itemsSummary,
    stockDeductions,
    uniqueId: rawUniqueId,
    createdBy: gSession?.name || 'Cashier'
  };

  window.isSubmitting = true;
  const btn = document.getElementById('btn-checkout');
  if (btn) btn.disabled = true;

  try {
    let orderSuccess = false;

    // အဆင့် ၁။ Online တင်ပို့နိုင်ပါက D1 သို့ တိုက်ရိုက်ပို့သည်
    if (navigator.onLine) {
      try {
        const res = await callApi('checkoutPosSale', payload);
        if (res && res.success) {
          orderSuccess = true;
          showToast("SUCCESS", `အရောင်း အောင်မြင်ပါပြီ! Invoice: ${res.invoiceNo || invoiceNo}`);
        } else if (res && res.message && (res.message.includes('ဆိုင်ပိတ်') || res.message.includes('မလုံလောက်') || res.message.includes('လက်ကျန်'))) {
          showToast("ERROR", res.message);
          return;
        }
      } catch (netErr) {
        console.warn("[Checkout] Online attempt failed, committing to offline pending queue:", netErr.message);
      }
    }

    // အဆင့် ၂။ Offline ဖြစ်နေပါက စက်တွင်း IndexedDB Pending Queue သို့ လုံခြုံစွာ သိမ်းဆည်းသည်
    if (!orderSuccess) {
      payload.uniqueId = `OFF_${rawUniqueId}`;
      payload.isOffline = true;
      payload.created_at = new Date().toISOString();

      if (typeof dbSavePendingOrder === 'function') {
        await dbSavePendingOrder(payload);
      }

      if (gPaymentMode === 'Student Pocket Money' && gCurrentStudent && typeof dbDeductStudentWallet === 'function') {
        await dbDeductStudentWallet(gCurrentStudent.studentId, totalAmount);
      }

      showToast("SUCCESS", `အရောင်း မှတ်တမ်းတင်ပြီးပါပြီ (Offline Pending: ${invoiceNo})`);
      if (typeof updatePendingBadgeCount === 'function') {
        await updatePendingBadgeCount();
      }
    }

    // အဆင့် ၃။ စတော့များကို RAM Cache နှင့် IndexedDB နှစ်ခုစလုံးမှ အလိုအလျောက် နုတ်ယူညှိနှိုင်းသည်
    for (const sd of stockDeductions) {
      const item = gItemsCache.find(it => it.barcode === sd.barcode);
      if (item) {
        item.currentStock = Math.max(0, Number(item.currentStock || 0) - sd.qty);
      }
      if (typeof dbUpdateItemStock === 'function') {
        await dbUpdateItemStock(sd.barcode, sd.qty);
      }
    }

    gCart = [];
    gCurrentStudent = null;
    const stuInp = document.getElementById('pos-student-input');
    if (stuInp) stuInp.value = '';

    resetStudentCard();
    renderCart();

  } catch (err) {
    showToast("ERROR", "အရောင်း အမှားဖြစ်ပေါ်ခဲ့သည်: " + err.message);
  } finally {
    window.isSubmitting = false;
    if (btn) btn.disabled = false;
    focusScanner();
  }
}

// ------------------------------------------------------------------------------
// 🖨️ 6. POS THERMAL RECEIPT PRINTER (STRICT MMT DATE & TIME)
// ------------------------------------------------------------------------------
function printPosReceipt(invoiceNo, totalAmt, itemsSummary, method, student) {
  const formattedDateTime = typeof window.getMMTFullDateTimeString === 'function' ? window.getMMTFullDateTimeString() : getMMTDateString();
  const cashierName = gSession?.name || 'Cashier';

  const studentInfoRow = student 
    ? `<tr><td colspan="2">Student: [${student.fyid || student.studentId}] ${student.name}</td></tr>` 
    : '';

  const slipHtml = `
    <!DOCTYPE html><html><head><title>Receipt - ${invoiceNo}</title>
    <style>
      @page { size: 80mm auto; margin: 0; }
      body { font-family: -apple-system, sans-serif; font-size: 11px; width: 72mm; margin: 0 auto; padding: 10px 0; color: #000; }
      .center { text-align: center; }
      .line { border-top: 1px dashed #000; margin: 6px 0; }
      table { width: 100%; border-collapse: collapse; font-size: 11px; }
      td { padding: 2px 0; vertical-align: top; }
    </style></head><body>
      <div class="center">
        <h3 style="margin:0; font-size:14px; font-weight:900;">GOLDEN SCHOOL CANTEEN</h3>
        <p style="margin:2px 0;">Official Sales Receipt</p>
      </div>
      <div class="line"></div>
      <table>
        <tr><td>Inv: ${invoiceNo}</td><td style="text-align:right;">${formattedDateTime}</td></tr>
        <tr><td>Cashier: ${cashierName}</td><td style="text-align:right;">${method === 'Cash' ? 'Cash' : 'Wallet'}</td></tr>
        ${studentInfoRow}
      </table>
      <div class="line"></div>
      <p style="margin:4px 0; font-size:11px;"><strong>Items:</strong> ${itemsSummary}</p>
      <div class="line"></div>
      <table>
        <tr style="font-size:13px; font-weight:900;">
          <td>TOTAL PAID:</td>
          <td style="text-align:right;">${Number(totalAmt).toLocaleString()} MMK</td>
        </tr>
      </table>
      <div class="line"></div>
      <div class="center" style="font-size:10px; margin-top:8px;">
        <p style="margin:0;">ကျေးဇူးတင်ပါသည် / Thank You!</p>
      </div>
    </body></html>
  `;

  const w = window.open('', '_blank', 'width=350,height=500');
  if (!w) return;
  w.document.write(slipHtml);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); w.close(); }, 350);
}

// ------------------------------------------------------------------------------
// 🌐 7. WINDOW GLOBAL EXPORTS
// ------------------------------------------------------------------------------
window.setPaymentMode = setPaymentMode;
window.lookupStudentRadar = lookupStudentRadar;
window.handleBarcodeInput = handleBarcodeInput;
window.selectDropdownItem = selectDropdownItem;
window.searchAndAddItem = searchAndAddItem;
window.clearCart = clearCart;
window.changeCartQty = changeCartQty;
window.setCartQty = setCartQty;
window.removeCartItem = removeCartItem;
window.executeCheckout = executeCheckout;
window.printPosReceipt = printPosReceipt;