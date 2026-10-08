/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CANTEEN POS HANDLERS (CLOUDFLARE D1 ENTERPRISE V9.3 FULL)
 * File: handlers-canteen-pos.js (Location: cashbook-api/handlers-canteen-pos.js)
 * 
 * 💡 Features & Architectural Blueprint V9.3:
 *   1. 🕒 STRICT MMT TIMEZONE: Universal UTC+06:30 Myanmar Standard Time calculation
 *   2. 📊 LIVE DASHBOARD: 1-Batch Atomic Metrics (Today, THIS MONTH, All-Time & Closure)
 *   3. 🛒 PURCHASES HUB KPIS: Real-time Today, THIS MONTH & All-Time purchase totals
 *   4. 💰 CAPITAL INVARIANCE: Surplus stock increases inventory count WITHOUT inflating capital
 *   5. 📈 8% DEFAULT MARKUP: Dynamic Pricing updated with 50-step cash rounding
 *   6. 📦 SURPLUS & WASTAGE: Multi-item cost-basis ledgers with atomic rollback engines
 *   7. 🧾 SALES ORDERS AUDITOR: Full 20-row paginated history with profit tracking
 *   8. 🔒 STORE CLOSURE INTERLOCK: Day Close enforcement before Finance Settlement
 *   9. 🌐 OFFLINE BATCH SYNC: Idempotent queue sync with Zero Double-Deduction guarantee
 *  10. 🛡️ SELF-HEALING SCHEMA: Auto-verifies and heals missing columns/tables on cold start
 *  11. ⚡ D1 QUOTA-SHIELD: Maximum query batching to minimize read/write charges
 * ==============================================================================
 */

import {
  normalizeFyStr,
  sanitizeFyidStr,
  generateUniqueId,
  generateVoucherNo,
  generateFyNo,
  recalculateLedgerBalances,
  getCurrentAcademicYear
} from './utils.js';

// ------------------------------------------------------------------------------
// 🕒 1. STRICT MYANMAR STANDARD TIME ENGINE (MMT UTC+06:30)
// ------------------------------------------------------------------------------
export function getMyanmarDateString(dInput) {
  if (dInput && typeof dInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dInput.trim())) {
    return dInput.trim();
  }
  const d = dInput ? new Date(dInput) : new Date();
  const targetMs = isNaN(d.getTime()) ? Date.now() : d.getTime();
  // Myanmar is strictly UTC + 6 hours 30 minutes (23,400,000 ms)
  const mmt = new Date(targetMs + (6.5 * 60 * 60 * 1000));
  return mmt.toISOString().slice(0, 10);
}

function computeAcademicFy(dateStr) {
  const cleanDate = dateStr || getMyanmarDateString();
  const d = new Date(cleanDate);
  if (isNaN(d.getTime())) return getCurrentAcademicYear();
  let year = d.getFullYear();
  if (d.getMonth() < 2) year -= 1; // Before March belongs to previous academic year
  return `${year}-${year + 1}`;
}

// 🛡️ Fail-safe Number Sanitizer (Negative & NaN အား လုံးဝ အဝင်မခံပါ)
function safeAmount(val) {
  const num = Number(val);
  return (Number.isFinite(num) && num > 0) ? Math.round(num * 100) / 100 : 0;
}

// ------------------------------------------------------------------------------
// 🛡️ 2. SELF-HEALING SCHEMA GUARDIAN (AUTO-MIGRATION FALLBACK)
// ------------------------------------------------------------------------------
let _schemaInitialized = false;
async function ensureCanteenSchema(db) {
  if (_schemaInitialized || !db || typeof db.prepare !== 'function') return;
  try {
    await db.prepare("ALTER TABLE pos_items_master ADD COLUMN surplus_stock REAL NOT NULL DEFAULT 0").run();
  } catch (e) {}
  try {
    await db.prepare("ALTER TABLE pos_waste_records ADD COLUMN items_json TEXT").run();
  } catch (e) {}
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS pos_surplus_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        surplus_no TEXT UNIQUE NOT NULL,
        date TEXT NOT NULL,
        reason TEXT NOT NULL,
        total_surplus_value REAL NOT NULL DEFAULT 0,
        total_items_qty REAL NOT NULL DEFAULT 0,
        items_summary TEXT NOT NULL,
        items_json TEXT,
        remark TEXT,
        reported_by TEXT NOT NULL DEFAULT 'Cashier',
        uniqueid TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  } catch (e) {}
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS canteen_day_closures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE NOT NULL,
        closed_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_by TEXT NOT NULL,
        total_sales REAL NOT NULL DEFAULT 0,
        cash_sales REAL NOT NULL DEFAULT 0,
        wallet_sales REAL NOT NULL DEFAULT 0,
        total_orders INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'CLOSED',
        remark TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
  } catch (e) {}
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS pos_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `).run();
    await db.prepare(`
      INSERT INTO pos_settings (setting_key, setting_value, description)
      VALUES ('daily_spending_cap', '10000', 'ကျောင်းသားတစ်ဦး တစ်ရက် အများဆုံး မုန့်ဖိုးသုံးစွဲခွင့် ကန့်သတ်ငွေ (MMK)')
      ON CONFLICT(setting_key) DO NOTHING
    `).run();
  } catch (e) {}
  _schemaInitialized = true;
}

// ==============================================================================
// 💡 3. SMART PRICING ROUNDING ENGINE (DEFAULT 8% MARKUP, 50-STEP ROUNDING)
// ==============================================================================
export function calculateSmartPrice(costPrice, markupPercent = 8, roundTo = 50) {
  const cost = safeAmount(costPrice);
  const markup = Math.max(0, Number(markupPercent !== undefined ? markupPercent : 8));
  const rawPrice = cost * (1 + markup / 100);
  if (rawPrice <= 0) return 0;
  
  const step = (roundTo === 100) ? 100 : 50;
  return Math.ceil(rawPrice / step) * step;
}

// ==============================================================================
// 💡 4. CANTEEN EXECUTIVE DASHBOARD METRICS (SINGLE BATCH: TODAY, MONTH, ALL-TIME)
// ==============================================================================
export async function getCanteenDashboardMetrics(db, body) {
  try {
    await ensureCanteenSchema(db);
    const todayStr = getMyanmarDateString();
    const date = String(body.date || todayStr).trim();

    // 📅 Calculate Month Range for MMT (e.g., '2026-10-01' to '2026-10-31')
    const monthPrefix = date.slice(0, 7); // 'YYYY-MM'
    const monthStart = `${monthPrefix}-01`;
    const [y, m] = monthPrefix.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

    // 🚀 D1 ULTRA QUOTA-SHIELD: Single Batch ဖြင့် Query အားလုံးကို တပြိုင်နက် ဆွဲယူသည်
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
        SELECT 
          settlement_no as settlementNo, 
          net_payout_amount as netPayoutAmount, 
          created_at as createdAt, 
          handed_over_by as handedOverBy, 
          received_by as receivedBy 
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

      // ၄။ Stock သတိပေးချက်နှင့် စုစုပေါင်း ရင်းနှီးငွေတန်ဖိုး (Capital Investment - Invariance Formula)
      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN current_stock <= 10 THEN 1 ELSE 0 END), 0) as lowStockCount,
          COALESCE(SUM(
            CASE 
              WHEN (current_stock - COALESCE(surplus_stock, 0)) > 0 
              THEN (cost_price * (current_stock - COALESCE(surplus_stock, 0))) 
              ELSE 0 
            END
          ), 0) as totalStockCapital
        FROM pos_items_master 
        WHERE is_active = 1
      `),

      // ၅။ အပျက်/အပျောက် ဆုံးရှုံးမှုတန်ဖိုး (ယနေ့၊ ယခုလ နှင့် သမိုင်းဝင် ဆုံးရှုံးငွေ)
      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN date = ? THEN total_loss_cost ELSE 0 END), 0) as todayLossCost,
          COALESCE(SUM(CASE WHEN date >= ? AND date <= ? THEN total_loss_cost ELSE 0 END), 0) as monthLossCost,
          COALESCE(SUM(total_loss_cost), 0) as allTimeLossCost
        FROM pos_waste_records
      `).bind(date, monthStart, monthEnd),

      // ၆။ အပိုပစ္စည်း ရရှိမှုတန်ဖိုး (ယနေ့၊ ယခုလ နှင့် သမိုင်းဝင် အပိုငွေ)
      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN date = ? THEN total_surplus_value ELSE 0 END), 0) as todaySurplusValue,
          COALESCE(SUM(CASE WHEN date >= ? AND date <= ? THEN total_surplus_value ELSE 0 END), 0) as monthSurplusValue,
          COALESCE(SUM(total_surplus_value), 0) as allTimeSurplusValue
        FROM pos_surplus_records
      `).bind(date, monthStart, monthEnd),

      // ၇။ ယနေ့ ကန်တင်းဆိုင်ပိတ်သိမ်းပြီး/မပြီး စစ်ဆေးခြင်း
      db.prepare(`
        SELECT 
          date, 
          closed_at as closedAt, 
          closed_by as closedBy, 
          status 
        FROM canteen_day_closures 
        WHERE date = ? 
        LIMIT 1
      `).bind(date),

      // ၈။ 🎯 ယခုလ (THIS MONTH) အရောင်းစာရင်းချုပ်
      db.prepare(`
        SELECT 
          COUNT(id) as monthOrders,
          COALESCE(SUM(total_amount), 0) as monthSales,
          COALESCE(SUM(CASE WHEN payment_method = 'Student Pocket Money' THEN total_amount ELSE 0 END), 0) as monthPocketShare,
          COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END), 0) as monthCashShare,
          COALESCE(SUM(net_profit), 0) as monthProfit
        FROM pos_sales_orders 
        WHERE date >= ? AND date <= ?
      `).bind(monthStart, monthEnd)
    ];

    let todayRes, settleRes, allTimeRes, stockRes, wasteRes, surplusRes, closureRes, monthRes;
    try {
      [todayRes, settleRes, allTimeRes, stockRes, wasteRes, surplusRes, closureRes, monthRes] = await db.batch(batchQueries);
    } catch (batchErr) {
      // Fallback query if surplus_stock column was pending in master table
      const fallbackStockQuery = db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN current_stock <= 10 THEN 1 ELSE 0 END), 0) as lowStockCount,
          COALESCE(SUM(CASE WHEN current_stock > 0 THEN (cost_price * current_stock) ELSE 0 END), 0) as totalStockCapital
        FROM pos_items_master 
        WHERE is_active = 1
      `);
      batchQueries[3] = fallbackStockQuery;
      [todayRes, settleRes, allTimeRes, stockRes, wasteRes, surplusRes, closureRes, monthRes] = await db.batch(batchQueries);
    }

    const todayStats = todayRes?.results?.[0] || {};
    const settle = settleRes?.results?.[0] || null;
    const allTimeStats = allTimeRes?.results?.[0] || {};
    const stockStats = stockRes?.results?.[0] || {};
    const wasteStats = wasteRes?.results?.[0] || {};
    const surplusStats = surplusRes?.results?.[0] || {};
    const closure = closureRes?.results?.[0] || null;
    const monthStats = monthRes?.results?.[0] || {};

    const lowStockCount = Number(stockStats.lowStockCount || 0);
    const totalStockCapital = parseFloat(stockStats.totalStockCapital || 0);
    
    // 🎯 Net Loss Formulas (Waste - Surplus)
    const todayLossCost = parseFloat(wasteStats.todayLossCost || 0);
    const todaySurplusValue = parseFloat(surplusStats.todaySurplusValue || 0);
    const todayNetLoss = Math.round((todayLossCost - todaySurplusValue) * 100) / 100;

    const monthLossCost = parseFloat(wasteStats.monthLossCost || 0);
    const monthSurplusValue = parseFloat(surplusStats.monthSurplusValue || 0);
    const monthNetLoss = Math.round((monthLossCost - monthSurplusValue) * 100) / 100;

    const allTimeLossCost = parseFloat(wasteStats.allTimeLossCost || 0);
    const allTimeSurplusValue = parseFloat(surplusStats.allTimeSurplusValue || 0);
    const allTimeNetLoss = Math.round((allTimeLossCost - allTimeSurplusValue) * 100) / 100;

    return {
      success: true,
      data: {
        date,
        monthPrefix,
        today: {
          totalOrders: todayStats.totalOrders || 0,
          totalSales: parseFloat(todayStats.totalSales || 0),
          pocketMoneyShare: parseFloat(todayStats.pocketMoneyShare || 0),
          cashSalesShare: parseFloat(todayStats.cashSalesShare || 0),
          totalProfit: parseFloat(todayStats.totalProfit || 0),
          todayLossCost,
          todaySurplusValue,
          todayNetLoss,
          isSettled: Boolean(settle),
          settlement: settle,
          isClosed: Boolean(closure),
          closure: closure
        },
        thisMonth: {
          monthPrefix,
          totalOrders: monthStats.monthOrders || 0,
          totalSales: parseFloat(monthStats.monthSales || 0),
          pocketMoneyShare: parseFloat(monthStats.monthPocketShare || 0),
          cashSalesShare: parseFloat(monthStats.monthCashShare || 0),
          totalProfit: parseFloat(monthStats.monthProfit || 0),
          monthLossCost,
          monthSurplusValue,
          monthNetLoss
        },
        allTime: {
          totalOrders: allTimeStats.allTimeOrders || 0,
          totalSales: parseFloat(allTimeStats.allTimeSales || 0),
          pocketMoneyShare: parseFloat(allTimeStats.allTimePocketShare || 0),
          cashSalesShare: parseFloat(allTimeStats.allTimeCashShare || 0),
          totalProfit: parseFloat(allTimeStats.allTimeProfit || 0),
          totalStockCapital,
          allTimeLossCost,
          allTimeSurplusValue,
          allTimeNetLoss
        },
        totalStockCapital,
        lowStockCount,
        todayLossCost,
        todaySurplusValue,
        todayNetLoss,
        monthLossCost,
        monthSurplusValue,
        monthNetLoss,
        allTimeLossCost,
        allTimeSurplusValue,
        allTimeNetLoss,
        isClosed: Boolean(closure)
      }
    };
  } catch (err) {
    return { success: false, message: "Dashboard အချက်အလက် ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

// ==============================================================================
// 📦 5. STOCK SURPLUS LEDGER (CAPITAL INVARIANCE ENGINE)
// ==============================================================================
export async function getPosSurplusHistory(db, body) {
  try {
    await ensureCanteenSchema(db);
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
      whereClauses.push(`(surplus_no LIKE ? OR items_summary LIKE ? OR remark LIKE ? OR reported_by LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRes, rowsRes] = await db.batch([
      db.prepare(`
        SELECT 
          COUNT(id) as totalRows, 
          COALESCE(SUM(total_surplus_value), 0) as totalSurplusAmount, 
          COALESCE(SUM(total_items_qty), 0) as totalSurplusQty 
        FROM pos_surplus_records 
        ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT 
          id, 
          surplus_no as surplusNo, 
          date, 
          reason, 
          total_surplus_value as totalSurplusValue, 
          total_items_qty as totalItemsQty, 
          items_summary as itemsSummary, 
          items_json as itemsJson, 
          remark, 
          reported_by as reportedBy, 
          uniqueid as uniqueId, 
          created_at as createdAt 
        FROM pos_surplus_records 
        ${whereSql} 
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

    const stats = countRes.results[0] || {};
    return {
      success: true,
      data: rowsRes.results || [],
      totalRows: stats.totalRows || 0,
      totalSurplusAmount: parseFloat(stats.totalSurplusAmount || 0),
      totalSurplusQty: parseFloat(stats.totalSurplusQty || 0),
      page,
      limit
    };
  } catch (err) {
    return { success: false, message: "အပိုစာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

export async function savePosSurplusEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const entryDate = getMyanmarDateString(body.date);
    const reason = String(body.reason || 'ရေတွက်မှုအပို').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const remark = String(body.remark || '').trim();

    if (items.length === 0) {
      return { success: false, message: "အပိုစာရင်းသွင်းမည့် ပစ္စည်း အနည်းဆုံး ၁ ခု ရွေးချယ်ပါ။" };
    }

    let totalSurplusValue = 0;
    let totalItemsQty = 0;
    const summaryParts = [];
    const stockAdditions = [];

    for (const it of items) {
      const bCode = String(it.barcode || '').trim();
      const name = String(it.name || it.itemName || 'ပစ္စည်း').trim();
      const q = safeAmount(it.qty);
      const cost = safeAmount(it.costPrice || it.cost);

      if (!bCode || q <= 0) continue;

      totalItemsQty += q;
      totalSurplusValue += (q * cost);
      summaryParts.push(`${name} x ${q}`);
      stockAdditions.push({ barcode: bCode, qty: q, costPrice: cost, name });
    }

    totalSurplusValue = Math.round(totalSurplusValue * 100) / 100;
    if (totalItemsQty <= 0) {
      return { success: false, message: "ပစ္စည်းအရေအတွက် ထည့်သွင်းထားခြင်း မရှိပါ။" };
    }

    const itemsSummary = summaryParts.join(', ');
    const itemsJson = JSON.stringify(stockAdditions);
    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^SUR_/i, '') : generateUniqueId('').replace(/^_/, '');
    const surplusUniqueId = `SUR_${rawCore}`;
    const surplusNo = `SUR-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-3).toUpperCase()}`;

    // ⚡ Atomic Batch: current_stock တိုးပြီး surplus_stock ပါ တပြိုင်နက်တိုးသဖြင့် ရင်းနှီးငွေ မတက်ပါ
    const batchStatements = [
      db.prepare(`
        INSERT INTO pos_surplus_records (surplus_no, date, reason, total_surplus_value, total_items_qty, items_summary, items_json, remark, reported_by, uniqueid) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(surplusNo, entryDate, reason, totalSurplusValue, totalItemsQty, itemsSummary, itemsJson, remark, session?.name || 'Cashier', surplusUniqueId)
    ];

    for (const sa of stockAdditions) {
      batchStatements.push(
        db.prepare(`
          UPDATE pos_items_master 
          SET current_stock = current_stock + ?, 
              surplus_stock = COALESCE(surplus_stock, 0) + ?, 
              updated_at = datetime('now') 
          WHERE barcode = ?
        `).bind(sa.qty, sa.qty, sa.barcode)
      );
    }

    await db.batch(batchStatements);
    return {
      success: true,
      surplusNo,
      totalSurplusValue,
      totalItemsQty,
      message: "အပိုစာရင်း အောင်မြင်စွာ မှတ်တမ်းတင်ပြီး စတော့လက်ကျန် တိုးမြှင့်ပြီးပါပြီ။"
    };
  } catch (err) {
    return { success: false, message: "အပိုစာရင်း မှတ်တမ်းတင်မှု မအောင်မြင်ပါ: " + err.message };
  }
}

export async function deletePosSurplusEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const id = parseInt(body.id, 10);
    const surplusNo = String(body.surplusNo || "").trim();
    if (!id && !surplusNo) return { success: false, message: "အပိုစာရင်း အချက်အလက် မပါဝင်ပါ။" };

    const existing = await db.prepare("SELECT id, surplus_no, items_json FROM pos_surplus_records WHERE id = ? OR surplus_no = ?").bind(id || 0, surplusNo || "").first();
    if (!existing) return { success: false, message: "ဖျက်သိမ်းမည့် အပိုစာရင်း ရှာမတွေ့ပါ။" };

    const batchStatements = [
      db.prepare("DELETE FROM pos_surplus_records WHERE id = ?").bind(existing.id)
    ];

    if (existing.items_json) {
      try {
        const items = JSON.parse(existing.items_json);
        for (const it of items) {
          const q = safeAmount(it.qty);
          if (it.barcode && q > 0) {
            batchStatements.push(
              db.prepare(`
                UPDATE pos_items_master 
                SET current_stock = MAX(0, current_stock - ?), 
                    surplus_stock = MAX(0, COALESCE(surplus_stock, 0) - ?), 
                    updated_at = datetime('now') 
                WHERE barcode = ?
              `).bind(q, q, it.barcode)
            );
          }
        }
      } catch (jsonErr) {}
    }

    await db.batch(batchStatements);
    return { success: true, message: `အပိုစာရင်း (${existing.surplus_no}) အား ဖျက်သိမ်းပြီး စတော့အရေအတွက် ပြန်လည်ညှိနှိုင်းပြီးပါပြီ။` };
  } catch (err) {
    return { success: false, message: "အပိုစာရင်း ဖျက်သိမ်းမှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// ⚠️ 6. WASTAGE & LOSS LEDGER (အပျက်စာရင်း & ADMIN ROLLBACK)
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
        SELECT 
          COUNT(id) as totalRows, 
          COALESCE(SUM(total_loss_cost), 0) as totalLossAmount, 
          COALESCE(SUM(total_items_qty), 0) as totalLossQty 
        FROM pos_waste_records 
        ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT 
          id, 
          waste_no as wasteNo, 
          date, 
          reason, 
          total_loss_cost as totalLossCost, 
          total_items_qty as totalItemsQty, 
          items_summary as itemsSummary, 
          items_json as itemsJson, 
          remark, 
          reported_by as reportedBy, 
          uniqueid as uniqueId, 
          created_at as createdAt 
        FROM pos_waste_records 
        ${whereSql} 
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

    const stats = countRes.results[0] || {};
    return {
      success: true,
      data: rowsRes.results || [],
      totalRows: stats.totalRows || 0,
      totalLossAmount: parseFloat(stats.totalLossAmount || 0),
      totalLossQty: parseFloat(stats.totalLossQty || 0),
      page,
      limit
    };
  } catch (err) {
    return { success: false, message: "အပျက်/အပျောက်စာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

export async function savePosWasteEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
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
      stockDeductions.push({ barcode: bCode, qty: q, costPrice: cost, name });
    }

    totalLossCost = Math.round(totalLossCost * 100) / 100;
    if (totalItemsQty <= 0) {
      return { success: false, message: "ပစ္စည်းအရေအတွက် ထည့်သွင်းထားခြင်း မရှိပါ။" };
    }

    const itemsSummary = summaryParts.join(', ');
    const itemsJson = JSON.stringify(stockDeductions);
    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^WST_/i, '') : generateUniqueId('').replace(/^_/, '');
    const wasteUniqueId = `WST_${rawCore}`;
    const wasteNo = `WST-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-3).toUpperCase()}`;

    const batchStatements = [
      db.prepare(`
        INSERT INTO pos_waste_records (waste_no, date, reason, total_loss_cost, total_items_qty, items_summary, items_json, remark, reported_by, uniqueid) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(wasteNo, entryDate, reason, totalLossCost, totalItemsQty, itemsSummary, itemsJson, remark, session?.name || 'Cashier', wasteUniqueId)
    ];

    for (const sd of stockDeductions) {
      batchStatements.push(
        db.prepare(`
          UPDATE pos_items_master 
          SET current_stock = current_stock - ?, 
              surplus_stock = MAX(0, COALESCE(surplus_stock, 0) - ?), 
              updated_at = datetime('now') 
          WHERE barcode = ?
        `).bind(sd.qty, sd.qty, sd.barcode)
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

export async function deletePosWasteEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const id = parseInt(body.id, 10);
    const wasteNo = String(body.wasteNo || "").trim();
    if (!id && !wasteNo) return { success: false, message: "အပျက်စာရင်း အချက်အလက် မပါဝင်ပါ။" };

    const existing = await db.prepare("SELECT id, waste_no, items_json FROM pos_waste_records WHERE id = ? OR waste_no = ?").bind(id || 0, wasteNo || "").first();
    if (!existing) return { success: false, message: "ဖျက်သိမ်းမည့် အပျက်စာရင်း ရှာမတွေ့ပါ။" };

    const batchStatements = [
      db.prepare("DELETE FROM pos_waste_records WHERE id = ?").bind(existing.id)
    ];

    if (existing.items_json) {
      try {
        const items = JSON.parse(existing.items_json);
        for (const it of items) {
          const q = safeAmount(it.qty);
          if (it.barcode && q > 0) {
            batchStatements.push(
              db.prepare(`
                UPDATE pos_items_master 
                SET current_stock = current_stock + ?, 
                    updated_at = datetime('now') 
                WHERE barcode = ?
              `).bind(q, it.barcode)
            );
          }
        }
      } catch (jsonErr) {}
    }

    await db.batch(batchStatements);
    return { success: true, message: `အပျက်စာရင်း (${existing.waste_no}) အား ဖျက်သိမ်းပြီး စတော့အရေအတွက် ပြန်လည်ပေါင်းထည့်ပြီးပါပြီ။` };
  } catch (err) {
    return { success: false, message: "အပျက်စာရင်း ဖျက်သိမ်းမှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 🛒 7. PURCHASES & SUPPLIERS AUDIT (WITH LIVE TODAY, THIS MONTH & ALL-TIME KPIS)
// ==============================================================================
export async function getPosPurchasesHistory(db, body) {
  try {
    const todayStr = getMyanmarDateString();
    const monthPrefix = todayStr.slice(0, 7);
    const monthStart = `${monthPrefix}-01`;
    const [y, m] = monthPrefix.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

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

    // 🚀 D1 Batch: Filtered rows query, count query AND live KPI aggregate query in 1 round-trip!
    const [countRes, rowsRes, kpiRes] = await db.batch([
      db.prepare(`
        SELECT 
          COUNT(p.id) as totalRows, 
          COALESCE(SUM(p.total_cost), 0) as totalPurchasesAmount 
        FROM pos_purchases p 
        LEFT JOIN pos_items_master m ON p.item_barcode = m.barcode 
        LEFT JOIN pos_suppliers s ON p.supplier_id = s.id 
        ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT 
          p.id, 
          p.purchase_no as purchaseNo, 
          p.date, 
          p.supplier_id as supplierId, 
          COALESCE(s.supplier_name, 'အထွေထွေ') as supplierName, 
          COALESCE(s.phone_no, '-') as supplierPhone, 
          COALESCE(s.address, '-') as supplierAddress, 
          p.item_barcode as barcode, 
          COALESCE(m.item_name, 'ပစ္စည်းအမည်မသိ') as itemName, 
          p.qty, 
          p.cost_price as costPrice, 
          p.markup_percent as markupPercent, 
          p.selling_price as sellingPrice, 
          p.total_cost as totalCost, 
          p.remark, 
          p.created_by as createdBy, 
          p.created_at as createdAt 
        FROM pos_purchases p 
        LEFT JOIN pos_items_master m ON p.item_barcode = m.barcode 
        LEFT JOIN pos_suppliers s ON p.supplier_id = s.id 
        ${whereSql} 
        ORDER BY p.id DESC 
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset),

      // 🎯 Live Purchases KPI Summaries (Today, This Month, All-Time)
      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN date = ? THEN total_cost ELSE 0 END), 0) as todayPurchasesTotal,
          COALESCE(SUM(CASE WHEN date >= ? AND date <= ? THEN total_cost ELSE 0 END), 0) as thisMonthPurchasesTotal,
          COALESCE(SUM(total_cost), 0) as allTimePurchasesTotal,
          COUNT(CASE WHEN date = ? THEN 1 END) as todayPurchasesCount,
          COUNT(CASE WHEN date >= ? AND date <= ? THEN 1 END) as thisMonthPurchasesCount,
          COUNT(id) as allTimePurchasesCount
        FROM pos_purchases
      `).bind(todayStr, monthStart, monthEnd, todayStr, monthStart, monthEnd)
    ]);

    const totalRows = countRes.results[0]?.totalRows || 0;
    const totalPurchasesAmount = parseFloat(countRes.results[0]?.totalPurchasesAmount || 0);
    const kpiStats = kpiRes?.results?.[0] || {};

    return {
      success: true,
      data: rowsRes.results || [],
      totalRows,
      totalPurchasesAmount, // Currently filtered sum
      todayPurchasesTotal: parseFloat(kpiStats.todayPurchasesTotal || 0),
      thisMonthPurchasesTotal: parseFloat(kpiStats.thisMonthPurchasesTotal || 0),
      allTimePurchasesTotal: parseFloat(kpiStats.allTimePurchasesTotal || 0),
      todayPurchasesCount: Number(kpiStats.todayPurchasesCount || 0),
      thisMonthPurchasesCount: Number(kpiStats.thisMonthPurchasesCount || 0),
      allTimePurchasesCount: Number(kpiStats.allTimePurchasesCount || 0),
      page,
      limit
    };
  } catch (err) {
    return { success: false, message: "အဝယ်စာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
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
    // 🎯 DEFAULT 8% MARKUP
    const markupPercent = Math.max(0, Number(body.markupPercent !== undefined ? body.markupPercent : (body.markup_percent !== undefined ? body.markup_percent : 8)));

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

export async function updatePosPurchase(db, session, body) {
  try {
    const id = parseInt(body.id, 10);
    const purchaseNo = String(body.purchaseNo || "").trim();
    if (!id && !purchaseNo) return { success: false, message: "ပြင်ဆင်မည့် အဝယ်စာရင်း ID သို့မဟုတ် PO Number မပါဝင်ပါ။" };

    const existing = await db.prepare("SELECT id, purchase_no, item_barcode, qty, cost_price, selling_price FROM pos_purchases WHERE id = ? OR purchase_no = ?").bind(id || 0, purchaseNo || "").first();
    if (!existing) return { success: false, message: "ပြင်ဆင်မည့် အဝယ်စာရင်း ရှာမတွေ့ပါ။" };

    const entryDate = getMyanmarDateString(body.date);
    const supplierId = body.supplierId ? parseInt(body.supplierId, 10) : null;
    const newQty = safeAmount(body.qty);
    const newCostPrice = safeAmount(body.costPrice || body.cost_price);
    // 🎯 DEFAULT 8% MARKUP
    const markupPercent = Math.max(0, Number(body.markupPercent !== undefined ? body.markupPercent : (body.markup_percent !== undefined ? body.markup_percent : 8)));
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

export async function deletePosPurchase(db, session, body) {
  try {
    const id = parseInt(body.id, 10);
    const purchaseNo = String(body.purchaseNo || "").trim();
    if (!id && !purchaseNo) return { success: false, message: "ဖျက်သိမ်းမည့် အဝယ်စာရင်း ID သို့မဟုတ် PO Number မပါဝင်ပါ။" };

    const existing = await db.prepare("SELECT id, purchase_no, item_barcode, qty FROM pos_purchases WHERE id = ? OR purchase_no = ?").bind(id || 0, purchaseNo || "").first();
    if (!existing) return { success: false, message: "ဖျက်သိမ်းမည့် အဝယ်စာရင်း ရှာမတွေ့ပါ။" };

    const rollbackQty = safeAmount(existing.qty);
    const batchStatements = [
      db.prepare("DELETE FROM pos_purchases WHERE id = ?").bind(existing.id),
      db.prepare(`
        UPDATE pos_items_master 
        SET current_stock = current_stock - ?, 
            updated_at = datetime('now') 
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
// 🧾 8. SALES ORDERS HISTORY AUDITOR (SOLVES CLOUDFLARE BUILD WARNING)
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
        SELECT 
          COUNT(id) as totalRows, 
          COALESCE(SUM(total_amount), 0) as totalSalesAmount, 
          COALESCE(SUM(net_profit), 0) as totalProfitAmount 
        FROM pos_sales_orders 
        ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT 
          id, 
          invoice_no as invoiceNo, 
          date, 
          payment_method as paymentMethod, 
          student_id as studentId, 
          total_amount as totalAmount, 
          total_cost as totalCost, 
          net_profit as netProfit, 
          items_summary as itemsSummary, 
          canteen_vr_no as canteenVrNo, 
          uniqueid as uniqueId, 
          created_by as createdBy, 
          created_at as createdAt 
        FROM pos_sales_orders 
        ${whereSql} 
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

    const stats = countRes.results[0] || {};
    return {
      success: true,
      data: rowsRes.results || [],
      totalRows: stats.totalRows || 0,
      totalSalesAmount: parseFloat(stats.totalSalesAmount || 0),
      totalProfitAmount: parseFloat(stats.totalProfitAmount || 0),
      page,
      limit
    };
  } catch (err) {
    return { success: false, message: "အရောင်းမှတ်တမ်းများ ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 9. REAL-TIME STOCK INVENTORY AUDITOR (WITH CAPITAL INVARIANCE)
// ==============================================================================
export async function getPosStockInventory(db, body) {
  try {
    await ensureCanteenSchema(db);
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

    let summaryRes, rowsRes;
    try {
      [summaryRes, rowsRes] = await db.batch([
        db.prepare(`
          SELECT 
            COUNT(id) as totalRows, 
            COALESCE(SUM(current_stock), 0) as totalStockQty,
            COALESCE(SUM(cost_price * CASE WHEN (current_stock - COALESCE(surplus_stock, 0)) > 0 THEN (current_stock - COALESCE(surplus_stock, 0)) ELSE 0 END), 0) as totalStockValue,
            COALESCE(SUM(CASE WHEN current_stock <= 0 THEN 1 ELSE 0 END), 0) as outOfStockCount,
            COALESCE(SUM(CASE WHEN current_stock > 0 AND current_stock <= 10 THEN 1 ELSE 0 END), 0) as lowStockCount
          FROM pos_items_master 
          ${whereSql}
        `).bind(...params),

        db.prepare(`
          SELECT 
            id, 
            barcode, 
            item_name as itemName, 
            category, 
            cost_price as costPrice,
            markup_percent as markupPercent, 
            selling_price as sellingPrice,
            current_stock as currentStock, 
            COALESCE(surplus_stock, 0) as surplusStock,
            is_active as isActive, 
            updated_at as updatedAt,
            (cost_price * CASE WHEN (current_stock - COALESCE(surplus_stock, 0)) > 0 THEN (current_stock - COALESCE(surplus_stock, 0)) ELSE 0 END) as stockValue
          FROM pos_items_master 
          ${whereSql}
          ORDER BY id DESC 
          LIMIT ? OFFSET ?
        `).bind(...params, limit, offset)
      ]);
    } catch (e) {
      [summaryRes, rowsRes] = await db.batch([
        db.prepare(`
          SELECT 
            COUNT(id) as totalRows, 
            COALESCE(SUM(current_stock), 0) as totalStockQty,
            COALESCE(SUM(cost_price * current_stock), 0) as totalStockValue,
            COALESCE(SUM(CASE WHEN current_stock <= 0 THEN 1 ELSE 0 END), 0) as outOfStockCount,
            COALESCE(SUM(CASE WHEN current_stock > 0 AND current_stock <= 10 THEN 1 ELSE 0 END), 0) as lowStockCount
          FROM pos_items_master 
          ${whereSql}
        `).bind(...params),

        db.prepare(`
          SELECT 
            id, 
            barcode, 
            item_name as itemName, 
            category, 
            cost_price as costPrice,
            markup_percent as markupPercent, 
            selling_price as sellingPrice,
            current_stock as currentStock, 
            0 as surplusStock,
            is_active as isActive, 
            updated_at as updatedAt,
            (cost_price * current_stock) as stockValue
          FROM pos_items_master 
          ${whereSql}
          ORDER BY id DESC 
          LIMIT ? OFFSET ?
        `).bind(...params, limit, offset)
      ]);
    }

    const summaryData = summaryRes.results[0] || {};
    return {
      success: true,
      data: rowsRes.results || [],
      totalRows: summaryData.totalRows || 0,
      page,
      limit,
      summary: {
        totalItems: summaryData.totalRows || 0,
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
      const newStock = Math.max(0, Number(body.currentStock) || 0);
      updates.push(`current_stock = ?`);
      params.push(newStock);
      // 💰 Guard against surplusStock becoming greater than currentStock
      updates.push(`surplus_stock = MIN(COALESCE(surplus_stock, 0), ?)`);
      params.push(newStock);
    }
    if (body.isActive !== undefined) {
      updates.push(`is_active = ?`);
      params.push(body.isActive ? 1 : 0);
    }

    if (updates.length === 0) return { success: false, message: "ပြင်ဆင်ရန် အချက်အလက် မပါဝင်ပါ။" };

    updates.push(`updated_at = datetime('now')`);
    params.push(barcode);

    await db.prepare(`UPDATE pos_items_master SET ${updates.join(', ')} WHERE barcode = ?`).bind(...params).run();
    return { success: true, message: "ပစ္စည်းအချက်အလက် ပြင်ဆင်ပြီးပါပြီ။" };
  } catch (err) {
    return { success: false, message: "ပြင်ဆင်မှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 10. POS CATALOG & PRICING (PURE BULLETPROOF - NEVER CRASHES)
// ==============================================================================
export async function getPosItems(db, body) {
  try {
    await ensureCanteenSchema(db);
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
    
    let res;
    try {
      res = await db.prepare(`
        SELECT 
          id, 
          barcode, 
          item_name as itemName, 
          category, 
          cost_price as costPrice,
          markup_percent as markupPercent, 
          selling_price as sellingPrice,
          current_stock as currentStock, 
          COALESCE(surplus_stock, 0) as surplusStock,
          is_active as isActive, 
          updated_at as updatedAt
        FROM pos_items_master 
        ${whereSql}
        ORDER BY item_name ASC 
        LIMIT 500
      `).bind(...params).all();
    } catch (colErr) {
      res = await db.prepare(`
        SELECT 
          id, 
          barcode, 
          item_name as itemName, 
          category, 
          cost_price as costPrice,
          markup_percent as markupPercent, 
          selling_price as sellingPrice,
          current_stock as currentStock, 
          0 as surplusStock,
          is_active as isActive, 
          updated_at as updatedAt
        FROM pos_items_master 
        ${whereSql}
        ORDER BY item_name ASC 
        LIMIT 500
      `).bind(...params).all();
    }

    return { success: true, data: res.results || [] };
  } catch (err) {
    return { success: false, message: "ပစ္စည်းစာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

export async function savePosItem(db, session, body) {
  try {
    const barcode = String(body.barcode || "").trim();
    const itemName = String(body.itemName || body.item_name || "").trim();
    if (!barcode || !itemName) return { success: false, message: "Barcode နှင့် ပစ္စည်းအမည် မဖြစ်မနေ ထည့်သွင်းပေးပါ။" };

    const category = String(body.category || 'Snack').trim();
    const costPrice = safeAmount(body.costPrice || body.cost_price);
    // 🎯 DEFAULT 8% MARKUP
    const markupPercent = Math.max(0, Number(body.markupPercent !== undefined ? body.markupPercent : (body.markup_percent !== undefined ? body.markup_percent : 8)));
    
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

// ==============================================================================
// 💡 11. STUDENT POCKET MONEY RADAR (PIGGYBACKED DYNAMIC CAP)
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
        WHERE (student_id = ? OR id = ? OR fyid = ? OR nfc_tag_id = ?) 
        LIMIT 1
      `).bind(stuIdNum, stuIdNum, rawInput, rawInput).first();
    } catch (e) {
      student = await db.prepare(`
        SELECT student_id as studentId, id, name, class, fyid 
        FROM student 
        WHERE (student_id = ? OR id = ? OR fyid = ?) 
        LIMIT 1
      `).bind(stuIdNum, stuIdNum, rawInput).first();
    }

    if (!student) return { success: false, message: "ကျောင်းသား ရှာမတွေ့ပါ။ ID သို့မဟုတ် QR စစ်ဆေးပါ။" };

    const realStudentId = parseInt(student.studentId || student.id, 10);
    const realFyid = student.fyid || rawInput;

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

// ------------------------------------------------------------------------------
// 🎓 12. OFFLINE POS STUDENT DIRECTORY SNAPSHOT (1-BATCH FOR INDEXED-DB)
// ------------------------------------------------------------------------------
export async function getPosStudentsSnapshot(db) {
  try {
    const todayStr = getMyanmarDateString();
    const currentFy = computeAcademicFy(todayStr).replace(/^FY\s*/i, '');

    let query = `
      SELECT 
        s.student_id as studentId, 
        s.id, 
        s.name, 
        s.class as studentClass, 
        s.fyid, 
        s.nfc_tag_id as nfcTagId,
        COALESCE(b.bal, 0) as currentBalance, 
        COALESCE(o.todaySpent, 0) as todaySpent
      FROM student s
      LEFT JOIN (
        SELECT student_id, SUM(debit - credit) as bal 
        FROM student_money 
        WHERE fy IN (?, ?) 
        GROUP BY student_id
      ) b ON (b.student_id = s.student_id OR b.student_id = s.id)
      LEFT JOIN (
        SELECT student_id, SUM(total_amount) as todaySpent 
        FROM pos_sales_orders 
        WHERE date = ? AND payment_method = 'Student Pocket Money' 
        GROUP BY student_id
      ) o ON (o.student_id = s.student_id OR o.student_id = s.id)
      ORDER BY s.student_id ASC
    `;

    let res;
    try {
      res = await db.prepare(query).bind(currentFy, `FY ${currentFy}`, todayStr).all();
    } catch (colErr) {
      query = query.replace('s.nfc_tag_id as nfcTagId,', "'' as nfcTagId,");
      res = await db.prepare(query).bind(currentFy, `FY ${currentFy}`, todayStr).all();
    }

    return { success: true, data: res.results || [] };
  } catch (err) {
    return { success: false, message: "ကျောင်းသား စာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 13. ATOMIC SINGLE BATCH POS CHECKOUT (MULTI-COUNTER SAFE)
// ==============================================================================
export async function checkoutPosSale(db, session, body) {
  try {
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || computeAcademicFy(entryDate));
    const cleanFy = fy.replace(/^FY\s*/i, '');

    try {
      const closureCheck = await db.prepare("SELECT id FROM canteen_day_closures WHERE date = ?").bind(entryDate).first();
      if (closureCheck) {
        return { success: false, message: `ရက်စွဲ (${entryDate}) အတွက် ကန်တင်းဆိုင်ပိတ်ပြီးဖြစ်သဖြင့် အရောင်းအသစ် ဖွင့်၍မရတော့ပါ။` };
      }
    } catch (e) {}

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

    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^(CAN_|STM_|POS_|OFF_)+/i, '') : generateUniqueId('').replace(/^_/, '');
    const posUniqueId = `POS_${rawCore}`;
    const canUniqueId = `CAN_${rawCore}`;
    const stmUniqueId = `STM_${rawCore}`;

    const duplicateCheck = await db.prepare("SELECT invoice_no, total_amount FROM pos_sales_orders WHERE uniqueid = ?").bind(posUniqueId).first();
    if (duplicateCheck) return { success: true, invoiceNo: duplicateCheck.invoice_no, message: "ဤပြေစာအား မှတ်တမ်းတင်ပြီးဖြစ်ပါသည်။ (Duplicate Ignored)" };

    if (isWallet) {
      if (!studentId || studentId <= 0) return { success: false, message: "မုန့်ဖိုးအကောင့်ဖြင့် ဝယ်ယူရန် ကျောင်းသား ID လိုအပ်ပါသည်။" };

      const [balRes, spentRes, capRes] = await db.batch([
        db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND (student_id = ? OR CAST(student_id AS TEXT) = ? OR (fyid IS NOT NULL AND fyid = ?))`).bind(cleanFy, `FY ${cleanFy}`, studentId, String(studentId), body.fyid || ''),
        db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as todaySpent FROM pos_sales_orders WHERE student_id = ? AND date = ? AND payment_method = 'Student Pocket Money'`).bind(studentId, entryDate),
        db.prepare(`SELECT setting_value as capVal FROM pos_settings WHERE setting_key = 'daily_spending_cap' LIMIT 1`)
      ]);

      const curStuBal = parseFloat(balRes.results[0]?.bal || 0);
      const todaySpent = parseFloat(spentRes.results[0]?.todaySpent || 0);
      const dynamicCap = parseFloat(capRes.results[0]?.capVal || 10000);

      if (totalAmount > curStuBal) return { success: false, message: `မုန့်ဖိုးလက်ကျန် မလုံလောက်ပါ! လက်ရှိတွင် (${curStuBal.toLocaleString('en-US')} MMK) သာ ကျန်ရှိပါသည်။` };
      if ((todaySpent + totalAmount) > dynamicCap) {
        const remaining = Math.max(0, dynamicCap - todaySpent);
        return { success: false, message: `တစ်ရက် မုန့်ဖိုးကန့်သတ်ချက် (${dynamicCap.toLocaleString('en-US')} MMK) ကျော်လွန်နေပါသည်! ယနေ့ (${todaySpent.toLocaleString('en-US')} MMK) သုံးပြီးဖြစ်၍ (${remaining.toLocaleString('en-US')} MMK) သာ ဝယ်ယူခွင့် ကျန်ပါတော့သည်။` };
      }
    }

    const invoiceNo = `INV-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-4).toUpperCase()}`;
    const vrCan = await generateVoucherNo(db, 'canteen_book', 'CAN', entryDate);
    const noCan = await generateFyNo(db, 'canteen_book', fy);

    const batchStatements = [
      db.prepare(`
        INSERT INTO pos_sales_orders (invoice_no, date, payment_method, student_id, total_amount, total_cost, net_profit, items_summary, canteen_vr_no, uniqueid, created_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(invoiceNo, entryDate, paymentMethod, studentId, totalAmount, totalCost, netProfit, itemsSummary, vrCan, posUniqueId, session?.name || 'Cashier'),

      db.prepare(`
        INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) 
        VALUES (?, ?, 'POS Sales', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
      `).bind(noCan, entryDate, `[${invoiceNo}] ${itemsSummary}`, paymentMethod === 'Cash' ? 'Cash' : 'Transfer', totalAmount, vrCan, my, fy, session?.name || 'Cashier', canUniqueId)
    ];

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

    // 🛡️ Multi-Counter Concurrency Safe Atomic Stock Deduction
    for (const item of stockDeductions) {
      const bCode = String(item.barcode || "").trim();
      const q = safeAmount(item.qty);
      if (bCode && q > 0) {
        batchStatements.push(
          db.prepare(`
            UPDATE pos_items_master 
            SET current_stock = current_stock - ?,
                surplus_stock = MAX(0, COALESCE(surplus_stock, 0) - ?),
                updated_at = datetime('now')
            WHERE barcode = ? AND current_stock >= ?
          `).bind(q, q, bCode, q)
        );
      }
    }

    await db.batch(batchStatements);
    await recalculateLedgerBalances(db, 'canteen_book', fy, entryDate);
    if (isWallet && studentId > 0) {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);
    }

    return { success: true, invoiceNo, canteenVrNo: vrCan, uniqueId: posUniqueId, totalAmount, netProfit };
  } catch (err) {
    return { success: false, message: "အရောင်းမှတ်တမ်းတင်မှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 🌐 14. OFFLINE BATCH IDEMPOTENT SYNC (ZERO DOUBLE-DEDUCTION PIPELINE)
// ==============================================================================
export async function syncOfflinePosOrders(db, session, body) {
  try {
    const orders = Array.isArray(body.orders) ? body.orders : [];
    if (orders.length === 0) return { success: true, syncedCount: 0, skippedCount: 0, message: "Sync ပြုလုပ်ရန် စာရင်း မရှိပါ။" };

    let syncedCount = 0, skippedCount = 0;
    const failedOrders = [], affectedLedgers = new Set();

    for (const order of orders) {
      try {
        const entryDate = getMyanmarDateString(order.date);
        const d = new Date(entryDate);
        const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
        const fy = normalizeFyStr(order.fy || computeAcademicFy(entryDate));
        const cleanFy = fy.replace(/^FY\s*/i, '');

        const rawCore = order.uniqueId ? String(order.uniqueId).trim().replace(/^(CAN_|STM_|POS_|OFF_)+/i, '') : generateUniqueId('').replace(/^_/, '');
        const posUniqueId = `POS_${rawCore}`;
        const canUniqueId = `CAN_${rawCore}`;
        const stmUniqueId = `STM_${rawCore}`;

        const dup = await db.prepare("SELECT invoice_no FROM pos_sales_orders WHERE uniqueid = ?").bind(posUniqueId).first();
        if (dup) { skippedCount++; continue; }

        const paymentMethod = String(order.paymentMethod || 'Cash').trim();
        const isWallet = (paymentMethod === 'Student Pocket Money');
        const studentId = parseInt(order.studentId, 10) || null;
        const totalAmount = safeAmount(order.totalAmount);
        const totalCost = safeAmount(order.totalCost);
        const netProfit = Math.round((totalAmount - totalCost) * 100) / 100;
        const itemsSummary = String(order.itemsSummary || "").trim() || "Offline Sales";
        const stockDeductions = Array.isArray(order.stockDeductions) ? order.stockDeductions : [];

        const invoiceNo = order.invoiceNo || `INV-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-4).toUpperCase()}`;
        const vrCan = await generateVoucherNo(db, 'canteen_book', 'CAN', entryDate);
        const noCan = await generateFyNo(db, 'canteen_book', fy);

        const batchStatements = [
          db.prepare(`
            INSERT INTO pos_sales_orders (invoice_no, date, payment_method, student_id, total_amount, total_cost, net_profit, items_summary, canteen_vr_no, uniqueid, created_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(invoiceNo, entryDate, paymentMethod, studentId, totalAmount, totalCost, netProfit, itemsSummary, vrCan, posUniqueId, session?.name || order.createdBy || 'Offline POS'),

          db.prepare(`
            INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) 
            VALUES (?, ?, 'POS Sales', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
          `).bind(noCan, entryDate, `[${invoiceNo}] ${itemsSummary}`, paymentMethod === 'Cash' ? 'Cash' : 'Transfer', totalAmount, vrCan, my, fy, session?.name || 'Offline POS', canUniqueId)
        ];

        if (isWallet && studentId > 0) {
          const noStu = await generateFyNo(db, 'student_money', cleanFy);
          const stuName = order.studentName ? `[${order.fyid || ''}] ${order.studentName}` : `[ID ${studentId}]`;
          const desc = `[Canteen POS - ${invoiceNo}]: ${itemsSummary}`.trim();
          batchStatements.push(
            db.prepare(`
              INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) 
              VALUES (?, ?, ?, ?, ?, ?, ?, 'Canteen POS', 0, ?, 0, ?, ?, ?)
            `).bind(noStu, entryDate, cleanFy, studentId, order.fyid || '', stuName, order.studentClass || '', totalAmount, desc, session?.name || 'Offline POS', stmUniqueId)
          );
          affectedLedgers.add(`student_money:${cleanFy}:${entryDate}`);
        }

        for (const item of stockDeductions) {
          const bCode = String(item.barcode || "").trim();
          const q = safeAmount(item.qty);
          if (bCode && q > 0) {
            batchStatements.push(
              db.prepare(`
                UPDATE pos_items_master 
                SET current_stock = current_stock - ?, 
                    surplus_stock = MAX(0, COALESCE(surplus_stock, 0) - ?),
                    updated_at = datetime('now') 
                WHERE barcode = ?
              `).bind(q, q, bCode)
            );
          }
        }

        await db.batch(batchStatements);
        affectedLedgers.add(`canteen_book:${fy}:${entryDate}`);
        syncedCount++;
      } catch (itemErr) {
        failedOrders.push({ uniqueId: order.uniqueId, error: itemErr.message });
      }
    }

    for (const item of affectedLedgers) {
      const [book, academicFy, date] = item.split(':');
      await recalculateLedgerBalances(db, book, academicFy, date);
    }

    return {
      success: true,
      syncedCount,
      skippedCount,
      failedCount: failedOrders.length,
      failedOrders,
      message: `Offline အရောင်းစာရင်း (${syncedCount}) စောင် အောင်မြင်စွာ D1 သို့ Sync လုပ်ပြီးပါပြီ။ (${skippedCount} ခု Duplicate ကျော်လွန်)`
    };
  } catch (err) {
    return { success: false, message: "Offline Sync လုပ်ဆောင်မှု မအောင်မြင်ပါ: " + err.message };
  }
}

// ==============================================================================
// 🔒 15. CANTEEN STORE CLOSURE & SETTLEMENT
// ==============================================================================
export async function closeCanteenDay(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const todayStr = getMyanmarDateString();
    const targetDate = String(body.date || todayStr).trim();

    const existing = await db.prepare("SELECT id, closed_at as closedAt, closed_by as closedBy FROM canteen_day_closures WHERE date = ?").bind(targetDate).first();
    if (existing) {
      return { success: false, message: `ဤရက်စွဲ (${targetDate}) အတွက် ဆိုင်ပိတ်သိမ်းပြီးဖြစ်ပါသည် (${existing.closedBy})` };
    }

    const stats = await db.prepare(`
      SELECT 
        COUNT(id) as totalOrders, 
        COALESCE(SUM(total_amount), 0) as totalSales,
        COALESCE(SUM(CASE WHEN payment_method = 'Student Pocket Money' THEN total_amount ELSE 0 END), 0) as walletSales,
        COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END), 0) as cashSales
      FROM pos_sales_orders 
      WHERE date = ?
    `).bind(targetDate).first();

    const totalOrders = stats?.totalOrders || 0;
    const totalSales = parseFloat(stats?.totalSales || 0);
    const walletSales = parseFloat(stats?.walletSales || 0);
    const cashSales = parseFloat(stats?.cashSales || 0);
    const closedBy = session?.name || 'Canteen Manager';
    const remark = String(body.remark || '').trim();

    await db.prepare(`
      INSERT INTO canteen_day_closures (date, closed_at, closed_by, total_sales, cash_sales, wallet_sales, total_orders, status, remark)
      VALUES (?, datetime('now'), ?, ?, ?, ?, ?, 'CLOSED', ?)
    `).bind(targetDate, closedBy, totalSales, cashSales, walletSales, totalOrders, remark).run();

    return {
      success: true,
      data: { date: targetDate, totalSales, cashSales, walletSales, totalOrders, closedBy },
      message: `ရက်စွဲ (${targetDate}) အတွက် ကန်တင်းဆိုင်ပိတ်သိမ်းမှု အောင်မြင်ပါသည်။ Finance သို့ ငွေစာရင်းလွှဲပြောင်းနိုင်ပါပြီ။`
    };
  } catch (err) {
    return { success: false, message: "ဆိုင်ပိတ်သိမ်းမှု မအောင်မြင်ပါ: " + err.message };
  }
}

export async function getCanteenClosureStatus(db, body) {
  try {
    const todayStr = getMyanmarDateString();
    const targetDate = String(body.date || todayStr).trim();
    let row = null;
    try {
      row = await db.prepare(`SELECT date, closed_at as closedAt, closed_by as closedBy, total_sales as totalSales, cash_sales as cashSales, wallet_sales as walletSales, total_orders as totalOrders, status, remark FROM canteen_day_closures WHERE date = ? LIMIT 1`).bind(targetDate).first();
    } catch (e) {}

    return { success: true, isClosed: Boolean(row), data: row || null };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

export async function getCanteenDailySummary(db, body) {
  try {
    const targetDate = String(body.date || getMyanmarDateString()).trim();

    let stats = { totalOrders: 0, totalSales: 0, pocketMoneyShare: 0, cashSalesShare: 0, totalProfit: 0 };
    try {
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
      if (summaryRes) stats = summaryRes;
    } catch (e) {}

    let settleRow = null;
    try {
      settleRow = await db.prepare(`SELECT settlement_no as settlementNo, net_payout_amount as netPayoutAmount, created_at as createdAt, handed_over_by as handedOverBy, received_by as receivedBy FROM canteen_settlements WHERE date = ? LIMIT 1`).bind(targetDate).first();
    } catch (e) {}

    let closureRow = null;
    try {
      closureRow = await db.prepare(`SELECT date, closed_at as closedAt, closed_by as closedBy, total_sales as totalSales, status FROM canteen_day_closures WHERE date = ? LIMIT 1`).bind(targetDate).first();
    } catch (e) {}

    return {
      success: true,
      data: {
        date: targetDate,
        totalOrders: stats.totalOrders || 0,
        totalSales: parseFloat(stats.totalSales || 0),
        pocketMoneyShare: parseFloat(stats.pocketMoneyShare || 0),
        cashSalesShare: parseFloat(stats.cashSalesShare || 0),
        totalProfit: parseFloat(stats.totalProfit || 0),
        isSettled: Boolean(settleRow),
        settlement: settleRow || null,
        isClosed: Boolean(closureRow),
        closure: closureRow || null
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

    try {
      const closureCheck = await db.prepare("SELECT id FROM canteen_day_closures WHERE date = ?").bind(entryDate).first();
      if (!closureCheck) {
        return { 
          success: false, 
          message: `ငွေရှင်းလင်း၍ မရသေးပါ! ရက်စွဲ (${entryDate}) အတွက် ကန်တင်းတာဝန်ခံမှ နေ့စဉ်ဆိုင်ပိတ်သိမ်းမှု (Close Register) အရင်လုပ်ဆောင်ရပါမည်။` 
        };
      }
    } catch (e) {}

    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^SETTLE_/i, '') : generateUniqueId('').replace(/^_/, '');
    const settleUniqueId = `SETTLE_${rawCore}`;
    const canSettleUniqueId = `CAN_SETTLE_${rawCore}`;
    const settlementNo = `SETTLE-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-3).toUpperCase()}`;

    const dupCheck = await db.prepare("SELECT settlement_no FROM canteen_settlements WHERE uniqueid = ? OR date = ?").bind(settleUniqueId, entryDate).first();
    if (dupCheck) return { success: false, message: `ဤရက်စွဲ (${entryDate}) အတွက် ငွေရှင်းလင်းမှု ပြုလုပ်ပြီးဖြစ်ပါသည်။ (${dupCheck.settlement_no})` };

    const d = new Date(entryDate);
    const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(computeAcademicFy(entryDate));
    const noCan = await generateFyNo(db, 'canteen_book', fy);

    await db.batch([
      db.prepare(`
        INSERT INTO canteen_settlements (settlement_no, date, settlement_type, total_sales_amount, pocket_money_share, cash_sales_share, net_payout_amount, handed_over_by, received_by, remark, uniqueid)
        VALUES (?, ?, 'Evening Cash Out', ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        settlementNo, entryDate, totalSales, pocketMoneyShare, cashSalesShare, netPayout,
        body.handedOverBy || session?.name || 'Finance Admin',
        body.receivedBy || 'Canteen Manager',
        body.remark || 'ညနေပိုင်း Canteen အရောင်းငွေ ရှင်းလင်းမှု ပြီးမြောက်ခြင်း',
        settleUniqueId
      ),

      db.prepare(`
        INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid)
        VALUES (?, ?, 'Settlement Payout', ?, 'Cash', 0, ?, 0, ?, ?, ?, ?, ?)
      `).bind(
        noCan, entryDate, `[${settlementNo}] Finance မှ Pocket Money အရောင်းငွေ ထုတ်ပေးရှင်းလင်းခြင်း`,
        netPayout, settlementNo, my, fy, session?.name || 'Finance Admin', canSettleUniqueId
      )
    ]);

    await recalculateLedgerBalances(db, 'canteen_book', fy, entryDate);
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

    if (dateFrom) { whereClauses.push(`date >= ?`); params.push(dateFrom); }
    if (dateTo) { whereClauses.push(`date <= ?`); params.push(dateTo); }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `
      SELECT 
        id, 
        settlement_no as settlementNo, 
        date, 
        settlement_type as settlementType,
        total_sales_amount as totalSalesAmount, 
        pocket_money_share as pocketMoneyShare,
        cash_sales_share as cashSalesShare, 
        net_payout_amount as netPayoutAmount,
        handed_over_by as handedOverBy, 
        received_by as receivedBy, 
        remark, 
        uniqueid, 
        created_at as createdAt
      FROM canteen_settlements 
      ${whereSql}
      ORDER BY date DESC, id DESC 
      LIMIT ?
    `;
    params.push(limit);

    const res = await db.prepare(query).bind(...params).all();
    return { success: true, data: res.results || [] };
  } catch (err) {
    return { success: false, message: "Settlement စာရင်း ဆွဲယူ၍ မရပါ: " + err.message };
  }
}

// ==============================================================================
// 💡 16. SUPPLIERS MASTER (FULL PROFILE: PH NO & ADDRESS)
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

// ==============================================================================
// ⚙️ 17. DYNAMIC POS SETTINGS (ALLOWANCE CAP)
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