/**
 * GOLDEN ERP SYSTEM - MAIN BANK & CASH BOOKS HANDLER (CLOUDFLARE D1)
 * File: handlers-bank-cash.js  
 * 💡 Features: Server-Side Auto-Lock Enforcement (5-Prefix Lock Engine & Zero Client Bypass),
 *              Direct isMigration Mode (Preserves Column A NO 1..656 & Bypasses Auto-Transfers),
 *              Strict Net Balances Calculation (Total Income - Total Expense),
 *              Dynamic Month-Year (MY) Generator & Idempotent Cross-Book Transfer Engine
 */

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
 * 💡 FY String Normalizer (Ensures "FY 2026-2027" format)
 */
function normalizeFyStr(fy) {
  if (!fy) return 'FY 2026-2027';
  let s = String(fy).trim();
  if (!s.toUpperCase().startsWith('FY ')) {
    s = 'FY ' + s;
  }
  return s;
}

/**
 * 💡 Cloudflare D1 Batch Running Balance & Integer NO Recalculation Engine
 */
async function recalculateLedgerBalances(db, tableName) {
  if (!tableName) return;
  try {
    const fysRes = await db.prepare(`SELECT DISTINCT fy FROM ${tableName}`).all();
    const rawFys = (fysRes.results || []).map(r => normalizeFyStr(r.fy)).filter(Boolean);
    const fys = Array.from(new Set(rawFys));

    if (fys.length === 0) {
      fys.push('FY 2026-2027');
    }

    const statements = [];

    for (const fyVal of fys) {
      const rows = await db.prepare(
        `SELECT id, debit, credit FROM ${tableName} WHERE fy = ? OR fy = ? ORDER BY date ASC, id ASC`
      ).bind(fyVal, fyVal.replace(/^FY\s*/i, '')).all();

      const list = rows.results || [];
      let currentBal = 0;
      let seqNo = 1;

      for (const row of list) {
        const debit = parseFloat(row.debit || 0);
        const credit = parseFloat(row.credit || 0);
        currentBal = currentBal + debit - credit;

        statements.push(
          db.prepare(`UPDATE ${tableName} SET balances = ?, no = ?, fy = ? WHERE id = ?`).bind(currentBal, seqNo, fyVal, row.id)
        );
        seqNo++;
      }
    }

    for (let i = 0; i < statements.length; i += 100) {
      await db.batch(statements.slice(i, i + 100));
    }
  } catch (e) {
    console.warn(`Running Balance & NO Recalculation Warning for ${tableName}:`, e);
  }
}

/**
 * 💡 Date-Based Voucher Number Generator (Format: BNK-080826-001, CAH-080826-001)
 */
async function generateVoucherNo(db, tableName, prefix, entryDate) {
  let ddmmyy = "";
  const parts = String(entryDate || '').split('-');
  if (parts.length === 3) {
    const y = parts[0].slice(-2);
    ddmmyy = `${parts[2]}${parts[1]}${y}`;
  } else {
    const now = new Date();
    ddmmyy = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`;
  }

  const pattern = `${prefix}-${ddmmyy}-%`;
  const countRow = await db.prepare(
    `SELECT COUNT(*) as cnt FROM ${tableName} WHERE vr_no LIKE ? OR date = ?`
  ).bind(pattern, entryDate).first();

  const seq = (countRow ? parseInt(countRow.cnt, 10) : 0) + 1;
  return `${prefix}-${ddmmyy}-${String(seq).padStart(3, '0')}`;
}

/**
 * 💡 FY-Based Integer NO Generator
 */
async function generateFyNo(db, tableName, fy) {
  const normFy = normalizeFyStr(fy);
  const lastNoRow = await db.prepare(
    `SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM ${tableName} WHERE fy = ? OR fy = ?`
  ).bind(normFy, normFy.replace(/^FY\s*/i, '')).first();
  return (lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0) + 1;
}

/**
 * 💡 Clean Linked Transfer Auto Entries
 */
async function cleanLinkedTransfer(db, uniqueid) {
  if (!uniqueid) return;
  const transferUid = `TRANS_${uniqueid}`;
  const tables = ['bank', 'cash', 'office', 'kitchen', 'payroll'];
  for (const tbl of tables) {
    try {
      await db.prepare(`DELETE FROM ${tbl} WHERE uniqueid = ?`).bind(transferUid).run();
      await recalculateLedgerBalances(db, tbl);
    } catch (e) {}
  }
}

/**
 * 💡 Cross-Book Transfer Auto-Posting Engine (Idempotent INSERT OR REPLACE)
 */
async function postCrossBookTransfer(db, body, sourceBookName, entryDate, my, fy, createdBy, uniqueid) {
  if (String(body.category || '').trim() !== 'Transfer' || !body.transfer) return;

  const targetTable = getTableName(body.transfer);
  const sourceTable = getTableName(sourceBookName);

  if (targetTable === sourceTable) return;

  const normFy = normalizeFyStr(fy);
  const transferUid = `TRANS_${uniqueid}`;
  const debit = parseFloat(body.debit || 0);
  const credit = parseFloat(body.credit || 0);

  const targetDebit = credit;
  const targetCredit = debit;

  const targetPrefix = getTablePrefix(targetTable);
  const targetVrNo = await generateVoucherNo(db, targetTable, targetPrefix, entryDate);
  const targetNo = await generateFyNo(db, targetTable, normFy);
  const targetDesc = `[Transfer from ${sourceBookName}] ${body.description || ''}`.trim();

  if (targetTable === 'office') {
    // 19 Columns for Office
    await db.prepare(`
      INSERT OR REPLACE INTO office (
        no, date, category, description, unit, unit_price, method, debit, credit, balances, liabilities, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).bind(
      targetNo, entryDate, 'Transfer', targetDesc, 0, 0, body.method || 'Cash',
      targetDebit, targetCredit, sourceBookName, targetVrNo, my, normFy,
      sourceBookName, createdBy, transferUid
    ).run();
  } else if (targetTable === 'payroll') {
    // 18 Columns for Payroll
    await db.prepare(`
      INSERT OR REPLACE INTO payroll (
        no, date, category, description, method, debit, credit, balances, unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).bind(
      targetNo, entryDate, 'Transfer', targetDesc, body.method || 'Cash',
      targetDebit, targetCredit, sourceBookName, targetVrNo, my, normFy,
      sourceBookName, createdBy, transferUid
    ).run();
  } else {
    // 16 Columns for Bank, Cash, Kitchen
    await db.prepare(`
      INSERT OR REPLACE INTO ${targetTable} (
        no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `).bind(
      targetNo, entryDate, 'Transfer', targetDesc, body.method || 'Cash',
      targetDebit, targetCredit, sourceBookName, targetVrNo, my, normFy,
      sourceBookName, createdBy, transferUid
    ).run();
  }

  await recalculateLedgerBalances(db, targetTable);
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
    const limit = parseInt(body.limit || 30, 10);
    const offset = (page - 1) * limit;

    const activeFy = normalizeFyStr(body.fy || "FY 2026-2027");

    const statsResult = await db.prepare(`
      SELECT 
        COALESCE(SUM(debit), 0) as totalIncome,
        COALESCE(SUM(credit), 0) as totalExpense
      FROM ${tableName}
      WHERE fy = ? OR fy = ?
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

    // 💡 Strict Net Balance Calculation: Total Income - Total Expense
    const balance = totalIncome - totalExpense;

    let whereClauses = [];
    let params = [];

    if (searchVal) {
      whereClauses.push(`(description LIKE ? OR category LIKE ? OR CAST(debit AS TEXT) LIKE ? OR CAST(credit AS TEXT) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM ${tableName} ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    const dataQuery = `
      SELECT * FROM ${tableName} 
      ${whereSql} 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => {
      const uid = String(row.uniqueid || row.uniqueId || '');
      const isAutoLocked = Boolean(row.is_locked || row.isLocked || uid.startsWith('UNIPROFIT_') || uid.startsWith('UNICASHIER_') || uid.startsWith('TRANS_') || uid.startsWith('DAILY_INC_'));

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
 * 💡 Save Bank / Cash Entry (Preserves Column A NO during isMigration Mode)
 */
export async function saveBankCashEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const createdBy = session?.name || body.createdBy || "Admin";

    const entryDate = body.date || new Date().toISOString().split('T')[0];
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
    
    let fyYear = d.getFullYear();
    if (d.getMonth() < 3) fyYear -= 1;
    const fy = normalizeFyStr(body.fy || `FY ${fyYear}-${fyYear + 1}`);

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);

    // 🔒 1. PRIVILEGE ESCALATION DEFENSE: Server-generated UUID only for new records
    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);

    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : `BCK_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // 💡 Use exact sequential NO from Google Sheet Column A when migrating
    const newNo = (isMigration && body.no) ? parseInt(body.no, 10) : await generateFyNo(db, tableName, fy);
    const prefix = getTablePrefix(tableName);
    const vrNo = body.vrNo || await generateVoucherNo(db, tableName, prefix, entryDate);

    const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";

    const stmt = `
      ${sqlVerb} ${tableName} (
        no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `;

    await db.prepare(stmt).bind(
      newNo, entryDate, body.category || 'Income', body.description || '',
      body.method || (tableName === 'bank' ? 'Bank' : 'Cash'), debit, credit,
      body.transfer || '', vrNo, my, normalizeFyStr(body.fy), rawBook, createdBy, uniqueid
    ).run();

    if (isMigration) {
      return {
        success: true,
        message: "စာရင်းသစ် အောင်မြင်စွာ တိုက်ရိုက် သွင်းယူပြီးပါပြီ။",
        uniqueId: uniqueid,
        vrNo: vrNo
      };
    }

    // 💡 LIVE OPERATIONAL MODE (Normal Daily Manual Use)
    await recalculateLedgerBalances(db, tableName);
    await postCrossBookTransfer(db, body, rawBook, entryDate, my, fy, createdBy, uniqueid);

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
 * 💡 Update Bank / Cash Entry (With Strict Server-Side Auto-Lock & Role Protection)
 */
export async function updateBankCashEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    // 🔒 1. SERVER-SIDE LOCK ENFORCEMENT (All 5 Lock Types Protected, Zero Client-Flag Bypass)
    const existing = await db.prepare(`SELECT is_locked, uniqueid, transfer FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) {
      return { success: false, message: "ပြင်ဆင်မည့် စာရင်း ရှာမတွေ့ပါ။" };
    }

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked) ||
      uid.startsWith('TRANS_') ||
      uid.startsWith('UNIPROFIT_') ||
      uid.startsWith('UNICASHIER_') ||
      uid.startsWith('DAILY_INC_');

    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');

    // 🛡️ Lock rejection: Non-admin users cannot alter linked/auto-generated rows
    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် အခြားစာအုပ်မှ လွှဲပြောင်းထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ပြင်ဆင်နိုင်ပါသည်။" 
      };
    }

    await cleanLinkedTransfer(db, uniqueid);

    const entryDate = body.date || new Date().toISOString().split('T')[0];
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;

    let fyYear = d.getFullYear();
    if (d.getMonth() < 3) fyYear -= 1;
    const fy = normalizeFyStr(body.fy || `FY ${fyYear}-${fyYear + 1}`);

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);

    const stmt = `
      UPDATE ${tableName} SET
        date = ?, category = ?, description = ?, method = ?, debit = ?, credit = ?,
        transfer = ?, my = ?, fy = ?
      WHERE uniqueid = ?
    `;

    await db.prepare(stmt).bind(
      entryDate, body.category || 'Income', body.description || '',
      body.method || (tableName === 'bank' ? 'Bank' : 'Cash'), debit, credit,
      body.transfer || '', my, fy, uniqueid
    ).run();

    await recalculateLedgerBalances(db, tableName);
    await postCrossBookTransfer(db, body, rawBook, entryDate, my, fy, session?.name || 'Admin', uniqueid);

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
 * 💡 Delete Bank / Cash Entry (With Strict Server-Side Auto-Lock & Role Protection)
 */
export async function deleteBankCashEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    // 🔒 1. SERVER-SIDE LOCK ENFORCEMENT (All 5 Lock Types Protected, Zero Client-Flag Bypass)
    const existing = await db.prepare(`SELECT is_locked, uniqueid FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (existing) {
      const uid = String(existing.uniqueid || '');
      const isAutoLocked = Boolean(existing.is_locked) ||
        uid.startsWith('TRANS_') ||
        uid.startsWith('UNIPROFIT_') ||
        uid.startsWith('UNICASHIER_') ||
        uid.startsWith('DAILY_INC_');

      const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');

      // 🛡️ Lock rejection: Non-admin users cannot directly delete linked/auto-generated rows
      if (isAutoLocked && !isPrivilegedAdmin) {
        return { 
          success: false, 
          message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် အခြားစာအုပ်မှ လွှဲပြောင်းထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ဖျက်သိမ်းနိုင်ပါသည်။" 
        };
      }
    }

    await db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).run();
    await cleanLinkedTransfer(db, uniqueid);
    await recalculateLedgerBalances(db, tableName);

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
