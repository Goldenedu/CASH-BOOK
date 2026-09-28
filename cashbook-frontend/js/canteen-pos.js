/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CANTEEN POS CLIENT CONTROLLER
 * File: js/canteen-pos.js (Location: cashbook-frontend/js/canteen-pos.js)
 * 
 * 💡 Features:
 *   1. ⚡ IN-MEMORY CART: O(1) LocalStorage item lookup & real-time aggregation
 *   2. 🛡️ STUDENT RADAR: 10,000 MMK daily cap warning progress bar
 *   3. 🖨️ POS THERMAL RECEIPT: 80mm ESC-POS printer slip generator
 *   4. ⌨️ HARDWARE SCANNER & HOTKEYS: F2 (Wallet), F4 (Cash), Esc (Clear Cart)
 * ==============================================================================
 */

// 🎯 Application State
let gSession = null;
let gItemsCache = [];       // Local Product Catalog Cache
let gCart = [];             // Dynamic In-Memory Cart State Array
let gCurrentStudent = null; // Scanned Student Object
let gPaymentMode = 'Student Pocket Money'; // 'Student Pocket Money' or 'Cash'
let isSubmitting = false;

// Center Toast Alert Engine
function showToast(type, msg) {
  const box = document.getElementById('pos-toast-box');
  if (!box) return;
  const isErr = (type === 'ERROR');
  box.innerHTML = `
    <div class="pointer-events-auto p-4 rounded-2xl shadow-2xl border-2 flex items-center gap-3 animate-in zoom-in-95 duration-150 ${
      isErr ? 'bg-rose-950 border-rose-500 text-white shadow-[0_0_40px_rgba(244,63,94,0.4)]' : 'bg-emerald-950 border-emerald-500 text-white shadow-[0_0_40px_rgba(16,185,129,0.4)]'
    }">
      <i class="fa-solid ${isErr ? 'fa-triangle-exclamation text-rose-400 text-xl' : 'fa-circle-check text-emerald-400 text-xl'}"></i>
      <p class="text-xs font-bold leading-snug flex-1">${msg}</p>
    </div>
  `;
  setTimeout(() => { if (box) box.innerHTML = ''; }, 3200);
}

// 🚀 Initialize App on Load
window.addEventListener('DOMContentLoaded', async () => {
  const userStr = localStorage.getItem('golden_user') || localStorage.getItem('user');
  const token = localStorage.getItem('golden_auth_token') || localStorage.getItem('token');

  if (!userStr || !token) {
    window.location.href = '/';
    return;
  }

  gSession = JSON.parse(userStr);
  const role = gSession.role || 'Cashier';

  const roleBadge = document.getElementById('pos-role-badge');
  if (roleBadge) roleBadge.textContent = role.toUpperCase();

  const titleEl = document.getElementById('pos-terminal-title');
  if (titleEl) {
    if (role === 'canteen_admin') titleEl.textContent = 'CANTEEN ADMIN TERMINAL';
    else if (role.startsWith('counter')) titleEl.textContent = `CANTEEN POS (${role.toUpperCase()})`;
    else titleEl.textContent = 'CANTEEN POS TERMINAL';
  }

  // Admin Tools Guard
  if (role !== 'canteen_admin' && role !== 'Owner' && role !== 'Admin') {
    const btnAdmin = document.getElementById('btn-admin-stock');
    if (btnAdmin) btnAdmin.classList.add('hidden');
  }

  const d = new Date();
  const dateEl = document.getElementById('pos-today-date');
  if (dateEl) {
    dateEl.textContent = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  // Keyboard Shortcut Bindings
  window.addEventListener('keydown', handleGlobalHotkeys);

  // Load Catalog & Focus Scanner
  await loadItemsCatalog(false);
  focusScanner();
});

function focusScanner() {
  const input = document.getElementById('pos-barcode-input');
  if (input) input.focus();
}

// 🎯 Global Hotkeys (F2: Wallet, F4: Cash, Esc: Clear)
function handleGlobalHotkeys(e) {
  if (e.key === 'F2') {
    e.preventDefault();
    setPaymentMode('Student Pocket Money');
    document.getElementById('pos-student-input')?.focus();
  } else if (e.key === 'F4') {
    e.preventDefault();
    setPaymentMode('Cash');
    focusScanner();
  } else if (e.key === 'Escape') {
    clearCart(false);
    focusScanner();
  }
}

// 🚀 O(1) Local Product Catalog Loader
async function loadItemsCatalog(isManualRefresh) {
  try {
    const res = await callApi('getPosItems', { onlyActive: true }, 'GET');
    if (res && res.success) {
      gItemsCache = res.data || [];
      if (isManualRefresh) showToast("SUCCESS", `ပစ္စည်း (${gItemsCache.length}) မျိုး အသစ်ရယူပြီးပါပြီ။`);
    }
  } catch (err) {
    console.warn("Items Catalog Load Warning:", err.message);
  }
}

// ==============================================================================
// 💡 1. IN-MEMORY CART & BARCODE SCANNER LOGIC
// ==============================================================================

function handleBarcodeInput(e) {
  const val = e.target.value.trim();
  const dropdown = document.getElementById('pos-search-dropdown');

  if (e.key === 'Enter') {
    e.preventDefault();
    searchAndAddItem(val);
    return;
  }

  // Live search autocomplete
  if (val.length >= 2) {
    const matches = gItemsCache.filter(it => 
      it.itemName.toLowerCase().includes(val.toLowerCase()) || 
      it.barcode.toLowerCase().includes(val.toLowerCase())
    );

    if (matches.length > 0) {
      dropdown.innerHTML = matches.map(m => `
        <div onclick="selectDropdownItem('${m.barcode}')" class="p-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-800/60 flex items-center justify-between text-xs">
          <div>
            <span class="font-bold text-white">${m.itemName}</span>
            <span class="text-[10px] font-mono text-slate-400 block">${m.barcode}</span>
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

  // Auto-Aggregation: Barcode ရှိပြီးသားဖြစ်ပါက Qty++
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
      <div class="p-3 bg-[#080f1e]/80 border border-slate-800 rounded-xl flex items-center justify-between gap-3 text-xs">
        <div class="min-w-0 flex-1">
          <h4 class="font-bold text-white truncate">${item.name}</h4>
          <span class="text-[10px] font-mono text-slate-400">${Number(item.price).toLocaleString()} MMK</span>
        </div>

        <!-- Qty Stepper Controls -->
        <div class="flex items-center gap-1.5 shrink-0 bg-[#060c18] border border-slate-800 rounded-lg p-1">
          <button onclick="changeCartQty(${idx}, -1)" class="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs">-</button>
          <input type="number" value="${item.qty}" min="1" max="${item.maxStock}" onchange="setCartQty(${idx}, this.value)" class="w-10 bg-transparent text-center font-mono font-bold text-white text-xs outline-none">
          <button onclick="changeCartQty(${idx}, 1)" class="w-6 h-6 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs">+</button>
        </div>

        <div class="text-right shrink-0 min-w-[80px]">
          <strong class="font-mono text-emerald-400 font-bold block">${Number(subtotal).toLocaleString()}</strong>
          <button onclick="removeCartItem(${idx})" class="text-[10px] text-slate-500 hover:text-rose-400 p-0.5 mt-0.5 transition"><i class="fa-solid fa-trash"></i></button>
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
  if (target <= 0) {
    removeCartItem(idx);
    return;
  }
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

// ==============================================================================
// 💡 2. STUDENT RADAR & 10,000 MMK CAP VERIFIER
// ==============================================================================

function setPaymentMode(mode) {
  gPaymentMode = mode;
  const btnWallet = document.getElementById('btn-mode-wallet');
  const btnCash = document.getElementById('btn-mode-cash');
  const radar = document.getElementById('pos-student-radar');

  if (mode === 'Student Pocket Money') {
    btnWallet.className = "py-2.5 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 bg-indigo-600 text-white shadow-lg shadow-indigo-600/30";
    btnCash.className = "py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    radar.classList.remove('opacity-40', 'pointer-events-none');
    document.getElementById('btn-checkout-label').textContent = "မုန့်ဖိုးဖြင့် ရှင်းမည် (CHECKOUT)";
  } else {
    btnCash.className = "py-2.5 px-3 rounded-xl text-xs font-black transition flex items-center justify-center gap-2 bg-emerald-600 text-white shadow-lg shadow-emerald-600/30";
    btnWallet.className = "py-2.5 px-3 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 text-slate-400 hover:text-white";
    radar.classList.add('opacity-40', 'pointer-events-none');
    document.getElementById('btn-checkout-label').textContent = "ငွေသားဖြင့် ရှင်းမည် (CHECKOUT)";
  }
}

async function lookupStudentRadar() {
  const input = document.getElementById('pos-student-input');
  const val = (input?.value || '').trim();
  if (!val) return;

  try {
    const res = await callApi('lookupStudentForPos', { studentId: val }, 'GET');
    if (res && res.success && res.data) {
      gCurrentStudent = res.data;
      renderStudentCard();
      showToast("SUCCESS", `ကျောင်းသား: ${gCurrentStudent.name}`);
      focusScanner();
    } else {
      gCurrentStudent = null;
      resetStudentCard();
      showToast("ERROR", res?.message || "ကျောင်းသား ရှာမတွေ့ပါ။");
    }
  } catch (err) {
    showToast("ERROR", "ကျောင်းသား စစ်ဆေး၍ မရပါ: " + err.message);
  }
}

function renderStudentCard() {
  if (!gCurrentStudent) return resetStudentCard();

  document.getElementById('radar-student-name').textContent = gCurrentStudent.name;
  document.getElementById('radar-student-info').textContent = `Class: ${gCurrentStudent.studentClass || '-'} | FYID: ${gCurrentStudent.fyid || '-'}`;
  document.getElementById('radar-wallet-bal').textContent = `${Number(gCurrentStudent.currentBalance).toLocaleString()} MMK`;
  document.getElementById('radar-today-spent').textContent = `${Number(gCurrentStudent.todaySpent).toLocaleString()} / ${Number(gCurrentStudent.dailyCap).toLocaleString()}`;
  document.getElementById('radar-badge-status').textContent = "ACTIVE WALLET";
  document.getElementById('radar-badge-status').className = "px-2 py-0.5 rounded text-[9px] font-black bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono";

  const totalBill = getCartTotalAmount();
  evaluateStudentCapWarning(totalBill);
}

function resetStudentCard() {
  document.getElementById('radar-student-name').textContent = "ကျောင်းသား ရွေးချယ်ပါ";
  document.getElementById('radar-student-info').textContent = "Class: - | ID: -";
  document.getElementById('radar-wallet-bal').textContent = "0 MMK";
  document.getElementById('radar-today-spent').textContent = "0 / 10,000";
  document.getElementById('radar-cap-text').textContent = "ကျန်ခွဲတမ်း: 10,000 MMK";
  document.getElementById('radar-progress-bar').style.width = "0%";
  document.getElementById('radar-progress-bar').className = "h-full bg-emerald-500";
  document.getElementById('radar-badge-status').textContent = "STANDBY";
  document.getElementById('radar-badge-status').className = "px-2 py-0.5 rounded text-[9px] font-black bg-slate-800 text-slate-400 border border-slate-700 font-mono";
}

function evaluateStudentCapWarning(currentBillAmount) {
  if (!gCurrentStudent || gPaymentMode !== 'Student Pocket Money') return;

  const spent = gCurrentStudent.todaySpent || 0;
  const cap = gCurrentStudent.dailyCap || 10000;
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

function getCartTotalAmount() {
  let tot = 0;
  gCart.forEach(ci => { tot += (ci.qty * ci.price); });
  return tot;
}

// ==============================================================================
// 💡 3. ATOMIC CHECKOUT & RECEIPT PRINTER
// ==============================================================================

async function executeCheckout() {
  if (isSubmitting) return;

  if (gCart.length === 0) {
    return showToast("ERROR", "Cart ထဲတွင် ပစ္စည်းများ မရှိသေးပါ!");
  }

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

  // Pocket Money Mode Validation
  if (gPaymentMode === 'Student Pocket Money') {
    if (!gCurrentStudent) {
      return showToast("ERROR", "မုန့်ဖိုးဖြတ်တောက်ရန် ကျောင်းသား ID Scan အရင်ဖတ်ပေးပါ!");
    }

    if (totalAmount > gCurrentStudent.currentBalance) {
      return showToast("ERROR", `ကျောင်းသားတွင် မုန့်ဖိုး (${gCurrentStudent.currentBalance.toLocaleString()} MMK) သာ ကျန်သဖြင့် မလုံလောက်ပါ!`);
    }

    const spent = gCurrentStudent.todaySpent || 0;
    const cap = gCurrentStudent.dailyCap || 10000;
    if ((spent + totalAmount) > cap) {
      const remaining = Math.max(0, cap - spent);
      return showToast("ERROR", `တစ်ရက် ၁၀,၀၀၀ ကျပ် ကန့်သတ်ချက် ကျော်လွန်နေပါသည်! (ကျန်ခွဲတမ်း: ${remaining.toLocaleString()} MMK)`);
    }
  }

  const payload = {
    date: new Date().toISOString().slice(0, 10),
    paymentMethod: gPaymentMode,
    studentId: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.studentId : null,
    studentName: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.name : '',
    fyid: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.fyid : '',
    studentClass: (gPaymentMode === 'Student Pocket Money') ? gCurrentStudent.studentClass : '',
    totalAmount,
    totalCost,
    itemsSummary,
    stockDeductions,
    uniqueId: 'CAN_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7)
  };

  isSubmitting = true;
  const btn = document.getElementById('btn-checkout');
  if (btn) btn.disabled = true;

  try {
    const res = await callApi('checkoutPosSale', payload);
    if (res && res.success) {
      showToast("SUCCESS", `အရောင်း အောင်မြင်ပါပြီ! Invoice: ${res.invoiceNo}`);
      
      // Print Receipt Slip
      printPosReceipt(res.invoiceNo, totalAmount, itemsSummary, gPaymentMode, gCurrentStudent);

      // Reset States
      gCart = [];
      gCurrentStudent = null;
      const stuInp = document.getElementById('pos-student-input');
      if (stuInp) stuInp.value = '';
      resetStudentCard();
      renderCart();
      await loadItemsCatalog(false);
    } else {
      showToast("ERROR", res?.message || "အရောင်း မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", "ဆာဗာ အမှား: " + err.message);
  } finally {
    isSubmitting = false;
    if (btn) btn.disabled = false;
    focusScanner();
  }
}

// 🖨️ Thermal POS Receipt Slip Generator (Line 874 Syntax Bug Fixed Here)
function printPosReceipt(invoiceNo, totalAmt, itemsSummary, method, student) {
  const today = new Date().toISOString().slice(0, 10);
  const cashierName = gSession?.name || 'Cashier';

  // 🎯 Fixed: Clean Logical OR without invalid escape characters
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

// ==============================================================================
// 💡 4. SMART PRICING ENGINE & ITEM MODAL
// ==============================================================================

function openItemModal() {
  document.getElementById('m-barcode').value = '';
  document.getElementById('m-item-name').value = '';
  document.getElementById('m-qty').value = '1';
  document.getElementById('m-cost-price').value = '';
  document.getElementById('m-selling-price').value = '';
  document.getElementById('m-suggested-price').textContent = '0 MMK';
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
    document.getElementById('m-selling-price').value = existing.sellingPrice;
    triggerSmartPriceCalc();
  }
}

function triggerSmartPriceCalc() {
  const cost = parseFloat(document.getElementById('m-cost-price').value || 0);
  const markup = parseFloat(document.getElementById('m-markup-percent').value || 20);
  if (cost <= 0) return;

  const rawPrice = cost * (1 + markup / 100);
  const rounded = Math.ceil(rawPrice / 50) * 50;

  document.getElementById('m-suggested-price').textContent = `${rounded.toLocaleString()} MMK`;
  
  const sellingInput = document.getElementById('m-selling-price');
  if (!sellingInput.value || sellingInput.value == '0') {
    sellingInput.value = rounded;
  }
}

async function submitPosPurchase(e) {
  e.preventDefault();
  const payload = {
    date: new Date().toISOString().slice(0, 10),
    barcode: document.getElementById('m-barcode').value.trim(),
    itemName: document.getElementById('m-item-name').value.trim(),
    category: document.getElementById('m-category').value,
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
      await loadItemsCatalog(false);
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (err) {
    showToast("ERROR", err.message);
  }
}

// ==============================================================================
// 💡 5. EVENING SETTLEMENT MODAL
// ==============================================================================

async function openSettlementModal() {
  try {
    const res = await callApi('getCanteenDailySummary', { date: new Date().toISOString().slice(0, 10) }, 'GET');
    if (res && res.success && res.data) {
      const dt = res.data;
      document.getElementById('set-orders').textContent = `${dt.totalOrders} Orders`;
      document.getElementById('set-total').textContent = `${Number(dt.totalSales).toLocaleString()} MMK`;
      document.getElementById('set-cash').textContent = `${Number(dt.cashSalesShare).toLocaleString()} MMK`;
      document.getElementById('set-pocket').textContent = `${Number(dt.pocketMoneyShare).toLocaleString()} MMK`;
      document.getElementById('set-payout-text').textContent = `${Number(dt.pocketMoneyShare).toLocaleString()} MMK`;

      const actionBox = document.getElementById('set-action-box');
      if (dt.isSettled) {
        actionBox.innerHTML = `<div class="p-3 text-center bg-emerald-950/40 text-emerald-400 border border-emerald-500/30 rounded-xl font-bold font-sans">ဤရက်စွဲအတွက် Finance နှင့် ငွေရှင်းပြီးဖြစ်ပါသည် (${dt.settlement?.settlement_no})</div>`;
      } else {
        actionBox.innerHTML = `<button onclick="confirmCanteenSettlement(${dt.pocketMoneyShare}, ${dt.cashSalesShare})" class="w-full py-3.5 bg-amber-600 hover:bg-amber-500 text-white rounded-xl font-black text-xs shadow-lg shadow-amber-950 active:scale-95 transition font-sans">Finance မှ ငွေထုတ်ပေးရှင်းလင်းပြီးကြောင်း အတည်ပြုမည်</button>`;
      }

      document.getElementById('pos-settlement-modal')?.classList.remove('hidden');
    }
  } catch (e) {
    showToast("ERROR", "Summary ခေါ်ယူ၍ မရပါ: " + e.message);
  }
}

async function confirmCanteenSettlement(pocketShare, cashShare) {
  if (!confirm("Finance မှ Pocket Money ရောင်းရငွေ အပြင်တွင် အမှန်တကယ် လက်ရောက်ရှင်းပြီးပြီလား?")) return;

  const payload = {
    date: new Date().toISOString().slice(0, 10),
    pocketMoneyShare: pocketShare,
    cashSalesShare: cashShare,
    netPayoutAmount: pocketShare,
    receivedBy: gSession?.name || 'Canteen Manager'
  };

  try {
    const res = await callApi('saveCanteenSettlement', payload);
    if (res && res.success) {
      showToast("SUCCESS", "ငွေရှင်းလင်းမှု မှတ်တမ်းတင်ပြီးပါပြီ။");
      closeModal('pos-settlement-modal');
    } else {
      showToast("ERROR", res?.message || "မအောင်မြင်ပါ။");
    }
  } catch (e) {
    showToast("ERROR", e.message);
  }
}

function closeModal(id) { 
  document.getElementById(id)?.classList.add('hidden'); 
}

function logoutPos() {
  localStorage.removeItem('golden_auth_token');
  localStorage.removeItem('golden_user');
  localStorage.removeItem('golden_user_role');
  localStorage.removeItem('golden_user_name');
  localStorage.removeItem('golden_token_expires_at');
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
}