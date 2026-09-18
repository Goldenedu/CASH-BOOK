/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - MAIN BANK & CASH BOOKS HANDLER (CLOUDFLARE D1)
 * File: handlers-bank-cash.js (Location: cashbook-api/handlers-bank-cash.js)
 * 💡 Features: Refactored with utils.js for DRY Principle,
 *              🚀 OPTIMIZED: Aggregations natively in SQL (SUM/COUNT), Avoided SELECT *
 * ==============================================================================
 */

import {
  getMyanmarDateString,
  calculateAcademicFyFromDate,
  normalizeFyStr,
  generateVoucherNo,
  generateFyNo,
  recalculateLedgerBalances,
  generateUniqueId,
  getCurrentAcademicYear
} from './utils.js';

const BOOK_TABLE_MAP = {
  "bank": "bank",
  "main bank book": "bank",
  "cash": "cash",
  "main cash book": "cash",
  "office": "office",
  "office exp book": "office",
  "kitchen": "kitchen",
  "kitchen exp book": "kitchen",
  "payroll": "payroll",
  "hr payroll exp book": "payroll"
};

function getTableName(rawBook) {
  if (!rawBook) return "cash";
  const key = String(rawBook).trim().toLowerCase();
  return BOOK_TABLE_MAP[key] || "cash";
}

function getTablePrefix(tableName) {
  switch (tableName) {
    case 'bank': return 'BNK';
    case 'cash': return 'CAH';
    case 'office': return 'OFF';
    case 'kitchen': return 'KIT';
    case 'payroll': return 'SAL';
    default: return 'BCK';
  }
}

/**
 * 💡 Table Name -> Human-Readable Book Title
 */
function getBookTitle(tableName) {
  switch (tableName) {
    case 'bank': return 'Main Bank Book';
    case 'cash': return 'Main Cash Book';
    case 'office': return 'Office Exp Book';
    case 'kitchen': return 'Kitchen Exp Book';
    case 'payroll': return 'HR Payroll Exp Book';
    default: return tableName;
  }
}

/**
 * 💡 Target Transfer Statement Factory
 */
async function createTargetTransferStatement(db, body, sourceTable, targetTable, entryDate, my, normFy, createdBy, transferUid) {
  const debit = parseFloat(body.debit || 0);
  const credit = parseFloat(body.credit || 0);

  const targetDebit = credit;
  const targetCredit = debit;

  const targetPrefix = getTablePrefix(targetTable);
  const targetVrNo = await generateVoucherNo(db, targetTable, targetPrefix, entryDate);
  const targetNo = await generateFyNo(db, targetTable, normFy);
  const sourceBookTitle = getBookTitle(sourceTable);
  const targetBookTitle = getBookTitle(targetTable);
  const targetDesc = `[Transfer from ${sourceBookTitle}] ${body.description || ''}`.trim();

  if (targetTable === 'office') {
    return db.prepare(`
      INSERT INTO office (
        no, date, category, description, unit, unit_price, method, debit, credit, balances, liabilities, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, 'Transfer', ?, 0, 0, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).bind(
      targetNo, entryDate, targetDesc, body.method || 'Cash',
      targetDebit, targetCredit, sourceBookTitle, targetVrNo, my, normFy,
      targetBookTitle, createdBy, transferUid
    );
  } else if (targetTable === 'payroll') {
    return db.prepare(`
      INSERT INTO payroll (
        no, date, category, description, method, debit, credit, balances, unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, 'Transfer', ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).bind(
      targetNo, entryDate, targetDesc, body.method || 'Cash',
      targetDebit, targetCredit, sourceBookTitle, targetVrNo, my, normFy,
      targetBookTitle, createdBy, transferUid
    );
  } else {
    return db.prepare(`
      INSERT INTO ${targetTable} (
        no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, 'Transfer', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).bind(
      targetNo, entryDate, targetDesc, body.method || 'Cash',
      targetDebit, targetCredit, sourceBookTitle, targetVrNo, my, normFy,
      targetBookTitle, createdBy, transferUid
    );
  }
}

/**
 * 💡 Fetch Main Bank & Cash Data
 */
export async function getBankCashData(db, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 30, 10); // Default to 30, though FE requests 2000 for Search
    const offset = (page - 1) * limit;

    // Zero Hardcoding FY
    const activeFy = normalizeFyStr(body.fy || `FY ${getCurrentAcademicYear()}`);
    const fyClean = activeFy.replace(/^FY\s*/i, '');

    // 🚀 OPTIMIZATION 1: Fetch Aggregate Totals directly from SQL
    const statsResult = await db.prepare(`
      SELECT 
        COALESCE(SUM(debit), 0) as totalIncome,
        COALESCE(SUM(credit), 0) as totalExpense
      FROM ${tableName}
      WHERE fy = ? OR fy = ?
    `).bind(activeFy, fyClean).first() || { totalIncome: 0, totalExpense: 0 };

    let totalIncome = parseFloat(statsResult.totalIncome || 0);
    let totalExpense = parseFloat(statsResult.totalExpense || 0);

    // Fallback logic if FY is empty (Legacy Mode Support)
    if (totalIncome === 0 && totalExpense === 0) {
      const allStats = await db.prepare(`
        SELECT 
          COALESCE(SUM(debit), 0) as totalIncome,
          COALESCE(SUM(credit), 0) as totalExpense
        FROM ${tableName}
      `).first() || { totalIncome: 0, totalExpense: 0 };
      totalIncome = parseFloat(allStats.totalIncome || 0);
      totalExpense = parseFloat(allStats.totalExpense || 0);
    }

    const balance = totalIncome - totalExpense;

    let whereClauses = [];
    let params = [];

    // Search Logic implementation (Allows cross-fy search if fy is omitted or search explicitly provided)
    if (searchVal) {
      whereClauses.push(`(description LIKE ? OR category LIKE ? OR CAST(debit AS TEXT) LIKE ? OR CAST(credit AS TEXT) LIKE ? OR vr_no LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 🚀 OPTIMIZATION 2: Row Count explicitly via SQL
    const countRow = await db.prepare(`SELECT COUNT(id) as count FROM ${tableName} ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    // 🚀 OPTIMIZATION 3: Explicit Columns Select
    const dataQuery = `
      SELECT id, no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, is_locked, uniqueid 
      FROM ${tableName} 
      ${whereSql} 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => {
      const uid = String(row.uniqueid || row.uniqueId || '');
      const isAutoLocked = Boolean(
        row.is_locked || 
        row.isLocked || 
        uid.startsWith('UNIPROFIT_') || 
        uid.startsWith('UNICASHIER_') || 
        uid.startsWith('TRANS_') || 
        uid.startsWith('DAILY_INC_')
      );

      return {
        id: row.id,
        no: Math.floor(parseFloat(row.no || row.id || 1)),
        date: row.date || '',
        category: row.category || '',
        description: row.description || '',
        method: row.method || (tableName === 'bank' ? 'Bank' : 'Cash'),
        debit: parseFloat(row.debit || 0),
        credit: parseFloat(row.credit || 0),
        balances: parseFloat(row.balances || 0),
        transfer: row.transfer || '',
        vrNo: row.vr_no || row.vrNo || '',
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
      stats: {
        totalIncome: totalIncome,
        totalExpense: totalExpense,
        balance: balance
      }
    };
  } catch (err) {
    console.error("Error in getBankCashData handler:", err);
    return {
      success: false,
      message: "Bank/Cash စာရင်း ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Save Bank / Cash Entry
 */
export async function saveBankCashEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const createdBy = session?.name || body.createdBy || "Admin";

    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || calculateAcademicFyFromDate(entryDate));

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);

    // ⚡ Refactored: Uses generateUniqueId from utils.js
    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : generateUniqueId('BCK');

    const newNo = (isMigration && body.no) ? parseInt(body.no, 10) : await generateFyNo(db, tableName, fy);
    const prefix = getTablePrefix(tableName);
    const vrNo = body.vrNo || await generateVoucherNo(db, tableName, prefix, entryDate);

    // ⚡ MIGRATION DIRECT IMPORT MODE
    if (isMigration) {
      await db.prepare(`
        INSERT OR REPLACE INTO ${tableName} (
          no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      `).bind(
        newNo, entryDate, body.category || 'Income', body.description || '',
        body.method || (tableName === 'bank' ? 'Bank' : 'Cash'), debit, credit,
        body.transfer || '', vrNo, my, fy, rawBook, createdBy, uniqueid
      ).run();

      return {
        success: true,
        message: "စာရင်းသစ် အောင်မြင်စွာ တိုက်ရိုက် သွင်းယူပြီးပါပြီ။",
        uniqueId: uniqueid,
        vrNo: vrNo
      };
    }

    // ⚡ LIVE OPERATIONAL MODE: D1 ATOMIC BATCH TRANSACTION
    const batchStatements = [];

    batchStatements.push(
      db.prepare(`
        INSERT INTO ${tableName} (
          no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      `).bind(
        newNo, entryDate, body.category || 'Income', body.description || '',
        body.method || (tableName === 'bank' ? 'Bank' : 'Cash'), debit, credit,
        body.transfer || '', vrNo, my, fy, rawBook, createdBy, uniqueid
      )
    );

    const isTransfer = String(body.category || '').trim() === 'Transfer' && body.transfer;
    let targetTable = null;

    if (isTransfer) {
      targetTable = getTableName(body.transfer);
      if (targetTable !== tableName) {
        const transferUid = `TRANS_${uniqueid}`;
        const targetStmt = await createTargetTransferStatement(
          db, body, tableName, targetTable, entryDate, my, fy, createdBy, transferUid
        );
        batchStatements.push(targetStmt);
      }
    }

    await db.batch(batchStatements);

    // ⚡ Quota-Shield Recalculate
    await recalculateLedgerBalances(db, tableName, fy);
    if (targetTable && targetTable !== tableName) {
      await recalculateLedgerBalances(db, targetTable, fy);
    }

    return {
      success: true,
      message: "စာရင်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      uniqueId: uniqueid,
      vrNo: vrNo
    };
  } catch (err) {
    console.error("Error in saveBankCashEntry handler:", err);
    return {
      success: false,
      message: "စာရင်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Update Bank / Cash Entry
 */
export async function updateBankCashEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const existing = await db.prepare(`SELECT * FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) {
      return { success: false, message: "ပြင်ဆင်မည့် စာရင်း ရှာမတွေ့ပါ။" };
    }

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) ||
      uid.startsWith('TRANS_') ||
      uid.startsWith('UNIPROFIT_') ||
      uid.startsWith('UNICASHIER_') ||
      uid.startsWith('DAILY_INC_');

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');

    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် အခြားစာအုပ်မှ လွှဲပြောင်းထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ပြင်ဆင်နိုင်ပါသည်။" 
      };
    }

    const oldFy = existing.fy ? normalizeFyStr(existing.fy) : null;
    const transferUid = `TRANS_${uniqueid}`;

    const entryDate = getMyanmarDateString(body.date || existing.date);
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || calculateAcademicFyFromDate(entryDate));

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);

    const batchStatements = [];

    const tables = ['bank', 'cash', 'office', 'kitchen', 'payroll'];
    for (const tbl of tables) {
      batchStatements.push(
        db.prepare(`DELETE FROM ${tbl} WHERE uniqueid = ?`).bind(transferUid)
      );
    }

    batchStatements.push(
      db.prepare(`
        UPDATE ${tableName} SET
          date = ?, category = ?, description = ?, method = ?, debit = ?, credit = ?,
          transfer = ?, my = ?, fy = ?
        WHERE uniqueid = ?
      `).bind(
        entryDate, body.category || 'Income', body.description || '',
        body.method || (tableName === 'bank' ? 'Bank' : 'Cash'), debit, credit,
        body.transfer || '', my, fy, uniqueid
      )
    );

    const isTransfer = String(body.category || '').trim() === 'Transfer' && body.transfer;
    let targetTable = null;

    if (isTransfer) {
      targetTable = getTableName(body.transfer);
      if (targetTable !== tableName) {
        const targetStmt = await createTargetTransferStatement(
          db, body, tableName, targetTable, entryDate, my, fy, session?.name || 'Admin', transferUid
        );
        batchStatements.push(targetStmt);
      }
    }

    await db.batch(batchStatements);

    // ⚡ Quota-Shield Recalculate
    await recalculateLedgerBalances(db, tableName, fy);
    if (oldFy && oldFy !== fy) {
      await recalculateLedgerBalances(db, tableName, oldFy);
    }

    if (targetTable && targetTable !== tableName) {
      await recalculateLedgerBalances(db, targetTable, fy);
    }

    return {
      success: true,
      message: "စာရင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in updateBankCashEntry handler:", err);
    return {
      success: false,
      message: "စာရင်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Delete Bank / Cash Entry
 */
export async function deleteBankCashEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const existing = await db.prepare(`SELECT * FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) {
      return { success: false, message: "ဖျက်သိမ်းမည့် စာရင်း ရှာမတွေ့ပါ။" };
    }

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) ||
      uid.startsWith('TRANS_') ||
      uid.startsWith('UNIPROFIT_') ||
      uid.startsWith('UNICASHIER_') ||
      uid.startsWith('DAILY_INC_');

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');

    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် အခြားစာအုပ်မှ လွှဲပြောင်းထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ဖျက်သိမ်းနိုင်ပါသည်။" 
      };
    }

    const targetFy = existing.fy ? normalizeFyStr(existing.fy) : null;
    const transferUid = `TRANS_${uniqueid}`;

    const batchStatements = [
      db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid),
      db.prepare(`DELETE FROM bank WHERE uniqueid = ?`).bind(transferUid),
      db.prepare(`DELETE FROM cash WHERE uniqueid = ?`).bind(transferUid),
      db.prepare(`DELETE FROM office WHERE uniqueid = ?`).bind(transferUid),
      db.prepare(`DELETE FROM kitchen WHERE uniqueid = ?`).bind(transferUid),
      db.prepare(`DELETE FROM payroll WHERE uniqueid = ?`).bind(transferUid)
    ];

    await db.batch(batchStatements);

    await recalculateLedgerBalances(db, tableName, targetFy);

    if (existing.transfer) {
      const linkedTable = getTableName(existing.transfer);
      if (linkedTable && linkedTable !== tableName) {
        await recalculateLedgerBalances(db, linkedTable, targetFy);
      }
    }

    return {
      success: true,
      message: "စာရင်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in deleteBankCashEntry handler:", err);
    return {
      success: false,
      message: "စာရင်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}
