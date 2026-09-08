/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - CASHIER SUB-LEDGER HANDLER (CLOUDFLARE D1)
 * File: handlers-cashier.js  
 * 💡 Features: Server-Side Auto-Lock Enforcement (Zero Client Bypass),
 *              Privilege Escalation Defense (Server-Generated UUIDs for New Records),
 *              17-Column Schema Alignment (With Responsibility Person),
 *              Today's Income Live Feed for Invoice Printer & Cross-Book Transfer Engine,
 *              ⚡ O(1) D1 Write-Optimized Window Function Recalculator (Zero D1 Quota Waste),
 *              🎯 Multi-FY Cross-Year Transition Safety & Scoped Recalculation
 * ==============================================================================
 */

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
 * ⚡ FIX PERF #1: O(1) Single-Query Window Function Recalculation Engine for Cashier Sub-Ledgers
 * Row-by-row batch loop (100 rows/batch) များကို ဖယ်ရှားပြီး
 * SQLite Window Function ဖြင့် ၁ ကြိမ်တည်း Update လုပ်သည်။
 */
async function recalculateLedgerBalances(db, tableName, targetFy = null) {
  if (!tableName) return;
  try {
    if (targetFy) {
      // 🎯 သီးသန့် FY တစ်ခုတည်းကိုသာ ထိရောက်စွာ Update လုပ်ခြင်း
      const normFy = normalizeFyStr(targetFy);
      const cleanFy = normFy.replace(/^FY\s*/i, '');

      await db.prepare(`
        WITH calculated AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   ORDER BY date ASC, id ASC
                 ) as calc_no,
                 SUM(debit - credit) OVER (
                   ORDER BY date ASC, id ASC 
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ) as calc_bal
          FROM ${tableName}
          WHERE fy = ? OR fy = ?
        )
        UPDATE ${tableName} 
        SET no = (SELECT calc_no FROM calculated WHERE calculated.id = ${tableName}.id),
            balances = (SELECT calc_bal FROM calculated WHERE calculated.id = ${tableName}.id)
        WHERE id IN (SELECT id FROM calculated);
      `).bind(normFy, cleanFy).run();
    } else {
      // 🎯 FY သီးသန့်မပါပါက FY အားလုံးကို PARTITION BY fy ဖြင့် Query ၁ ကြိမ်တည်း တွက်ချက်ခြင်း
      await db.prepare(`
        WITH calculated AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY fy
                   ORDER BY date ASC, id ASC
                 ) as calc_no,
                 SUM(debit - credit) OVER (
                   PARTITION BY fy
                   ORDER BY date ASC, id ASC 
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                 ) as calc_bal
          FROM ${tableName}
        )
        UPDATE ${tableName} 
        SET no = (SELECT calc_no FROM calculated WHERE calculated.id = ${tableName}.id),
            balances = (SELECT calc_bal FROM calculated WHERE calculated.id = ${tableName}.id)
        WHERE id IN (SELECT id FROM calculated);
      `).run();
    }
  } catch (e) {
    console.warn(`Running Balance & NO Recalculation Warning for ${tableName}:`, e.message);
  }
}

/**
 * 💡 Date-Based Voucher Number Generator
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
 * 💡 Clean Linked Transfer Auto Entries for Cashier Sub-Ledgers (Optimized)
 */
async function cleanLinkedTransfer(db, uniqueid) {
  if (!uniqueid) return;
  const transferUid = `TRANS_${uniqueid}`;
  const tables = ['ca_bank', 'ca_cash', 'ca_office', 'ca_kitchen', 'ca_payroll'];
  for (const tbl of tables) {
    try {
      const delRes = await db.prepare(`DELETE FROM ${tbl} WHERE uniqueid = ?`).bind(transferUid).run();
      // ⚡ အမှန်တကယ် delete ဖြစ်မှသာ အဆိုပါ table ၏ balance ကို recalculate ပြုလုပ်မည်
      if (delRes?.meta?.changes > 0) {
        await recalculateLedgerBalances(db, tbl);
      }
    } catch (e) {}
  }
}

/**
 * 💡 Cross-Book Transfer Auto-Posting Engine for Cashier Sub-Books
 */
async function postCashierCrossBookTransfer(db, body, sourceBookName, entryDate, my, fy, createdBy, uniqueid) {
  if (String(body.category || '').trim() !== 'Transfer' || !body.transfer) return;

  const { tableName: targetTable, prefix: targetPrefix, bookTitle: targetBookTitle } = getCashierMeta(body.transfer);
  const { tableName: sourceTable, bookTitle: sourceBookTitle } = getCashierMeta(sourceBookName);

  if (targetTable === sourceTable) return;

  const normFy = normalizeFyStr(fy);
  const transferUid = `TRANS_${uniqueid}`;
  const debit = parseFloat(body.debit || 0);
  const credit = parseFloat(body.credit || 0);

  const targetDebit = credit;
  const targetCredit = debit;

  const targetVrNo = await generateVoucherNo(db, targetTable, targetPrefix, entryDate);
  const targetNo = await generateFyNo(db, targetTable, normFy);
  const targetDesc = `[Transfer from ${sourceBookTitle}] ${body.description || ''}`.trim();
  const respPersonVal = body.respPerson || body.responsibility_person || '';

  await db.prepare(`
    INSERT OR REPLACE INTO ${targetTable} (
      no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).bind(
    targetNo, entryDate, respPersonVal, 'Transfer', targetDesc, body.method || 'Cash',
    targetDebit, targetCredit, sourceBookTitle, targetVrNo, my, normFy,
    targetBookTitle, createdBy, transferUid
  ).run();

  // ⚡ Target table ၏ သက်ဆိုင်ရာ FY တစ်ခုတည်းကိုသာ တွက်ချက်သည်
  await recalculateLedgerBalances(db, targetTable, normFy);
}

/**
 * 💡 Fetch Cashier Sub-Ledger Data (Supports full dataset loading up to 2000 rows)
 */
export async function getCashierData(db, body) {
  try {
    const rawBook = body.bookName || "CABank";
    const { tableName, bookTitle } = getCashierMeta(rawBook);
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 50, 10);
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

    const balance = totalIncome - totalExpense;

    let whereClauses = [];
    let params = [];

    if (searchVal) {
      whereClauses.push(`(description LIKE ? OR category LIKE ? OR responsibility_person LIKE ? OR vr_no LIKE ? OR method LIKE ? OR transfer LIKE ? OR CAST(debit AS TEXT) LIKE ? OR CAST(credit AS TEXT) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p, p, p, p);
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
      const isAutoLocked = Boolean(row.is_locked || row.isLocked || uid.startsWith('UNIPROFIT_') || uid.startsWith('UNICASHIER_') || uid.startsWith('INCCASHIER_') || uid.startsWith('TRANS_') || uid.startsWith('DAILY_INC_'));

      return {
        id: row.id,
        no: Math.floor(parseFloat(row.no || row.id || 1)),
        date: row.date || '',
        respPerson: row.responsibility_person || row.respPerson || '',
        category: row.category || '',
        description: row.description || '',
        method: row.method || 'Cash',
        debit: parseFloat(row.debit || 0),
        credit: parseFloat(row.credit || 0),
        balances: parseFloat(row.balances || 0),
        transfer: row.transfer || '',
        vrNo: row.vr_no || row.vrNo || '',
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
 * 💡 Load Today's Student Income Entries Live Feed for Cashier Receipt Printer
 */
export async function getTodayIncomeForCashier(db, body) {
  try {
    const todayDate = body.date || new Date().toISOString().split('T')[0];
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 500, 10);
    const offset = (page - 1) * limit;

    const rowsRes = await db.prepare(
      `SELECT * FROM income WHERE date = ? ORDER BY id DESC LIMIT ? OFFSET ?`
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
      uniqueId: row.uniqueid || row.uniqueId || `INC_${row.id}`,
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
 * 💡 Save Cashier Entry (Privilege Escalation Protected & Fast Recalculation)
 */
export async function saveCashierEntry(db, session, body) {
  try {
    const rawBook = body.bookName || "CABank";
    const { tableName, prefix, bookTitle } = getCashierMeta(rawBook);
    const createdBy = session?.name || body.createdBy || "Cashier";

    const entryDate = body.date || new Date().toISOString().split('T')[0];
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;

    let fyYear = d.getFullYear();
    if (d.getMonth() < 3) fyYear -= 1;
    const fy = normalizeFyStr(body.fy || `FY ${fyYear}-${fyYear + 1}`);

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);
    const respPersonVal = body.respPerson || body.responsibility_person || '';

    // 🔒 1. PRIVILEGE ESCALATION DEFENSE: Server-generated UUID only for new records
    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);

    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : `CAS_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const newNo = (isMigration && body.no) ? parseInt(body.no, 10) : await generateFyNo(db, tableName, fy);
    const vrNo = body.vrNo || await generateVoucherNo(db, tableName, prefix, entryDate);

    const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";

    const stmt = `
      ${sqlVerb} ${tableName} (
        no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `;

    await db.prepare(stmt).bind(
      newNo, entryDate, respPersonVal, body.category || 'Income', body.description || '',
      body.method || 'Cash', debit, credit, body.transfer || '', vrNo, my, fy,
      bookTitle, createdBy, uniqueid
    ).run();

    if (isMigration) {
      return {
        success: true,
        message: "Cashier စာရင်းသစ် အောင်မြင်စွာ တိုက်ရိုက် သွင်းယူပြီးပါပြီ။",
        uniqueId: uniqueid,
        vrNo: vrNo
      };
    }

    // ⚡ LIVE OPERATIONAL MODE: Recalculate only the affected FY
    await recalculateLedgerBalances(db, tableName, fy);
    await postCashierCrossBookTransfer(db, body, rawBook, entryDate, my, fy, createdBy, uniqueid);

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
 * 💡 Update Cashier Entry (With Multi-FY Balance Safety & Fast Recalculation)
 */
export async function updateCashierEntry(db, session, body) {
  try {
    const rawBook = body.bookName || "CABank";
    const { tableName } = getCashierMeta(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    // 🔒 1. SERVER-SIDE LOCK ENFORCEMENT & Capture old FY
    const existing = await db.prepare(`SELECT is_locked, uniqueid, transfer, fy FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
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

    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် မူရင်းစာအုပ်မှ အလိုအလျောက် ရောက်ရှိလာသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ပြင်ဆင်နိုင်ပါသည်။" 
      };
    }

    const oldFy = existing.fy ? normalizeFyStr(existing.fy) : null;

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
    const respPersonVal = body.respPerson || body.responsibility_person || '';

    const stmt = `
      UPDATE ${tableName} SET
        date = ?, responsibility_person = ?, category = ?, description = ?, method = ?,
        debit = ?, credit = ?, transfer = ?, my = ?, fy = ?
      WHERE uniqueid = ?
    `;

    await db.prepare(stmt).bind(
      entryDate, respPersonVal, body.category || 'Income', body.description || '',
      body.method || 'Cash', debit, credit, body.transfer || '', my, fy, uniqueid
    ).run();

    // ⚡ Recalculate target FY balances
    await recalculateLedgerBalances(db, tableName, fy);

    // ⚡ If the entry was moved from another FY, also recalculate the old FY
    if (oldFy && oldFy !== fy) {
      await recalculateLedgerBalances(db, tableName, oldFy);
    }

    await postCashierCrossBookTransfer(db, body, rawBook, entryDate, my, fy, session?.name || 'Cashier', uniqueid);

    return {
      success: true,
      message: "Cashier စာရင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။"
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
 * 💡 Delete Cashier Entry (With Fast Scoped Recalculation)
 */
export async function deleteCashierEntry(db, session, body) {
  try {
    const rawBook = body.bookName || "CABank";
    const { tableName } = getCashierMeta(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    // 🔒 1. SERVER-SIDE LOCK ENFORCEMENT & Capture target FY
    const existing = await db.prepare(`SELECT is_locked, uniqueid, fy FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (existing) {
      const uid = String(existing.uniqueid || '');
      const isAutoLocked = Boolean(existing.is_locked) ||
        uid.startsWith('TRANS_') ||
        uid.startsWith('UNIPROFIT_') ||
        uid.startsWith('UNICASHIER_') ||
        uid.startsWith('INCCASHIER_') ||
        uid.startsWith('DAILY_INC_');

      const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
      if (isAutoLocked && !isPrivilegedAdmin) {
        return { 
          success: false, 
          message: "ဤစာရင်းသည် မူရင်းစာအုပ်မှ အလိုအလျောက် ရောက်ရှိလာသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ဖျက်သိမ်းနိုင်ပါသည်။" 
        };
      }
    }

    const targetFy = existing?.fy ? normalizeFyStr(existing.fy) : null;

    await db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).run();
    await cleanLinkedTransfer(db, uniqueid);

    // ⚡ သက်ဆိုင်ရာ FY ကိုသာ O(1) query ဖြင့် ချက်ချင်း recalculate လုပ်သည်
    await recalculateLedgerBalances(db, tableName, targetFy);

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
