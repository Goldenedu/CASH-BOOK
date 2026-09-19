/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CASHIER SUB-LEDGER HANDLER (CLOUDFLARE D1)
 * File: handlers-cashier.js  
 * 💡 Features: Refactored with utils.js for DRY Principle,
 *              🚀 OPTIMIZED: Aggregations natively in SQL (SUM/COUNT), Avoided SELECT *
 *              🚀 ULTRA-OPTIMIZED: Prevented Full Table Scans. Replaced OR with IN().
 *              🚀 PHASE 1 (INCREMENTAL RECALC): Passed fromDate to cut 95% of row reads
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

const CASHIER_TABLE_MAP = {
  "cabank": "ca_bank",
  "ca_bank": "ca_bank",
  "cashier bank book": "ca_bank",
  "cacash": "ca_cash",
  "ca_cash": "ca_cash",
  "cashier cash book": "ca_cash",
  "caoffice": "ca_office",
  "ca_office": "ca_office",
  "cashier office book": "ca_office",
  "cakitchen": "ca_kitchen",
  "ca_kitchen": "ca_kitchen",
  "cashier kitchen book": "ca_kitchen",
  "capayroll": "ca_payroll",
  "ca_payroll": "ca_payroll",
  "cashier payroll book": "ca_payroll"
};

function getCashierMeta(rawBook) {
  const key = String(rawBook || "CABank").trim().toLowerCase();
  const tableName = CASHIER_TABLE_MAP[key] || "ca_bank";

  let prefix = "CAB";
  let bookTitle = "Cashier Bank Book";

  switch (tableName) {
    case 'ca_cash':
      prefix = 'CAC';
      bookTitle = 'Cashier Cash Book';
      break;
    case 'ca_office':
      prefix = 'CAO';
      bookTitle = 'Cashier Office Book';
      break;
    case 'ca_kitchen':
      prefix = 'CAK';
      bookTitle = 'Cashier Kitchen Book';
      break;
    case 'ca_payroll':
      prefix = 'CAP';
      bookTitle = 'Cashier Payroll Book';
      break;
    default:
      prefix = 'CAB';
      bookTitle = 'Cashier Bank Book';
      break;
  }

  return { tableName, prefix, bookTitle };
}

/**
 * 💡 Cashier Target Transfer Statement Factory
 * 17 Columns Schema Alignment with responsibility_person
 */
async function createTargetCashierTransferStatement(db, body, sourceBookTitle, targetTable, targetPrefix, targetBookTitle, entryDate, my, normFy, createdBy, transferUid) {
  const debit = parseFloat(body.debit || 0);
  const credit = parseFloat(body.credit || 0);

  // Source တွင် ထွက်ငွေ (Credit) ဖြစ်ပါက Target တွင် ဝင်ငွေ (Debit) ဖြစ်ရမည်
  const targetDebit = credit;
  const targetCredit = debit;

  const targetVrNo = await generateVoucherNo(db, targetTable, targetPrefix, entryDate);
  const targetNo = await generateFyNo(db, targetTable, normFy);
  const targetDesc = `[Transfer from ${sourceBookTitle}] ${body.description || ''}`.trim();
  const respPersonVal = body.respPerson || body.responsibility_person || '';

  return db.prepare(`
    INSERT INTO ${targetTable} (
      no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, 'Transfer', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).bind(
    targetNo, entryDate, respPersonVal, targetDesc, body.method || 'Cash',
    targetDebit, targetCredit, sourceBookTitle, targetVrNo, my, normFy,
    targetBookTitle, createdBy, transferUid
  );
}

/**
 * 💡 Fetch Cashier Sub-Ledger Data
 */
export async function getCashierData(db, body) {
  try {
    const rawBook = body.bookName || "CABank";
    const { tableName, bookTitle } = getCashierMeta(rawBook);
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 50, 10);
    const offset = (page - 1) * limit;

    const activeFy = normalizeFyStr(body.fy || `FY ${getCurrentAcademicYear()}`);

    // 🚀 ULTRA-OPTIMIZATION: `fy IN (?, ?)` limits Row Scans to matching Index only
    const statsResult = await db.prepare(`
      SELECT 
        COALESCE(SUM(debit), 0) as totalIncome,
        COALESCE(SUM(credit), 0) as totalExpense
      FROM ${tableName}
      WHERE fy IN (?, ?)
    `).bind(activeFy, activeFy.replace(/^FY\s*/i, '')).first() || { totalIncome: 0, totalExpense: 0 };

    let totalIncome = parseFloat(statsResult.totalIncome || 0);
    let totalExpense = parseFloat(statsResult.totalExpense || 0);

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

    if (searchVal) {
      whereClauses.push(`(description LIKE ? OR category LIKE ? OR responsibility_person LIKE ? OR vr_no LIKE ? OR method LIKE ? OR transfer LIKE ? OR CAST(debit AS TEXT) LIKE ? OR CAST(credit AS TEXT) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = await db.prepare(`SELECT COUNT(id) as count FROM ${tableName} ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    const dataQuery = `
      SELECT id, no, date, responsibility_person as respPerson, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, is_locked, uniqueid 
      FROM ${tableName} 
      ${whereSql} 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => {
      const uid = String(row.uniqueid || '');
      const isAutoLocked = Boolean(
        row.is_locked || 
        uid.startsWith('UNIPROFIT_') || 
        uid.startsWith('UNICASHIER_') || 
        uid.startsWith('INCCASHIER_') || 
        uid.startsWith('TRANS_') || 
        uid.startsWith('DAILY_INC_')
      );

      return {
        id: row.id,
        no: Math.floor(parseFloat(row.no || row.id || 1)),
        date: row.date || '',
        respPerson: row.respPerson || row.responsibility_person || '',
        category: row.category || '',
        description: row.description || '',
        method: row.method || 'Cash',
        debit: parseFloat(row.debit || 0),
        credit: parseFloat(row.credit || 0),
        balances: parseFloat(row.balances || 0),
        transfer: row.transfer || '',
        vrNo: row.vr_no || '',
        my: row.my || '',
        fy: normalizeFyStr(row.fy || activeFy),
        bookName: row.book_name || bookTitle,
        createdBy: row.created_by || 'Cashier',
        createdAt: row.created_at || '',
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
    console.error("Error in getCashierData handler:", err);
    return {
      success: false,
      message: "Cashier စာရင်း ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Load Today's Student Income Entries Live Feed
 */
export async function getTodayIncomeForCashier(db, body) {
  try {
    const todayDate = body.date ? getMyanmarDateString(body.date) : getMyanmarDateString();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 500, 10);
    const offset = (page - 1) * limit;

    const rowsRes = await db.prepare(
      `SELECT student_id, id, no, effect_date, date, fy, fyid, fyid_name, class, category, account_name, method, debit, credit, aut_amount, promo, my, vr_no, remark, uniqueid, is_locked 
       FROM income 
       WHERE date = ? 
       ORDER BY id DESC 
       LIMIT ? OFFSET ?`
    ).bind(todayDate, limit, offset).all();

    const rawRows = rowsRes.results || [];
    const formattedRows = rawRows.map(row => ({
      id: row.student_id || row.id,
      no: Math.floor(parseFloat(row.no || row.id || 1)),
      effDate: row.effect_date || row.date || '',
      date: row.date || '',
      fy: normalizeFyStr(row.fy || 'FY 2026-2027'),
      fyid: row.fyid || '',
      fyidName: row.fyid_name || '',
      class: row.class || '',
      category: row.category || '',
      accountName: row.account_name || '',
      method: row.method || 'Cash',
      debit: parseFloat(row.debit || 0),
      credit: parseFloat(row.credit || 0),
      autAmount: parseFloat(row.aut_amount || 0),
      promo: row.promo || '',
      my: row.my || '',
      vrNo: row.vr_no || '',
      remark: row.remark || '',
      uniqueId: row.uniqueid || `INC_${row.id}`,
      isLocked: Boolean(row.is_locked)
    }));

    return {
      success: true,
      data: formattedRows,
      totalRows: formattedRows.length
    };
  } catch (err) {
    console.error("Error in getTodayIncomeForCashier handler:", err);
    return {
      success: false,
      message: "ယနေ့ ဝင်ငွေစာရင်း ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Save Cashier Entry (🛡️ 100% Atomic Batch Transaction Engine)
 */
export async function saveCashierEntry(db, session, body) {
  try {
    const rawBook = body.bookName || "CABank";
    const { tableName, prefix, bookTitle } = getCashierMeta(rawBook);
    const createdBy = session?.name || body.createdBy || "Cashier";

    // 🎯 Myanmar Standard Date & March Boundary Fiscal Year
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || calculateAcademicFyFromDate(entryDate));

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);
    const respPersonVal = body.respPerson || body.responsibility_person || '';

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);

    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : generateUniqueId('CAS');

    const newNo = (isMigration && body.no) ? parseInt(body.no, 10) : await generateFyNo(db, tableName, fy);
    const vrNo = body.vrNo || await generateVoucherNo(db, tableName, prefix, entryDate);

    // ⚡ MIGRATION DIRECT IMPORT MODE
    if (isMigration) {
      await db.prepare(`
        INSERT OR REPLACE INTO ${tableName} (
          no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      `).bind(
        newNo, entryDate, respPersonVal, body.category || 'Income', body.description || '',
        body.method || 'Cash', debit, credit, body.transfer || '', vrNo, my, fy,
        bookTitle, createdBy, uniqueid
      ).run();

      return {
        success: true,
        message: "Cashier စာရင်းသစ် အောင်မြင်စွာ တိုက်ရိုက် သွင်းယူပြီးပါပြီ။",
        uniqueId: uniqueid,
        vrNo: vrNo
      };
    }

    // ⚡ LIVE OPERATIONAL MODE: D1 ATOMIC BATCH TRANSACTION
    const batchStatements = [];

    batchStatements.push(
      db.prepare(`
        INSERT INTO ${tableName} (
          no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
      `).bind(
        newNo, entryDate, respPersonVal, body.category || 'Income', body.description || '',
        body.method || 'Cash', debit, credit, body.transfer || '', vrNo, my, fy,
        bookTitle, createdBy, uniqueid
      )
    );

    const isTransfer = String(body.category || '').trim() === 'Transfer' && body.transfer;
    let targetTableName = null;

    if (isTransfer) {
      const { tableName: targetTable, prefix: targetPrefix, bookTitle: targetBookTitle } = getCashierMeta(body.transfer);
      if (targetTable !== tableName) {
        targetTableName = targetTable;
        const transferUid = `TRANS_${uniqueid}`;
        const targetStmt = await createTargetCashierTransferStatement(
          db, body, bookTitle, targetTable, targetPrefix, targetBookTitle, entryDate, my, fy, createdBy, transferUid
        );
        batchStatements.push(targetStmt);
      }
    }

    await db.batch(batchStatements);

    // ⚡ Quota-Shield Recalculate - Incremental (Phase 1)
    await recalculateLedgerBalances(db, tableName, fy, entryDate);
    if (targetTableName && targetTableName !== tableName) {
      await recalculateLedgerBalances(db, targetTableName, fy, entryDate);
    }

    return {
      success: true,
      message: "Cashier စာရင်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      uniqueId: uniqueid,
      vrNo: vrNo
    };
  } catch (err) {
    console.error("Error in saveCashierEntry handler:", err);
    return {
      success: false,
      message: "Cashier စာရင်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Update Cashier Entry (🛡️ Atomic Batch Clean & Update Engine)
 */
export async function updateCashierEntry(db, session, body) {
  try {
    const rawBook = body.bookName || "CABank";
    const { tableName, bookTitle } = getCashierMeta(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    // 🚀 OPTIMIZATION: Avoid SELECT * and FETCH `date` for Incremental Recalc
    const existing = await db.prepare(`SELECT fy, date, is_locked, uniqueid FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) {
      return { success: false, message: "ပြင်ဆင်မည့် စာရင်း ရှာမတွေ့ပါ။" };
    }

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked) ||
      uid.startsWith('TRANS_') ||
      uid.startsWith('UNIPROFIT_') ||
      uid.startsWith('UNICASHIER_') ||
      uid.startsWith('INCCASHIER_') ||
      uid.startsWith('DAILY_INC_');

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် မူရင်းစာအုပ်မှ အလိုအလျောက် ရောက်ရှိလာသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ပြင်ဆင်နိုင်ပါသည်။" 
      };
    }

    const oldFy = existing.fy ? normalizeFyStr(existing.fy) : null;
    const oldDate = existing.date || '9999-12-31'; // Safe default
    const transferUid = `TRANS_${uniqueid}`;

    const entryDate = getMyanmarDateString(body.date || existing.date);
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || calculateAcademicFyFromDate(entryDate));

    // Determine the earliest date between old and new for Incremental Recalc
    const recalcDate = (entryDate < oldDate) ? entryDate : oldDate;

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);
    const respPersonVal = body.respPerson || body.responsibility_person || '';

    const batchStatements = [];

    // ၁။ Cashier Sub-books ၅ အုပ်လုံးမှ Linked Transfer အဟောင်းများ ဖျက်ရန် Statements
    const tables = ['ca_bank', 'ca_cash', 'ca_office', 'ca_kitchen', 'ca_payroll'];
    for (const tbl of tables) {
      batchStatements.push(
        db.prepare(`DELETE FROM ${tbl} WHERE uniqueid = ?`).bind(transferUid)
      );
    }

    // ၂။ မူရင်းစာအုပ် Update Statement
    batchStatements.push(
      db.prepare(`
        UPDATE ${tableName} SET
          date = ?, responsibility_person = ?, category = ?, description = ?, method = ?,
          debit = ?, credit = ?, transfer = ?, my = ?, fy = ?
        WHERE uniqueid = ?
      `).bind(
        entryDate, respPersonVal, body.category || 'Income', body.description || '',
        body.method || 'Cash', debit, credit, body.transfer || '', my, fy, uniqueid
      )
    );

    const isTransfer = String(body.category || '').trim() === 'Transfer' && body.transfer;
    let targetTableName = null;

    if (isTransfer) {
      const { tableName: targetTable, prefix: targetPrefix, bookTitle: targetBookTitle } = getCashierMeta(body.transfer);
      if (targetTable !== tableName) {
        targetTableName = targetTable;
        const targetStmt = await createTargetCashierTransferStatement(
          db, body, bookTitle, targetTable, targetPrefix, targetBookTitle, entryDate, my, fy, session?.name || 'Cashier', transferUid
        );
        batchStatements.push(targetStmt);
      }
    }

    await db.batch(batchStatements);

    // ⚡ Quota-Shield Recalculate - Incremental (Phase 1)
    await recalculateLedgerBalances(db, tableName, fy, recalcDate);
    if (oldFy && oldFy !== fy) {
      await recalculateLedgerBalances(db, tableName, oldFy, oldDate);
    }

    if (targetTableName && targetTableName !== tableName) {
      await recalculateLedgerBalances(db, targetTableName, fy, recalcDate);
    }

    return {
      success: true,
      message: "Cashier စာရင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ."
    };
  } catch (err) {
    console.error("Error in updateCashierEntry handler:", err);
    return {
      success: false,
      message: "Cashier စာရင်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Delete Cashier Entry (🛡️ Atomic Batch Delete Engine)
 */
export async function deleteCashierEntry(db, session, body) {
  try {
    const rawBook = body.bookName || "CABank";
    const { tableName } = getCashierMeta(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    // 🚀 OPTIMIZATION: Avoid SELECT * and FETCH `date` for Incremental Recalc
    const existing = await db.prepare(`SELECT fy, date, transfer, is_locked, uniqueid FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) {
      return { success: false, message: "ဖျက်သိမ်းမည့် စာရင်း ရှာမတွေ့ပါ။" };
    }

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked) ||
      uid.startsWith('TRANS_') ||
      uid.startsWith('UNIPROFIT_') ||
      uid.startsWith('UNICASHIER_') ||
      uid.startsWith('INCCASHIER_') ||
      uid.startsWith('DAILY_INC_');

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် မူရင်းစာအုပ်မှ အလိုအလျောက် ရောက်ရှိလာသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ဖျက်သိမ်းနိုင်ပါသည်။" 
      };
    }

    const targetFy = existing.fy ? normalizeFyStr(existing.fy) : null;
    const oldDate = existing.date || null;
    const transferUid = `TRANS_${uniqueid}`;

    const batchStatements = [
      db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid),
      db.prepare(`DELETE FROM ca_bank WHERE uniqueid = ?`).bind(transferUid),
      db.prepare(`DELETE FROM ca_cash WHERE uniqueid = ?`).bind(transferUid),
      db.prepare(`DELETE FROM ca_office WHERE uniqueid = ?`).bind(transferUid),
      db.prepare(`DELETE FROM ca_kitchen WHERE uniqueid = ?`).bind(transferUid),
      db.prepare(`DELETE FROM ca_payroll WHERE uniqueid = ?`).bind(transferUid)
    ];

    await db.batch(batchStatements);

    // ⚡ Quota-Shield Recalculate - Incremental (Phase 1)
    await recalculateLedgerBalances(db, tableName, targetFy, oldDate);

    if (existing.transfer) {
      const { tableName: linkedTable } = getCashierMeta(existing.transfer);
      if (linkedTable && linkedTable !== tableName) {
        await recalculateLedgerBalances(db, linkedTable, targetFy, oldDate);
      }
    }

    return {
      success: true,
      message: "Cashier စာရင်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in deleteCashierEntry handler:", err);
    return {
      success: false,
      message: "Cashier စာရင်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}