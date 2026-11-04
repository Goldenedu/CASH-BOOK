/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CANTEEN POS HANDLERS (CLOUDFLARE D1 ENTERPRISE V10.0)
 * File: handlers-canteen-pos.js (Location: cashbook-api/handlers-canteen-pos.js)
 * 
 * 💡 Features & Architectural Blueprint V10.0:
 *   1. 🕒 STRICT MMT TIMEZONE: Universal UTC+06:30 Myanmar Standard Time calculation
 *   2. 💰 POS CASH BOOK LEDGER:
 *      - Admin/Finance/Owner: Jan-Dec Yearly KPIs (Bank, Cash, Total, Entries) & Full History
 *      - Other Roles (Cashier/Counter): Strictly Daily KPIs & Daily Transactions Only
 *      - Surplus/Deficit accepts (+/-), Debit & Credit accept positive numbers only (>= 0)
 *   3. 🛒 MULTI-ITEM PURCHASE VOUCHER ENGINE:
 *      - 17-Column Purchase Ledger with Retail & Wholesale Smart Pricing (50-Step Rounding)
 *      - Auto-generates ERP Voucher No (PUR-DDMMYY-001)
 *      - Auto-posts Actual Voucher Amount as Credit into POS Cash Book
 *      - Auto-records (Items Total - Voucher Amount) into Surplus/Deficit
 *   4. 📊 PURCHASES 4-KPIS: Today Purchase, Monthly Purchase, Total Purchase, Stocks Balance
 *   5. 🛡️ SELF-HEALING SCHEMA: Auto-migrates new tables and columns on cold start
 * ==============================================================================
 */

import {
  normalizeFyStr,
  sanitizeFyidStr,
  generateUniqueId,
  generateVoucherNo,
  generateFyNo,
  recalculateLedgerBalances,
  getCurrentAcademicYear,
  verifyRecordMutationPolicy
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
  const mmt = new Date(targetMs + (6.5 * 60 * 60 * 1000));
  return mmt.toISOString().slice(0, 10);
}

function computeAcademicFy(dateStr) {
  const cleanDate = dateStr || getMyanmarDateString();
  const d = new Date(cleanDate);
  if (isNaN(d.getTime())) return getCurrentAcademicYear();
  let year = d.getFullYear();
  if (d.getMonth() < 2) year -= 1;
  return `${year}-${year + 1}`;
}

// 🛡️ Strictly Positive Amount Sanitizer (For Debit, Credit, Price, Qty)
function safeAmount(val) {
  const num = Number(val);
  return (Number.isFinite(num) && num > 0) ? Math.round(num * 100) / 100 : 0;
}

// 🛡️ Signed Amount Sanitizer (For Surplus/Deficit: Accepts both + and -)
function safeSignedAmount(val) {
  const num = Number(val);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

// 🛡️ Role Privilege Checker (Admin / Owner / Finance vs Daily Operational Roles)
function isFullAccessRole(session) {
  const rawRole = String(session?.role || 'Cashier').trim().toLowerCase().replace(/[\s_-]/g, '');
  return rawRole.includes('admin') || rawRole.includes('owner') || rawRole.includes('finance');
}

// ------------------------------------------------------------------------------
// 🛡️ 2. SELF-HEALING SCHEMA GUARDIAN (AUTO-MIGRATION FALLBACK)
// ------------------------------------------------------------------------------
let _schemaInitialized = false;
async function ensureCanteenSchema(db) {
  if (_schemaInitialized || !db || typeof db.prepare !== 'function') return;

  // 2.1 POS Cash Book Table
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS pos_cash_book (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        no INTEGER DEFAULT 1,
        date TEXT NOT NULL,
        category TEXT DEFAULT 'POS Sales',
        description TEXT,
        method TEXT DEFAULT 'Cash',
        debit REAL DEFAULT 0,
        credit REAL DEFAULT 0,
        balances REAL DEFAULT 0,
        ref TEXT DEFAULT '',
        surplus_deficit REAL DEFAULT 0,
        vr_no TEXT,
        my TEXT,
        fy TEXT DEFAULT 'FY 2026-2027',
        created_by TEXT DEFAULT 'Cashier',
        created_at TEXT DEFAULT (datetime('now')),
        uniqueid TEXT UNIQUE
      )
    `).run();
  } catch (e) { }

  // 2.2 New Columns Migration for Items, Suppliers & Purchases
  const alterStatements = [
    "ALTER TABLE pos_items_master ADD COLUMN surplus_stock REAL NOT NULL DEFAULT 0",
    "ALTER TABLE pos_items_master ADD COLUMN wholesale_markup REAL NOT NULL DEFAULT 5",
    "ALTER TABLE pos_items_master ADD COLUMN wholesale_price REAL NOT NULL DEFAULT 0",
    "ALTER TABLE pos_suppliers ADD COLUMN shop_name TEXT DEFAULT ''",
    "ALTER TABLE pos_purchases ADD COLUMN no INTEGER DEFAULT 1",
    "ALTER TABLE pos_purchases ADD COLUMN voucher_no TEXT DEFAULT ''",
    "ALTER TABLE pos_purchases ADD COLUMN category TEXT DEFAULT 'Snack'",
    "ALTER TABLE pos_purchases ADD COLUMN item_name TEXT DEFAULT ''",
    "ALTER TABLE pos_purchases ADD COLUMN method TEXT DEFAULT 'Cash'",
    "ALTER TABLE pos_purchases ADD COLUMN wholesale_markup REAL DEFAULT 5",
    "ALTER TABLE pos_purchases ADD COLUMN wholesale_price REAL DEFAULT 0",
    "ALTER TABLE pos_purchases ADD COLUMN supplier_name TEXT DEFAULT ''",
    "ALTER TABLE pos_purchases ADD COLUMN shop_name TEXT DEFAULT ''",
    "ALTER TABLE pos_purchases ADD COLUMN phone_no TEXT DEFAULT ''",
    "ALTER TABLE pos_purchases ADD COLUMN address TEXT DEFAULT ''",
    "ALTER TABLE pos_purchases ADD COLUMN ref TEXT DEFAULT ''",
    "ALTER TABLE pos_purchases ADD COLUMN voucher_amount REAL DEFAULT 0",
    "ALTER TABLE pos_purchases ADD COLUMN surplus_deficit REAL DEFAULT 0",
    "ALTER TABLE pos_purchases ADD COLUMN uniqueid TEXT",
    "ALTER TABLE pos_waste_records ADD COLUMN items_json TEXT"
  ];

  for (const sql of alterStatements) {
    try { await db.prepare(sql).run(); } catch (e) { }
  }

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
  } catch (e) { }

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
  } catch (e) { }

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
      VALUES ('daily_spending_cap', '10000', 'Daily Student Spending Cap (MMK)')
      ON CONFLICT(setting_key) DO NOTHING
    `).run();
  } catch (e) { }

  _schemaInitialized = true;
}

// ==============================================================================
// 💡 3. SMART PRICING ROUNDING ENGINE (50-STEP ROUNDING)
// ==============================================================================
export function calculateSmartPrice(costPrice, markupPercent = 8, roundTo = 50) {
  const cost = safeAmount(costPrice);
  const markup = Math.max(0, Number(markupPercent !== undefined ? markupPercent : 8));
  const rawPrice = cost * (1 + markup / 100);
  if (rawPrice <= 0) return 0;

  const step = (roundTo === 100) ? 100 : 50;
  return Math.ceil(rawPrice / step) * step;
}

export async function recalculateCanteenBookBalances(db, fy, fromDate) {
  return recalculateLedgerBalances(db, 'canteen_book', fy, fromDate);
}

// ==============================================================================
// 💰 3.5 POS CASH BOOK LEDGER (ROLE-SCOPED KPIS & TRANSACTIONS)
// ==============================================================================
export async function getPosCashBookData(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const todayStr = getMyanmarDateString();
    const isAdmin = isFullAccessRole(session);

    const page = Math.max(1, parseInt(body.page || 1, 10));
    const limit = Math.min(100, Math.max(1, parseInt(body.limit || 20, 10)));
    const offset = (page - 1) * limit;

    const searchVal = String(body.searchVal || "").trim();
    let dateFrom = String(body.dateFrom || "").trim();
    let dateTo = String(body.dateTo || "").trim();

    // Calendar Year Scope for Admin (Jan 1 to Dec 31 - Resets every new year)
    const activeYear = (dateFrom && /^\d{4}/.test(dateFrom)) ? dateFrom.slice(0, 4) : todayStr.slice(0, 4);
    const yearStart = `${activeYear}-01-01`;
    const yearEnd = `${activeYear}-12-31`;

    let whereClauses = [];
    let params = [];

    if (isAdmin) {
      if (dateFrom) { whereClauses.push(`date >= ?`); params.push(dateFrom); }
      else { whereClauses.push(`date >= ?`); params.push(yearStart); }

      if (dateTo) { whereClauses.push(`date <= ?`); params.push(dateTo); }
      else { whereClauses.push(`date <= ?`); params.push(yearEnd); }
    } else {
      // Non-admin roles strictly view ONLY Today's Daily Transactions
      whereClauses.push(`date = ?`);
      params.push(todayStr);
    }

    if (searchVal) {
      whereClauses.push(`(description LIKE ? OR category LIKE ? OR ref LIKE ? OR vr_no LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // KPI Scope: Admin sees Jan-Dec Yearly KPIs; Others see strictly Today's Daily KPIs
    const kpiWhereSql = isAdmin ? `WHERE date >= ? AND date <= ?` : `WHERE date = ?`;
    const kpiParams = isAdmin ? [yearStart, yearEnd] : [todayStr];

    const [kpiRes, countRes, rowsRes] = await db.batch([
      db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN method = 'Bank' THEN (debit - credit) ELSE 0 END), 0) as bankBalance,
          COALESCE(SUM(CASE WHEN method = 'Cash' THEN (debit - credit) ELSE 0 END), 0) as cashBalance,
          COALESCE(SUM(debit - credit), 0) as totalBalance,
          COUNT(id) as totalEntries
        FROM pos_cash_book
        ${kpiWhereSql}
      `).bind(...kpiParams),

      db.prepare(`SELECT COUNT(id) as totalRows FROM pos_cash_book ${whereSql}`).bind(...params),

      db.prepare(`
        SELECT
          id,
          no,
          date,
          category,
          description,
          method,
          debit,
          credit,
          balances,
          ref,
          COALESCE(surplus_deficit, 0) as surplusDeficit,
          vr_no as vrNo,
          my,
          fy,
          created_by as createdBy,
          uniqueid as uniqueId
        FROM pos_cash_book
        ${whereSql}
        ORDER BY CAST(no AS INTEGER) DESC, id DESC
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

    const kpi = kpiRes?.results?.[0] || {};
    const totalRows = countRes?.results?.[0]?.totalRows || 0;

    return {
      success: true,
      year: activeYear,
      scope: isAdmin ? 'YEARLY' : 'DAILY',
      data: rowsRes?.results || [],
      totalRows,
      page,
      limit,
      stats: {
        bankBalance: parseFloat(kpi.bankBalance || 0),
        cashBalance: parseFloat(kpi.cashBalance || 0),
        totalBalance: parseFloat(kpi.totalBalance || 0),
        totalEntries: parseInt(kpi.totalEntries || 0, 10)
      }
    };
  } catch (err) {
    return { success: false, message: "Failed to load POS Cash Book: " + err.message };
  }
}

export async function savePosCashBookEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || computeAcademicFy(entryDate));

    // Strict Validation: Debit & Credit only accept positive values (>= 0)
    if (Number(body.debit) < 0 || Number(body.credit) < 0) {
      return { success: false, message: "Debit and Credit cannot be negative numbers." };
    }

    const debit = safeAmount(body.debit);
    const credit = safeAmount(body.credit);
    // Surplus/Deficit accepts both + and -
    const surplusDeficit = safeSignedAmount(body.surplusDeficit !== undefined ? body.surplusDeficit : body.surplus_deficit);

    if (debit <= 0 && credit <= 0 && surplusDeficit === 0) {
      return { success: false, message: "Please enter a valid Debit, Credit, or Surplus/Deficit amount." };
    }

    const category = String(body.category || 'POS Sales').trim();
    const description = String(body.description || '').trim();
    const method = (String(body.method || 'Cash').trim() === 'Bank') ? 'Bank' : 'Cash';
    const ref = String(body.ref || '').trim();

    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^PCB_/i, '') : generateUniqueId('').replace(/^_/, '');
    const pcbUniqueId = `PCB_${rawCore}`;

    const existing = await db.prepare("SELECT id, vr_no FROM pos_cash_book WHERE uniqueid = ?").bind(pcbUniqueId).first();
    if (existing && !body.isUpdate) {
      return { success: true, uniqueId: pcbUniqueId, vrNo: existing.vr_no, message: "Entry already recorded." };
    }

    const noPcb = await generateFyNo(db, 'pos_cash_book', fy);
    const vrPcb = body.vrNo || await generateVoucherNo(db, 'pos_cash_book', 'PCB', entryDate);

    await db.prepare(`
      INSERT INTO pos_cash_book (no, date, category, description, method, debit, credit, balances, ref, surplus_deficit, vr_no, my, fy, created_by, uniqueid)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      noPcb, entryDate, category, description, method,
      debit, credit, ref || vrPcb, surplusDeficit,
      vrPcb, my, fy, session?.name || 'Cashier', pcbUniqueId
    ).run();

    await recalculateLedgerBalances(db, 'pos_cash_book', fy, entryDate);

    return {
      success: true,
      uniqueId: pcbUniqueId,
      vrNo: vrPcb,
      message: "POS Cash Book entry saved successfully."
    };
  } catch (err) {
    return { success: false, message: "Failed to save POS Cash Book entry: " + err.message };
  }
}

export async function deletePosCashBookEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const uid = String(body.uniqueId || "").trim();
    if (!uid) return { success: false, message: "Unique ID is required." };

    const existing = await db.prepare("SELECT id, fy, date FROM pos_cash_book WHERE uniqueid = ?").bind(uid).first();
    if (!existing) return { success: false, message: "Entry not found." };

    const policy = verifyRecordMutationPolicy(session, existing.date);
    if (!policy.allowed) return { success: false, message: policy.message };

    await db.prepare("DELETE FROM pos_cash_book WHERE id = ?").bind(existing.id).run();
    await recalculateLedgerBalances(db, 'pos_cash_book', existing.fy, existing.date);

    return { success: true, message: "POS Cash Book entry deleted successfully." };
  } catch (err) {
    return { success: false, message: "Failed to delete POS Cash Book entry: " + err.message };
  }
}

// ==============================================================================
// 💡 4. CANTEEN EXECUTIVE DASHBOARD METRICS
// ==============================================================================
export async function getCanteenDashboardMetrics(db, body) {
  try {
    await ensureCanteenSchema(db);
    const todayStr = getMyanmarDateString();
    const date = String(body.date || todayStr).trim();

    const monthPrefix = date.slice(0, 7);
    const monthStart = `${monthPrefix}-01`;
    const [y, m] = monthPrefix.split('-').map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const monthEnd = `${monthPrefix}-${String(lastDay).padStart(2, '0')}`;

    const batchQueries = [
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

      db.prepare(`
        SELECT 
          COUNT(id) as allTimeOrders,
          COALESCE(SUM(total_amount), 0) as allTimeSales,
          COALESCE(SUM(CASE WHEN payment_method = 'Student Pocket Money' THEN total_amount ELSE 0 END), 0) as allTimePocketShare,
          COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END), 0) as allTimeCashShare,
          COALESCE(SUM(net_profit), 0) as allTimeProfit
        FROM pos_sales_orders
      `),

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

      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN date = ? THEN total_loss_cost ELSE 0 END), 0) as todayLossCost,
          COALESCE(SUM(CASE WHEN date >= ? AND date <= ? THEN total_loss_cost ELSE 0 END), 0) as monthLossCost,
          COALESCE(SUM(total_loss_cost), 0) as allTimeLossCost
        FROM pos_waste_records
      `).bind(date, monthStart, monthEnd),

      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN date = ? THEN total_surplus_value ELSE 0 END), 0) as todaySurplusValue,
          COALESCE(SUM(CASE WHEN date >= ? AND date <= ? THEN total_surplus_value ELSE 0 END), 0) as monthSurplusValue,
          COALESCE(SUM(total_surplus_value), 0) as allTimeSurplusValue
        FROM pos_surplus_records
      `).bind(date, monthStart, monthEnd),

      db.prepare(`
        SELECT date, closed_at as closedAt, closed_by as closedBy, status 
        FROM canteen_day_closures WHERE date = ? LIMIT 1
      `).bind(date),

      db.prepare(`
        SELECT 
          COUNT(id) as monthOrders,
          COALESCE(SUM(total_amount), 0) as monthSales,
          COALESCE(SUM(CASE WHEN payment_method = 'Student Pocket Money' THEN total_amount ELSE 0 END), 0) as monthPocketShare,
          COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END), 0) as monthCashShare,
          COALESCE(SUM(net_profit), 0) as monthProfit
        FROM pos_sales_orders 
        WHERE date >= ? AND date <= ?
      `).bind(monthStart, monthEnd),

      db.prepare(`
        SELECT 
          p.date,
          COUNT(p.id) as totalOrders,
          COALESCE(SUM(p.total_amount), 0) as totalSales
        FROM pos_sales_orders p
        LEFT JOIN canteen_day_closures c ON p.date = c.date
        WHERE c.id IS NULL AND p.date < ?
        GROUP BY p.date
        ORDER BY p.date DESC
        LIMIT 3
      `).bind(todayStr)
    ];

    const [todayRes, settleRes, allTimeRes, stockRes, wasteRes, surplusRes, closureRes, monthRes, unclosedRes] = await db.batch(batchQueries);

    const todayStats = todayRes?.results?.[0] || {};
    const settle = settleRes?.results?.[0] || null;
    const allTimeStats = allTimeRes?.results?.[0] || {};
    const stockStats = stockRes?.results?.[0] || {};
    const wasteStats = wasteRes?.results?.[0] || {};
    const surplusStats = surplusRes?.results?.[0] || {};
    const closure = closureRes?.results?.[0] || null;
    const monthStats = monthRes?.results?.[0] || {};
    const unclosedPastDays = unclosedRes?.results || [];

    const lowStockCount = Number(stockStats.lowStockCount || 0);
    const totalStockCapital = parseFloat(stockStats.totalStockCapital || 0);

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
        unclosedPastDays,
        hasUnclosedPastDays: unclosedPastDays.length > 0,
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
    return { success: false, message: "Failed to load dashboard metrics: " + err.message };
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

    if (reason) { whereClauses.push(`reason = ?`); params.push(reason); }
    if (dateFrom) { whereClauses.push(`date >= ?`); params.push(dateFrom); }
    if (dateTo) { whereClauses.push(`date <= ?`); params.push(dateTo); }
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
          id, surplus_no as surplusNo, date, reason, 
          total_surplus_value as totalSurplusValue, total_items_qty as totalItemsQty, 
          items_summary as itemsSummary, items_json as itemsJson, 
          remark, reported_by as reportedBy, uniqueid as uniqueId, created_at as createdAt 
        FROM pos_surplus_records 
        ${whereSql} 
        ORDER BY id DESC LIMIT ? OFFSET ?
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
    return { success: false, message: "Failed to load surplus history: " + err.message };
  }
}

export async function savePosSurplusEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const entryDate = getMyanmarDateString(body.date);
    const reason = String(body.reason || 'Count Surplus').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const remark = String(body.remark || '').trim();

    if (items.length === 0) {
      return { success: false, message: "Please select at least 1 item for surplus entry." };
    }

    let totalSurplusValue = 0;
    let totalItemsQty = 0;
    const summaryParts = [];
    const stockAdditions = [];

    for (const it of items) {
      const bCode = String(it.barcode || '').trim();
      const name = String(it.name || it.itemName || 'Item').trim();
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
      return { success: false, message: "Invalid item quantity." };
    }

    const itemsSummary = summaryParts.join(', ');
    const itemsJson = JSON.stringify(stockAdditions);
    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^SUR_/i, '') : generateUniqueId('').replace(/^_/, '');
    const surplusUniqueId = `SUR_${rawCore}`;
    const surplusNo = `SUR-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-3).toUpperCase()}`;

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
      message: "Stock surplus recorded and inventory updated."
    };
  } catch (err) {
    return { success: false, message: "Failed to save surplus entry: " + err.message };
  }
}

export async function deletePosSurplusEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const id = parseInt(body.id, 10);
    const surplusNo = String(body.surplusNo || "").trim();
    if (!id && !surplusNo) return { success: false, message: "Surplus ID or Number is required." };

    const existing = await db.prepare("SELECT id, surplus_no, date, items_json FROM pos_surplus_records WHERE id = ? OR surplus_no = ?").bind(id || 0, surplusNo || "").first();
    if (!existing) return { success: false, message: "Surplus record not found." };

    const policy = verifyRecordMutationPolicy(session, existing.date);
    if (!policy.allowed) return { success: false, message: policy.message };

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
      } catch (jsonErr) { }
    }

    await db.batch(batchStatements);
    return { success: true, message: `Surplus record (${existing.surplus_no}) deleted and stock rolled back.` };
  } catch (err) {
    return { success: false, message: "Failed to delete surplus record: " + err.message };
  }
}

// ==============================================================================
// ⚠️ 6. WASTAGE & LOSS LEDGER
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

    if (reason) { whereClauses.push(`reason = ?`); params.push(reason); }
    if (dateFrom) { whereClauses.push(`date >= ?`); params.push(dateFrom); }
    if (dateTo) { whereClauses.push(`date <= ?`); params.push(dateTo); }
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
          id, waste_no as wasteNo, date, reason, 
          total_loss_cost as totalLossCost, total_items_qty as totalItemsQty, 
          items_summary as itemsSummary, items_json as itemsJson, 
          remark, reported_by as reportedBy, uniqueid as uniqueId, created_at as createdAt 
        FROM pos_waste_records 
        ${whereSql} 
        ORDER BY id DESC LIMIT ? OFFSET ?
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
    return { success: false, message: "Failed to load wastage history: " + err.message };
  }
}

export async function savePosWasteEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const entryDate = getMyanmarDateString(body.date);
    const reason = String(body.reason || 'Damaged').trim();
    const items = Array.isArray(body.items) ? body.items : [];
    const remark = String(body.remark || '').trim();

    if (items.length === 0) {
      return { success: false, message: "Please select at least 1 item for wastage entry." };
    }

    let totalLossCost = 0;
    let totalItemsQty = 0;
    const summaryParts = [];
    const stockDeductions = [];

    for (const it of items) {
      const bCode = String(it.barcode || '').trim();
      const name = String(it.name || it.itemName || 'Item').trim();
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
      return { success: false, message: "Invalid item quantity." };
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
      message: "Wastage & loss entry recorded successfully."
    };
  } catch (err) {
    return { success: false, message: "Failed to save wastage entry: " + err.message };
  }
}

export async function deletePosWasteEntry(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const id = parseInt(body.id, 10);
    const wasteNo = String(body.wasteNo || "").trim();
    if (!id && !wasteNo) return { success: false, message: "Wastage ID or Number is required." };

    const existing = await db.prepare("SELECT id, waste_no, date, items_json FROM pos_waste_records WHERE id = ? OR waste_no = ?").bind(id || 0, wasteNo || "").first();
    if (!existing) return { success: false, message: "Wastage record not found." };

    const policy = verifyRecordMutationPolicy(session, existing.date);
    if (!policy.allowed) return { success: false, message: policy.message };

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
      } catch (jsonErr) { }
    }

    await db.batch(batchStatements);
    return { success: true, message: `Wastage record (${existing.waste_no}) deleted and stock restored.` };
  } catch (err) {
    return { success: false, message: "Failed to delete wastage record: " + err.message };
  }
}

// ==============================================================================
// 🛒 7. PURCHASES & VOUCHER LEDGER (17 COLUMNS + 4 ERP KPIS + MULTI-ITEM SAVE)
// ==============================================================================
export async function getPosPurchasesHistory(db, body) {
  try {
    await ensureCanteenSchema(db);
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

    if (supplierId > 0) { whereClauses.push(`p.supplier_id = ?`); params.push(supplierId); }
    if (dateFrom) { whereClauses.push(`p.date >= ?`); params.push(dateFrom); }
    if (dateTo) { whereClauses.push(`p.date <= ?`); params.push(dateTo); }
    if (searchVal) {
      whereClauses.push(`(p.item_barcode LIKE ? OR COALESCE(NULLIF(p.item_name, ''), m.item_name) LIKE ? OR p.purchase_no LIKE ? OR p.voucher_no LIKE ? OR COALESCE(NULLIF(p.supplier_name, ''), s.supplier_name) LIKE ? OR p.shop_name LIKE ? OR p.ref LIKE ?)`);
      const q = `%${searchVal}%`;
      params.push(q, q, q, q, q, q, q);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRes, rowsRes, kpiRes, stockBalRes] = await db.batch([
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
          p.no,
          p.purchase_no as purchaseNo,
          COALESCE(NULLIF(p.voucher_no, ''), p.purchase_no) as voucherNo,
          p.date,
          p.item_barcode as barcode,
          COALESCE(NULLIF(p.category, ''), m.category, 'Snack') as category,
          COALESCE(NULLIF(p.item_name, ''), m.item_name, 'Unknown Item') as itemName,
          COALESCE(NULLIF(p.method, ''), 'Cash') as method,
          p.qty,
          p.cost_price as costPrice,
          p.total_cost as totalCost,
          p.markup_percent as markupPercent,
          p.selling_price as sellingPrice,
          COALESCE(p.wholesale_markup, m.wholesale_markup, 5) as wholesaleMarkup,
          COALESCE(p.wholesale_price, m.wholesale_price, p.selling_price, 0) as wholesalePrice,
          p.supplier_id as supplierId,
          COALESCE(NULLIF(p.supplier_name, ''), s.contact_person, s.supplier_name, '-') as supplierName,
          COALESCE(NULLIF(p.shop_name, ''), s.shop_name, s.supplier_name, '-') as shopName,
          COALESCE(NULLIF(p.phone_no, ''), s.phone_no, '-') as supplierPhone,
          COALESCE(NULLIF(p.address, ''), s.address, '-') as supplierAddress,
          COALESCE(p.ref, '') as ref,
          COALESCE(p.remark, '') as remark,
          COALESCE(p.voucher_amount, p.total_cost) as voucherAmount,
          COALESCE(p.surplus_deficit, 0) as surplusDeficit,
          p.created_by as createdBy,
          p.created_at as createdAt
        FROM pos_purchases p 
        LEFT JOIN pos_items_master m ON p.item_barcode = m.barcode 
        LEFT JOIN pos_suppliers s ON p.supplier_id = s.id 
        ${whereSql} 
        ORDER BY p.id DESC 
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset),

      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN date = ? THEN total_cost ELSE 0 END), 0) as todayPurchasesTotal,
          COALESCE(SUM(CASE WHEN date >= ? AND date <= ? THEN total_cost ELSE 0 END), 0) as thisMonthPurchasesTotal,
          COALESCE(SUM(total_cost), 0) as allTimePurchasesTotal,
          COUNT(CASE WHEN date = ? THEN 1 END) as todayPurchasesCount,
          COUNT(CASE WHEN date >= ? AND date <= ? THEN 1 END) as thisMonthPurchasesCount,
          COUNT(id) as allTimePurchasesCount
        FROM pos_purchases
      `).bind(todayStr, monthStart, monthEnd, todayStr, monthStart, monthEnd),

      db.prepare(`
        SELECT COALESCE(SUM(
          CASE 
            WHEN (current_stock - COALESCE(surplus_stock, 0)) > 0 
            THEN (cost_price * (current_stock - COALESCE(surplus_stock, 0))) 
            ELSE 0 
          END
        ), 0) as stocksBalanceTotal
        FROM pos_items_master
        WHERE is_active = 1
      `)
    ]);

    const totalRows = countRes.results[0]?.totalRows || 0;
    const totalPurchasesAmount = parseFloat(countRes.results[0]?.totalPurchasesAmount || 0);
    const kpiStats = kpiRes?.results?.[0] || {};
    const stocksBalanceTotal = parseFloat(stockBalRes?.results?.[0]?.stocksBalanceTotal || 0);

    return {
      success: true,
      data: rowsRes.results || [],
      totalRows,
      totalPurchasesAmount,
      todayPurchasesTotal: parseFloat(kpiStats.todayPurchasesTotal || 0),
      thisMonthPurchasesTotal: parseFloat(kpiStats.thisMonthPurchasesTotal || 0),
      allTimePurchasesTotal: parseFloat(kpiStats.allTimePurchasesTotal || 0),
      stocksBalanceTotal,
      todayPurchasesCount: Number(kpiStats.todayPurchasesCount || 0),
      thisMonthPurchasesCount: Number(kpiStats.thisMonthPurchasesCount || 0),
      allTimePurchasesCount: Number(kpiStats.allTimePurchasesCount || 0),
      page,
      limit
    };
  } catch (err) {
    return { success: false, message: "Failed to load purchases history: " + err.message };
  }
}

export async function savePosPurchase(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || computeAcademicFy(entryDate));

    const method = (String(body.method || 'Cash').trim() === 'Bank') ? 'Bank' : 'Cash';
    const supplierId = body.supplierId ? parseInt(body.supplierId, 10) : null;
    const supplierName = String(body.supplierName || '').trim();
    const shopName = String(body.shopName || supplierName || '').trim();
    const phoneNo = String(body.phoneNo || '').trim();
    const address = String(body.address || '').trim();
    const ref = String(body.ref || '').trim();
    const remark = String(body.remark || '').trim();

    // Support both Multi-Item Array (`body.items`) and Legacy Single-Item Payload
    let rawItems = Array.isArray(body.items) && body.items.length > 0
      ? body.items
      : [{
        barcode: body.barcode || body.item_barcode,
        category: body.category || 'Snack',
        itemName: body.itemName || body.item_name,
        qty: body.qty,
        costPrice: body.costPrice || body.cost_price,
        markupPercent: body.markupPercent !== undefined ? body.markupPercent : 8,
        sellingPrice: body.sellingPrice || body.selling_price,
        wholesaleMarkup: body.wholesaleMarkup !== undefined ? body.wholesaleMarkup : 5,
        wholesalePrice: body.wholesalePrice || body.wholesale_price
      }];

    const validItems = [];
    let calculatedTotal = 0;
    const summaryParts = [];

    for (const it of rawItems) {
      const barcode = String(it.barcode || "").trim();
      const itemName = String(it.itemName || it.name || "New Item").trim();
      const category = String(it.category || "Snack").trim();
      const qty = safeAmount(it.qty);
      const costPrice = safeAmount(it.costPrice || it.cost);

      if (!barcode || qty <= 0 || costPrice <= 0) continue;

      const markupPercent = Math.max(0, Number(it.markupPercent !== undefined ? it.markupPercent : 8));
      let sellingPrice = safeAmount(it.sellingPrice || it.retailPrice);
      if (sellingPrice <= 0) sellingPrice = calculateSmartPrice(costPrice, markupPercent, 50);

      const wholesaleMarkup = Math.max(0, Number(it.wholesaleMarkup !== undefined ? it.wholesaleMarkup : 5));
      let wholesalePrice = safeAmount(it.wholesalePrice);
      if (wholesalePrice <= 0) wholesalePrice = calculateSmartPrice(costPrice, wholesaleMarkup, 50);

      const totalCost = Math.round(qty * costPrice * 100) / 100;
      calculatedTotal += totalCost;
      summaryParts.push(`${itemName} x ${qty}`);

      validItems.push({
        barcode, itemName, category, qty, costPrice, totalCost,
        markupPercent, sellingPrice, wholesaleMarkup, wholesalePrice
      });
    }

    if (validItems.length === 0) {
      return { success: false, message: "Please provide at least 1 valid item with Barcode, Qty > 0, and Buy Price > 0." };
    }

    calculatedTotal = Math.round(calculatedTotal * 100) / 100;
    const voucherAmount = (body.voucherAmount !== undefined && body.voucherAmount !== '')
      ? safeAmount(body.voucherAmount)
      : calculatedTotal;

    // Difference between Calculated Total and Actual Voucher Amount (+/-)
    const surplusDeficit = (body.surplusDeficit !== undefined && body.surplusDeficit !== '')
      ? safeSignedAmount(body.surplusDeficit)
      : Math.round((calculatedTotal - voucherAmount) * 100) / 100;

    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^(PO_|PUR_|PCB_)+/i, '') : generateUniqueId('').replace(/^_/, '');
    const voucherNo = body.voucherNo || await generateVoucherNo(db, 'pos_purchases', 'PUR', entryDate);

    // Idempotency Guard
    const existingVoucher = await db.prepare("SELECT id, voucher_no FROM pos_purchases WHERE voucher_no = ? LIMIT 1").bind(voucherNo).first();
    if (existingVoucher && !body.isUpdate) {
      return {
        success: true,
        voucherNo: existingVoucher.voucher_no,
        message: "Purchase voucher already recorded (Duplicate prevented)."
      };
    }

    const batchStatements = [];

    // Optional Auto-Upsert Supplier if Shop/Supplier Name is provided
    if (shopName || supplierName) {
      const supKey = shopName || supplierName;
      batchStatements.push(
        db.prepare(`
          INSERT INTO pos_suppliers (supplier_name, contact_person, shop_name, phone_no, address)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(supplier_name) DO UPDATE SET
            contact_person = COALESCE(NULLIF(excluded.contact_person, ''), pos_suppliers.contact_person),
            shop_name = COALESCE(NULLIF(excluded.shop_name, ''), pos_suppliers.shop_name),
            phone_no = COALESCE(NULLIF(excluded.phone_no, ''), pos_suppliers.phone_no),
            address = COALESCE(NULLIF(excluded.address, ''), pos_suppliers.address)
        `).bind(supKey, supplierName || supKey, shopName || supKey, phoneNo, address)
      );
    }

    // Get starting sequence `no` for pos_purchases
    const lastPurRow = await db.prepare("SELECT MAX(CAST(no AS INTEGER)) as maxNo, COUNT(id) as cnt FROM pos_purchases").first();
    let nextPurNo = Math.max(parseInt(lastPurRow?.maxNo || 0, 10), parseInt(lastPurRow?.cnt || 0, 10));

    for (let i = 0; i < validItems.length; i++) {
      const it = validItems[i];
      nextPurNo += 1;
      const linePurchaseNo = `${voucherNo}-${String(i + 1).padStart(2, '0')}`;
      const lineUid = `PUR_${rawCore}_${i + 1}`;

      // 1. Upsert Master Item & Increment Stock
      batchStatements.push(
        db.prepare(`
          INSERT INTO pos_items_master (
            barcode, item_name, category, cost_price, markup_percent, selling_price,
            wholesale_markup, wholesale_price, current_stock, is_active, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
          ON CONFLICT(barcode) DO UPDATE SET
            item_name = COALESCE(NULLIF(excluded.item_name, ''), pos_items_master.item_name),
            category = COALESCE(NULLIF(excluded.category, ''), pos_items_master.category),
            cost_price = excluded.cost_price,
            markup_percent = excluded.markup_percent,
            selling_price = excluded.selling_price,
            wholesale_markup = excluded.wholesale_markup,
            wholesale_price = excluded.wholesale_price,
            current_stock = pos_items_master.current_stock + excluded.current_stock,
            is_active = 1,
            updated_at = datetime('now')
        `).bind(
          it.barcode, it.itemName, it.category, it.costPrice,
          it.markupPercent, it.sellingPrice, it.wholesaleMarkup, it.wholesalePrice, it.qty
        )
      );

      // 2. Insert 17-Column Purchase Line Record
      batchStatements.push(
        db.prepare(`
          INSERT INTO pos_purchases (
            no, purchase_no, voucher_no, date, item_barcode, category, item_name, method,
            qty, cost_price, total_cost, markup_percent, selling_price, wholesale_markup, wholesale_price,
            supplier_id, supplier_name, shop_name, phone_no, address, ref, remark,
            voucher_amount, surplus_deficit, created_by, uniqueid
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          nextPurNo, linePurchaseNo, voucherNo, entryDate, it.barcode, it.category, it.itemName, method,
          it.qty, it.costPrice, it.totalCost, it.markupPercent, it.sellingPrice, it.wholesaleMarkup, it.wholesalePrice,
          supplierId, supplierName, shopName, phoneNo, address, ref, remark,
          voucherAmount, surplusDeficit, session?.name || 'Admin', lineUid
        )
      );
    }

    // 3. Automatically Post Voucher Amount as Credit & Difference as Surplus/Deficit into POS Cash Book
    const noPcb = await generateFyNo(db, 'pos_cash_book', fy);
    const pcbUid = `PCB_PUR_${rawCore}`;
    const pcbDesc = `[${voucherNo}] ${shopName || supplierName || 'Purchase'}: ${summaryParts.join(', ')}`.slice(0, 500);

    batchStatements.push(
      db.prepare(`
        INSERT INTO pos_cash_book (
          no, date, category, description, method, debit, credit, balances,
          ref, surplus_deficit, vr_no, my, fy, created_by, uniqueid
        )
        VALUES (?, ?, 'Purchase', ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        noPcb, entryDate, pcbDesc, method, voucherAmount,
        ref || voucherNo, surplusDeficit, voucherNo, my, fy,
        session?.name || 'Admin', pcbUid
      )
    );

    await db.batch(batchStatements);
    await recalculateLedgerBalances(db, 'pos_cash_book', fy, entryDate);

    return {
      success: true,
      voucherNo,
      calculatedTotal,
      voucherAmount,
      surplusDeficit,
      itemsCount: validItems.length,
      message: `Purchase Voucher (${voucherNo}) saved and posted to POS Cash Book.`
    };
  } catch (err) {
    return { success: false, message: "Failed to save purchase voucher: " + err.message };
  }
}

export async function updatePosPurchase(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const id = parseInt(body.id, 10);
    const purchaseNo = String(body.purchaseNo || "").trim();
    if (!id && !purchaseNo) return { success: false, message: "Purchase ID or Number is required." };

    const existing = await db.prepare("SELECT id, purchase_no, item_barcode, qty, date FROM pos_purchases WHERE id = ? OR purchase_no = ?").bind(id || 0, purchaseNo || "").first();
    if (!existing) return { success: false, message: "Purchase record not found." };

    const policy = verifyRecordMutationPolicy(session, existing.date);
    if (!policy.allowed) return { success: false, message: policy.message };

    const entryDate = getMyanmarDateString(body.date);
    const supplierId = body.supplierId ? parseInt(body.supplierId, 10) : null;
    const newQty = safeAmount(body.qty);
    const newCostPrice = safeAmount(body.costPrice || body.cost_price);
    const markupPercent = Math.max(0, Number(body.markupPercent !== undefined ? body.markupPercent : 8));
    let newSellingPrice = safeAmount(body.sellingPrice || body.selling_price);
    const wholesaleMarkup = Math.max(0, Number(body.wholesaleMarkup !== undefined ? body.wholesaleMarkup : 5));
    let newWholesalePrice = safeAmount(body.wholesalePrice || body.wholesale_price);

    if (newQty <= 0 || newCostPrice <= 0) {
      return { success: false, message: "Qty and Cost Price must be greater than 0." };
    }

    if (newSellingPrice <= 0) newSellingPrice = calculateSmartPrice(newCostPrice, markupPercent, 50);
    if (newWholesalePrice <= 0) newWholesalePrice = calculateSmartPrice(newCostPrice, wholesaleMarkup, 50);

    const totalCost = Math.round(newQty * newCostPrice * 100) / 100;
    const deltaQty = newQty - Number(existing.qty || 0);

    await db.batch([
      db.prepare(`
        UPDATE pos_purchases 
        SET date = ?, supplier_id = ?, qty = ?, cost_price = ?, markup_percent = ?, 
            selling_price = ?, wholesale_markup = ?, wholesale_price = ?, total_cost = ?, remark = ? 
        WHERE id = ?
      `).bind(entryDate, supplierId, newQty, newCostPrice, markupPercent, newSellingPrice, wholesaleMarkup, newWholesalePrice, totalCost, body.remark || '', existing.id),

      db.prepare(`
        UPDATE pos_items_master 
        SET current_stock = current_stock + ?, 
            cost_price = ?, 
            markup_percent = ?, 
            selling_price = ?, 
            wholesale_markup = ?,
            wholesale_price = ?,
            updated_at = datetime('now') 
        WHERE barcode = ?
      `).bind(deltaQty, newCostPrice, markupPercent, newSellingPrice, wholesaleMarkup, newWholesalePrice, existing.item_barcode)
    ]);

    return { success: true, message: "Purchase entry and inventory updated successfully." };
  } catch (err) {
    return { success: false, message: "Failed to update purchase entry: " + err.message };
  }
}

export async function deletePosPurchase(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const id = parseInt(body.id, 10);
    const purchaseNo = String(body.purchaseNo || "").trim();
    if (!id && !purchaseNo) return { success: false, message: "Purchase ID or Number is required." };

    const existing = await db.prepare("SELECT id, purchase_no, voucher_no, item_barcode, qty, date FROM pos_purchases WHERE id = ? OR purchase_no = ?").bind(id || 0, purchaseNo || "").first();
    if (!existing) return { success: false, message: "Purchase record not found." };

    const policy = verifyRecordMutationPolicy(session, existing.date);
    if (!policy.allowed) return { success: false, message: policy.message };

    const rollbackQty = safeAmount(existing.qty);
    const batchStatements = [
      db.prepare("DELETE FROM pos_purchases WHERE id = ?").bind(existing.id),
      db.prepare(`
        UPDATE pos_items_master 
        SET current_stock = MAX(0, current_stock - ?), 
            updated_at = datetime('now') 
        WHERE barcode = ?
      `).bind(rollbackQty, existing.item_barcode)
    ];

    await db.batch(batchStatements);

    // If no more line items exist for this voucher_no, remove its POS Cash Book entry as well
    if (existing.voucher_no) {
      const rem = await db.prepare("SELECT COUNT(id) as cnt FROM pos_purchases WHERE voucher_no = ?").bind(existing.voucher_no).first();
      if (!rem || Number(rem.cnt) === 0) {
        await db.prepare("DELETE FROM pos_cash_book WHERE vr_no = ?").bind(existing.voucher_no).run();
        const fy = normalizeFyStr(computeAcademicFy(existing.date));
        await recalculateLedgerBalances(db, 'pos_cash_book', fy, existing.date);
      }
    }

    return { success: true, message: `Purchase entry (${existing.purchase_no}) deleted and stock rolled back.` };
  } catch (err) {
    return { success: false, message: "Failed to delete purchase entry: " + err.message };
  }
}

// ==============================================================================
// 🧾 8. SALES ORDERS HISTORY AUDITOR
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

    if (dateFrom) { whereClauses.push(`date >= ?`); params.push(dateFrom); }
    if (dateTo) { whereClauses.push(`date <= ?`); params.push(dateTo); }
    if (paymentMethod) { whereClauses.push(`payment_method = ?`); params.push(paymentMethod); }
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
          id, invoice_no as invoiceNo, date, payment_method as paymentMethod, 
          student_id as studentId, total_amount as totalAmount, total_cost as totalCost, 
          net_profit as netProfit, items_summary as itemsSummary, 
          canteen_vr_no as canteenVrNo, uniqueid as uniqueId, 
          created_by as createdBy, created_at as createdAt 
        FROM pos_sales_orders 
        ${whereSql} 
        ORDER BY id DESC LIMIT ? OFFSET ?
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
    return { success: false, message: "Failed to load sales orders history: " + err.message };
  }
}

// ==============================================================================
// 💡 9. REAL-TIME STOCK INVENTORY AUDITOR
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

    if (category) { whereClauses.push(`category = ?`); params.push(category); }
    if (stockStatus === 'low_stock') { whereClauses.push(`current_stock > 0 AND current_stock <= 10`); }
    else if (stockStatus === 'out_of_stock') { whereClauses.push(`current_stock <= 0`); }

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
          COALESCE(SUM(cost_price * CASE WHEN (current_stock - COALESCE(surplus_stock, 0)) > 0 THEN (current_stock - COALESCE(surplus_stock, 0)) ELSE 0 END), 0) as totalStockValue,
          COALESCE(SUM(CASE WHEN current_stock <= 0 THEN 1 ELSE 0 END), 0) as outOfStockCount,
          COALESCE(SUM(CASE WHEN current_stock > 0 AND current_stock <= 10 THEN 1 ELSE 0 END), 0) as lowStockCount
        FROM pos_items_master 
        ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT 
          id, barcode, item_name as itemName, category, 
          cost_price as costPrice, markup_percent as markupPercent, 
          selling_price as sellingPrice,
          COALESCE(wholesale_markup, 5) as wholesaleMarkup,
          COALESCE(wholesale_price, selling_price, 0) as wholesalePrice,
          current_stock as currentStock, 
          COALESCE(surplus_stock, 0) as surplusStock,
          is_active as isActive, updated_at as updatedAt,
          (cost_price * CASE WHEN (current_stock - COALESCE(surplus_stock, 0)) > 0 THEN (current_stock - COALESCE(surplus_stock, 0)) ELSE 0 END) as stockValue
        FROM pos_items_master 
        ${whereSql}
        ORDER BY id DESC LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

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
    return { success: false, message: "Failed to load stock inventory: " + err.message };
  }
}

export async function updatePosItemQuick(db, session, body) {
  try {
    const barcode = String(body.barcode || "").trim();
    if (!barcode) return { success: false, message: "Barcode is required." };

    const updates = [];
    const params = [];

    if (body.sellingPrice !== undefined) {
      updates.push(`selling_price = ?`);
      params.push(safeAmount(body.sellingPrice));
    }
    if (body.wholesalePrice !== undefined) {
      updates.push(`wholesale_price = ?`);
      params.push(safeAmount(body.wholesalePrice));
    }
    if (body.costPrice !== undefined) {
      updates.push(`cost_price = ?`);
      params.push(safeAmount(body.costPrice));
    }
    if (body.currentStock !== undefined) {
      const newStock = Math.max(0, Number(body.currentStock) || 0);
      updates.push(`current_stock = ?`);
      params.push(newStock);
      updates.push(`surplus_stock = MIN(COALESCE(surplus_stock, 0), ?)`);
      params.push(newStock);
    }
    if (body.isActive !== undefined) {
      updates.push(`is_active = ?`);
      params.push(body.isActive ? 1 : 0);
    }

    if (updates.length === 0) return { success: false, message: "No fields to update." };

    updates.push(`updated_at = datetime('now')`);
    params.push(barcode);

    await db.prepare(`UPDATE pos_items_master SET ${updates.join(', ')} WHERE barcode = ?`).bind(...params).run();
    return { success: true, message: "Item updated successfully." };
  } catch (err) {
    return { success: false, message: "Failed to update item: " + err.message };
  }
}

// ==============================================================================
// 💡 10. POS CATALOG & PRICING
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

    if (barcode) { whereClauses.push(`barcode = ?`); params.push(barcode); }
    if (category) { whereClauses.push(`category = ?`); params.push(category); }
    if (onlyActive) { whereClauses.push(`is_active = 1`); }
    if (searchVal) {
      whereClauses.push(`(item_name LIKE ? OR barcode LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const res = await db.prepare(`
      SELECT 
        id, barcode, item_name as itemName, category, 
        cost_price as costPrice, markup_percent as markupPercent, 
        selling_price as sellingPrice,
        COALESCE(wholesale_markup, 5) as wholesaleMarkup,
        COALESCE(wholesale_price, selling_price, 0) as wholesalePrice,
        current_stock as currentStock, 
        COALESCE(surplus_stock, 0) as surplusStock, is_active as isActive, updated_at as updatedAt
      FROM pos_items_master 
      ${whereSql}
      ORDER BY item_name ASC 
      LIMIT 500
    `).bind(...params).all();

    return { success: true, data: res.results || [] };
  } catch (err) {
    return { success: false, message: "Failed to load POS items: " + err.message };
  }
}

export async function savePosItem(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const barcode = String(body.barcode || "").trim();
    const itemName = String(body.itemName || body.item_name || "").trim();
    if (!barcode || !itemName) return { success: false, message: "Barcode and Item Name are required." };

    const category = String(body.category || 'Snack').trim();
    const costPrice = safeAmount(body.costPrice || body.cost_price);
    const markupPercent = Math.max(0, Number(body.markupPercent !== undefined ? body.markupPercent : 8));
    let sellingPrice = safeAmount(body.sellingPrice || body.selling_price);
    if (sellingPrice <= 0 && costPrice > 0) sellingPrice = calculateSmartPrice(costPrice, markupPercent, 50);

    const wholesaleMarkup = Math.max(0, Number(body.wholesaleMarkup !== undefined ? body.wholesaleMarkup : 5));
    let wholesalePrice = safeAmount(body.wholesalePrice || body.wholesale_price);
    if (wholesalePrice <= 0 && costPrice > 0) wholesalePrice = calculateSmartPrice(costPrice, wholesaleMarkup, 50);

    const currentStock = Number(body.currentStock || body.current_stock) || 0;
    const isActive = body.isActive === 0 ? 0 : 1;

    await db.prepare(`
      INSERT INTO pos_items_master (
        barcode, item_name, category, cost_price, markup_percent, selling_price,
        wholesale_markup, wholesale_price, current_stock, is_active, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(barcode) DO UPDATE SET
        item_name = excluded.item_name, 
        category = excluded.category, 
        cost_price = excluded.cost_price,
        markup_percent = excluded.markup_percent, 
        selling_price = excluded.selling_price,
        wholesale_markup = excluded.wholesale_markup,
        wholesale_price = excluded.wholesale_price,
        current_stock = excluded.current_stock, 
        is_active = excluded.is_active, 
        updated_at = datetime('now')
    `).bind(barcode, itemName, category, costPrice, markupPercent, sellingPrice, wholesaleMarkup, wholesalePrice, currentStock, isActive).run();

    return {
      success: true,
      data: { barcode, itemName, category, costPrice, markupPercent, sellingPrice, wholesaleMarkup, wholesalePrice, currentStock, isActive }
    };
  } catch (err) {
    return { success: false, message: "Failed to save item: " + err.message };
  }
}

// ==============================================================================
// 💡 11. STUDENT POCKET MONEY RADAR
// ==============================================================================
export async function lookupStudentForPos(db, body) {
  try {
    const rawInput = String(body.studentId || body.searchVal || "").trim();
    if (!rawInput) return { success: false, message: "Please enter Student ID or Barcode." };

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

    if (!student) return { success: false, message: "Student not found." };

    const realStudentId = parseInt(student.studentId || student.id, 10);
    const realFyid = student.fyid || rawInput;

    const balStmt = (realStudentId > 0)
      ? db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id = ?`).bind(cleanFy, `FY ${cleanFy}`, realStudentId)
      : db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND fyid = ?`).bind(cleanFy, `FY ${cleanFy}`, realFyid);

    const [balRow, spentRow, capRow] = await db.batch([
      balStmt,
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
    return { success: false, message: "Failed to lookup student: " + err.message };
  }
}

// ------------------------------------------------------------------------------
// 🎓 12. OFFLINE POS STUDENT DIRECTORY SNAPSHOT
// ------------------------------------------------------------------------------
export async function getPosStudentsSnapshot(db) {
  try {
    const todayStr = getMyanmarDateString();
    const currentFy = computeAcademicFy(todayStr).replace(/^FY\s*/i, '');

    let query = `
      SELECT 
        s.student_id as studentId, s.id, s.name, s.class as studentClass, 
        s.fyid, s.nfc_tag_id as nfcTagId,
        COALESCE(b.bal, 0) as currentBalance, 
        COALESCE(o.todaySpent, 0) as todaySpent
      FROM student s
      LEFT JOIN (
        SELECT student_id, SUM(debit - credit) as bal 
        FROM student_money WHERE fy IN (?, ?) GROUP BY student_id
      ) b ON b.student_id = COALESCE(s.student_id, s.id)
      LEFT JOIN (
        SELECT student_id, SUM(total_amount) as todaySpent 
        FROM pos_sales_orders WHERE date = ? AND payment_method = 'Student Pocket Money' GROUP BY student_id
      ) o ON o.student_id = COALESCE(s.student_id, s.id)
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
    return { success: false, message: "Failed to fetch students snapshot: " + err.message };
  }
}

// ==============================================================================
// 💡 13. ATOMIC SINGLE BATCH POS CHECKOUT
// ==============================================================================
export async function checkoutPosSale(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || computeAcademicFy(entryDate));
    const cleanFy = fy.replace(/^FY\s*/i, '');

    try {
      const closureCheck = await db.prepare("SELECT id FROM canteen_day_closures WHERE date = ?").bind(entryDate).first();
      if (closureCheck) {
        return { success: false, message: `Register is already closed for (${entryDate}). Cannot process new sales.` };
      }
    } catch (e) { }

    const paymentMethod = String(body.paymentMethod || 'Student Pocket Money').trim();
    const isWallet = (paymentMethod === 'Student Pocket Money');
    const studentId = parseInt(body.studentId, 10) || null;
    const stockDeductions = Array.isArray(body.stockDeductions) ? body.stockDeductions : [];

    let totalAmount = 0;
    let totalCost = 0;
    const verifiedSummaryParts = [];

    if (stockDeductions.length > 0) {
      const barcodes = stockDeductions.map(i => String(i.barcode || "").trim()).filter(Boolean);
      if (barcodes.length > 0) {
        const placeholders = barcodes.map(() => '?').join(',');
        const dbItemsRes = await db.prepare(
          `SELECT barcode, item_name, selling_price, cost_price, current_stock FROM pos_items_master WHERE barcode IN (${placeholders})`
        ).bind(...barcodes).all();
        const itemMap = new Map((dbItemsRes.results || []).map(r => [r.barcode, r]));

        for (const reqItem of stockDeductions) {
          const bCode = String(reqItem.barcode || "").trim();
          const q = safeAmount(reqItem.qty);
          if (!bCode || q <= 0) continue;

          const dbItem = itemMap.get(bCode);
          if (!dbItem) return { success: false, message: `Item Barcode (${bCode}) not found.` };
          if (Number(dbItem.current_stock || 0) < q) {
            return { success: false, message: `Insufficient stock for "${dbItem.item_name}" (Available: ${dbItem.current_stock})` };
          }
          totalAmount += q * safeAmount(dbItem.selling_price);
          totalCost += q * safeAmount(dbItem.cost_price);
          verifiedSummaryParts.push(`${dbItem.item_name} x ${q}`);
        }
      }
      totalAmount = Math.round(totalAmount * 100) / 100;
      totalCost = Math.round(totalCost * 100) / 100;
    } else {
      totalAmount = safeAmount(body.totalAmount);
      totalCost = safeAmount(body.totalCost);
    }

    const netProfit = Math.round((totalAmount - totalCost) * 100) / 100;
    const itemsSummary = verifiedSummaryParts.length > 0 ? verifiedSummaryParts.join(', ') : String(body.itemsSummary || "").trim();

    if (totalAmount <= 0 || !itemsSummary) {
      return { success: false, message: "Cart is empty or invalid amount." };
    }

    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^(CAN_|STM_|POS_|OFF_|PCB_)+/i, '') : generateUniqueId('').replace(/^_/, '');
    const posUniqueId = `POS_${rawCore}`;
    const canUniqueId = `CAN_${rawCore}`;
    const stmUniqueId = `STM_${rawCore}`;
    const pcbUniqueId = `PCB_${rawCore}`;

    const duplicateCheck = await db.prepare("SELECT invoice_no FROM pos_sales_orders WHERE uniqueid = ?").bind(posUniqueId).first();
    if (duplicateCheck) {
      return {
        success: true,
        invoiceNo: duplicateCheck.invoice_no,
        uniqueId: posUniqueId,
        message: "Invoice already processed."
      };
    }

    if (isWallet) {
      if (!studentId || studentId <= 0) return { success: false, message: "Student ID is required for Wallet payment." };

      const [balRes, spentRes, capRes] = await db.batch([
        db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id = ?`).bind(cleanFy, `FY ${cleanFy}`, studentId),
        db.prepare(`SELECT COALESCE(SUM(total_amount), 0) as todaySpent FROM pos_sales_orders WHERE student_id = ? AND date = ? AND payment_method = 'Student Pocket Money'`).bind(studentId, entryDate),
        db.prepare(`SELECT setting_value as capVal FROM pos_settings WHERE setting_key = 'daily_spending_cap' LIMIT 1`)
      ]);

      const curStuBal = parseFloat(balRes.results[0]?.bal || 0);
      const todaySpent = parseFloat(spentRes.results[0]?.todaySpent || 0);
      const dynamicCap = parseFloat(capRes.results[0]?.capVal || 10000);

      if (totalAmount > curStuBal) return { success: false, message: `Insufficient wallet balance! Available: ${curStuBal.toLocaleString()} MMK.` };
      if ((todaySpent + totalAmount) > dynamicCap) {
        const remaining = Math.max(0, dynamicCap - todaySpent);
        return { success: false, message: `Daily spending cap (${dynamicCap.toLocaleString()} MMK) exceeded! Remaining today: ${remaining.toLocaleString()} MMK.` };
      }
    }

    const invoiceNo = `INV-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-4).toUpperCase()}`;
    const vrCan = await generateVoucherNo(db, 'canteen_book', 'CAN', entryDate);
    const noCan = await generateFyNo(db, 'canteen_book', fy);
    const noPcb = await generateFyNo(db, 'pos_cash_book', fy);

    const batchStatements = [
      db.prepare(`
        INSERT INTO pos_sales_orders (invoice_no, date, payment_method, student_id, total_amount, total_cost, net_profit, items_summary, canteen_vr_no, uniqueid, created_by) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(invoiceNo, entryDate, paymentMethod, studentId, totalAmount, totalCost, netProfit, itemsSummary, vrCan, posUniqueId, session?.name || 'Cashier'),

      db.prepare(`
        INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) 
        VALUES (?, ?, 'POS Sales', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
      `).bind(noCan, entryDate, `[${invoiceNo}] ${itemsSummary}`, paymentMethod === 'Cash' ? 'Cash' : 'Transfer', totalAmount, vrCan, my, fy, session?.name || 'Cashier', canUniqueId),

      // Record in POS Cash Book as Debit
      db.prepare(`
        INSERT INTO pos_cash_book (no, date, category, description, method, debit, credit, balances, ref, surplus_deficit, vr_no, my, fy, created_by, uniqueid)
        VALUES (?, ?, 'POS Sales', ?, 'Cash', ?, 0, 0, ?, 0, ?, ?, ?, ?, ?)
      `).bind(noPcb, entryDate, `[${invoiceNo}] ${itemsSummary}`, totalAmount, invoiceNo, vrCan, my, fy, session?.name || 'Cashier', pcbUniqueId)
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

    await recalculateCanteenBookBalances(db, fy, entryDate);
    await recalculateLedgerBalances(db, 'pos_cash_book', fy, entryDate);
    if (isWallet && studentId > 0) {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);
    }

    return { success: true, invoiceNo, canteenVrNo: vrCan, uniqueId: posUniqueId, totalAmount, netProfit };
  } catch (err) {
    return { success: false, message: "Checkout failed: " + err.message };
  }
}

// ==============================================================================
// 🌐 14. OFFLINE BATCH IDEMPOTENT SYNC
// ==============================================================================
export async function syncOfflinePosOrders(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const orders = Array.isArray(body.orders) ? body.orders : [];
    if (orders.length === 0) return { success: true, syncedCount: 0, skippedCount: 0, message: "No offline orders to sync." };

    let syncedCount = 0, skippedCount = 0;
    const failedOrders = [], affectedLedgers = new Set();

    for (const order of orders) {
      try {
        const entryDate = getMyanmarDateString(order.date);
        const d = new Date(entryDate);
        const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
        const fy = normalizeFyStr(order.fy || computeAcademicFy(entryDate));
        const cleanFy = fy.replace(/^FY\s*/i, '');

        const rawCore = order.uniqueId ? String(order.uniqueId).trim().replace(/^(CAN_|STM_|POS_|OFF_|PCB_)+/i, '') : generateUniqueId('').replace(/^_/, '');
        const posUniqueId = `POS_${rawCore}`;
        const canUniqueId = `CAN_${rawCore}`;
        const stmUniqueId = `STM_${rawCore}`;
        const pcbUniqueId = `PCB_${rawCore}`;

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
        const noPcb = await generateFyNo(db, 'pos_cash_book', fy);

        const batchStatements = [
          db.prepare(`
            INSERT INTO pos_sales_orders (invoice_no, date, payment_method, student_id, total_amount, total_cost, net_profit, items_summary, canteen_vr_no, uniqueid, created_by) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(invoiceNo, entryDate, paymentMethod, studentId, totalAmount, totalCost, netProfit, itemsSummary, vrCan, posUniqueId, session?.name || order.createdBy || 'Offline POS'),

          db.prepare(`
            INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) 
            VALUES (?, ?, 'POS Sales', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)
          `).bind(noCan, entryDate, `[${invoiceNo}] ${itemsSummary}`, paymentMethod === 'Cash' ? 'Cash' : 'Transfer', totalAmount, vrCan, my, fy, session?.name || 'Offline POS', canUniqueId),

          db.prepare(`
            INSERT INTO pos_cash_book (no, date, category, description, method, debit, credit, balances, ref, surplus_deficit, vr_no, my, fy, created_by, uniqueid)
            VALUES (?, ?, 'POS Sales', ?, 'Cash', ?, 0, 0, ?, 0, ?, ?, ?, ?, ?)
          `).bind(noPcb, entryDate, `[${invoiceNo}] ${itemsSummary}`, totalAmount, invoiceNo, vrCan, my, fy, session?.name || 'Offline POS', pcbUniqueId)
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
        affectedLedgers.add(`pos_cash_book:${fy}:${entryDate}`);
        syncedCount++;
      } catch (itemErr) {
        failedOrders.push({ uniqueId: order.uniqueId, error: itemErr.message });
      }
    }

    for (const item of affectedLedgers) {
      const [book, academicFy, date] = item.split(':');
      if (book === 'canteen_book') {
        await recalculateCanteenBookBalances(db, academicFy, date);
      } else {
        await recalculateLedgerBalances(db, book, academicFy, date);
      }
    }

    return {
      success: true,
      syncedCount,
      skippedCount,
      failedCount: failedOrders.length,
      failedOrders,
      message: `Synced (${syncedCount}) offline orders to D1. (${skippedCount} duplicates skipped)`
    };
  } catch (err) {
    return { success: false, message: "Offline Sync failed: " + err.message };
  }
}

// ==============================================================================
// 🔒 15. CANTEEN STORE CLOSURE & SETTLEMENT
// ==============================================================================
export async function closeCanteenDay(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const todayStr = getMyanmarDateString();
    let targetDate = String(body.date || "").trim();
    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) targetDate = todayStr;

    if (targetDate > todayStr) {
      return { success: false, message: `Cannot close register for a future date (${targetDate}).` };
    }

    const existing = await db.prepare("SELECT id, closed_at as closedAt, closed_by as closedBy FROM canteen_day_closures WHERE date = ?").bind(targetDate).first();
    if (existing) {
      return { success: false, message: `Register is already closed for (${targetDate}) by ${existing.closedBy}.` };
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
      message: `Daily register closed for (${targetDate}). Ready for Finance settlement.`
    };
  } catch (err) {
    return { success: false, message: "Failed to close register: " + err.message };
  }
}

export async function getCanteenClosureStatus(db, body) {
  try {
    const todayStr = getMyanmarDateString();
    let targetDate = String(body.date || "").trim();
    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) targetDate = todayStr;

    let row = null;
    try {
      row = await db.prepare(`SELECT date, closed_at as closedAt, closed_by as closedBy, total_sales as totalSales, cash_sales as cashSales, wallet_sales as walletSales, total_orders as totalOrders, status, remark FROM canteen_day_closures WHERE date = ? LIMIT 1`).bind(targetDate).first();
    } catch (e) { }

    return { success: true, isClosed: Boolean(row), data: row || null };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

export async function getCanteenDailySummary(db, body) {
  try {
    await ensureCanteenSchema(db);
    const todayStr = getMyanmarDateString();
    const todayMs = new Date(todayStr + "T00:00:00Z").getTime();
    const yesterdayStr = new Date(todayMs - 86400000).toISOString().slice(0, 10);

    let targetDate = String(body.date || "").trim();
    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) targetDate = todayStr;

    const [summaryRes, settleRes, closureRes, unclosedRes] = await db.batch([
      db.prepare(`
        SELECT 
          COUNT(id) as totalOrders, 
          COALESCE(SUM(total_amount), 0) as totalSales,
          COALESCE(SUM(CASE WHEN payment_method = 'Student Pocket Money' THEN total_amount ELSE 0 END), 0) as pocketMoneyShare,
          COALESCE(SUM(CASE WHEN payment_method = 'Cash' THEN total_amount ELSE 0 END), 0) as cashSalesShare,
          COALESCE(SUM(net_profit), 0) as totalProfit
        FROM pos_sales_orders 
        WHERE date = ?
      `).bind(targetDate),

      db.prepare(`
        SELECT settlement_no as settlementNo, net_payout_amount as netPayoutAmount, created_at as createdAt, handed_over_by as handedOverBy, received_by as receivedBy 
        FROM canteen_settlements WHERE date = ? LIMIT 1
      `).bind(targetDate),

      db.prepare(`
        SELECT date, closed_at as closedAt, closed_by as closedBy, total_sales as totalSales, status 
        FROM canteen_day_closures WHERE date = ? LIMIT 1
      `).bind(targetDate),

      db.prepare(`
        SELECT 
          p.date,
          COUNT(p.id) as totalOrders,
          COALESCE(SUM(p.total_amount), 0) as totalSales,
          COALESCE(SUM(CASE WHEN p.payment_method = 'Student Pocket Money' THEN p.total_amount ELSE 0 END), 0) as walletSales,
          COALESCE(SUM(CASE WHEN p.payment_method = 'Cash' THEN p.total_amount ELSE 0 END), 0) as cashSales
        FROM pos_sales_orders p
        LEFT JOIN canteen_day_closures c ON p.date = c.date
        WHERE c.id IS NULL AND p.date < ?
        GROUP BY p.date
        ORDER BY p.date DESC
        LIMIT 5
      `).bind(todayStr)
    ]);

    const stats = summaryRes?.results?.[0] || {};
    const settleRow = settleRes?.results?.[0] || null;
    const closureRow = closureRes?.results?.[0] || null;
    const unclosedPastDays = unclosedRes?.results || [];
    const isYesterdayUnclosed = unclosedPastDays.some(d => d.date === yesterdayStr);

    return {
      success: true,
      data: {
        date: targetDate,
        today: todayStr,
        yesterday: yesterdayStr,
        isYesterdayUnclosed,
        unclosedPastDays,
        totalOrders: stats.totalOrders || 0,
        totalSales: parseFloat(stats.totalSales || 0),
        pocketMoneyShare: parseFloat(stats.pocketMoneyShare || 0),
        cashSalesShare: parseFloat(stats.cashSalesShare || 0),
        totalProfit: parseFloat(stats.totalProfit || 0),
        isSettled: Boolean(settleRow),
        settlement: settleRow,
        isClosed: Boolean(closureRow),
        closure: closureRow
      }
    };
  } catch (err) {
    return { success: false, message: "Failed to load daily summary: " + err.message };
  }
}

export async function saveCanteenSettlement(db, session, body) {
  try {
    const todayStr = getMyanmarDateString();
    let entryDate = String(body.date || "").trim();
    if (!entryDate || !/^\d{4}-\d{2}-\d{2}$/.test(entryDate)) entryDate = todayStr;

    const pocketMoneyShare = safeAmount(body.pocketMoneyShare);
    const cashSalesShare = safeAmount(body.cashSalesShare);
    const totalSales = Math.round((pocketMoneyShare + cashSalesShare) * 100) / 100;
    const netPayout = safeAmount(body.netPayoutAmount || pocketMoneyShare);

    if (totalSales <= 0) return { success: false, message: "No sales to settle for this date." };

    try {
      const closureCheck = await db.prepare("SELECT id FROM canteen_day_closures WHERE date = ?").bind(entryDate).first();
      if (!closureCheck) {
        return {
          success: false,
          message: `Cannot settle yet! Canteen register for (${entryDate}) must be closed first.`
        };
      }
    } catch (e) { }

    const rawCore = body.uniqueId ? String(body.uniqueId).trim().replace(/^SETTLE_/i, '') : generateUniqueId('').replace(/^_/, '');
    const settleUniqueId = `SETTLE_${rawCore}`;
    const canSettleUniqueId = `CAN_SETTLE_${rawCore}`;
    const settlementNo = `SETTLE-${entryDate.replace(/-/g, '')}-${generateUniqueId('').slice(-3).toUpperCase()}`;

    const dupCheck = await db.prepare("SELECT settlement_no FROM canteen_settlements WHERE uniqueid = ? OR date = ?").bind(settleUniqueId, entryDate).first();
    if (dupCheck) return { success: false, message: `Date (${entryDate}) is already settled (${dupCheck.settlement_no}).` };

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
        body.remark || 'Evening Canteen Pocket Money Settlement',
        settleUniqueId
      ),

      db.prepare(`
        INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid)
        VALUES (?, ?, 'Settlement Payout', ?, 'Cash', 0, ?, 0, ?, ?, ?, ?, ?)
      `).bind(
        noCan, entryDate, `[${settlementNo}] Pocket Money Sales Settlement Payout from Finance`,
        netPayout, settlementNo, my, fy, session?.name || 'Finance Admin', canSettleUniqueId
      )
    ]);

    await recalculateCanteenBookBalances(db, fy, entryDate);
    return {
      success: true,
      settlementNo,
      netPayoutAmount: netPayout,
      message: "Canteen settlement recorded successfully."
    };
  } catch (err) {
    return { success: false, message: "Settlement failed: " + err.message };
  }
}

export async function getCanteenSettlements(db, body) {
  try {
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const searchVal = String(body.searchVal || "").trim();
    const page = Math.max(1, parseInt(body.page || 1, 10));
    const limit = Math.min(100, Math.max(1, parseInt(body.limit || 20, 10)));
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let params = [];

    if (dateFrom) { whereClauses.push(`date >= ?`); params.push(dateFrom); }
    if (dateTo) { whereClauses.push(`date <= ?`); params.push(dateTo); }
    if (searchVal) {
      whereClauses.push(`(settlement_no LIKE ? OR handed_over_by LIKE ? OR received_by LIKE ? OR remark LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const [countRes, rowsRes] = await db.batch([
      db.prepare(`
        SELECT 
          COUNT(id) as totalRows,
          COALESCE(SUM(total_sales_amount), 0) as totalSalesAmount,
          COALESCE(SUM(pocket_money_share), 0) as totalPocketMoneyShare,
          COALESCE(SUM(cash_sales_share), 0) as totalCashSalesShare,
          COALESCE(SUM(net_payout_amount), 0) as totalPayoutAmount
        FROM canteen_settlements
        ${whereSql}
      `).bind(...params),

      db.prepare(`
        SELECT 
          id, settlement_no as settlementNo, date, settlement_type as settlementType,
          total_sales_amount as totalSalesAmount, pocket_money_share as pocketMoneyShare,
          cash_sales_share as cashSalesShare, net_payout_amount as netPayoutAmount,
          handed_over_by as handedOverBy, received_by as receivedBy, 
          remark, uniqueid, created_at as createdAt
        FROM canteen_settlements 
        ${whereSql}
        ORDER BY date DESC, id DESC 
        LIMIT ? OFFSET ?
      `).bind(...params, limit, offset)
    ]);

    const stats = countRes?.results?.[0] || {};
    return {
      success: true,
      data: rowsRes?.results || [],
      totalRows: stats.totalRows || 0,
      totalSalesAmount: parseFloat(stats.totalSalesAmount || 0),
      totalPocketMoneyShare: parseFloat(stats.totalPocketMoneyShare || 0),
      totalCashSalesShare: parseFloat(stats.totalCashSalesShare || 0),
      totalPayoutAmount: parseFloat(stats.totalPayoutAmount || 0),
      page,
      limit
    };
  } catch (err) {
    return { success: false, message: "Failed to load settlements: " + err.message };
  }
}

export async function getUnclosedCanteenDates(db, body) {
  try {
    await ensureCanteenSchema(db);
    const todayStr = getMyanmarDateString();
    const limit = Math.min(20, Math.max(1, parseInt(body?.limit || 10, 10)));

    const res = await db.prepare(`
      SELECT 
        p.date,
        COUNT(p.id) as totalOrders,
        COALESCE(SUM(p.total_amount), 0) as totalSales,
        COALESCE(SUM(CASE WHEN p.payment_method = 'Student Pocket Money' THEN p.total_amount ELSE 0 END), 0) as walletSales,
        COALESCE(SUM(CASE WHEN p.payment_method = 'Cash' THEN p.total_amount ELSE 0 END), 0) as cashSales,
        MAX(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END) as isSettled
      FROM pos_sales_orders p
      LEFT JOIN canteen_day_closures c ON p.date = c.date
      LEFT JOIN canteen_settlements s ON p.date = s.date
      WHERE c.id IS NULL AND p.date <= ?
      GROUP BY p.date
      ORDER BY p.date DESC
      LIMIT ?
    `).bind(todayStr, limit).all();

    return {
      success: true,
      today: todayStr,
      data: res.results || []
    };
  } catch (err) {
    return { success: false, message: "Failed to load unclosed dates: " + err.message };
  }
}

// ==============================================================================
// 💡 16. SUPPLIERS MASTER
// ==============================================================================
export async function getPosSuppliers(db) {
  try {
    await ensureCanteenSchema(db);
    const res = await db.prepare(`
      SELECT 
        id, 
        supplier_name as supplierName, 
        COALESCE(NULLIF(shop_name, ''), supplier_name) as shopName,
        contact_person as contactPerson, 
        phone_no as phoneNo, 
        address, 
        is_active as isActive 
      FROM pos_suppliers 
      WHERE is_active = 1 
      ORDER BY supplier_name ASC
    `).all();
    return { success: true, data: res.results || [] };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

export async function savePosSupplier(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const name = String(body.supplierName || body.shopName || "").trim();
    if (!name) return { success: false, message: "Supplier or Shop Name is required." };

    const shopName = String(body.shopName || name).trim();
    const contactPerson = String(body.contactPerson || body.supplierName || "").trim();
    const phoneNo = String(body.phoneNo || "").trim();
    const address = String(body.address || "").trim();

    await db.prepare(`
      INSERT INTO pos_suppliers (supplier_name, shop_name, contact_person, phone_no, address)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(supplier_name) DO UPDATE SET
        shop_name = excluded.shop_name,
        contact_person = excluded.contact_person, 
        phone_no = excluded.phone_no, 
        address = excluded.address
    `).bind(name, shopName, contactPerson, phoneNo, address).run();

    return { success: true, message: "Supplier saved successfully." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

// ==============================================================================
// ⚙️ 17. DYNAMIC POS SETTINGS (ALLOWANCE CAP)
// ==============================================================================
export async function getPosSettings(db) {
  try {
    await ensureCanteenSchema(db);
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
    return { success: false, message: "Failed to load POS settings: " + err.message };
  }
}

export async function updatePosSettings(db, session, body) {
  try {
    await ensureCanteenSchema(db);
    const key = String(body.settingKey || body.key || '').trim();
    const val = String(body.settingValue || body.value || '').trim();

    if (!key) return { success: false, message: "Setting Key is required." };

    if (key === 'daily_spending_cap') {
      const numVal = parseInt(val, 10);
      if (isNaN(numVal) || numVal < 0) {
        return { success: false, message: "Daily spending cap must be 0 MMK or higher." };
      }
    }

    await db.prepare(`
      INSERT INTO pos_settings (setting_key, setting_value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = datetime('now')
    `).bind(key, val).run();

    return { success: true, message: "POS Settings updated successfully." };
  } catch (err) {
    return { success: false, message: "Failed to update POS settings: " + err.message };
  }
}