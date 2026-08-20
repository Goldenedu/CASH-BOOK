/**
 * GOLDEN ERP SYSTEM - MAIN INCOME BOOK HANDLER (CLOUDFLARE D1)
 * File: handlers-income.js
 * 💡 Features: Server-Side Auto-Lock Enforcement (Zero Client Bypass),
 *              Privilege Escalation Defense (Server-Generated UUIDs for New Records),
 *              Idempotent Upsert for Cashier & Daily Rollups (INSERT OR REPLACE),
 *              Split Payment Support, Precision FY-Scoped Student Lookup & Auto-Posting Engine
 */

function parseCleanIntId(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.trunc(val);
  const n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? 0 : n;
}

function normalizeFyStr(fy) {
  if (!fy) return 'FY 2026-2027';ထထ
  let s = String(fy).trim();
  if (!s.toUpperCase().startsWith('FY ')) {
    s = 'FY ' + s;
  }
  return s;
}

function getFyShortCode(fyStr) {
  if (!fyStr) return '2627';
  const parts = String(fyStr).replace(/^FY\s*/i, '').split(/[-/]/);
  if (parts.length >= 2) {
    const y1 = parts[0].trim().slice(-2);
    const y2 = parts[1].trim().slice(-2);
    return `${y1}${y2}`;
  }
  return '2627';
}

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

function formatDDMMYY(entryDate) {
  const parts = String(entryDate || '').split('-');
  if (parts.length === 3) {
    const yy = parts[0].slice(-2);
    return `${parts[2]}-${parts[1]}-${yy}`;
  }
  return entryDate || '';
}

function getMonthYearLabel(entryDate) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(entryDate);
  if (isNaN(d.getTime())) return '';
  return `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
}

function buildStudentDetailedDesc(body, prefix) {
  const studentId = parseCleanIntId(body.id || body.studentId);
  let name = String(body.fyidName || body.name || '').trim();
  
  if (name.includes(']')) {
    const parts = name.split(']');
    name = parts.length > 1 ? parts[1].trim() : name;
  }

  const className = String(body.class || '').trim();
  const category = String(body.category || '').trim();
  const accName = String(body.accountName || '').trim();

  let details = [];
  if (studentId > 0) details.push(`ID ${studentId}`);
  if (name) details.push(name);
  if (className) details.push(className);
  if (category) details.push(category);

  const mainInfo = details.join(' ');
  const fullDesc = accName ? `${mainInfo} - ${accName}` : mainInfo;

  return prefix ? `[${prefix}] ${fullDesc}` : fullDesc;
}

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

async function generateFyNo(db, tableName, fy) {
  const normFy = normalizeFyStr(fy);
  const lastNoRow = await db.prepare(
    `SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM ${tableName} WHERE fy = ? OR fy = ?`
  ).bind(normFy, normFy.replace(/^FY\s*/i, '')).first();
  return (lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0) + 1;
}

/**
 * 💡 Insert Record into Income Table (Safe Verb)
 */
async function insertIncomeRecord(db, p, isMigration = false) {
  const normFy = normalizeFyStr(p.fy);
  const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";
  const stmt = `
    ${sqlVerb} income (
      no, effect_date, date, fy, student_id, fyid, fyid_name, class, category, account_name, method, debit, credit, aut_amount, promo, my, vr_no, remark, created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  await db.prepare(stmt).bind(
    p.no, p.effDate, p.entryDate, normFy, p.studentId, p.fyid, p.fyidName,
    p.class, p.category, p.accountName, p.method, p.debit, p.credit,
    p.autAmount, p.promo, p.my, p.vrNo, p.remark, p.createdBy, new Date().toISOString(), p.uniqueid
  ).run();
}

/**
 * 💡 Clean Linked Auto Entries
 */
async function cleanLinkedIncomeEntries(db, uniqueid) {
  if (!uniqueid) return;
  const uids = [
    uniqueid,
    `${uniqueid}_CASH`,
    `${uniqueid}_BANK`,
    `INCMAIN_${uniqueid}`,
    `INCMAIN_${uniqueid}_CASH`,
    `INCMAIN_${uniqueid}_BANK`,
    `INCMAIN_REFUND_${uniqueid}`,
    `INCCASHIER_${uniqueid}`,
    `INCCASHIER_${uniqueid}_CASH`,
    `INCCASHIER_${uniqueid}_BANK`,
    `INCCASHIER_REFUND_${uniqueid}`
  ];

  const tables = ['income', 'cash', 'bank', 'ca_cash', 'ca_bank'];
  for (const tbl of tables) {
    for (const uid of uids) {
      try {
        await db.prepare(`DELETE FROM ${tbl} WHERE uniqueid = ?`).bind(uid).run();
      } catch (e) {}
    }
  }
}

/**
 * 💡 Post Line-by-Line Student Entry to Cashier Sub-Ledger (Idempotent INSERT OR REPLACE)
 */
async function postCashierIndividualLine(db, targetMethod, amount, body, entryDate, my, fy, createdBy, uidSuffix) {
  if (amount <= 0) return;

  const normFy = normalizeFyStr(fy);
  const methodKey = String(targetMethod).toLowerCase() === 'bank' ? 'bank' : 'cash';
  const caTable = methodKey === 'bank' ? 'ca_bank' : 'ca_cash';
  const caPrefix = methodKey === 'bank' ? 'CAB' : 'CAC';

  const caVrNo = await generateVoucherNo(db, caTable, caPrefix, entryDate);
  const caNo = await generateFyNo(db, caTable, normFy);
  const caUid = `INCCASHIER_${uidSuffix}`;
  const caDesc = buildStudentDetailedDesc(body, null);

  await db.prepare(`
    INSERT OR REPLACE INTO ${caTable} (
      no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    caNo, entryDate, 'Student Income', caDesc, targetMethod, amount, 0, 0, '',
    caVrNo, my, normFy, 'Main Income Book', createdBy, new Date().toISOString(), caUid
  ).run();

  await recalculateLedgerBalances(db, caTable);
}

async function upsertDailyIncomeRollup(db, tableName, entryDate, fy, netAmount, count, createdBy) {
  const normFy = normalizeFyStr(fy);
  const isBank = tableName === 'bank';
  const prefix = isBank ? 'BNK' : 'CAH';
  const methodLabel = isBank ? 'Bank' : 'Cash';
  const uniqueid = `DAILY_INC_${tableName.toUpperCase()}_${entryDate}`;

  if (!count || count <= 0 || !netAmount || netAmount <= 0) {
    await db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).run();
    await recalculateLedgerBalances(db, tableName);
    return;
  }

  const ddmmyy = formatDDMMYY(entryDate);
  const studentWord = count === 1 ? 'Student' : 'Students';
  const desc = `Daily Income | ${ddmmyy} | ${count} ${studentWord}`;
  const debit = netAmount > 0 ? netAmount : 0;
  const credit = netAmount < 0 ? Math.abs(netAmount) : 0;
  const my = getMonthYearLabel(entryDate);

  const existing = await db.prepare(`SELECT id FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();

  if (existing) {
    await db.prepare(`
      UPDATE ${tableName} SET
        date = ?, category = ?, description = ?, method = ?, debit = ?, credit = ?, my = ?, fy = ?, book_name = ?
      WHERE uniqueid = ?
    `).bind(entryDate, 'Student Income', desc, methodLabel, debit, credit, my, normFy, 'Main Income Book', uniqueid).run();
  } else {
    const vrNo = await generateVoucherNo(db, tableName, prefix, entryDate);
    const no = await generateFyNo(db, tableName, normFy);

    await db.prepare(`
      INSERT OR REPLACE INTO ${tableName} (
        no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      no, entryDate, 'Student Income', desc, methodLabel, debit, credit, 0, '',
      vrNo, my, normFy, 'Main Income Book', createdBy, new Date().toISOString(), uniqueid
    ).run();
  }

  await recalculateLedgerBalances(db, tableName);
}

async function syncDailyIncomeRollupForDate(db, entryDate, fy, createdBy) {
  if (!entryDate) return;

  const rows = (await db.prepare(
    `SELECT id, student_id, fyid, debit, credit, method, fy, remark FROM income WHERE date = ?`
  ).bind(entryDate).all()).results || [];

  let cashNet = 0;
  let bankNet = 0;

  const cashStudentSet = new Set();
  const bankStudentSet = new Set();
  let effectiveFy = normalizeFyStr(fy);

  rows.forEach((r, index) => {
    const net = parseFloat(r.credit || 0) - parseFloat(r.debit || 0);
    const m = String(r.method || '').toLowerCase().trim();
    const remark = String(r.remark || '');
    const stId = parseCleanIntId(r.student_id) || String(r.fyid || '').trim() || String(r.id || index);

    if (m === 'cash' || remark.includes('[Split - Cash]')) {
      cashNet += net;
      if (stId) cashStudentSet.add(String(stId).trim().toLowerCase());
    } else if (m === 'bank' || remark.includes('[Split - Bank]')) {
      bankNet += net;
      if (stId) bankStudentSet.add(String(stId).trim().toLowerCase());
    }
    if (r.fy) effectiveFy = normalizeFyStr(r.fy);
  });

  const cashCount = cashStudentSet.size;
  const bankCount = bankStudentSet.size;

  await upsertDailyIncomeRollup(db, 'cash', entryDate, effectiveFy, cashNet, cashCount, createdBy);
  await upsertDailyIncomeRollup(db, 'bank', entryDate, effectiveFy, bankNet, bankCount, createdBy);
}

async function postLinkedIncomeAutoEntries(db, body, entryDate, my, fy, createdBy, uniqueid) {
  const normFy = normalizeFyStr(fy);
  const method = String(body.method || 'Cash').toLowerCase();
  const debit = parseFloat(body.debit || 0);

  if (debit > 0) {
    const refundTable = (method === 'bank') ? 'bank' : 'cash';
    const refundPrefix = (method === 'bank') ? 'BNK' : 'CAH';
    const refundDesc = buildStudentDetailedDesc(body, 'Student Refund');

    const mainVrNo = await generateVoucherNo(db, refundTable, refundPrefix, entryDate);
    const mainNo = await generateFyNo(db, refundTable, normFy);
    const mainRefUid = `INCMAIN_REFUND_${uniqueid}`;

    await db.prepare(`
      INSERT OR REPLACE INTO ${refundTable} (
        no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      mainNo, entryDate, 'Student Refund', refundDesc, body.method || 'Cash', 0, debit, 0, '',
      mainVrNo, my, normFy, 'Main Income Book', createdBy, new Date().toISOString(), mainRefUid
    ).run();

    const caTable = (method === 'bank') ? 'ca_bank' : 'ca_cash';
    const caPrefix = (method === 'bank') ? 'CAB' : 'CAC';
    const caVrNo = await generateVoucherNo(db, caTable, caPrefix, entryDate);
    const caNo = await generateFyNo(db, caTable, normFy);
    const caRefUid = `INCCASHIER_REFUND_${uniqueid}`;

    await db.prepare(`
      INSERT OR REPLACE INTO ${caTable} (
        no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      caNo, entryDate, 'Student Refund', refundDesc, body.method || 'Cash', 0, debit, 0, '',
      caVrNo, my, normFy, 'Main Income Book', createdBy, new Date().toISOString(), caRefUid
    ).run();

    await recalculateLedgerBalances(db, refundTable);
    await recalculateLedgerBalances(db, caTable);
  }

  await syncDailyIncomeRollupForDate(db, entryDate, normFy, createdBy);
}

export async function getIncomeData(db, body) {
  try {
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 50, 10);
    const offset = (page - 1) * limit;

    const activeFy = normalizeFyStr(body.fy || "FY 2026-2027");

    const statsResult = await db.prepare(`
      SELECT 
        COALESCE(SUM(credit), 0) as totalIncome,
        COALESCE(SUM(debit), 0) as totalExpense
      FROM income
      WHERE fy = ? OR fy = ?
    `).bind(activeFy, activeFy.replace(/^FY\s*/i, '')).first() || { totalIncome: 0, totalExpense: 0 };

    let totalIncome = parseFloat(statsResult.totalIncome || 0);
    let totalExpense = parseFloat(statsResult.totalExpense || 0);
    const balance = totalIncome - totalExpense;

    let whereClauses = [];
    let params = [];

    if (searchVal) {
      whereClauses.push(`(fyid_name LIKE ? OR fyid LIKE ? OR CAST(student_id AS TEXT) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM income ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    const dataQuery = `
      SELECT * FROM income 
      ${whereSql} 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => {
      const uid = String(row.uniqueid || row.uniqueId || '');
      const isAutoLocked = Boolean(row.is_locked || row.isLocked || uid.startsWith('INCMAIN_') || uid.startsWith('INCCASHIER_') || uid.startsWith('DAILY_INC_'));

      return {
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
        uniqueId: uid || `INC_${row.id}`,
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
    console.error("Error in getIncomeData handler:", err);
    return {
      success: false,
      message: "Income ဒေတာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

export async function saveIncomeEntry(db, session, body) {
  // 🔒 PRIVILEGE ESCALATION DEFENSE: Server-generated UUID only for new records,
  // unless an Owner/Admin explicitly requests migration mode.
  const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
  const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);
  const uniqueid = (isMigration && body.uniqueId)
    ? String(body.uniqueId).trim()
    : `INC_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  return _saveIncomeEntryCore(db, session, body, uniqueid, isMigration);
}

/**
 * 💡 Internal upsert core, shared by:
 *  - saveIncomeEntry (new records — public entrypoint above always supplies a
 *    server-generated or admin-migration uniqueid, never a raw client value)
 *  - updateIncomeEntry (existing records — caller already verified 'edit'
 *    permission and resolved the target's ORIGINAL uniqueid, which must be
 *    preserved so the record's identity doesn't silently change on every edit)
 */
async function _saveIncomeEntryCore(db, session, body, uniqueid, isMigration) {
  try {
    const createdBy = session?.name || body.createdBy || "Admin";

    const entryDate = body.date || new Date().toISOString().split('T')[0];
    const effDate = body.effDate || entryDate;
    const my = getMonthYearLabel(entryDate);

    let fyYear = new Date(entryDate).getFullYear();
    if (new Date(entryDate).getMonth() < 3) fyYear -= 1;
    const fy = normalizeFyStr(body.fy || `FY ${fyYear}-${fyYear + 1}`);

    const cleanStudentId = parseCleanIntId(body.id || body.studentId);
    const cleanFyid = sanitizeFyidStr(body.fyid || '');

    const assignedNo = (isMigration && body.no)
      ? parseInt(body.no, 10)
      : await generateFyNo(db, 'income', fy);

    if (body.isSplit) {
      const cashAmt = parseFloat(body.cashAmount || 0);
      const bankAmt = parseFloat(body.bankAmount || 0);

      if (cashAmt > 0) {
        const cashNo = assignedNo;
        const cashVrNo = await generateVoucherNo(db, 'income', 'INC', entryDate);
        const cashUid = `${uniqueid}_CASH`;
        const cashRemark = `[Split - Cash] ${body.remark || ''}`.trim();

        await insertIncomeRecord(db, {
          no: cashNo, effDate, entryDate, fy, studentId: cleanStudentId, fyid: cleanFyid,
          fyidName: body.fyidName || '', class: body.class || '', category: body.category || 'Boarder',
          accountName: body.accountName || 'Registration', method: 'Cash', debit: 0, credit: cashAmt,
          autAmount: parseFloat(body.autAmount || 0), promo: body.promo || '', my, vrNo: cashVrNo,
          remark: cashRemark, createdBy, uniqueid: cashUid
        }, isMigration);

        if (!isMigration) {
          await postCashierIndividualLine(db, 'Cash', cashAmt, body, entryDate, my, fy, createdBy, `${uniqueid}_CASH`);
        }
      }

      if (bankAmt > 0) {
        const bankNo = isMigration ? assignedNo : await generateFyNo(db, 'income', fy);
        const bankVrNo = await generateVoucherNo(db, 'income', 'INC', entryDate);
        const bankUid = `${uniqueid}_BANK`;
        const bankRemark = `[Split - Bank] ${body.remark || ''}`.trim();

        await insertIncomeRecord(db, {
          no: bankNo, effDate, entryDate, fy, studentId: cleanStudentId, fyid: cleanFyid,
          fyidName: body.fyidName || '', class: body.class || '', category: body.category || 'Boarder',
          accountName: body.accountName || 'Registration', method: 'Bank', debit: 0, credit: bankAmt,
          autAmount: 0, promo: body.promo || '', my, vrNo: bankVrNo,
          remark: bankRemark, createdBy, uniqueid: bankUid
        }, isMigration);

        if (!isMigration) {
          await postCashierIndividualLine(db, 'Bank', bankAmt, body, entryDate, my, fy, createdBy, `${uniqueid}_BANK`);
        }
      }
    } else {
      const vrNo = body.vrNo || await generateVoucherNo(db, 'income', 'INC', entryDate);
      const debit = parseFloat(body.debit || 0);
      const credit = parseFloat(body.credit || 0);

      await insertIncomeRecord(db, {
        no: assignedNo, effDate, entryDate, fy, studentId: cleanStudentId, fyid: cleanFyid,
        fyidName: body.fyidName || '', class: body.class || '', category: body.category || 'Boarder',
        accountName: body.accountName || 'Registration', method: body.method || 'Cash', debit, credit,
        autAmount: parseFloat(body.autAmount || 0), promo: body.promo || '', my, vrNo,
        remark: body.remark || '', createdBy, uniqueid
      }, isMigration);

      const netAmount = credit - debit;
      if (!isMigration && netAmount > 0) {
        await postCashierIndividualLine(db, body.method || 'Cash', netAmount, body, entryDate, my, fy, createdBy, uniqueid);
      }
    }

    if (isMigration) {
      return {
        success: true,
        message: "ဝင်ငွေစာရင်းသစ် အောင်မြင်စွာ တိုက်ရိုက် သွင်းယူပြီးပါပြီ။",
        uniqueId: uniqueid
      };
    }

    // 💡 LIVE OPERATIONAL MODE
    await recalculateLedgerBalances(db, 'income');
    await postLinkedIncomeAutoEntries(db, body, entryDate, my, fy, createdBy, uniqueid);

    return {
      success: true,
      message: "ဝင်ငွေစာရင်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      uniqueId: uniqueid
    };
  } catch (err) {
    console.error("Error in saveIncomeEntry handler:", err);
    return {
      success: false,
      message: "ဝင်ငွေစာရင်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

export async function updateIncomeEntry(db, session, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    // 🔒 1. SERVER-SIDE LOCK ENFORCEMENT (Zero Client-Flag Bypass)
    const existing = await db.prepare(`SELECT is_locked, uniqueid, date, fy FROM income WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) {
      return { success: false, message: "ပြင်ဆင်မည့် ဝင်ငွေစာရင်း ရှာမတွေ့ပါ။" };
    }

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked) ||
      uid.startsWith('INCMAIN_') ||
      uid.startsWith('INCCASHIER_') ||
      uid.startsWith('DAILY_INC_');

    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် ချိတ်ဆက်ထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ပြင်ဆင်နိုင်ပါသည်။" 
      };
    }

    const oldDate = existing?.date || null;
    const oldFy = existing?.fy || null;

    await cleanLinkedIncomeEntries(db, uniqueid);
    // 🔒 Preserve the ORIGINAL uniqueid on edit — do not delegate to the public
    // saveIncomeEntry() entrypoint, which now always mints a fresh id unless an
    // explicit Owner/Admin migration request is made. Editing a record must never
    // silently change its identity (breaks receipts, links, and audit continuity).
    const res = await _saveIncomeEntryCore(db, session, body, uniqueid, false);

    const entryDate = body.date || new Date().toISOString().split('T')[0];
    const createdBy = session?.name || 'Admin';

    if (oldDate && oldDate !== entryDate) {
      await syncDailyIncomeRollupForDate(db, oldDate, oldFy || body.fy, createdBy);
    }

    return res;
  } catch (err) {
    console.error("Error in updateIncomeEntry handler:", err);
    return {
      success: false,
      message: "ဝင်ငွေစာရင်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

export async function deleteIncomeEntry(db, session, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    // 🔒 1. SERVER-SIDE LOCK ENFORCEMENT (Zero Client-Flag Bypass)
    const existing = await db.prepare(`SELECT is_locked, uniqueid, date, fy FROM income WHERE uniqueid = ?`).bind(uniqueid).first();
    if (existing) {
      const uid = String(existing.uniqueid || '');
      const isAutoLocked = Boolean(existing.is_locked) ||
        uid.startsWith('INCMAIN_') ||
        uid.startsWith('INCCASHIER_') ||
        uid.startsWith('DAILY_INC_');

      const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
      if (isAutoLocked && !isPrivilegedAdmin) {
        return { 
          success: false, 
          message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် ချိတ်ဆက်ထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ဖျက်သိမ်းနိုင်ပါသည်။" 
        };
      }
    }

    const entryDate = existing?.date || null;
    const fy = existing?.fy || null;

    await cleanLinkedIncomeEntries(db, uniqueid);
    await recalculateLedgerBalances(db, 'income');

    if (entryDate) {
      await syncDailyIncomeRollupForDate(db, entryDate, fy, session?.name || 'Admin');
    }

    return {
      success: true,
      message: "ဝင်ငွေစာရင်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in deleteIncomeEntry handler:", err);
    return {
      success: false,
      message: "ဝင်ငွေစာရင်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}
