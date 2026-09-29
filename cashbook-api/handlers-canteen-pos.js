/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CANTEEN POS HANDLERS (CLOUDFLARE D1 ENTERPRISE EDITION)
 * File: handlers-canteen-pos.js (Location: cashbook-api/handlers-canteen-pos.js)
 * 
 * 💡 Features & Architectural Blueprint V6:
 *   1. 📊 LIVE DASHBOARD: 1-Batch Atomic Metrics (Sales, Stock Capital & Spoilage Loss)
 *   2. 🧾 PAGINATED SALES ORDERS: 20-Row Server-Side Pagination & ID DESC Sorting
 *   3. 📦 PAGINATED STOCK INVENTORY: 20-Row Pagination, Full Barcode & Valuation
 *   4. 🛒 PURCHASES AUDITOR: 20-Row Pagination with Auto Stock-Rollback on Edit/Delete
 *   5. ⚠️ WASTAGE & LOSS LEDGER: Multi-item Cost-basis Loss & Atomic Stock Deduction
 *   6. ⚙️ DYNAMIC POS SETTINGS: Dynamic Daily Allowance Cap (Zero Extra Roundtrips)
 *   7. 🛡️ ATOMIC ZERO-OVERDRAFT: Multi-counter Safe Concurrency Checks
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
// 💡 2. CANTEEN EXECUTIVE DASHBOARD METRICS (OPTIMIZED 5-BATCH AGGREGATOR)
// ==============================================================================
export async function getCanteenDashboardMetrics(db, body) {
  try {
    const todayStr = getMyanmarDateString();
    const date = String(body.date || todayStr).trim();

    // 🚀 D1 ULTRA QUOTA-SHIELD: Query (၅) ခုသာ Single Batch ဖြင့် ၁ ကြိမ်တည်း အပြီးဆွဲယူသည်
    const batchQueries = [
      // ၁။ ယနေ့ အရောင်းစာရင်း (Orders, Sales, Wallet Share, Cash Share, Net Margin)
      db.prepare(`
        SELECT 
          COUNT(id) as totalOrders,
          COALESCE(SUM(total_amount), 0) as totalSales,
          COALESCE(SUM(CASE WHEN payment_method = 'Student Pocket Money' THEN total_amount ELSE 0 END), 0) as pocketMoneyShare,
          COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END), 0) as cashSalesShare,
          COALESCE(SUM(net_profit), 0) as totalProfit
        FROM pos_sales_orders 
        WHERE date = ?
      `).bind(date),

      // ၂။ ယနေ့အတွက် Finance နှင့် ငွေရှင်းပြီး/မပြီး စစ်ဆေးခြင်း
      db.prepare(`
        SELECT settlement_no as settlementNo, net_payout_amount as netPayoutAmount, 
               created_at as createdAt, handed_over_by as handedOverBy, received_by as receivedBy 
        FROM canteen_settlements 
        WHERE date = ? 
        LIMIT 1
      `).bind(date),

      // ၃။ ကန်တင်းသမိုင်းဝင် စုစုပေါင်း အရောင်းစာရင်းချုပ် (All-Time Stats)
      db.prepare(`
        SELECT 
          COUNT(id) as allTimeOrders,
          COALESCE(SUM(total_amount), 0) as allTimeSales,
          COALESCE(SUM(CASE WHEN payment_method = 'Student Pocket Money' THEN total_amount ELSE 0 END), 0) as allTimePocketShare,
          COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END), 0) as allTimeCashShare,
          COALESCE(SUM(net_profit), 0) as allTimeProfit
        FROM pos_sales_orders
      `),

      // ၄။ Stock သတိပေးချက်နှင့် စုစုပေါင်း ရင်းနှီးငွေတန်ဖိုး (Capital Investment)
      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN current_stock <= 10 THEN 1 ELSE 0 END), 0) as lowStockCount,
          COALESCE(SUM(CASE WHEN current_stock > 0 THEN (cost_price * current_stock) ELSE 0 END), 0) as totalStockCapital
        FROM pos_items_master 
        WHERE is_active = 1
      `),

      // ၅။ အပျက်/အပျောက် ဆုံးရှုံးမှုတန်ဖိုး (ယနေ့ နှင့် သမိုင်းဝင် ဆုံးရှုံးငွေ)
      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN date = ? THEN total_loss_cost ELSE 0 END), 0) as todayLossCost,
          COALESCE(SUM(total_loss_cost), 0) as allTimeLossCost
        FROM pos_waste_records
      `).bind(date)
    ];

    const [todayRes, settleRes, allTimeRes, stockRes, wasteRes] = await db.batch(batchQueries);

    const todayStats = todayRes.results[0] || {};
    const settle = settleRes.results[0] || null;
    const allTimeStats = allTimeRes.results[0] || {};
    const stockStats = stockRes.results[0] || {};
    const wasteStats = wasteRes.results[0] || {};

    const lowStockCount = Number(stockStats.lowStockCount || 0);
    const totalStockCapital = parseFloat(stockStats.totalStockCapital || 0);
    const todayLossCost = parseFloat(wasteStats.todayLossCost || 0);
    const allTimeLossCost = parseFloat(wasteStats.allTimeLossCost || 0);

    return {
      success: true,
      data: {
        date,
        today: {
          totalOrders: todayStats.totalOrders || 0,
          totalSales: parseFloat(todayStats.totalSales || 0),
          pocketMoneyShare: parseFloat(todayStats.pocketMoneyShare || 0),
          cashSalesShare: parseFloat(todayStats.cashSalesShare || 0),
          totalProfit: parseFloat(todayStats.totalProfit || 0),
          todayLossCost,
          isSettled: Boolean(settle),
          settlement: settle
        },
        allTime: {
          totalOrders: allTimeStats.allTimeOrders || 0,
          totalSales: parseFloat(allTimeStats.allTimeSales || 0),
          pocketMoneyShare: parseFloat(allTimeStats.allTimePocketShare || 0),
          cashSalesShare: parseFloat(allTimeStats.allTimeCashShare || 0),
          totalProfit: parseFloat(allTimeStats.allTimeProfit || 0),
          totalStockCapital,
          allTimeLossCost
        },
        totalStockCapital,
        lowStockCount,
        todayLossCost,
        allTimeLossCost
      }
    };
  } catch (err) {
    return { success: false, message: "Dashboard အချက်အလက် ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 3. REAL-TIME STOCK INVENTORY AUDITOR (PAGINATED 20 ROWS PER PAGE)
// ==============================================================================
export async function getPosStockInventory(db, body) {
  try {
    const category = String(body.category || "").trim();
    const stockStatus = String(body.stockStatus || "all").trim();
    const searchVal = String(body.searchVal || "").trim();

    const page = Math.max(1, parseInt(body.page || 1, 10));
    const limit = Math.min(100, Math.max(1, parseInt(body.limit || 20, 10)));
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let params = [];

    if (category) {
      whereClauses.push(`category = ?`);
      params.push(category);
    }

    if (stockStatus === 'low_stock') {
      whereClauses.push(`current_stock > 0 AND current_stock <= 10`);
    } else if (stockStatus === 'out_of_stock') {
      whereClauses.push(`current_stock <= 0`);
    }

    if (searchVal) {
      whereClauses.push(`(item_name LIKE ? OR barcode LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [summaryRes, rowsRes] = await db.batch([
      db.prepare(`
        SELECT 
          COUNT(id) as totalRows,
          COALESCE(SUM(current_stock), 0) as totalStockQty,
          COALESCE(SUM(cost_price * current_stock), 0) as totalStockValue,
          COALESCE(SUM(CASE WHEN current_stock <= 0 THEN 1 ELSE 0 END), 0) as outOfStockCount,
          COALESCE(SUM(CASE WHEN current_stock > 0 AND current_stock <= 10 THEN 1 ELSE 0 END), 0) as lowStockCount
        FROM pos_items_master ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT id, barcode, item_name as itemName, category, cost_price as costPrice,
               markup_percent as markupPercent, selling_price as sellingPrice,
               current_stock as currentStock, is_active as isActive, updated_at as updatedAt,
               (cost_price * current_stock) as stockValue
        FROM pos_items_master ${whereSql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

    const summaryData = summaryRes.results[0] || {};
    const totalRows = summaryData.totalRows || 0;

    return {
      success: true,
      data: rowsRes.results || [],
      totalRows,
      page,
      limit,
      summary: {
        totalItems: totalRows,
        totalStockQty: Number(summaryData.totalStockQty || 0),
        totalStockValue: parseFloat(summaryData.totalStockValue || 0),
        outOfStockCount: Number(summaryData.outOfStockCount || 0),
        lowStockCount: Number(summaryData.lowStockCount || 0)
      }
    };
  } catch (err) {
    return { success: false, message: "Stock စာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

// ------------------------------------------------------------------------------
// 💡 QUICK STOCK & PRICE ADJUSTMENT (Admin Only)
// ------------------------------------------------------------------------------
export async function updatePosItemQuick(db, session, body) {
  try {
    const barcode = String(body.barcode || "").trim();
    if (!barcode) return { success: false, message: "Barcode မပါဝင်ပါ။" };

    const updates = [];
    const params = [];

    if (body.sellingPrice !== undefined) {
      updates.push(`selling_price = ?`);
      params.push(safeAmount(body.sellingPrice));
    }
    if (body.costPrice !== undefined) {
      updates.push(`cost_price = ?`);
      params.push(safeAmount(body.costPrice));
    }
    if (body.currentStock !== undefined) {
      updates.push(`current_stock = ?`);
      params.push(Number(body.currentStock) || 0);
    }
    if (body.isActive !== undefined) {
      updates.push(`is_active = ?`);
      params.push(body.isActive ? 1 : 0);
    }

    if (updates.length === 0) {
      return { success: false, message: "ပြင်ဆင်ရန် အချက်အလက် မပါဝင်ပါ။" };
    }

    updates.push(`updated_at = datetime('now')`);
    params.push(barcode);

    await db.prepare(`
      UPDATE pos_items_master 
      SET ${updates.join(', ')} 
      WHERE barcode = ?
    `).bind(...params).run();

    return { success: true, message: "ပစ္စည်းအချက်အလက် ပြင်ဆင်ပြီးပါပြီ။" };
  } catch (err) {
    return { success: false, message: "ပြင်ဆင်မှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 4. PURCHASES HISTORY & SUPPLIER AUDITOR (PAGINATED 20 ROWS PER PAGE)
// ==============================================================================
export async function getPosPurchasesHistory(db, body) {
  try {
    const supplierId = parseInt(body.supplierId, 10) || 0;
    const searchVal = String(body.searchVal || "").trim();
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();

    const page = Math.max(1, parseInt(body.page || 1, 10));
    const limit = Math.min(100, Math.max(1, parseInt(body.limit || 20, 10)));
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let params = [];

    if (supplierId > 0) {
      whereClauses.push(`p.supplier_id = ?`);
      params.push(supplierId);
    }
    if (dateFrom) {
      whereClauses.push(`p.date >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClauses.push(`p.date <= ?`);
      params.push(dateTo);
    }
    if (searchVal) {
      whereClauses.push(`(p.item_barcode LIKE ? OR m.item_name LIKE ? OR p.purchase_no LIKE ? OR s.supplier_name LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRes, rowsRes] = await db.batch([
      db.prepare(`
        SELECT COUNT(p.id) as totalRows, COALESCE(SUM(p.total_cost), 0) as totalPurchasesAmount
        FROM pos_purchases p
        LEFT JOIN pos_items_master m ON p.item_barcode = m.barcode
        LEFT JOIN pos_suppliers s ON p.supplier_id = s.id
        ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT p.id, p.purchase_no as purchaseNo, p.date, p.supplier_id as supplierId,
               COALESCE(s.supplier_name, 'အထွေထွေ') as supplierName,
               COALESCE(s.phone_no, '-') as supplierPhone,
               COALESCE(s.address, '-') as supplierAddress,
               p.item_barcode as barcode, COALESCE(m.item_name, 'ပစ္စည်းအမည်မသိ') as itemName,
               p.qty, p.cost_price as costPrice, p.markup_percent as markupPercent,
               p.selling_price as sellingPrice, p.total_cost as totalCost,
               p.remark, p.created_by as createdBy, p.created_at as createdAt
        FROM pos_purchases p
        LEFT JOIN pos_items_master m ON p.item_barcode = m.barcode
        LEFT JOIN pos_suppliers s ON p.supplier_id = s.id
        ${whereSql}
        ORDER BY p.id DESC
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

    const totalRows = countRes.results[0]?.totalRows || 0;
    const totalPurchasesAmount = parseFloat(countRes.results[0]?.totalPurchasesAmount || 0);

    return {
      success: true,
      data: rowsRes.results || [],
      totalRows,
      totalPurchasesAmount,
      page,
      limit
    };
  } catch (err) {
    return { success: false, message: "အဝယ်စာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

// ------------------------------------------------------------------------------
// 💡 အဝယ်စာရင်း ပြင်ဆင်ခြင်း (UPDATE PURCHASE WITH AUTO STOCK DELTA ADJUSTMENT)
// ------------------------------------------------------------------------------
export async function updatePosPurchase(db, session, body) {
  try {
    const id = parseInt(body.id, 10);
    const purchaseNo = String(body.purchaseNo || "").trim();
    if (!id && !purchaseNo) return { success: false, message: "ပြင်ဆင်မည့် အဝယ်စာရင်း ID သို့မဟုတ် PO Number မပါဝင်ပါ။" };

    const existing = await db.prepare(
      "SELECT id, purchase_no, item_barcode, qty, cost_price, selling_price FROM pos_purchases WHERE id = ? OR purchase_no = ?"
    ).bind(id || 0, purchaseNo || "").first();

    if (!existing) return { success: false, message: "ပြင်ဆင်မည့် အဝယ်စာရင်း ရှာမတွေ့ပါ။" };

    const entryDate = getMyanmarDateString(body.date);
    const supplierId = body.supplierId ? parseInt(body.supplierId, 10) : null;
    const newQty = safeAmount(body.qty);
    const newCostPrice = safeAmount(body.costPrice || body.cost_price);
    const markupPercent = Math.max(0, Number(body.markupPercent || body.markup_percent) || 20);
    let newSellingPrice = safeAmount(body.sellingPrice || body.selling_price);

    if (newQty <= 0) return { success: false, message: "အဝယ်အရေအတွက် အနည်းဆုံး ၁ ခု ရှိရပါမည်။" };
    if (newCostPrice <= 0) return { success: false, message: "ပစ္စည်းဝယ်ဈေး ထည့်သွင်းပေးပါ။" };

    if (newSellingPrice <= 0) {
      newSellingPrice = calculateSmartPrice(newCostPrice, markupPercent, 50);
    }

    const totalCost = Math.round(newQty * newCostPrice * 100) / 100;
    const deltaQty = newQty - Number(existing.qty || 0);

    const batchStatements = [
      db.prepare(`
        UPDATE pos_purchases 
        SET date = ?, supplier_id = ?, qty = ?, cost_price = ?, markup_percent = ?, 
            selling_price = ?, total_cost = ?, remark = ?
        WHERE id = ?
      `).bind(entryDate, supplierId, newQty, newCostPrice, markupPercent, newSellingPrice, totalCost, body.remark || '', existing.id),

      db.prepare(`
        UPDATE pos_items_master 
        SET current_stock = current_stock + ?,
            cost_price = ?,
            markup_percent = ?,
            selling_price = ?,
            updated_at = datetime('now')
        WHERE barcode = ?
      `).bind(deltaQty, newCostPrice, markupPercent, newSellingPrice, existing.item_barcode)
    ];

    await db.batch(batchStatements);

    return { success: true, message: "အဝယ်စာရင်းနှင့် Stock အား အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။" };
  } catch (err) {
    return { success: false, message: "အဝယ်စာရင်း ပြင်ဆင်မှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ------------------------------------------------------------------------------
// 💡 အဝယ်စာရင်း ဖျက်သိမ်းခြင်း (DELETE PURCHASE & AUTO ROLLBACK MASTER STOCK)
// ------------------------------------------------------------------------------
export async function deletePosPurchase(db, session, body) {
  try {
    const id = parseInt(body.id, 10);
    const purchaseNo = String(body.purchaseNo || "").trim();
    if (!id && !purchaseNo) return { success: false, message: "ဖျက်သိမ်းမည့် အဝယ်စာရင်း ID သို့မဟုတ် PO Number မပါဝင်ပါ။" };

    const existing = await db.prepare(
      "SELECT id, purchase_no, item_barcode, qty FROM pos_purchases WHERE id = ? OR purchase_no = ?"
    ).bind(id || 0, purchaseNo || "").first();

    if (!existing) return { success: false, message: "ဖျက်သိမ်းမည့် အဝယ်စာရင်း ရှာမတွေ့ပါ။" };

    const rollbackQty = safeAmount(existing.qty);

    const batchStatements = [
      db.prepare("DELETE FROM pos_purchases WHERE id = ?").bind(existing.id),
      db.prepare(`
        UPDATE pos_items_master 
        SET current_stock = current_stock - ?, updated_at = datetime('now') 
        WHERE barcode = ?
      `).bind(rollbackQty, existing.item_barcode)
    ];

    await db.batch(batchStatements);

    return { success: true, message: `အဝယ်စာရင်း (${existing.purchase_no}) အား ဖျက်သိမ်းပြီး Stock (${rollbackQty}) ခုကို ပြန်လည်နုတ်ယူညှိနှိုင်းပြီးပါပြီ။` };
  } catch (err) {
    return { success: false, message: "အဝယ်စာရင်း ဖျက်သိမ်းမှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 5. SALES ORDERS HISTORY AUDITOR (PAGINATED 20 ROWS PER PAGE)
// ==============================================================================
export async function getPosSalesOrdersHistory(db, body) {
  try {
    const page = Math.max(1, parseInt(body.page || 1, 10));
    const limit = Math.min(100, Math.max(1, parseInt(body.limit || 20, 10)));
    const offset = (page - 1) * limit;

    const searchVal = String(body.searchVal || "").trim();
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const paymentMethod = String(body.paymentMethod || "").trim();

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
    if (paymentMethod) {
      whereClauses.push(`payment_method = ?`);
      params.push(paymentMethod);
    }
    if (searchVal) {
      whereClauses.push(`(invoice_no LIKE ? OR items_summary LIKE ? OR CAST(student_id AS TEXT) LIKE ? OR created_by LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRes, rowsRes] = await db.batch([
      db.prepare(`
        SELECT COUNT(id) as totalRows, 
               COALESCE(SUM(total_amount), 0) as totalSalesAmount,
               COALESCE(SUM(net_profit), 0) as totalProfitAmount
        FROM pos_sales_orders
        ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT id, invoice_no as invoiceNo, date, payment_method as paymentMethod,
               student_id as studentId, total_amount as totalAmount, total_cost as totalCost,
               net_profit as netProfit, items_summary as itemsSummary, canteen_vr_no as canteenVrNo,
               uniqueid as uniqueId, created_by as createdBy, created_at as createdAt
        FROM pos_sales_orders
        ${whereSql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

    const stats = countRes.results[0] || {};
    const totalRows = stats.totalRows || 0;
    const totalSalesAmount = parseFloat(stats.totalSalesAmount || 0);
    const totalProfitAmount = parseFloat(stats.totalProfitAmount || 0);

    return {
      success: true,
      data: rowsRes.results || [],
      totalRows,
      totalSalesAmount,
      totalProfitAmount,
      page,
      limit
    };
  } catch (err) {
    return { success: false, message: "အရောင်းမှတ်တမ်းများ ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 6. WASTAGE & LOSS LEDGER (အပျက်/အပျောက်စာရင်း - 20 ROWS PER PAGE)
// ==============================================================================
export async function getPosWasteHistory(db, body) {
  try {
    const page = Math.max(1, parseInt(body.page || 1, 10));
    const limit = Math.min(100, Math.max(1, parseInt(body.limit || 20, 10)));
    const offset = (page - 1) * limit;

    const reason = String(body.reason || "").trim();
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const searchVal = String(body.searchVal || "").trim();

    let whereClauses = [];
    let params = [];

    if (reason) {
      whereClauses.push(`reason = ?`);
      params.push(reason);
    }
    if (dateFrom) {
      whereClauses.push(`date >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClauses.push(`date <= ?`);
      params.push(dateTo);
    }
    if (searchVal) {
      whereClauses.push(`(waste_no LIKE ? OR items_summary LIKE ? OR remark LIKE ? OR reported_by LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRes, rowsRes] = await db.batch([
      db.prepare(`
        SELECT COUNT(id) as totalRows, 
               COALESCE(SUM(total_loss_cost), 0) as totalLossAmount,
               COALESCE(SUM(total_items_qty), 0) as totalLossQty
        FROM pos_waste_records
        ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT id, waste_no as wasteNo, date, reason, total_loss_cost as totalLossCost,
               total_items_qty as totalItemsQty, items_summary as itemsSummary, remark,
               reported_by as reportedBy, uniqueid as uniqueId, created_at as createdAt
        FROM pos_waste_records
        ${whereSql}
        ORDER BY id DESC
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

    const stats = countRes.results[0] || {};
    const totalRows = stats.totalRows || 0;
    const totalLossAmount = parseFloat(stats.totalLossAmount || 0);
    const totalLossQty = parseFloat(stats.totalLossQty || 0);

    return {
      success: true,
      data: rowsRes.results || [],
      totalRows,
      totalLossAmount,
      totalLossQty,
      page,
      limit
    };
  } catch (err) {
    return { success: false, message: "အပျက်/အပျောက်စာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

// ------------------------------------------------------------------------------
// 💡 အပျက်/အပျောက် စာရင်း သွင်းယူခြင်း (Multi-Item Commit + Atomic Stock Deduct)
// ------------------------------------------------------------------------------
export async function savePosWasteEntry(db, session, body) {
  try {
    const entryDate = getMyanmarDateString(body.date);
    const reason = String(body.reason || 'ပျက်စီးကွဲရှ').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const remark = String(body.remark || '').trim();

    if (items.length === 0) {
      return { success: false, message: "အပျက်စာရင်းသွင်းမည့် ပစ္စည်း အနည်းဆုံး ၁ ခု ရွေးချယ်ပါ။" };
    }

    let totalLossCost = 0;
    let totalItemsQty = 0;
    const summaryParts = [];
    const stockDeductions = [];

    for (const it of items) {
      const bCode = String(it.barcode || '').trim();
      const name = String(it.name || it.itemName || 'ပစ္စည်း').trim();
      const q = safeAmount(it.qty);
      const cost = safeAmount(it.costPrice || it.cost);

      if (!bCode || q <= 0) continue;

      totalItemsQty += q;
      totalLossCost += (q * cost);
      summaryParts.push(`${name} x ${q}`);
      stockDeductions.push({ barcode: bCode, qty: q });
    }

    totalLossCost = Math.round(totalLossCost * 100) / 100;

    if (totalItemsQty <= 0) {
      return { success: false, message: "ပစ္စည်းအရေအတွက် ထည့်သွင်းထားခြင်း မရှိပါ။" };
    }

    const itemsSummary = summaryParts.join(', ');
    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^WST_/i, '') : generateUniqueId('').replace(/^_/, '');
    const wasteUniqueId = `WST_${rawCore}`;
    const wasteNo = `WST-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-3).toUpperCase()}`;

    // ⚡ Atomic Batch: ၁ ကြိမ်တည်းဖြင့် Waste Row သွင်းပြီး Stock Master ထဲမှ နုတ်ယူသည်
    const batchStatements = [
      db.prepare(`
        INSERT INTO pos_waste_records (waste_no, date, reason, total_loss_cost, total_items_qty, items_summary, remark, reported_by, uniqueid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(wasteNo, entryDate, reason, totalLossCost, totalItemsQty, itemsSummary, remark, session?.name || 'Cashier', wasteUniqueId)
    ];

    for (const sd of stockDeductions) {
      batchStatements.push(
        db.prepare(`
          UPDATE pos_items_master 
          SET current_stock = current_stock - ?, updated_at = datetime('now') 
          WHERE barcode = ?
        `).bind(sd.qty, sd.barcode)
      );
    }

    await db.batch(batchStatements);

    return {
      success: true,
      wasteNo,
      totalLossCost,
      totalItemsQty,
      message: "အပျက်/အပျောက်စာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။"
    };
  } catch (err) {
    return { success: false, message: "အပျက်စာရင်း မှတ်တမ်းတင်မှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 7. DYNAMIC POS SETTINGS (ALLOWANCE CAP & SYSTEM SETTINGS)
// ==============================================================================
export async function getPosSettings(db) {
  try {
    const res = await db.prepare("SELECT setting_key as settingKey, setting_value as settingValue, description, updated_at as updatedAt FROM pos_settings").all();
    const settingsMap = {};
    (res.results || []).forEach(r => {
      settingsMap[r.settingKey] = r.settingValue;
    });

    if (!settingsMap.daily_spending_cap) {
      settingsMap.daily_spending_cap = '10000';
    }

    return { success: true, data: settingsMap, list: res.results || [] };
  } catch (err) {
    return { success: false, message: "Settings ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

export async function updatePosSettings(db, session, body) {
  try {
    const key = String(body.settingKey || body.key || '').trim();
    const val = String(body.settingValue || body.value || '').trim();

    if (!key) return { success: false, message: "Setting Key မပါဝင်ပါ။" };

    if (key === 'daily_spending_cap') {
      const numVal = parseInt(val, 10);
      if (isNaN(numVal) || numVal < 0) {
        return { success: false, message: "ကျောင်းသား တစ်နေ့တာ ကန့်သတ်ငွေသည် အနည်းဆုံး 0 MMK သို့မဟုတ် အထက် ဖြစ်ရပါမည်။" };
      }
    }

    await db.prepare(`
      INSERT INTO pos_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = datetime('now')
    `).bind(key, val).run();

    return { success: true, message: "စနစ်ဆက်တင်အား အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။" };
  } catch (err) {
    return { success: false, message: "Settings ပြင်ဆင်မှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 8. POS CATALOG & PRICING
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
      `).bind(purchaseNo, entryDate, body.supplierId || null, barcode, qty, costPrice, markupPercent, sellingPrice, totalCost, body.remark || '', session?.name || 'Cashier')
    ];

    await db.batch(batchStatements);

    return { success: true, purchaseNo, sellingPrice, totalCost };
  } catch (err) {
    return { success: false, message: "အဝယ်စာရင်း သိမ်းဆည်းမှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 9. STUDENT POCKET MONEY RADAR (PIGGYBACKED DYNAMIC CAP - ZERO EXTRA READS)
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
    try {
      student = await db.prepare(`
        SELECT student_id as studentId, id, name, class, fyid 
        FROM student 
        WHERE (student_id = ? OR id = ? OR fyid = ? OR nfc_tag_id = ?) LIMIT 1
      `).bind(stuIdNum, stuIdNum, rawInput, rawInput).first();
    } catch (e) {
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

    // 🚀 D1 ULTRA QUOTA-SHIELD: Balance, Spent နှင့် Dynamic Cap တို့ကို ၁ ကြိမ်တည်း ဆွဲယူသည်
    const [balRow, spentRow, capRow] = await db.batch([
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
      `).bind(realStudentId, todayStr),

      db.prepare(`SELECT setting_value as capVal FROM pos_settings WHERE setting_key = 'daily_spending_cap' LIMIT 1`)
    ]);

    const currentBalance = parseFloat(balRow.results[0]?.bal || 0);
    const todaySpent = parseFloat(spentRow.results[0]?.todaySpent || 0);
    const dynamicCap = parseFloat(capRow.results[0]?.capVal || 10000);
    const remainingQuota = Math.max(0, dynamicCap - todaySpent);

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
        dailyCap: dynamicCap
      }
    };
  } catch (err) {
    return { success: false, message: "ကျောင်းသား အချက်အလက် စစ်ဆေး၍ မရပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 10. ATOMIC SINGLE BATCH POS CHECKOUT (DYNAMIC CAP + ATOMIC STOCK LOCK)
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

    if (isWallet) {
      if (!studentId || studentId <= 0) {
        return { success: false, message: "မုန့်ဖိုးအကောင့်ဖြင့် ဝယ်ယူရန် ကျောင်းသား ID လိုအပ်ပါသည်။" };
      }

      // 🚀 Single Batch Verification (Balance + Spent + Dynamic Cap)
      const [balRes, spentRes, capRes] = await db.batch([
        db.prepare(`
          SELECT COALESCE(SUM(debit - credit), 0) as bal 
          FROM student_money 
          WHERE fy IN (?, ?) AND (student_id = ? OR CAST(student_id AS TEXT) = ? OR (fyid IS NOT NULL AND fyid = ?))
        `).bind(cleanFy, `FY ${cleanFy}`, studentId, String(studentId), body.fyid || ''),

        db.prepare(`
          SELECT COALESCE(SUM(total_amount), 0) as todaySpent 
          FROM pos_sales_orders 
          WHERE student_id = ? AND date = ? AND payment_method = 'Student Pocket Money'
        `).bind(studentId, entryDate),

        db.prepare(`SELECT setting_value as capVal FROM pos_settings WHERE setting_key = 'daily_spending_cap' LIMIT 1`)
      ]);

      const curStuBal = parseFloat(balRes.results[0]?.bal || 0);
      const todaySpent = parseFloat(spentRes.results[0]?.todaySpent || 0);
      const dynamicCap = parseFloat(capRes.results[0]?.capVal || 10000);

      if (totalAmount > curStuBal) {
        return { 
          success: false, 
          message: `မုန့်ဖိုးလက်ကျန် မလုံလောက်ပါ! လက်ရှိတွင် (${curStuBal.toLocaleString('en-US')} MMK) သာ ကျန်ရှိပါသည်။` 
        };
      }

      if ((todaySpent + totalAmount) > dynamicCap) {
        const remaining = Math.max(0, dynamicCap - todaySpent);
        return { 
          success: false, 
          message: `တစ်ရက် မုန့်ဖိုးကန့်သတ်ချက် (${dynamicCap.toLocaleString('en-US')} MMK) ကျော်လွန်နေပါသည်! ယနေ့ (${todaySpent.toLocaleString('en-US')} MMK) သုံးပြီးဖြစ်၍ (${remaining.toLocaleString('en-US')} MMK) သာ ဝယ်ယူခွင့် ကျန်ပါတော့သည်။` 
        };
      }
    }

    const invoiceNo = `INV-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-4).toUpperCase()}`;
    const vrCan = await generateVoucherNo(db, 'canteen_book', 'CAN', entryDate);
    const noCan = await generateFyNo(db, 'canteen_book', fy);

    const batchStatements = [];

    batchStatements.push(
      db.prepare(`
        INSERT INTO pos_sales_orders (invoice_no, date, payment_method, student_id, total_amount, total_cost, net_profit, items_summary, canteen_vr_no, uniqueid, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(invoiceNo, entryDate, paymentMethod, studentId, totalAmount, totalCost, netProfit, itemsSummary, vrCan, posUniqueId, session?.name || 'Cashier')
    );

    batchStatements.push(
      db.prepare(`
        INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid)
        VALUES (?, ?, 'POS Sales', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
      `).bind(noCan, entryDate, `[${invoiceNo}] ${itemsSummary}`, paymentMethod === 'Cash' ? 'Cash' : 'Transfer', totalAmount, vrCan, my, fy, session?.name || 'Cashier', canUniqueId)
    );

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

    // 🎯 Multi-Counter Concurrency Safe Atomic Stock Deduction
    for (const item of stockDeductions) {
      const bCode = String(item.barcode || "").trim();
      const q = safeAmount(item.qty);
      if (bCode && q > 0) {
        batchStatements.push(
          db.prepare(`
            UPDATE pos_items_master 
            SET current_stock = current_stock - ?, updated_at = datetime('now') 
            WHERE barcode = ? AND current_stock >= ?
          `).bind(q, bCode, q)
        );
      }
    }

    await db.batch(batchStatements);

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
// 💡 11. EVENING CANTEEN SETTLEMENT (ညနေပိုင်း ငွေသားရှင်းလင်းမှု)
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

// ==============================================================================
// 💡 12. SUPPLIERS MASTER (FULL PROFILE: PH NO & ADDRESS)
// ==============================================================================
export async function getPosSuppliers(db) {
  try {
    const res = await db.prepare("SELECT id, supplier_name as supplierName, contact_person as contactPerson, phone_no as phoneNo, address, is_active as isActive FROM pos_suppliers WHERE is_active = 1 ORDER BY supplier_name ASC").all();
    return { success: true, data: res.results || [] };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

export async function savePosSupplier(db, session, body) {
  try {
    const name = String(body.supplierName || "").trim();
    if (!name) return { success: false, message: "ကုန်သည်အမည် ထည့်သွင်းပါ။" };

    const contactPerson = String(body.contactPerson || "").trim();
    const phoneNo = String(body.phoneNo || "").trim();
    const address = String(body.address || "").trim();

    await db.prepare(`
      INSERT INTO pos_suppliers (supplier_name, contact_person, phone_no, address)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(supplier_name) DO UPDATE SET
        contact_person = excluded.contact_person,
        phone_no = excluded.phone_no,
        address = excluded.address
    `).bind(name, contactPerson, phoneNo, address).run();

    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}