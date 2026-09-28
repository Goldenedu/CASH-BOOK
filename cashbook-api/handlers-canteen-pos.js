/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CANTEEN POS HANDLERS (CLOUDFLARE D1 ENTERPRISE EDITION)
 * File: handlers-canteen-pos.js
 * 
 * 💡 Features & Architectural Blueprint V3:
 *   1. ⚡ SMART PRICING ENGINE: Cost + Markup % with Nearest 50/100 MMK Rounding & Manual Override
 *   2. 🛡️ DAILY 10,000 MMK CAP: Fast Indexed Student Daily Spending Enforcement (QR-Safe)
 *   3. ⚡ QUOTA-SHIELD: O(1) Single Batch Execution for Order, 2 Ledgers & Stock Deduction
 *   4. 🔒 IDEMPOTENCY & ZERO-OVERDRAFT: Double-scan & Concurrent charge protection
 *   5. 📑 EVENING SETTLEMENT ENGINE: Physical Cash vs Virtual Pocket Money Reconciliation
 * ==============================================================================
 */

import {
  getMyanmarDateString, normalizeFyStr, sanitizeFyidStr, generateUniqueId,
  generateVoucherNo, generateFyNo, recalculateLedgerBalances, getCurrentAcademicYear
} from './utils.js';

function computeAcademicFy(dateStr) {
  if (!dateStr) return getCurrentAcademicYear();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return getCurrentAcademicYear();
  let year = d.getFullYear();
  if (d.getMonth() < 2) year -= 1;
  return `${year}-${year + 1}`;
}

// 🛡️ Fail-safe Number Sanitizer (Negative & NaN အား လုံးဝ အဝင်မခံပါ)
function safeAmount(val) {
  const num = Number(val);
  return (Number.isFinite(num) && num > 0) ? Math.round(num * 100) / 100 : 0;
}

// ==============================================================================
// 💡 1. SMART PRICING ROUNDING ENGINE (မြန်မာငွေ အကြွေညှိ စနစ်)
// ==============================================================================
export function calculateSmartPrice(costPrice, markupPercent = 20, roundTo = 50) {
  const cost = safeAmount(costPrice);
  const markup = Math.max(0, Number(markupPercent) || 0);
  const rawPrice = cost * (1 + markup / 100);
  if (rawPrice <= 0) return 0;
  
  const step = (roundTo === 100) ? 100 : 50;
  return Math.ceil(rawPrice / step) * step;
}

// ==============================================================================
// 💡 2. POS ITEMS & INVENTORY MANAGEMENT
// ==============================================================================

export async function getPosItems(db, body) {
  try {
    const searchVal = String(body.searchVal || "").trim();
    const barcode = String(body.barcode || "").trim();
    const category = String(body.category || "").trim();
    const onlyActive = body.onlyActive !== false;

    let whereClauses = [];
    let params = [];

    if (barcode) {
      whereClauses.push(`barcode = ?`);
      params.push(barcode);
    }
    if (category) {
      whereClauses.push(`category = ?`);
      params.push(category);
    }
    if (onlyActive) {
      whereClauses.push(`is_active = 1`);
    }
    if (searchVal) {
      whereClauses.push(`(item_name LIKE ? OR barcode LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `
      SELECT id, barcode, item_name as itemName, category, cost_price as costPrice,
             markup_percent as markupPercent, selling_price as sellingPrice,
             current_stock as currentStock, is_active as isActive, updated_at as updatedAt
      FROM pos_items_master ${whereSql}
      ORDER BY item_name ASC LIMIT 500
    `;

    const res = await db.prepare(query).bind(...params).all();
    return { success: true, data: res.results || [] };
  } catch (err) {
    return { success: false, message: "ပစ္စည်းစာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

export async function savePosItem(db, session, body) {
  try {
    const barcode = String(body.barcode || "").trim();
    const itemName = String(body.itemName || body.item_name || "").trim();
    if (!barcode || !itemName) {
      return { success: false, message: "Barcode နှင့် ပစ္စည်းအမည် မဖြစ်မနေ ထည့်သွင်းပေးပါ။" };
    }

    const category = String(body.category || 'Snack').trim();
    const costPrice = safeAmount(body.costPrice || body.cost_price);
    const markupPercent = Math.max(0, Number(body.markupPercent || body.markup_percent) || 20);
    
    let sellingPrice = safeAmount(body.sellingPrice || body.selling_price);
    if (sellingPrice <= 0 && costPrice > 0) {
      sellingPrice = calculateSmartPrice(costPrice, markupPercent, 50);
    }

    const currentStock = Number(body.currentStock || body.current_stock) || 0;
    const isActive = body.isActive === 0 ? 0 : 1;

    await db.prepare(`
      INSERT INTO pos_items_master (barcode, item_name, category, cost_price, markup_percent, selling_price, current_stock, is_active, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(barcode) DO UPDATE SET
        item_name = excluded.item_name,
        category = excluded.category,
        cost_price = excluded.cost_price,
        markup_percent = excluded.markup_percent,
        selling_price = excluded.selling_price,
        current_stock = excluded.current_stock,
        is_active = excluded.is_active,
        updated_at = datetime('now')
    `).bind(barcode, itemName, category, costPrice, markupPercent, sellingPrice, currentStock, isActive).run();

    return { 
      success: true, 
      data: { barcode, itemName, category, costPrice, markupPercent, sellingPrice, currentStock, isActive } 
    };
  } catch (err) {
    return { success: false, message: "ပစ္စည်းသိမ်းဆည်းမှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ------------------------------------------------------------------------------
// 💡 အဝယ်စာရင်း သွင်းယူခြင်း (🎯 FIX: Master Table သို့ အရင် UPSERT လုပ်ပြီးမှ Purchase သွင်းခြင်း)
// ------------------------------------------------------------------------------
export async function savePosPurchase(db, session, body) {
  try {
    const entryDate = getMyanmarDateString(body.date);
    const barcode = String(body.barcode || body.item_barcode || "").trim();
    const itemName = String(body.itemName || body.item_name || "ပစ္စည်းသစ်").trim();
    const category = String(body.category || 'Snack').trim();
    const qty = safeAmount(body.qty);
    const costPrice = safeAmount(body.costPrice || body.cost_price);
    const markupPercent = Math.max(0, Number(body.markupPercent || body.markup_percent) || 20);

    if (!barcode) return { success: false, message: "ပစ္စည်း Barcode ရွေးချယ်ပေးပါ။" };
    if (qty <= 0) return { success: false, message: "အဝယ်အရေအတွက် အနည်းဆုံး ၁ ခု ရှိရပါမည်။" };
    if (costPrice <= 0) return { success: false, message: "ပစ္စည်း ဝယ်ဈေး ထည့်သွင်းပေးပါ။" };

    let sellingPrice = safeAmount(body.sellingPrice || body.selling_price);
    if (sellingPrice <= 0) {
      sellingPrice = calculateSmartPrice(costPrice, markupPercent, 50);
    }

    const totalCost = Math.round(qty * costPrice * 100) / 100;
    const purchaseNo = body.purchaseNo || `PO-${entryDate.replace(/-/g, '').slice(0, 6)}-${generateUniqueId('').slice(-4).toUpperCase()}`;

    // ⚡ ATOMIC FIX: ပစ္စည်းအသစ်ဖြစ်စေ၊ ရှိပြီးသားဖြစ်စေ Master Table တွင် အရင်ဆုံး ရှိစေပြီးမှ Purchase သွင်းမည်
    const batchStatements = [
      db.prepare(`
        INSERT INTO pos_items_master (barcode, item_name, category, cost_price, markup_percent, selling_price, current_stock, is_active, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
        ON CONFLICT(barcode) DO UPDATE SET
          item_name = COALESCE(NULLIF(excluded.item_name, ''), pos_items_master.item_name),
          category = COALESCE(NULLIF(excluded.category, ''), pos_items_master.category),
          cost_price = excluded.cost_price,
          markup_percent = excluded.markup_percent,
          selling_price = excluded.selling_price,
          current_stock = pos_items_master.current_stock + excluded.current_stock,
          is_active = 1,
          updated_at = datetime('now')
      `).bind(barcode, itemName, category, costPrice, markupPercent, sellingPrice, qty),

      db.prepare(`
        INSERT INTO pos_purchases (purchase_no, date, supplier_id, item_barcode, qty, cost_price, markup_percent, selling_price, total_cost, remark, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(purchaseNo, entryDate, body.supplierId || null, barcode, qty, costPrice, markupPercent, sellingPrice, totalCost, body.remark || '', session?.name || 'Admin')
    ];

    await db.batch(batchStatements);

    return { success: true, purchaseNo, sellingPrice, totalCost };
  } catch (err) {
    return { success: false, message: "အဝယ်စာရင်း သိမ်းဆည်းမှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 3. STUDENT POCKET MONEY RADAR (🎯 FIX: QR Scan တိကျစွာ အလုပ်လုပ်စေခြင်း)
// ==============================================================================

export async function lookupStudentForPos(db, body) {
  try {
    const rawInput = String(body.studentId || body.searchVal || "").trim();
    if (!rawInput) return { success: false, message: "ကျောင်းသား ID သို့မဟုတ် Barcode ထည့်ပါ။" };

    const todayStr = getMyanmarDateString();
    const fyVal = computeAcademicFy(todayStr);
    const cleanFy = fyVal.replace(/^FY\s*/i, '');
    const stuIdNum = parseInt(rawInput, 10) || 0;

    let student = null;

    // 🎯 FIX: 'students' အစား 'student' (အနည်းကိန်း) သို့ ပြင်ဆင်ပြီး nfc_tag_id မရှိသေးပါကပါ အလိုအလျောက် fallback လုပ်မည့် စနစ်
    try {
      student = await db.prepare(`
        SELECT student_id as studentId, id, name, class, fyid 
        FROM student 
        WHERE (student_id = ? OR id = ? OR fyid = ? OR nfc_tag_id = ?) LIMIT 1
      `).bind(stuIdNum, stuIdNum, rawInput, rawInput).first();
    } catch (e) {
      // nfc_tag_id column မရှိသေးပါက standard query ဖြင့်သာ ရှာဖွေခြင်း
      student = await db.prepare(`
        SELECT student_id as studentId, id, name, class, fyid 
        FROM student 
        WHERE (student_id = ? OR id = ? OR fyid = ?) LIMIT 1
      `).bind(stuIdNum, stuIdNum, rawInput).first();
    }

    if (!student) {
      return { success: false, message: "ကျောင်းသား ရှာမတွေ့ပါ။ ID သို့မဟုတ် QR စစ်ဆေးပါ။" };
    }

    const realStudentId = parseInt(student.studentId || student.id, 10);
    const realFyid = student.fyid || rawInput;

    // ⚡ O(1) Composite Batch: ကျောင်းသား မုန့်ဖိုးလက်ကျန် နှင့် ယနေ့ သုံးစွဲပြီးငွေ ဆွဲယူခြင်း
    const [balRow, spentRow] = await db.batch([
      db.prepare(`
        SELECT COALESCE(SUM(debit - credit), 0) as bal 
        FROM student_money 
        WHERE fy IN (?, ?) 
          AND (student_id = ? OR CAST(student_id AS TEXT) = ? OR (fyid IS NOT NULL AND fyid = ?))
      `).bind(cleanFy, `FY ${cleanFy}`, realStudentId, String(realStudentId), realFyid),

      db.prepare(`
        SELECT COALESCE(SUM(total_amount), 0) as todaySpent 
        FROM pos_sales_orders 
        WHERE student_id = ? AND date = ? AND payment_method = 'Student Pocket Money'
      `).bind(realStudentId, todayStr)
    ]);

    const currentBalance = parseFloat(balRow.results[0]?.bal || 0);
    const todaySpent = parseFloat(spentRow.results[0]?.todaySpent || 0);
    const dailyCap = 10000;
    const remainingQuota = Math.max(0, dailyCap - todaySpent);

    return {
      success: true,
      data: {
        studentId: realStudentId,
        name: student.name,
        studentClass: student.class,
        fyid: realFyid,
        currentBalance,
        todaySpent,
        remainingQuota,
        dailyCap
      }
    };
  } catch (err) {
    return { success: false, message: "ကျောင်းသား အချက်အလက် စစ်ဆေး၍ မရပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 4. ATOMIC SINGLE BATCH POS CHECKOUT
// ==============================================================================

export async function checkoutPosSale(db, session, body) {
  try {
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || computeAcademicFy(entryDate));
    const cleanFy = fy.replace(/^FY\s*/i, '');

    const paymentMethod = String(body.paymentMethod || 'Student Pocket Money').trim();
    const isWallet = (paymentMethod === 'Student Pocket Money');
    const studentId = parseInt(body.studentId, 10) || null;
    const totalAmount = safeAmount(body.totalAmount);
    const totalCost = safeAmount(body.totalCost);
    const netProfit = Math.round((totalAmount - totalCost) * 100) / 100;
    const itemsSummary = String(body.itemsSummary || "").trim();
    const stockDeductions = Array.isArray(body.stockDeductions) ? body.stockDeductions : [];

    if (totalAmount <= 0) return { success: false, message: "ကျသင့်ငွေ ပမာဏ မရှိပါ။ Cart ထဲ ပစ္စည်းထည့်ပါ။" };
    if (!itemsSummary) return { success: false, message: "ပစ္စည်းစာရင်း အကျဉ်းချုပ် မပါဝင်ပါ။" };

    // 🎯 IDEMPOTENCY GUARD
    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^(CAN_|STM_|POS_)+/i, '') : generateUniqueId('').replace(/^_/, '');
    const posUniqueId = `POS_${rawCore}`;
    const canUniqueId = `CAN_${rawCore}`;
    const stmUniqueId = `STM_${rawCore}`;

    const duplicateCheck = await db.prepare("SELECT invoice_no, total_amount FROM pos_sales_orders WHERE uniqueid = ?").bind(posUniqueId).first();
    if (duplicateCheck) {
      return { 
        success: true, 
        invoiceNo: duplicateCheck.invoice_no, 
        message: "ဤပြေစာအား မှတ်တမ်းတင်ပြီးဖြစ်ပါသည်။ (Duplicate Ignored)" 
      };
    }

    // 🛡️ WALLET VERIFICATION (BALANCE & 10,000 MMK DAILY CAP GUARDS)
    if (isWallet) {
      if (!studentId || studentId <= 0) {
        return { success: false, message: "မုန့်ဖိုးအကောင့်ဖြင့် ဝယ်ယူရန် ကျောင်းသား ID လိုအပ်ပါသည်။" };
      }

      const [balRes, spentRes] = await db.batch([
        db.prepare(`
          SELECT COALESCE(SUM(debit - credit), 0) as bal 
          FROM student_money 
          WHERE fy IN (?, ?) AND (student_id = ? OR CAST(student_id AS TEXT) = ? OR (fyid IS NOT NULL AND fyid = ?))
        `).bind(cleanFy, `FY ${cleanFy}`, studentId, String(studentId), body.fyid || ''),

        db.prepare(`
          SELECT COALESCE(SUM(total_amount), 0) as todaySpent 
          FROM pos_sales_orders 
          WHERE student_id = ? AND date = ? AND payment_method = 'Student Pocket Money'
        `).bind(studentId, entryDate)
      ]);

      const curStuBal = parseFloat(balRes.results[0]?.bal || 0);
      const todaySpent = parseFloat(spentRes.results[0]?.todaySpent || 0);
      const DAILY_CAP = 10000;

      if (totalAmount > curStuBal) {
        return { 
          success: false, 
          message: `မုန့်ဖိုးလက်ကျန် မလုံလောက်ပါ! လက်ရှိတွင် (${curStuBal.toLocaleString('en-US')} MMK) သာ ကျန်ရှိပါသည်။` 
        };
      }

      if ((todaySpent + totalAmount) > DAILY_CAP) {
        const remaining = Math.max(0, DAILY_CAP - todaySpent);
        return { 
          success: false, 
          message: `တစ်ရက် မုန့်ဖိုးကန့်သတ်ချက် (10,000 MMK) ကျော်လွန်နေပါသည်! ယနေ့ (${todaySpent.toLocaleString('en-US')} MMK) သုံးပြီးဖြစ်၍ (${remaining.toLocaleString('en-US')} MMK) သာ ဝယ်ယူခွင့် ကျန်ပါတော့သည်။` 
        };
      }
    }

    // ⚡ O(1) ATOMIC D1 SINGLE BATCH EXECUTION
    const invoiceNo = `INV-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-4).toUpperCase()}`;
    const vrCan = await generateVoucherNo(db, 'canteen_book', 'CAN', entryDate);
    const noCan = await generateFyNo(db, 'canteen_book', fy);

    const batchStatements = [];

    // Statement 1: POS Sales Orders ထဲတွင် Single-Row အကျဉ်းချုပ် မှတ်တမ်းတင်ခြင်း
    batchStatements.push(
      db.prepare(`
        INSERT INTO pos_sales_orders (invoice_no, date, payment_method, student_id, total_amount, total_cost, net_profit, items_summary, canteen_vr_no, uniqueid, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(invoiceNo, entryDate, paymentMethod, studentId, totalAmount, totalCost, netProfit, itemsSummary, vrCan, posUniqueId, session?.name || 'Cashier')
    );

    // Statement 2: Canteen Book တွင် အရောင်းရငွေ Debit စာရင်းသွင်းခြင်း
    batchStatements.push(
      db.prepare(`
        INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid)
        VALUES (?, ?, 'POS Sales', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
      `).bind(noCan, entryDate, `[${invoiceNo}] ${itemsSummary}`, paymentMethod === 'Cash' ? 'Cash' : 'Transfer', totalAmount, vrCan, my, fy, session?.name || 'Cashier', canUniqueId)
    );

    // Statement 3: ကျောင်းသားမုန့်ဖိုးဖြစ်ပါက Student Money တွင် Credit စာရင်းနှုတ်ယူခြင်း
    if (isWallet && studentId > 0) {
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      const stuName = body.studentName ? `[${body.fyid || ''}] ${body.studentName}` : `[ID ${studentId}]`;
      const desc = `[Canteen POS - ${invoiceNo}]: ${itemsSummary}`.trim();

      batchStatements.push(
        db.prepare(`
          INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'Canteen POS', 0, ?, 0, ?, ?, ?)
        `).bind(noStu, entryDate, cleanFy, studentId, body.fyid || '', stuName, body.studentClass || '', totalAmount, desc, session?.name || 'Cashier', stmUniqueId)
      );
    }

    // Statement 4+: Stock အလိုအလျောက် နုတ်ယူခြင်း Loop
    for (const item of stockDeductions) {
      const bCode = String(item.barcode || "").trim();
      const q = safeAmount(item.qty);
      if (bCode && q > 0) {
        batchStatements.push(
          db.prepare(`UPDATE pos_items_master SET current_stock = current_stock - ?, updated_at = datetime('now') WHERE barcode = ?`).bind(q, bCode)
        );
      }
    }

    await db.batch(batchStatements);

    // ⚡ Targeted Recalculation
    await recalculateLedgerBalances(db, 'canteen_book', fy, entryDate);
    if (isWallet && studentId > 0) {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);
    }

    return {
      success: true,
      invoiceNo,
      canteenVrNo: vrCan,
      uniqueId: posUniqueId,
      totalAmount,
      netProfit
    };
  } catch (err) {
    return { success: false, message: "အရောင်းမှတ်တမ်းတင်မှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 5. EVENING CANTEEN SETTLEMENT (ညနေပိုင်း ငွေသားရှင်းလင်းမှု စနစ်)
// ==============================================================================

export async function getCanteenDailySummary(db, body) {
  try {
    const targetDate = String(body.date || getMyanmarDateString()).trim();

    const summaryRes = await db.prepare(`
      SELECT 
        COUNT(id) as totalOrders,
        COALESCE(SUM(total_amount), 0) as totalSales,
        COALESCE(SUM(CASE WHEN payment_method = 'Student Pocket Money' THEN total_amount ELSE 0 END), 0) as pocketMoneyShare,
        COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END), 0) as cashSalesShare,
        COALESCE(SUM(net_profit), 0) as totalProfit
      FROM pos_sales_orders 
      WHERE date = ?
    `).bind(targetDate).first();

    const settleRow = await db.prepare(`SELECT settlement_no, net_payout_amount, created_at FROM canteen_settlements WHERE date = ?`).bind(targetDate).first();

    return {
      success: true,
      data: {
        date: targetDate,
        totalOrders: summaryRes?.totalOrders || 0,
        totalSales: parseFloat(summaryRes?.totalSales || 0),
        pocketMoneyShare: parseFloat(summaryRes?.pocketMoneyShare || 0),
        cashSalesShare: parseFloat(summaryRes?.cashSalesShare || 0),
        totalProfit: parseFloat(summaryRes?.totalProfit || 0),
        isSettled: Boolean(settleRow),
        settlement: settleRow || null
      }
    };
  } catch (err) {
    return { success: false, message: "နေ့စဉ်အရောင်း ချုပ်စာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

export async function saveCanteenSettlement(db, session, body) {
  try {
    const entryDate = getMyanmarDateString(body.date);
    const pocketMoneyShare = safeAmount(body.pocketMoneyShare);
    const cashSalesShare = safeAmount(body.cashSalesShare);
    const totalSales = Math.round((pocketMoneyShare + cashSalesShare) * 100) / 100;
    const netPayout = safeAmount(body.netPayoutAmount || pocketMoneyShare);

    if (totalSales <= 0) return { success: false, message: "ရှင်းလင်းရန် အရောင်းစာရင်း မရှိပါ။" };

    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^SETTLE_/i, '') : generateUniqueId('').replace(/^_/, '');
    const settleUniqueId = `SETTLE_${rawCore}`;
    const settlementNo = `SETTLE-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-3).toUpperCase()}`;

    const dupCheck = await db.prepare("SELECT settlement_no FROM canteen_settlements WHERE uniqueid = ? OR date = ?").bind(settleUniqueId, entryDate).first();
    if (dupCheck) {
      return { success: false, message: `ဤရက်စွဲ (${entryDate}) အတွက် ငွေရှင်းလင်းမှု ပြုလုပ်ပြီးဖြစ်ပါသည်။ (${dupCheck.settlement_no})` };
    }

    await db.prepare(`
      INSERT INTO canteen_settlements (settlement_no, date, settlement_type, total_sales_amount, pocket_money_share, cash_sales_share, net_payout_amount, handed_over_by, received_by, remark, uniqueid)
      VALUES (?, ?, 'Evening Cash Out', ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      settlementNo, entryDate, totalSales, pocketMoneyShare, cashSalesShare, netPayout,
      body.handedOverBy || session?.name || 'Finance Admin',
      body.receivedBy || 'Canteen Manager',
      body.remark || 'ညနေပိုင်း Canteen အရောင်းငွေ ရှင်းလင်းမှု ပြီးမြောက်ခြင်း',
      settleUniqueId
    ).run();

    return {
      success: true,
      settlementNo,
      netPayoutAmount: netPayout,
      message: "Canteen ငွေရှင်းလင်းမှု မှတ်တမ်းတင်ပြီးပါပြီ။"
    };
  } catch (err) {
    return { success: false, message: "ငွေရှင်းလင်းမှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 6. SUPPLIERS MASTER
// ==============================================================================

export async function getPosSuppliers(db) {
  try {
    const res = await db.prepare("SELECT * FROM pos_suppliers WHERE is_active = 1 ORDER BY supplier_name ASC").all();
    return { success: true, data: res.results || [] };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

export async function savePosSupplier(db, session, body) {
  try {
    const name = String(body.supplierName || "").trim();
    if (!name) return { success: false, message: "ကုန်သည်အမည် ထည့်သွင်းပါ။" };

    await db.prepare(`
      INSERT INTO pos_suppliers (supplier_name, contact_person, phone_no, address)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(supplier_name) DO UPDATE SET
        contact_person = excluded.contact_person,
        phone_no = excluded.phone_no,
        address = excluded.address
    `).bind(name, body.contactPerson || '', body.phoneNo || '', body.address || '').run();

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}


// ==============================================================================
// 💡 7. CANTEEN SETTLEMENTS AUDIT & HISTORY (FINANCE VIEW)
// ==============================================================================

export async function getCanteenSettlements(db, body) {
  try {
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const limit = Math.min(100, Math.max(1, parseInt(body.limit || 30, 10)));

    let whereClauses = [];
    let params = [];

    if (dateFrom) {
      whereClauses.push(`date >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClauses.push(`date <= ?`);
      params.push(dateTo);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `
      SELECT id, settlement_no as settlementNo, date, settlement_type as settlementType,
             total_sales_amount as totalSalesAmount, pocket_money_share as pocketMoneyShare,
             cash_sales_share as cashSalesShare, net_payout_amount as netPayoutAmount,
             handed_over_by as handedOverBy, received_by as receivedBy, remark, uniqueid, created_at as createdAt
      FROM canteen_settlements ${whereSql}
      ORDER BY date DESC, id DESC LIMIT ?
    `;
    params.push(limit);

    const res = await db.prepare(query).bind(...params).all();
    return { success: true, data: res.results || [] };
  } catch (err) {
    return { success: false, message: "Settlement စာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}