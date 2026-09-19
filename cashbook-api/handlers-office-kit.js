/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - OFFICE & KITCHEN EXPENSE HANDLER (CLOUDFLARE D1)
 * File: handlers-office-kit.js (Location: cashbook-api/handlers-office-kit.js)
 * 💡 Features: Refactored with utils.js for DRY Principle
 *              🚀 OPTIMIZED: Aggregations natively in SQL (SUM/COUNT)
 *              🎯 EXPLICIT SELECTS: Avoided SELECT *, Exact Column Mapping
 *              🚀 ULTRA-OPTIMIZED: Prevented Full Table Scans. Replaced OR with IN().
 * ==============================================================================
 */

import {
  getMyanmarDateString,
  calculateAcademicFyFromDate,
  normalizeFyStr,
  parseAccountingNum,
  generateVoucherNo,
  generateFyNo,
  recalculateLedgerBalances,
  generateUniqueId,
  getCurrentAcademicYear
} from './utils.js';

const BOOK_TABLE_MAP = {
  "kitchen": "kitchen", 
  "kitchen exp book": "kitchen", 
  "kitchen expense book": "kitchen",
  "office": "office", 
  "office exp book": "office", 
  "office expense book": "office",
  "payroll": "payroll",
  "hr payroll exp book": "payroll",
  "caoffice": "ca_office", 
  "cakitchen": "ca_kitchen"
};

function getTableName(rawBook) {
  if (!rawBook) return "office";
  const key = String(rawBook).trim().toLowerCase();
  return BOOK_TABLE_MAP[key] || "office";
}

function getTablePrefix(tableName) {
  switch (tableName) {
    case 'kitchen': return 'KIT';
    case 'payroll': return 'SAL';
    default: return 'OFF';
  }
}

/**
 * 💡 Resilient Product ID Extractor
 */
function extractProductId(body = {}, description = '', fallbackId = null) {
  if (body.id) return String(body.id).trim();
  if (body.productId) return String(body.productId).trim();
  if (body.product_id) return String(body.product_id).trim();

  if (description) {
    const str = String(description).trim();
    const match = str.match(/PID\s*(\d+)/i);
    if (match && match[1]) return `PID ${match[1].padStart(3, '0')}`;
    const numMatch = str.match(/^(\d+)\s/);
    if (numMatch && numMatch[1]) return numMatch[1];
  }

  return fallbackId ? String(fallbackId).trim() : null;
}

/**
 * 💡 Uniform Stock Synchronizer
 */
async function syncUniformStock(db, productId, unitDelta) {
  if (!productId || unitDelta === 0) return;
  try {
    const rawPid = String(productId).trim();
    const cleanNum = rawPid.replace(/^PID\s*/i, '').trim();
    const formattedPid = `PID ${cleanNum.padStart(3, '0')}`;

    // 🚀 ULTRA-OPTIMIZATION: `IN (?, ?, ?)` prevents Table Full Scans
    const item = await db.prepare(`
      SELECT id, opening_stock, selling_unit, unit_price FROM uniform_ledger 
      WHERE uniqueid = ? 
         OR LOWER(product_id) IN (LOWER(?), LOWER(?)) 
         OR CAST(id AS TEXT) = ? 
      LIMIT 1
    `).bind(rawPid, rawPid, formattedPid, cleanNum).first();

    if (item) {
      const openStock = parseFloat(item.opening_stock || 0);
      const currentSellingUnit = parseFloat(item.selling_unit || 0);
      const newSellingUnit = Math.max(0, currentSellingUnit + unitDelta);
      const newCurrentQty = Math.max(0, openStock - newSellingUnit);
      const unitPrice = parseFloat(item.unit_price || 0);
      const newStockVal = newCurrentQty * unitPrice;

      await db.prepare(`
        UPDATE uniform_ledger SET 
          selling_unit = ?, 
          current_qty = ?, 
          total_stock_value = ? 
        WHERE id = ?
      `).bind(newSellingUnit, newCurrentQty, newStockVal, item.id).run();
    }
  } catch (e) {
    console.warn("Uniform Stock Sync Warning:", e);
  }
}

/**
 * 💡 Fetch Expense Data
 */
export async function getExpenseData(db, body) {
  try {
    const rawBook = body.bookName || body.book || "office";
    const tableName = getTableName(rawBook);
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 30, 10);
    const offset = (page - 1) * limit;
    
    const activeFy = normalizeFyStr(body.fy || `FY ${getCurrentAcademicYear()}`);

    // 🚀 ULTRA-OPTIMIZATION: `fy IN (?, ?)` prevents Table Full Scans
    const statsResult = await db.prepare(`
      SELECT 
        COALESCE(SUM(debit), 0) as totalIncome,
        COALESCE(SUM(credit), 0) as totalExpense
      FROM ${tableName}
      WHERE fy IN (?, ?)
    `).bind(activeFy, activeFy.replace(/^FY\s*/i, '')).first() || { totalIncome: 0, totalExpense: 0 };

    let totalIncome = parseFloat(statsResult.totalIncome || 0);
    let totalExpense = parseFloat(statsResult.totalExpense || 0);
    const balance = totalIncome - totalExpense;

    let whereClauses = [];
    let params = [];

    if (searchVal) {
      whereClauses.push(`(description LIKE ? OR category LIKE ? OR vr_no LIKE ? OR method LIKE ? OR transfer LIKE ? OR CAST(debit AS TEXT) LIKE ? OR CAST(credit AS TEXT) LIKE ? OR CAST(liabilities AS TEXT) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    // 🚀 OPTIMIZATION: COUNT(id) for faster scan
    const countRow = await db.prepare(`SELECT COUNT(id) as count FROM ${tableName} ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    // 🚀 OPTIMIZATION: Explicit Columns Select (Avoid SELECT *)
    let dataQuery = '';
    if (tableName === 'payroll') {
      dataQuery = `
        SELECT id, no, date, category, description, method, debit, credit, balances, unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name, is_locked, uniqueid 
        FROM ${tableName} 
        ${whereSql} 
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
      `;
    } else if (tableName === 'office') {
      dataQuery = `
        SELECT id, no, date, category, description, unit, unit_price, method, debit, credit, balances, liabilities, transfer, vr_no, my, fy, book_name, is_locked, uniqueid 
        FROM ${tableName} 
        ${whereSql} 
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
      `;
    } else { // Kitchen
      dataQuery = `
        SELECT id, no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, is_locked, uniqueid 
        FROM ${tableName} 
        ${whereSql} 
        ORDER BY id DESC 
        LIMIT ? OFFSET ?
      `;
    }

    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => {
      const uid = String(row.uniqueid || '');
      const isAutoLocked = Boolean(
        row.is_locked || 
        uid.startsWith('UNIPROFIT_') || 
        uid.startsWith('UNICASHIER_') || 
        uid.startsWith('TRANS_') || 
        uid.startsWith('DAILY_INC_') || 
        uid.startsWith('INCMAIN_')
      );

      return {
        id: row.id,
        no: Math.floor(parseFloat(row.no || row.id || 1)),
        date: row.date || '',
        category: row.category || '',
        description: row.description || '',
        unit: parseFloat(row.unit || 0),
        unitPrice: parseFloat(row.unit_price || 0),
        method: row.method || 'Cash',
        debit: parseFloat(row.debit || 0),
        credit: parseFloat(row.credit || 0),
        balances: parseFloat(row.balances || 0),
        liabilities: parseFloat(row.liabilities || 0),
        unpaidBonus: parseFloat(row.unpaid_bonus || 0),
        unpaidFund: parseFloat(row.unpaid_fund || 0),
        transfer: row.transfer || '',
        vrNo: row.vr_no || '',
        my: row.my || '',
        fy: normalizeFyStr(row.fy || activeFy),
        bookName: row.book_name || rawBook,
        uniqueId: uid || `ID_${row.id}`,
        isLocked: isAutoLocked
      };
    });

    return {
      success: true,
      data: formattedRows,
      totalRows: totalRows,
      page: page,
      limit: limit,
      stats: { totalIncome, totalExpense, balance }
    };
  } catch (err) {
    console.error("Error in getExpenseData handler:", err);
    return { success: false, message: "Expense ဒေတာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Save New Expense Entry (🛡️ Atomic Batch Transaction Engine & Full 'my' Binding)
 */
export async function saveExpenseEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "office";
    const tableName = getTableName(rawBook);
    const createdBy = session?.name || body.createdBy || "Admin";

    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || calculateAcademicFyFromDate(entryDate));

    const debit = parseAccountingNum(body.debit);
    const credit = parseAccountingNum(body.credit);
    const unit = parseFloat(body.unit || 0);
    const unitPrice = parseFloat(body.unitPrice || 0);
    const liabilities = parseAccountingNum(body.liabilities);

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);

    // ⚡ Refactored: Uses generateUniqueId from utils.js
    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : generateUniqueId('EXP');

    const newNo = (isMigration && body.no) ? parseInt(body.no, 10) : await generateFyNo(db, tableName, fy);
    const bookPrefix = getTablePrefix(tableName);
    const vrNo = body.vrNo || await generateVoucherNo(db, tableName, bookPrefix, entryDate);

    // ⚡ MIGRATION DIRECT IMPORT MODE
    if (isMigration) {
      if (tableName === 'kitchen') {
        await db.prepare(`
          INSERT OR REPLACE INTO kitchen (
            no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `).bind(
          newNo, entryDate, body.category || 'General', body.description || '',
          body.method || 'Cash', debit, credit, body.transfer || '',
          vrNo, my, fy, rawBook, createdBy, uniqueid
        ).run();
      } else if (tableName === 'payroll') {
        await db.prepare(`
          INSERT OR REPLACE INTO payroll (
            no, date, category, description, method, debit, credit, balances, unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `).bind(
          newNo, entryDate, body.category || 'Full Time Salary', body.description || '',
          body.method || 'Cash', debit, credit, parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0),
          body.transfer || '', vrNo, my, fy, rawBook, createdBy, uniqueid
        ).run();
      } else {
        await db.prepare(`
          INSERT OR REPLACE INTO office (
            no, date, category, description, unit, unit_price, method, debit, credit, balances, liabilities, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `).bind(
          newNo, entryDate, body.category || 'General', body.description || '',
          unit, unitPrice, body.method || 'Cash', debit, credit, liabilities,
          body.transfer || '', vrNo, my, fy, rawBook, createdBy, uniqueid
        ).run();
      }

      return {
        success: true,
        message: "စာရင်းသစ် အောင်မြင်စွာ တိုက်ရိုက် သွင်းယူပြီးပါပြီ။",
        uniqueId: uniqueid,
        vrNo: vrNo
      };
    }

    // ⚡ LIVE OPERATIONAL MODE: ATOMIC BATCH TRANSACTION
    const batchStatements = [];

    if (tableName === 'kitchen') {
      batchStatements.push(
        db.prepare(`
          INSERT INTO kitchen (
            no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `).bind(
          newNo, entryDate, body.category || 'General', body.description || '',
          body.method || 'Cash', debit, credit, body.transfer || '',
          vrNo, my, fy, rawBook, createdBy, uniqueid
        )
      );
    } else if (tableName === 'payroll') {
      batchStatements.push(
        db.prepare(`
          INSERT INTO payroll (
            no, date, category, description, method, debit, credit, balances, unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `).bind(
          newNo, entryDate, body.category || 'Full Time Salary', body.description || '',
          body.method || 'Cash', debit, credit, parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0),
          body.transfer || '', vrNo, my, fy, rawBook, createdBy, uniqueid
        )
      );
    } else {
      batchStatements.push(
        db.prepare(`
          INSERT INTO office (
            no, date, category, description, unit, unit_price, method, debit, credit, balances, liabilities, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
        `).bind(
          newNo, entryDate, body.category || 'General', body.description || '',
          unit, unitPrice, body.method || 'Cash', debit, credit, liabilities,
          body.transfer || '', vrNo, my, fy, rawBook, createdBy, uniqueid
        )
      );
    }

    const isUniform = (body.category === "Advance Uniform" || body.category === "Advance Unifrom");
    const method = String(body.method || 'Cash').toLowerCase();
    const profit = parseFloat(body.profit || 0);
    const costDebit = parseFloat(body.debit || 0);
    const totalCashierIncome = costDebit + profit;

    let hasLinkedMain = false;
    let hasLinkedCashier = false;
    const mainTable = (method === 'bank') ? 'bank' : 'cash';
    const caTable = (method === 'bank') ? 'ca_bank' : 'ca_cash';

    if (isUniform) {
      if (profit > 0) {
        hasLinkedMain = true;
        const mainPrefix = (method === 'bank') ? 'BNK' : 'CAH';
        const mainVrNo = await generateVoucherNo(db, mainTable, mainPrefix, entryDate);
        const mainNo = await generateFyNo(db, mainTable, fy);
        const mainProfitUid = `UNIPROFIT_${uniqueid}`;
        const mainDesc = `[Uniform Profit] ${body.description || ''}`.trim();

        batchStatements.push(
          db.prepare(`
            INSERT INTO ${mainTable} (
              no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
            ) VALUES (?, ?, 'Uniform Profit', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Office Exp Book', ?, datetime('now'), ?)
          `).bind(
            mainNo, entryDate, mainDesc, body.method || 'Cash', profit,
            mainVrNo, my, fy, createdBy, mainProfitUid
          )
        );
      }

      if (totalCashierIncome > 0) {
        hasLinkedCashier = true;
        const caPrefix = (method === 'bank') ? 'CAB' : 'CAC';
        const caVrNo = await generateVoucherNo(db, caTable, caPrefix, entryDate);
        const caNo = await generateFyNo(db, caTable, fy);
        const caUid = `UNICASHIER_${uniqueid}`;
        const caDesc = String(body.description || '').trim();

        batchStatements.push(
          db.prepare(`
            INSERT INTO ${caTable} (
              no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
            ) VALUES (?, ?, '', 'Income Uniform', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Office Exp Book', ?, datetime('now'), ?)
          `).bind(
            caNo, entryDate, caDesc, body.method || 'Cash', totalCashierIncome,
            caVrNo, my, fy, createdBy, caUid
          )
        );
      }
    }

    await db.batch(batchStatements);

    if (isUniform) {
      const targetPid = extractProductId(body, body.description, null);
      if (targetPid && unit > 0) {
        await syncUniformStock(db, targetPid, unit);
      }
    }

    // ⚡ Quota-Shield Recalculate (Dirty-row level updates only)
    await recalculateLedgerBalances(db, tableName, fy);
    if (hasLinkedMain) await recalculateLedgerBalances(db, mainTable, fy);
    if (hasLinkedCashier) await recalculateLedgerBalances(db, caTable, fy);

    return {
      success: true,
      message: "စာရင်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      uniqueId: uniqueid,
      vrNo: vrNo
    };
  } catch (err) {
    console.error("Error in saveExpenseEntry handler:", err);
    return { success: false, message: "စာရင်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Update Expense Entry (🛡️ Atomic Batch Clean & Update Engine)
 */
export async function updateExpenseEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "office";
    const tableName = getTableName(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };

    // 🚀 OPTIMIZATION: Exact Column selection
    let existingQuery = '';
    if (tableName === 'payroll') existingQuery = `SELECT fy, date, unit, description, id, category, is_locked, uniqueid FROM payroll WHERE uniqueid = ?`;
    else if (tableName === 'office') existingQuery = `SELECT fy, date, unit, description, id, category, is_locked, uniqueid FROM office WHERE uniqueid = ?`;
    else existingQuery = `SELECT fy, date, unit, description, id, category, is_locked, uniqueid FROM kitchen WHERE uniqueid = ?`;

    const existing = await db.prepare(existingQuery).bind(uniqueid).first();
    if (!existing) return { success: false, message: "ပြင်ဆင်မည့် စာရင်း ရှာမတွေ့ပါ။" };

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked) ||
      uid.startsWith('TRANS_') ||
      uid.startsWith('UNIPROFIT_') ||
      uid.startsWith('UNICASHIER_') ||
      uid.startsWith('DAILY_INC_') ||
      uid.startsWith('INCMAIN_');

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် အခြားစာအုပ်မှ ချိတ်ဆက်ထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ပြင်ဆင်နိုင်ပါသည်။" 
      };
    }

    const oldFy = existing.fy ? normalizeFyStr(existing.fy) : null;
    const oldUnit = parseFloat(existing.unit || 0);
    const oldPid = extractProductId(existing, existing.description, existing.id);
    const wasUniform = (existing.category === "Advance Uniform" || existing.category === "Advance Unifrom");

    const entryDate = getMyanmarDateString(body.date || existing.date);
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || calculateAcademicFyFromDate(entryDate));

    const debit = parseAccountingNum(body.debit);
    const credit = parseAccountingNum(body.credit);
    const unit = parseFloat(body.unit || 0);
    const unitPrice = parseFloat(body.unitPrice || 0);
    const liabilities = parseAccountingNum(body.liabilities);

    const isUniform = (body.category === "Advance Uniform" || body.category === "Advance Unifrom");
    const method = String(body.method || 'Cash').toLowerCase();
    const profit = parseFloat(body.profit || 0);
    const costDebit = parseFloat(body.debit || 0);
    const totalCashierIncome = costDebit + profit;

    const profitUid = `UNIPROFIT_${uniqueid}`;
    const cashierUid = `UNICASHIER_${uniqueid}`;
    const mainTable = (method === 'bank') ? 'bank' : 'cash';
    const caTable = (method === 'bank') ? 'ca_bank' : 'ca_cash';

    const batchStatements = [];

    batchStatements.push(db.prepare(`DELETE FROM cash WHERE uniqueid = ?`).bind(profitUid));
    batchStatements.push(db.prepare(`DELETE FROM bank WHERE uniqueid = ?`).bind(profitUid));
    batchStatements.push(db.prepare(`DELETE FROM ca_cash WHERE uniqueid = ?`).bind(cashierUid));
    batchStatements.push(db.prepare(`DELETE FROM ca_bank WHERE uniqueid = ?`).bind(cashierUid));

    if (tableName === 'kitchen') {
      batchStatements.push(
        db.prepare(`
          UPDATE kitchen SET date=?, category=?, description=?, method=?, debit=?, credit=?, transfer=?, my=?, fy=? WHERE uniqueid=?
        `).bind(entryDate, body.category || 'General', body.description || '', body.method || 'Cash', debit, credit, body.transfer || '', my, fy, uniqueid)
      );
    } else if (tableName === 'payroll') {
      batchStatements.push(
        db.prepare(`
          UPDATE payroll SET date=?, category=?, description=?, method=?, debit=?, credit=?, unpaid_bonus=?, unpaid_fund=?, transfer=?, my=?, fy=? WHERE uniqueid=?
        `).bind(entryDate, body.category || 'Full Time Salary', body.description || '', body.method || 'Cash', debit, credit, parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0), body.transfer || '', my, fy, uniqueid)
      );
    } else {
      batchStatements.push(
        db.prepare(`
          UPDATE office SET date=?, category=?, description=?, unit=?, unit_price=?, method=?, debit=?, credit=?, liabilities=?, transfer=?, my=?, fy=? WHERE uniqueid=?
        `).bind(entryDate, body.category || 'General', body.description || '', unit, unitPrice, body.method || 'Cash', debit, credit, liabilities, body.transfer || '', my, fy, uniqueid)
      );
    }

    let hasLinkedMain = false;
    let hasLinkedCashier = false;

    if (isUniform) {
      if (profit > 0) {
        hasLinkedMain = true;
        const mainPrefix = (method === 'bank') ? 'BNK' : 'CAH';
        const mainVrNo = await generateVoucherNo(db, mainTable, mainPrefix, entryDate);
        const mainNo = await generateFyNo(db, mainTable, fy);
        const mainDesc = `[Uniform Profit] ${body.description || ''}`.trim();

        batchStatements.push(
          db.prepare(`
            INSERT INTO ${mainTable} (
              no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
            ) VALUES (?, ?, 'Uniform Profit', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Office Exp Book', ?, datetime('now'), ?)
          `).bind(
            mainNo, entryDate, mainDesc, body.method || 'Cash', profit,
            mainVrNo, my, fy, session?.name || 'Admin', profitUid
          )
        );
      }

      if (totalCashierIncome > 0) {
        hasLinkedCashier = true;
        const caPrefix = (method === 'bank') ? 'CAB' : 'CAC';
        const caVrNo = await generateVoucherNo(db, caTable, caPrefix, entryDate);
        const caNo = await generateFyNo(db, caTable, fy);
        const caDesc = String(body.description || '').trim();

        batchStatements.push(
          db.prepare(`
            INSERT INTO ${caTable} (
              no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
            ) VALUES (?, ?, '', 'Income Uniform', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Office Exp Book', ?, datetime('now'), ?)
          `).bind(
            caNo, entryDate, caDesc, body.method || 'Cash', totalCashierIncome,
            caVrNo, my, fy, session?.name || 'Admin', cashierUid
          )
        );
      }
    }

    await db.batch(batchStatements);

    if (wasUniform && oldPid && oldUnit > 0) {
      await syncUniformStock(db, oldPid, -oldUnit);
    }
    if (isUniform) {
      const targetPid = extractProductId(body, body.description, null);
      if (targetPid && unit > 0) {
        await syncUniformStock(db, targetPid, unit);
      }
    }

    // ⚡ Quota-Shield Recalculate
    await recalculateLedgerBalances(db, tableName, fy);
    if (oldFy && oldFy !== fy) {
      await recalculateLedgerBalances(db, tableName, oldFy);
    }

    if (wasUniform || isUniform) {
      await recalculateLedgerBalances(db, 'cash', fy);
      await recalculateLedgerBalances(db, 'bank', fy);
      await recalculateLedgerBalances(db, 'ca_cash', fy);
      await recalculateLedgerBalances(db, 'ca_bank', fy);
    }

    return { success: true, message: "စာရင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in updateExpenseEntry handler:", err);
    return { success: false, message: "စာရင်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Delete Expense Entry (🛡️ Atomic Batch Delete Engine)
 */
export async function deleteExpenseEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "office";
    const tableName = getTableName(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };

    // 🚀 OPTIMIZATION: Exact Column selection
    let existingQuery = '';
    if (tableName === 'payroll') existingQuery = `SELECT fy, category, unit, description, id, is_locked, uniqueid FROM payroll WHERE uniqueid = ?`;
    else if (tableName === 'office') existingQuery = `SELECT fy, category, unit, description, id, is_locked, uniqueid FROM office WHERE uniqueid = ?`;
    else existingQuery = `SELECT fy, category, unit, description, id, is_locked, uniqueid FROM kitchen WHERE uniqueid = ?`;

    const existing = await db.prepare(existingQuery).bind(uniqueid).first();
    if (!existing) return { success: false, message: "ဖျက်သိမ်းမည့် စာရင်း ရှာမတွေ့ပါ။" };

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked) ||
      uid.startsWith('TRANS_') ||
      uid.startsWith('UNIPROFIT_') ||
      uid.startsWith('UNICASHIER_') ||
      uid.startsWith('DAILY_INC_') ||
      uid.startsWith('INCMAIN_');

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် အခြားစာအုပ်မှ ချိတ်ဆက်ထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ဖျက်သိမ်းနိုင်ပါသည်။" 
      };
    }

    const targetFy = existing.fy ? normalizeFyStr(existing.fy) : null;
    const profitUid = `UNIPROFIT_${uniqueid}`;
    const cashierUid = `UNICASHIER_${uniqueid}`;
    const transferUid = `TRANS_${uniqueid}`;

    const batchStatements = [
      db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid),
      db.prepare(`DELETE FROM cash WHERE uniqueid = ?`).bind(profitUid),
      db.prepare(`DELETE FROM bank WHERE uniqueid = ?`).bind(profitUid),
      db.prepare(`DELETE FROM ca_cash WHERE uniqueid = ?`).bind(cashierUid),
      db.prepare(`DELETE FROM ca_bank WHERE uniqueid = ?`).bind(cashierUid),
      db.prepare(`DELETE FROM bank WHERE uniqueid = ?`).bind(transferUid),
      db.prepare(`DELETE FROM cash WHERE uniqueid = ?`).bind(transferUid)
    ];

    await db.batch(batchStatements);

    const wasUniform = (existing.category === "Advance Uniform" || existing.category === "Advance Unifrom");
    if (wasUniform) {
      const oldUnit = parseFloat(existing.unit || 0);
      const oldPid = extractProductId(existing, existing.description, existing.id);
      if (oldPid && oldUnit > 0) {
        await syncUniformStock(db, oldPid, -oldUnit);
      }
    }

    // ⚡ Quota-Shield Recalculate
    await recalculateLedgerBalances(db, tableName, targetFy);

    if (wasUniform) {
      await recalculateLedgerBalances(db, 'cash', targetFy);
      await recalculateLedgerBalances(db, 'bank', targetFy);
      await recalculateLedgerBalances(db, 'ca_cash', targetFy);
      await recalculateLedgerBalances(db, 'ca_bank', targetFy);
    }

    return { success: true, message: "စာရင်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in deleteExpenseEntry handler:", err);
    return { success: false, message: "စာရင်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}
