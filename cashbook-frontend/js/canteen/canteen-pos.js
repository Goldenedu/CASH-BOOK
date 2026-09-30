/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN POS TERMINAL & CHECKOUT ENGINE
 * File: js/canteen/canteen-pos.js
 * ==============================================================================
 */

// 🎯 Payment Mode Switcher
function setPaymentMode(mode) {
  gPaymentMode = mode;
  const btnWallet = document.getElementById('btn-mode-wallet');
  const btnCash = document.getElementById('btn-mode-cash');
  const radar = document.getElementById('pos-student-radar');

  if (mode === 'Student Pocket Money') {
    btnWallet.className = "py-2 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 bg-indigo-600 text-white shadow-lg shadow-indigo-600/30";
    btnCash.className = "py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    radar.classList.remove('opacity-40', 'pointer-events-none');
    document.getElementById('btn-checkout-label').textContent = "မုန့်ဖိုးဖြင့် ရှင်းမည် (CHECKOUT - F8)";
  } else {
    btnCash.className = "py-2 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 bg-emerald-600 text-white shadow-lg shadow-emerald-600/30";
    btnWallet.className = "py-2 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    radar.classList.add('opacity-40', 'pointer-events-none');
    document.getElementById('btn-checkout-label').textContent = "ငွေသားဖြင့် ရှင်းမည် (CHECKOUT - F8)";
  }
}

// 🎯 Student Radar Lookup (Online with Offline IndexedDB Fallback)
async function lookupStudentRadar() {
  const input = document.getElementById('pos-student-input');
  const val = (input?.value || '').trim();
  if (!val) return;

  // 1. Online Lookup
  if (navigator.onLine) {
    try {
      const res = await callApi('lookupStudentForPos', { studentId: val, _t: Date.now() }, 'POST');
      if (res && res.success && res.data) {
        gCurrentStudent = res.data;
        if (res.data.dailyCap) gDailySpendingCap = Number(res.data.dailyCap);
        
        await dbSaveStudents([res.data]);
        
        renderStudentCard();
        showToast("SUCCESS", `ကျောင်းသား: ${gCurrentStudent.name}`);
        focusScanner();
        return;
      }
    } catch (err) {
      console.warn("[StudentRadar] Online lookup failed, trying offline fallback...", err.message);
    }
  }

  // 2. Offline Fallback from IndexedDB
  const offlineStu = await dbGetStudent(val);
  if (offlineStu) {
    gCurrentStudent = {
      studentId: offlineStu.studentId,
      name: offlineStu.name,
      studentClass: offlineStu.studentClass,
      fyid: offlineStu.fyid,
      currentBalance: offlineStu.currentBalance,
      todaySpent: offlineStu.todaySpent || 0,
      dailyCap: gDailySpendingCap || 10000
    };
    renderStudentCard();
    showToast("SUCCESS", `ကျောင်းသား (Offline): ${gCurrentStudent.name}`);
    focusScanner();
  } else {
    gCurrentStudent = null;
    resetStudentCard();
    showToast("ERROR", "ကျောင်းသား ရှာမတွေ့ပါ။ (Offline Database တွင်လည်း မရှိပါ)");
  }
}

function renderStudentCard() {
  if (!gCurrentStudent) return resetStudentCard();
  const cap = gDailySpendingCap || gCurrentStudent.dailyCap || 10000;

  document.getElementById('radar-student-name').textContent = gCurrentStudent.name;
  document.getElementById('radar-student-info').textContent = `Class: ${gCurrentStudent.studentClass || '-'} | FYID: ${gCurrentStudent.fyid || '-'}`;
  document.getElementById('radar-wallet-bal').textContent = `${Number(gCurrentStudent.currentBalance).toLocaleString()} MMK`;
  document.getElementById('radar-today-spent').textContent = `${Number(gCurrentStudent.todaySpent).toLocaleString()} / ${Number(cap).toLocaleString()}`;
  document.getElementById('radar-badge-status').textContent = "ACTIVE WALLET";
  document.getElementById('radar-badge-status').className = "px-2 py-0.5 rounded text-[9px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono";

  const capHeader = document.getElementById('radar-cap-header');
  if (capHeader) capHeader.textContent = `DAILY ${Number(cap).toLocaleString()} MMK CAP:`;

  evaluateStudentCapWarning(getCartTotalAmount());
}

function resetStudentCard() {
  const cap = gDailySpendingCap || 10000;
  document.getElementById('radar-student-name').textContent = "ကျောင်းသား ရွေးချယ်ပါ";
  document.getElementById('radar-student-info').textContent = "Class: - | ID: -";
  document.getElementById('radar-wallet-bal').textContent = "0 MMK";
  document.getElementById('radar-today-spent').textContent = `0 / ${Number(cap).toLocaleString()}`;
  document.getElementById('radar-cap-text').textContent = `ကျန်ခွဲတမ်း: ${Number(cap).toLocaleString()} MMK`;
  document.getElementById('radar-progress-bar').style.width = "0%";
  document.getElementById('radar-progress-bar').className = "h-full bg-emerald-500";
  document.getElementById('radar-badge-status').textContent = "STANDBY";
  document.getElementById('radar-badge-status').className = "px-2 py-0.5 rounded text-[9px] font-black bg-slate-800 text-slate-400 border border-slate-700 font-mono";
}

function evaluateStudentCapWarning(currentBillAmount) {
  if (!gCurrentStudent || gPaymentMode !== 'Student Pocket Money') return;

  const spent = gCurrentStudent.todaySpent || 0;
  const cap = gDailySpendingCap || gCurrentStudent.dailyCap || 10000;
  const combined = spent + currentBillAmount;
  const percentage = Math.min(100, (combined / cap) * 100);
  const remainingQuota = Math.max(0, cap - spent);

  const pBar = document.getElementById('radar-progress-bar');
  const capText = document.getElementById('radar-cap-text');
  pBar.style.width = `${percentage}%`;

  if (combined > cap) {
    pBar.className = "h-full bg-rose-500 animate-pulse";
    capText.innerHTML = `<span class="text-rose-400 font-black">ကန့်သတ်ချက် ကျော်လွန်နေပါသည်! (ကျန်: ${remainingQuota.toLocaleString()} MMK)</span>`;
  } else if (percentage >= 80) {
    pBar.className = "h-full bg-amber-400";
    capText.textContent = `ကျန်ခွဲတမ်း: ${(cap - combined).toLocaleString()} MMK`;
  } else {
    pBar.className = "h-full bg-emerald-500";
    capText.textContent = `ကျန်ခွဲတမ်း: ${(cap - combined).toLocaleString()} MMK`;
  }
}

// 🎯 Cart Functions
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
      it.itemName.toLowerCase().includes(val.toLowerCase()) || 
      it.barcode.toLowerCase().includes(val.toLowerCase())
    );

    if (matches.length > 0) {
      dropdown.innerHTML = matches.map(m => `
        <div onclick="selectDropdownItem('${escAttr(m.barcode)}')" class="p-2.5 hover:bg-slate-800 cursor-pointer border-b border-slate-700/60 flex items-center justify-between text-xs bg-[#0c1527] transition">
          <div>
            <span class="font-bold text-white">${esc(m.itemName)}</span>
            <span class="text-[10px] font-mono text-slate-400 block">${esc(m.barcode)}</span>
          </div>
          <span class="font-mono font-bold text-emerald-400">${Number(m.sellingPrice).toLocaleString()} MMK</span>
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

function selectDropdownItem(barcode) {
  document.getElementById('pos-search-dropdown')?.classList.add('hidden');
  searchAndAddItem(barcode);
}

function searchAndAddItem(targetCode) {
  const input = document.getElementById('pos-barcode-input');
  const code = (targetCode || input.value || '').trim();
  if (!code) return;

  const item = gItemsCache.find(it => it.barcode === code || it.itemName.toLowerCase() === code.toLowerCase());
  if (!item) {
    showToast("ERROR", `ပစ္စည်း ရှာမတွေ့ပါ: ${code}`);
    return;
  }

  const existing = gCart.find(ci => ci.barcode === item.barcode);
  if (existing) {
    if (item.currentStock > 0 && existing.qty + 1 > item.currentStock) {
      showToast("ERROR", `လက်ကျန် Stock (${item.currentStock}) သာ ရှိသဖြင့် ထပ်တိုး၍ မရပါ!`);
      return;
    }
    existing.qty += 1;
  } else {
    if (item.currentStock <= 0) {
      showToast("ERROR", `ဤပစ္စည်းတွင် လက်ကျန် Stock (0) ဖြစ်နေပါသည်။`);
      return;
    }
    gCart.push({
      barcode: item.barcode,
      name: item.itemName,
      price: Number(item.sellingPrice || 0),
      cost: Number(item.costPrice || 0),
      maxStock: Number(item.currentStock || 9999),
      qty: 1
    });
  }

  input.value = '';
  document.getElementById('pos-search-dropdown')?.classList.add('hidden');
  renderCart();
  focusScanner();
}

function renderCart() {
  const list = document.getElementById('pos-cart-list');
  const emptyBox = document.getElementById('pos-cart-empty');
  const badge = document.getElementById('pos-cart-badge');

  if (gCart.length === 0) {
    list.innerHTML = '';
    if (emptyBox) list.appendChild(emptyBox);
    badge.textContent = "0 Items";
    updateBillTotals();
    return;
  }

  list.innerHTML = '';
  gCart.forEach((item, idx) => {
    const subtotal = item.qty * item.price;
    list.innerHTML += `
      <div class="p-2.5 bg-[#080f1e]/80 border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs">
        <div class="min-w-0 flex-1">
          <h4 class="font-bold text-white truncate">${esc(item.name)}</h4>
          <span class="text-[10px] font-mono text-slate-400">${Number(item.price).toLocaleString()} MMK</span>
        </div>

        <div class="flex items-center gap-1 shrink-0 bg-[#060c18] border border-slate-800 rounded-lg p-0.5">
          <button onclick="changeCartQty(${idx}, -1)" class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs">-</button>
          <input type="number" value="${item.qty}" min="1" max="${item.maxStock}" onchange="setCartQty(${idx}, this.value)" class="w-8 bg-transparent text-center font-mono font-bold text-white text-xs outline-none">
          <button onclick="changeCartQty(${idx}, 1)" class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs">+</button>
        </div>

        <div class="text-right shrink-0 min-w-[70px]">
          <strong class="font-mono text-emerald-400 font-bold block">${Number(subtotal).toLocaleString()}</strong>
          <button onclick="removeCartItem(${idx})" class="text-[10px] text-slate-500 hover:text-rose-400 p-0.5 transition"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;
  });

  badge.textContent = `${gCart.length} Items`;
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

  document.getElementById('pos-cart-total-qty').textContent = totQty;
  document.getElementById('pos-cart-subtotal').textContent = `${totAmt.toLocaleString()} MMK`;
  document.getElementById('sum-qty').textContent = totQty;
  document.getElementById('sum-cost').textContent = `${totCost.toLocaleString()} MMK`;
  document.getElementById('sum-profit').textContent = `+${netProfit.toLocaleString()} MMK`;
  document.getElementById('pos-grand-total').innerHTML = `${totAmt.toLocaleString()} <span class="text-sm font-bold">MMK</span>`;
  document.getElementById('pos-items-count-label').textContent = `${totQty} items in cart`;

  evaluateStudentCapWarning(totAmt);
}

function getCartTotalAmount() {
  let tot = 0;
  gCart.forEach(ci => { tot += (ci.qty * ci.price); });
  return tot;
}

// ==============================================================================
// ⚡ CHECKOUT EXECUTION (OFFLINE-AWARE WITH PENDING QUEUE COMMIT)
// ==============================================================================
async function executeCheckout() {
  if (isSubmitting) return;
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

  // Wallet Validation
  if (gPaymentMode === 'Student Pocket Money') {
    if (!gCurrentStudent) return showToast("ERROR", "မုန့်ဖိုးဖြတ်တောက်ရန် ကျောင်းသား ID Scan အရင်ဖတ်ပေးပါ!");

    if (totalAmount > gCurrentStudent.currentBalance) {
      return showToast("ERROR", `ကျောင်းသားတွင် မုန့်ဖိုး (${gCurrentStudent.currentBalance.toLocaleString()} MMK) သာ ကျန်သဖြင့် မလုံလောက်ပါ!`);
    }

    const spent = gCurrentStudent.todaySpent || 0;
    const cap = gDailySpendingCap || gCurrentStudent.dailyCap || 10000;
    if ((spent + totalAmount) > cap) {
      const remaining = Math.max(0, cap - spent);
      return showToast("ERROR", `တစ်ရက် ${Number(cap).toLocaleString()} ကျပ် ကန့်သတ်ချက် ကျော်လွန်နေပါသည်! (ကျန်ခွဲတမ်း: ${remaining.toLocaleString()} MMK)`);
    }
  }

  const todayStr = new Date().toISOString().slice(0, 10);
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

  isSubmitting = true;
  const btn = document.getElementById('btn-checkout');
  if (btn) btn.disabled = true;

  try {
    let orderSuccess = false;

    // 1. Attempt Online Submission if online
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

    // 2. Offline Mode Commit (or network fallback)
    if (!orderSuccess) {
      payload.uniqueId = `OFF_${rawUniqueId}`;
      payload.isOffline = true;
      payload.created_at = new Date().toISOString();

      await dbSavePendingOrder(payload);

      if (gPaymentMode === 'Student Pocket Money' && gCurrentStudent) {
        await dbDeductStudentWallet(gCurrentStudent.studentId, totalAmount);
      }

      showToast("SUCCESS", `အရောင်း မှတ်တမ်းတင်ပြီးပါပြီ (Offline Pending: ${invoiceNo})`);
      await updatePendingBadgeCount();
    }

    // Deduct stock from Local In-Memory Cache & IndexedDB
    for (const sd of stockDeductions) {
      const item = gItemsCache.find(it => it.barcode === sd.barcode);
      if (item) item.currentStock = Math.max(0, Number(item.currentStock || 0) - sd.qty);
      await dbUpdateItemStock(sd.barcode, sd.qty);
    }

    // Reset Cart & Student Card
    gCart = [];
    gCurrentStudent = null;
    const stuInp = document.getElementById('pos-student-input');
    if (stuInp) stuInp.value = '';
    resetStudentCard();
    renderCart();

  } catch (err) {
    showToast("ERROR", "အရောင်း အမှားဖြစ်ပေါ်ခဲ့သည်: " + err.message);
  } finally {
    isSubmitting = false;
    if (btn) btn.disabled = false;
    focusScanner();
  }
}

// 🖨️ POS Thermal Receipt Printer
function printPosReceipt(invoiceNo, totalAmt, itemsSummary, method, student) {
  const today = new Date().toISOString().slice(0, 10);
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
        <tr><td>Inv: ${invoiceNo}</td><td style="text-align:right;">${today}</td></tr>
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

// Global Exports
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