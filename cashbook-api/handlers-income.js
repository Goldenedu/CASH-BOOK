/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - MAIN INCOME BOOK HANDLER (CLOUDFLARE D1)
 * File: handlers-income.js (Location: cashbook-api/handlers-income.js)
 * 💡 Features: 🛡️ Zero ON CONFLICT Schema Errors (Safe SELECT -> UPDATE/INSERT Pattern),
 *              🛡️ 100% ACID Compliant Atomic Refund & Multi-Book Postings via db.batch(),
 *              ⚡ O(1) Single-Pass Window Function Engine via SQLite 3.33+ UPDATE...FROM,
 *              Cashier Sub-Ledger Balances Auto-Sync on Income Delete & Update,
 *              Myanmar Standard Time (UTC+6:30) & March Academic Year Boundary Alignment,
 *              Split Payment Support, Precision FY-Scoped Student Lookup & Auto-Posting Engine
 * ==============================================================================
 */

function parseCleanIntId(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.trunc(val);
  const n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? 0 : n;
}

function getMyanmarDateString(inputDate = null) {
  if (inputDate) return String(inputDate).trim().split('T')[0];
  const now = new Date(Date.now() + (6.5 * 3600 * 1000));
  return now.toISOString().split('T')[0];
}

function calculateAcademicFyFromDate(dateStr) {
  const d = new Date(dateStr);
  let fyYear = d.getFullYear();
  if (d.getMonth() < 2) fyYear -= 1;
  return `FY ${fyYear}-${fyYear + 1}`;
}

function getCurrentAcademicYear(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date(Date.now() + (6.5 * 3600 * 1000));
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  let y = validDate.getFullYear();
  if (validDate.getMonth() < 2) {
    y -= 1;
  }
  return `${y}-${y + 1}`;
}

function normalizeFyStr(fy) {
  let s = fy ? String(fy).trim() : `FY ${getCurrentAcademicYear()}`;
  if (!s) s = `FY ${getCurrentAcademicYear()}`;
  if (!s.toUpperCase().startsWith('FY ')) {
    s = 'FY ' + s;
  }
  return s;
}

function getFyShortCode(fyStr) {
  if (fyStr) {
    const clean = String(fyStr).replace(/^FY\s*/i, '').trim();
    const parts = clean.split(/[-/]/);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      const y1 = parts[0].trim().slice(-2);
      const y2 = parts[1].trim().slice(-2);
      return y1 + y2;
    }
    if (/^\d{4}$/.test(clean)) {
      return clean;
    }
  }
  const currentFy = getCurrentAcademicYear();
  const p = currentFy.split('-');
  return p[0].slice(-2) + p[1].slice(-2);
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

async function recalculateLedgerBalances(db, tableName, targetFy = null) {
  if (!tableName) return;
  try {
    if (targetFy) {
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
        SET no = calculated.calc_no,
            balances = calculated.calc_bal
        FROM calculated
        WHERE ${tableName}.id = calculated.id;
      `).bind(normFy, cleanFy).run();

    } else {
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
        SET no = calculated.calc_no,
            balances = calculated.calc_bal
        FROM calculated
        WHERE ${tableName}.id = calculated.id;
      `).run();
    }
  } catch (e) {
    console.warn(`Running Balance Recalculation Warning for ${tableName}:`, e.message);
  }
}

async function generateVoucherNo(db, tableName, prefix, entryDate) {
  let ddmmyy = "";
  const parts = String(entryDate || '').split('-');
  if (parts.length === 3) {
    const y = parts[0].slice(-2);
    ddmmyy = `${parts[2]}${parts[1]}${y}`;
  } else {
    const now = new Date(Date.now() + (6.5 * 3600 * 1000));
    ddmmyy = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`;
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

async function insertIncomeRecord(db, p, isMigration = false) {
  const normFy = normalizeFyStr(p.fy);
  const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";
  const stmt = `
    ${sqlVerb} income (
      no, effect_date, date, fy, student_id, fyid, fyid_name, class, category, account_name, method, debit, credit, aut_amount, promo, my, vr_no, remark, created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `;
  await db.prepare(stmt).bind(
    p.no, p.effDate, p.entryDate, normFy, p.studentId, p.fyid, p.fyidName,
    p.class, p.category, p.accountName, p.method, p.debit, p.credit,
    p.autAmount, p.promo, p.my, p.vrNo, p.remark, p.createdBy, p.uniqueid
  ).run();
}

async function cleanLinkedIncomeEntries(db, uniqueid) {
  if (!uniqueid) return { cash: false, bank: false, ca_cash: false, ca_bank: false };
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

  const placeholders = uids.map(() => '?').join(', ');
  
  await db.prepare(`DELETE FROM income WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
  const delCash = await db.prepare(`DELETE FROM cash WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
  const delBank = await db.prepare(`DELETE FROM bank WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
  const delCaCash = await db.prepare(`DELETE FROM ca_cash WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
  const delCaBank = await db.prepare(`DELETE FROM ca_bank WHERE uniqueid IN (${placeholders})`).bind(...uids).run();

  return {
    cash: Boolean(delCash?.meta?.changes > 0),
    bank: Boolean(delBank?.meta?.changes > 0),
    ca_cash: Boolean(delCaCash?.meta?.changes > 0),
    ca_bank: Boolean(delCaBank?.meta?.changes > 0)
  };
}

/**
 * ⚡ FIX: Safe SELECT -> UPDATE/INSERT (Zero ON CONFLICT Errors)
 */
async function postCashierIndividualLine(db, targetMethod, amount, body, entryDate, my, fy, createdBy, uidSuffix) {
  if (amount <= 0) return;

  const normFy = normalizeFyStr(fy);
  const methodKey = String(targetMethod).toLowerCase() === 'bank' ? 'bank' : 'cash';
  const caTable = methodKey === 'bank' ? 'ca_bank' : 'ca_cash';
  const caPrefix = methodKey === 'bank' ? 'CAB' : 'CAC';

  const caUid = `INCCASHIER_${uidSuffix}`;
  const caDesc = buildStudentDetailedDesc(body, null);

  // 🛡️ CRASH-PROOF: SELECT ဖြင့် အရင်စစ်ဆေးပြီး ရှိပါက UPDATE၊ မရှိပါက INSERT လုပ်သည်
  const existing = await db.prepare(`SELECT id FROM ${caTable} WHERE uniqueid = ?`).bind(caUid).first();
  if (existing) {
    await db.prepare(`
      UPDATE ${caTable} SET
        date = ?, responsibility_person = ?, description = ?, method = ?,
        debit = ?, credit = 0, my = ?, fy = ?
      WHERE uniqueid = ?
    `).bind(entryDate, createdBy || 'Cashier', caDesc, targetMethod, amount, my, normFy, caUid).run();
  } else {
    const caVrNo = await generateVoucherNo(db, caTable, caPrefix, entryDate);
    const caNo = await generateFyNo(db, caTable, normFy);

    await db.prepare(`
      INSERT INTO ${caTable} (
        no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, 'Student Income', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Main Income Book', ?, datetime('now'), ?)
    `).bind(
      caNo, entryDate, createdBy || 'Cashier', caDesc, targetMethod, amount,
      caVrNo, my, normFy, createdBy || 'Cashier', caUid
    ).run();
  }

  await recalculateLedgerBalances(db, caTable, normFy);
}

/**
 * ⚡ FIX: Safe Daily Income Rollup (Zero ON CONFLICT Errors)
 */
async function upsertDailyIncomeRollup(db, tableName, entryDate, fy, createdBy) {
  const normFy = normalizeFyStr(fy);
  const isBank = tableName === 'bank';
  const prefix = isBank ? 'BNK' : 'CAH';
  const methodLabel = isBank ? 'Bank' : 'Cash';
  const uniqueid = `DAILY_INC_${tableName.toUpperCase()}_${entryDate}`;

  const stats = await db.prepare(`
    SELECT 
      COALESCE(SUM(credit - debit), 0) as netAmount,
      COUNT(DISTINCT student_id) as studentCount
    FROM income 
    WHERE date = ? AND (LOWER(method) = LOWER(?) OR remark LIKE ?)
  `).bind(entryDate, methodLabel, `%[Split - ${methodLabel}]%`).first();

  const netAmount = parseFloat(stats?.netAmount || 0);
  const count = parseInt(stats?.studentCount || 0, 10);

  if (count <= 0 || netAmount <= 0) {
    await db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).run();
    await recalculateLedgerBalances(db, tableName, normFy);
    return;
  }

  const ddmmyy = formatDDMMYY(entryDate);
  const studentWord = count === 1 ? 'Student' : 'Students';
  const desc = `Daily Income | ${ddmmyy} | ${count} ${studentWord}`;
  const debit = netAmount > 0 ? netAmount : 0;
  const credit = netAmount < 0 ? Math.abs(netAmount) : 0;
  const my = getMonthYearLabel(entryDate);

  // 🛡️ CRASH-PROOF: SELECT ဖြင့် အရင်စစ်ဆေးပြီး ရှိပါက UPDATE၊ မရှိပါက INSERT လုပ်သည်
  const existing = await db.prepare(`SELECT id FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
  if (existing) {
    await db.prepare(`
      UPDATE ${tableName} SET
        date = ?, description = ?, debit = ?, credit = ?, my = ?, fy = ?
      WHERE uniqueid = ?
    `).bind(entryDate, desc, debit, credit, my, normFy, uniqueid).run();
  } else {
    const vrNo = await generateVoucherNo(db, tableName, prefix, entryDate);
    const no = await generateFyNo(db, tableName, normFy);

    await db.prepare(`
      INSERT INTO ${tableName} (
        no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, 'Student Income', ?, ?, ?, ?, 0, '', ?, ?, ?, 'Main Income Book', ?, datetime('now'), ?)
    `).bind(
      no, entryDate, desc, methodLabel, debit, credit,
      vrNo, my, normFy, createdBy, uniqueid
    ).run();
  }

  await recalculateLedgerBalances(db, tableName, normFy);
}

async function syncDailyIncomeRollupForDate(db, entryDate, fy, createdBy) {
  if (!entryDate) return;
  await upsertDailyIncomeRollup(db, 'cash', entryDate, fy, createdBy);
  await upsertDailyIncomeRollup(db, 'bank', entryDate, fy, createdBy);
}

/**
 * ⚡ FIX: Post Linked Refund Auto Entries (Zero ON CONFLICT Errors)
 */
async function postLinkedIncomeAutoEntries(db, body, entryDate, my, fy, createdBy, uniqueid) {
  const normFy = normalizeFyStr(fy);
  const method = String(body.method || 'Cash').toLowerCase();
  const debit = parseFloat(body.debit || 0);

  if (debit > 0) {
    const refundTable = (method === 'bank') ? 'bank' : 'cash';
    const refundPrefix = (method === 'bank') ? 'BNK' : 'CAH';
    const refundDesc = buildStudentDetailedDesc(body, 'Student Refund');
    const mainRefUid = `INCMAIN_REFUND_${uniqueid}`;

    const caTable = (method === 'bank') ? 'ca_bank' : 'ca_cash';
    const caPrefix = (method === 'bank') ? 'CAB' : 'CAC';
    const caRefUid = `INCCASHIER_REFUND_${uniqueid}`;

    // 1. Main Refund Table
    const exMain = await db.prepare(`SELECT id FROM ${refundTable} WHERE uniqueid = ?`).bind(mainRefUid).first();
    if (exMain) {
      await db.prepare(`
        UPDATE ${refundTable} SET
          date = ?, description = ?, credit = ?, my = ?, fy = ?
        WHERE uniqueid = ?
      `).bind(entryDate, refundDesc, debit, my, normFy, mainRefUid).run();
    } else {
      const mainVrNo = await generateVoucherNo(db, refundTable, refundPrefix, entryDate);
      const mainNo = await generateFyNo(db, refundTable, normFy);
      await db.prepare(`
        INSERT INTO ${refundTable} (
          no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
        ) VALUES (?, ?, 'Student Refund', ?, ?, 0, ?, 0, '', ?, ?, ?, 'Main Income Book', ?, datetime('now'), ?)
      `).bind(
        mainNo, entryDate, refundDesc, body.method || 'Cash', debit,
        mainVrNo, my, normFy, createdBy, mainRefUid
      ).run();
    }

    // 2. Cashier Refund Table
    const exCa = await db.prepare(`SELECT id FROM ${caTable} WHERE uniqueid = ?`).bind(caRefUid).first();
    if (exCa) {
      await db.prepare(`
        UPDATE ${caTable} SET
          date = ?, responsibility_person = ?, description = ?, credit = ?, my = ?, fy = ?
        WHERE uniqueid = ?
      `).bind(entryDate, createdBy || 'Cashier', refundDesc, debit, my, normFy, caRefUid).run();
    } else {
      const caVrNo = await generateVoucherNo(db, caTable, caPrefix, entryDate);
      const caNo = await generateFyNo(db, caTable, normFy);
      await db.prepare(`
        INSERT INTO ${caTable} (
          no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
        ) VALUES (?, ?, ?, 'Student Refund', ?, ?, 0, ?, 0, '', ?, ?, ?, 'Main Income Book', ?, datetime('now'), ?)
      `).bind(
        caNo, entryDate, createdBy || 'Cashier', refundDesc, body.method || 'Cash', debit,
        caVrNo, my, normFy, createdBy, caRefUid
      ).run();
    }

    await recalculateLedgerBalances(db, refundTable, normFy);
    await recalculateLedgerBalances(db, caTable, normFy);
  }

  await syncDailyIncomeRollupForDate(db, entryDate, normFy, createdBy);
}

/**
 * 💡 Get Income Data
 */
export async function getIncomeData(db, body) {
  try {
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 50, 10);
    const offset = (page - 1) * limit;

    const activeFy = normalizeFyStr(body.fy || `FY ${getCurrentAcademicYear()}`);

    let statsResult;
    if (body.fy && body.fy !== 'all') {
      statsResult = await db.prepare(`
        SELECT 
          COALESCE(SUM(credit), 0) as totalIncome,
          COALESCE(SUM(debit), 0) as totalExpense
        FROM income
        WHERE fy = ? OR fy = ?
      `).bind(activeFy, activeFy.replace(/^FY\s*/i, '')).first();
    } else {
      statsResult = await db.prepare(`
        SELECT 
          COALESCE(SUM(credit), 0) as totalIncome,
          COALESCE(SUM(debit), 0) as totalExpense
        FROM income
      `).first();
    }
    statsResult = statsResult || { totalIncome: 0, totalExpense: 0 };

    let totalIncome = parseFloat(statsResult.totalIncome || 0);
    let totalExpense = parseFloat(statsResult.totalExpense || 0);
    const balance = totalIncome - totalExpense;

    let whereClauses = [];
    let params = [];

    if (body.fy && body.fy !== 'all') {
      whereClauses.push(`(fy = ? OR fy = ?)`);
      params.push(activeFy, activeFy.replace(/^FY\s*/i, ''));
    }

    if (searchVal) {
      whereClauses.push(`(fyid_name LIKE ? OR fyid LIKE ? OR CAST(student_id AS TEXT) LIKE ? OR account_name LIKE ? OR category LIKE ? OR class LIKE ? OR vr_no LIKE ? OR remark LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p, p, p, p);
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
      const isAutoLocked = Boolean(
        row.is_locked || 
        row.isLocked || 
        uid.startsWith('INCMAIN_') || 
        uid.startsWith('INCCASHIER_') || 
        uid.startsWith('DAILY_INC_')
      );

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
  const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
  const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);
  const uniqueid = (isMigration && body.uniqueId)
    ? String(body.uniqueId).trim()
    : `INC_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

  return _saveIncomeEntryCore(db, session, body, uniqueid, isMigration);
}

/**
 * 💡 Internal upsert core
 */
async function _saveIncomeEntryCore(db, session, body, uniqueid, isMigration) {
  try {
    const createdBy = session?.name || body.createdBy || "Admin";

    const entryDate = getMyanmarDateString(body.date);
    const effDate = body.effDate ? getMyanmarDateString(body.effDate) : entryDate;
    const my = getMonthYearLabel(entryDate);
    const fy = normalizeFyStr(body.fy || calculateAcademicFyFromDate(entryDate));

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

    // Live Operational Mode
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

/**
 * 💡 Update Income Entry
 */
export async function updateIncomeEntry(db, session, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const existing = await db.prepare(`SELECT * FROM income WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) {
      return { success: false, message: "ပြင်ဆင်မည့် ဝင်ငွေစာရင်း ရှာမတွေ့ပါ။" };
    }

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) ||
      uid.startsWith('INCMAIN_') ||
      uid.startsWith('INCCASHIER_') ||
      uid.startsWith('DAILY_INC_');

    const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် ချိတ်ဆက်ထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ပြင်ဆင်နိုင်ပါသည်။" 
      };
    }

    const oldDate = existing?.date || null;
    const oldFy = existing?.fy || null;

    const cleanResults = await cleanLinkedIncomeEntries(db, uniqueid);
    const res = await _saveIncomeEntryCore(db, session, body, uniqueid, false);

    const entryDate = getMyanmarDateString(body.date);
    const createdBy = session?.name || 'Admin';

    if (cleanResults.ca_cash) await recalculateLedgerBalances(db, 'ca_cash', oldFy || body.fy);
    if (cleanResults.ca_bank) await recalculateLedgerBalances(db, 'ca_bank', oldFy || body.fy);

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

/**
 * 💡 Delete Income Entry
 */
export async function deleteIncomeEntry(db, session, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const existing = await db.prepare(`SELECT * FROM income WHERE uniqueid = ?`).bind(uniqueid).first();
    if (existing) {
      const uid = String(existing.uniqueid || '');
      const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) ||
        uid.startsWith('INCMAIN_') ||
        uid.startsWith('INCCASHIER_') ||
        uid.startsWith('DAILY_INC_');

      const isPrivilegedAdmin = ['Owner', 'Admin', 'Finance', 'Accountant'].includes(session?.role || '');
      if (isAutoLocked && !isPrivilegedAdmin) {
        return { 
          success: false, 
          message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် ချိတ်ဆက်ထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ဖျက်သိမ်းနိုင်ပါသည်။" 
        };
      }
    }

    const entryDate = existing?.date || null;
    const fy = existing?.fy || null;

    const cleanResults = await cleanLinkedIncomeEntries(db, uniqueid);

    if (cleanResults.ca_cash) await recalculateLedgerBalances(db, 'ca_cash', fy);
    if (cleanResults.ca_bank) await recalculateLedgerBalances(db, 'ca_bank', fy);

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
