/**
 * GOLDEN ERP SYSTEM - CASHIER SUB-LEDGER HANDLER (CLOUDFLARE D1)
 * File: handlers-cashier.js
 * 💡 Features: 17-Column Schema Aligned (responsibility_person), User-Defined Responsibility Person Support,
 *              Active FY Stats, FY Integer NO Reset, Date-Based Voucher No (VR No) & Sub-Ledger Cross-Transfer Engine
 */

const CASHIER_TABLE_MAP = {
  "cabank": { table: "ca_bank", prefix: "CAB", bookName: "Cashier Bank Book", method: "Bank" },
  "cacash": { table: "ca_cash", prefix: "CAC", bookName: "Cashier Cash Book", method: "Cash" },
  "caoffice": { table: "ca_office", prefix: "CAO", bookName: "Cashier Office Book", method: "Cash" },
  "cakitchen": { table: "ca_kitchen", prefix: "CAK", bookName: "Cashier Kitchen Book", method: "Cash" },
  "capayroll": { table: "ca_payroll", prefix: "CAP", bookName: "Cashier Payroll Book", method: "Cash" },
  "ca_bank": { table: "ca_bank", prefix: "CAB", bookName: "Cashier Bank Book", method: "Bank" },
  "ca_cash": { table: "ca_cash", prefix: "CAC", bookName: "Cashier Cash Book", method: "Cash" },
  "ca_office": { table: "ca_office", prefix: "CAO", bookName: "Cashier Office Book", method: "Cash" },
  "ca_kitchen": { table: "ca_kitchen", prefix: "CAK", bookName: "Cashier Kitchen Book", method: "Cash" },
  "ca_payroll": { table: "ca_payroll", prefix: "CAP", bookName: "Cashier Payroll Book", method: "Cash" }
};

function getCashierMeta(rawBook) {
  if (!rawBook) return CASHIER_TABLE_MAP["cacash"];
  const key = String(rawBook).trim().toLowerCase();
  return CASHIER_TABLE_MAP[key] || CASHIER_TABLE_MAP["cacash"];
}

/**
 * 💡 Safe Integer ID Parser
 */
function parseCleanIntId(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.trunc(val);
  const n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 💡 FYID Sanitizer
 */
function sanitizeFyidStr(fyidStr) {
  const s = String(fyidStr || '').trim();
  if (!s) return s;
  if (s.indexOf('.0') === -1) return s;
  const cleaned = s.replace(/\.0/g, '');
  const parts = cleaned.split('-STU-');
  if (parts.length === 2) {
    const numPart = parseInt(parts[1], 10) || 0;
    return `${parts[0]}-STU-${String(numPart).padStart(4, '0')}`;
  }
  return cleaned;
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

    const chunkSize = 100;
    for (let i = 0; i < statements.length; i += chunkSize) {
      const chunk = statements.slice(i, i + chunkSize);
      await db.batch(chunk);
    }
  } catch (e) {
    console.warn(`Running Balance & NO Recalculation Warning for ${tableName}:`, e);
  }
}

/**
 * 💡 Date-Based Voucher Number Generator (Format: CAB-080826-001, CAC-080826-001)
 */
async function generateVoucherNo(db, tableName, prefix, entryDate) {
  let ddmmyy = "";
  const parts = String(entryDate || '').split('-');
  if (parts.length === 3) {
    const y = parts[0].slice(-2);
    ddmmyy = `${parts[2]}${parts[1]}${y}`;
  } else {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    ddmmyy = `${dd}${mm}${yy}`;
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
 * 💡 Clean Linked Sub-Ledger Transfer
 */
async function cleanLinkedTransfer(db, uniqueid) {
  if (!uniqueid) return;
  const transferUid = `TRANS_${uniqueid}`;
  const tables = ['ca_bank', 'ca_cash', 'ca_office', 'ca_kitchen', 'ca_payroll'];
  for (const tbl of tables) {
    try {
      await db.prepare(`DELETE FROM ${tbl} WHERE uniqueid = ?`).bind(transferUid).run();
      await recalculateLedgerBalances(db, tbl);
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * 💡 Cashier Sub-Ledger Cross-Book Transfer Engine
 */
async function postCashierCrossBookTransfer(db, body, sourceBookKey, entryDate, my, fy, createdBy, uniqueid) {
  if (String(body.category || '').trim() !== 'Transfer' || !body.transfer) return;

  const targetMeta = getCashierMeta(body.transfer);
  const sourceMeta = getCashierMeta(sourceBookKey);

  if (targetMeta.table === sourceMeta.table) return;

  const transferUid = `TRANS_${uniqueid}`;
  const debit = parseFloat(body.debit || 0);
  const credit = parseFloat(body.credit || 0);

  // Invert flows: Inflow becomes Outflow and vice versa
  const targetDebit = credit;
  const targetCredit = debit;

  const targetVrNo = await generateVoucherNo(db, targetMeta.table, targetMeta.prefix, entryDate);
  const targetNo = await generateFyNo(db, targetMeta.table, fy);
  const targetDesc = `[Transfer from ${sourceMeta.bookName}] ${body.description || ''}`.trim();

  await db.prepare(`
    INSERT INTO ${targetMeta.table} (
      no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    targetNo, entryDate, body.respPerson || '', 'Transfer', targetDesc, targetMeta.method,
    targetDebit, targetCredit, 0, sourceMeta.bookName, targetVrNo, my, fy,
    targetMeta.bookName, createdBy, new Date().toISOString(), transferUid
  ).run();

  await recalculateLedgerBalances(db, targetMeta.table);
}

/**
 * 💡 Fetch Cashier Sub-Ledger Data (17-Column Schema: responsibility_person)
 */
export async function getCashierData(db, body) {
  try {
    const rawBook = body.bookName || body.book || "CABank";
    const meta = getCashierMeta(rawBook);
    const tableName = meta.table;
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

    const latestBalRow = await db.prepare(`SELECT balances FROM ${tableName} ORDER BY id DESC LIMIT 1`).first();
    const balance = latestBalRow ? parseFloat(latestBalRow.balances || 0) : (totalIncome - totalExpense);

    let whereClauses = [];
    let params = [];

    if (searchVal) {
      whereClauses.push(`(description LIKE ? OR category LIKE ? OR responsibility_person LIKE ? OR CAST(debit AS TEXT) LIKE ? OR CAST(credit AS TEXT) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p);
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
      const isAutoLocked = Boolean(row.is_locked || row.isLocked || uid.startsWith('INCMAIN_') || uid.startsWith('INCCASHIER_') || uid.startsWith('UNIPROFIT_') || uid.startsWith('UNICASHIER_') || uid.startsWith('TRANS_'));

      return {
        id: row.id,
        no: Math.floor(parseFloat(row.no || row.id || 1)),
        date: row.date || '',
        respPerson: row.responsibility_person || row.resp_person || row.respPerson || '',
        category: row.category || '',
        description: row.description || '',
        method: row.method || meta.method,
        debit: parseFloat(row.debit || 0),
        credit: parseFloat(row.credit || 0),
        balances: parseFloat(row.balances || 0),
        transfer: row.transfer || '',
        vrNo: row.vr_no || row.vrNo || '',
        my: row.my || '',
        fy: normalizeFyStr(row.fy || activeFy),
        bookName: row.book_name || meta.bookName,
        createdBy: row.created_by || row.createdBy || '',
        createdAt: row.created_at || row.createdAt || '',
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
 * 💡 Fetch Today's Student Income Entries Live Feed for Cashier Invoice Printing
 */
export async function getTodayIncomeForCashier(db, body) {
  try {
    const todayDate = body.date || new Date().toISOString().split('T')[0];
    const activeFy = normalizeFyStr(body.fy || "FY 2026-2027");

    const rowsRes = await db.prepare(
      `SELECT * FROM income WHERE date = ? OR effect_date = ? ORDER BY id DESC LIMIT 500`
    ).bind(todayDate, todayDate).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => ({
      id: parseCleanIntId(row.student_id || row.id),
      no: Math.floor(parseFloat(row.no || row.id || 1)),
      effDate: row.effect_date || row.effDate || row.date || '',
      date: row.date || '',
      fy: normalizeFyStr(row.fy || activeFy),
      fyid: sanitizeFyidStr(row.fyid || ''),
      fyidName: row.fyid_name || row.fyidName || '',
      class: row.class || '',
      category: row.category || '',
      accountName: row.account_name || row.accountName || '',
      method: row.method || 'Cash',
      debit: parseFloat(row.debit || 0),
      credit: parseFloat(row.credit || 0),
      autAmount: parseFloat(row.aut_amount !== undefined ? row.aut_amount : (row.autAmount || 0)),
      promo: row.promo || '',
      my: row.my || '',
      vrNo: row.vr_no || row.vrNo || '',
      remark: row.remark || '',
      uniqueId: row.uniqueid || row.uniqueId || `INC_${row.id}`
    }));

    return {
      success: true,
      data: formattedRows,
      totalRows: formattedRows.length
    };
  } catch (err) {
    console.error("Error in getTodayIncomeForCashier:", err);
    return {
      success: false,
      message: "ယနေ့ ဝင်ငွေစာရင်းများ ခေါ်ယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Save Cashier Entry (17-Column Schema Aligned: responsibility_person)
 */
export async function saveCashierEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "CABank";
    const meta = getCashierMeta(rawBook);
    const tableName = meta.table;
    const uniqueid = body.uniqueId || `CAS_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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

    const newNo = await generateFyNo(db, tableName, fy);
    const vrNo = body.vrNo || await generateVoucherNo(db, tableName, meta.prefix, entryDate);

    const stmt = `
      INSERT INTO ${tableName} (
        no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.prepare(stmt).bind(
      newNo, entryDate, body.respPerson || '', body.category || 'Income',
      body.description || '', body.method || meta.method, debit, credit,
      0, body.transfer || '', vrNo, my, fy, meta.bookName, createdBy, new Date().toISOString(), uniqueid
    ).run();

    await recalculateLedgerBalances(db, tableName);
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
 * 💡 Update Cashier Entry
 */
export async function updateCashierEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "CABank";
    const meta = getCashierMeta(rawBook);
    const tableName = meta.table;
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
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
        date = ?, responsibility_person = ?, category = ?, description = ?, method = ?, debit = ?, credit = ?,
        transfer = ?, my = ?, fy = ?
      WHERE uniqueid = ?
    `;

    await db.prepare(stmt).bind(
      entryDate, body.respPerson || '', body.category || 'Income', body.description || '',
      body.method || meta.method, debit, credit, body.transfer || '', my, fy, uniqueid
    ).run();

    await recalculateLedgerBalances(db, tableName);
    await postCashierCrossBookTransfer(db, body, rawBook, entryDate, my, fy, session?.name || 'Admin', uniqueid);

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
 * 💡 Delete Cashier Entry
 */
export async function deleteCashierEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "CABank";
    const meta = getCashierMeta(rawBook);
    const tableName = meta.table;
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    await db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).run();
    await cleanLinkedTransfer(db, uniqueid);
    await recalculateLedgerBalances(db, tableName);

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