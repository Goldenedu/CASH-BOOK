/**
 * GOLDEN ERP SYSTEM - STUDENT MONEY D1 DATABASE HANDLER
 * File: handlers-money.js 
 * 💡 Features: FY-Scoped Data Fetching, Batch Running Balance Engine (Auto Recalculates on Save/Update/Delete),
 *              Integer Sequence NO, Sanitized FYID & Safe Session Handlers
 *              DEBIT = Income (အပ်ငွေ - Green), CREDIT = Expense (သုံးငွေ - Red), Balance = DEBIT - CREDIT
 */

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
 * 💡 FY String Normalizer (Ensures "FY 2026-2027" or "2026-2027" match)
 */
function normalizeFyStr(fy) {
  if (!fy) return '2026-2027';
  let s = String(fy).trim();
  s = s.replace(/^FY\s*/i, '');
  return s;
}

/**
 * 💡 FYID Sanitizer (Removes .0 decimal artifacts)
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
 * 💡 Cloudflare D1 Batch Running Balance & Sequence NO Recalculation Engine
 * Recalculates all balances chronologically whenever an entry is Added, Updated or Deleted
 */
async function recalculateStudentMoneyBalances(db, fy) {
  try {
    const activeFy = normalizeFyStr(fy);
    const fyPrefixed = `FY ${activeFy}`;

    const rows = await db.prepare(
      `SELECT id, debit, credit FROM student_money WHERE fy = ? OR fy = ? ORDER BY date ASC, id ASC`
    ).bind(activeFy, fyPrefixed).all();

    const list = rows.results || [];
    if (list.length === 0) return;

    const statements = [];
    let currentBal = 0;
    let seqNo = 1;

    for (const row of list) {
      const debit = parseFloat(row.debit || 0);
      const credit = parseFloat(row.credit || 0);
      currentBal = currentBal + debit - credit;

      statements.push(
        db.prepare(`UPDATE student_money SET balances = ?, no = ? WHERE id = ?`).bind(currentBal, seqNo, row.id)
      );
      seqNo++;
    }

    const chunkSize = 100;
    for (let i = 0; i < statements.length; i += chunkSize) {
      const chunk = statements.slice(i, i + chunkSize);
      await db.batch(chunk);
    }
  } catch (e) {
    console.warn("Student Money Running Balance Recalculation Warning:", e);
  }
}

/**
 * 💡 Fetch Student Money Ledger Data
 */
export async function getStudentMoneyData(db, body) {
  try {
    const page = parseInt(body.page, 10) || 1;
    const limit = parseInt(body.limit, 10) || 50;
    const offset = (page - 1) * limit;
    
    const searchVal = String(body.searchVal || '').trim();
    const fyFilter = normalizeFyStr(body.fy || '2026-2027');
    const fyPrefixed = `FY ${fyFilter}`;

    let whereClause = [];
    let params = [];

    // 💡 Strict FY Scoped Filter
    if (fyFilter) {
      whereClause.push(`(fy = ? OR fy = ?)`);
      params.push(fyFilter, fyPrefixed);
    }

    // Search Filter (fyid_name, fyid, student_id)
    if (searchVal) {
      whereClause.push(`(LOWER(fyid_name) LIKE ? OR LOWER(fyid) LIKE ? OR CAST(student_id AS TEXT) LIKE ?)`);
      const q = `%${searchVal.toLowerCase()}%`;
      params.push(q, q, q);
    }

    const whereStr = whereClause.length > 0 ? ` WHERE ` + whereClause.join(` AND `) : ``;

    const countQuery = `SELECT COUNT(*) as count FROM student_money` + whereStr;
    const dataQuery = `SELECT * FROM student_money` + whereStr + ` ORDER BY date ASC, id ASC LIMIT ? OFFSET ?`;

    const totalRows = await db.prepare(countQuery).bind(...params).first('count') || 0;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const list = rowsRes.results || [];

    // 💡 FY-Scoped Totals Calculation
    const statsQuery = `SELECT COALESCE(SUM(debit), 0) as tot_debit, COALESCE(SUM(credit), 0) as tot_credit FROM student_money` + whereStr;
    const statsRes = await db.prepare(statsQuery).bind(...params).first() || { tot_debit: 0, tot_credit: 0 };

    const totalDebit = parseFloat(statsRes.tot_debit || 0);   // Total Income (အပ်ငွေ)
    const totalCredit = parseFloat(statsRes.tot_credit || 0); // Total Expense (သုံးငွေ)

    // Format Output Rows
    const formattedData = list.map((r, i) => ({
      no: r.no !== undefined && r.no !== null ? parseInt(r.no, 10) : (offset + i + 1),
      id: parseCleanIntId(r.student_id || r.id),
      date: r.date || '',
      fy: r.fy || fyFilter,
      fyid: sanitizeFyidStr(r.fyid || ''),
      fyidName: r.fyid_name || r.fyidName || '',
      class: r.class || '',
      method: r.method || 'Cash',
      debit: parseFloat(r.debit || 0),
      credit: parseFloat(r.credit || 0),
      balances: parseFloat(r.balances || 0),
      remark: r.remark || '',
      uniqueId: r.uniqueid || r.uniqueId || `STM_${r.id}`
    }));

    return {
      success: true,
      data: formattedData,
      totalRows,
      stats: {
        totalIncome: totalDebit,            // DEBIT = Total Income (အပ်ငွေ)
        totalExpense: totalCredit,          // CREDIT = Total Expense (သုံးငွေ)
        balance: totalDebit - totalCredit  // Balance = DEBIT - CREDIT
      }
    };
  } catch (err) {
    console.error("Error in getStudentMoneyData:", err);
    return { success: false, message: "ကျောင်းသား အပ်ငွေ/သုံးငွေ စာရင်း ရယူ၍ မရပါ: " + err.message };
  }
}

/**
 * 💡 Save New Student Money Entry
 */
export async function saveStudentMoneyEntry(db, userSession, body) {
  try {
    const uniqueId = body.uniqueId || `STM-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);
    const fyVal = normalizeFyStr(body.fy || "2026-2027");
    const createdBy = userSession?.name || userSession?.username || body.createdBy || 'Admin';

    const cleanStudentId = parseCleanIntId(body.id || body.studentId);
    const cleanFyid = sanitizeFyidStr(body.fyid || '');

    await db.prepare(`
      INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, created_at, uniqueid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      0, // Will be set in recalculation
      body.date || new Date().toISOString().split('T')[0],
      fyVal,
      cleanStudentId,
      cleanFyid,
      body.fyidName || body.name || '',
      body.class || '',
      body.method || 'Cash',
      debit,
      credit,
      0, // Will be set in recalculation
      body.remark || '',
      createdBy,
      new Date().toISOString(),
      uniqueId
    ).run();

    // 💡 Auto Recalculate Running Balances
    await recalculateStudentMoneyBalances(db, fyVal);

    return { 
      success: true, 
      message: "ကျောင်းသား အပ်ငွေ/သုံးငွေ စာရင်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      uniqueId 
    };
  } catch (err) {
    console.error("Error in saveStudentMoneyEntry:", err);
    return { success: false, message: "စာရင်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Update Existing Student Money Entry
 */
export async function updateStudentMoneyEntry(db, userSession, body) {
  try {
    const uniqueId = body.uniqueId || body.uniqueid;
    if (!uniqueId) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);
    const fyVal = normalizeFyStr(body.fy || "2026-2027");
    const cleanStudentId = parseCleanIntId(body.id || body.studentId);
    const cleanFyid = sanitizeFyidStr(body.fyid || '');

    await db.prepare(`
      UPDATE student_money
      SET date = ?, fy = ?, student_id = ?, fyid = ?, fyid_name = ?, class = ?, method = ?, debit = ?, credit = ?, remark = ?
      WHERE uniqueid = ?
    `).bind(
      body.date || new Date().toISOString().split('T')[0],
      fyVal,
      cleanStudentId,
      cleanFyid,
      body.fyidName || body.name || '',
      body.class || '',
      body.method || 'Cash',
      debit,
      credit,
      body.remark || '',
      uniqueId
    ).run();

    // 💡 Auto Recalculate Running Balances
    await recalculateStudentMoneyBalances(db, fyVal);

    return { 
      success: true, 
      message: "ကျောင်းသား အပ်ငွေ/သုံးငွေ စာရင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။" 
    };
  } catch (err) {
    console.error("Error in updateStudentMoneyEntry:", err);
    return { success: false, message: "စာရင်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Delete Student Money Entry
 */
export async function deleteStudentMoneyEntry(db, userSession, body) {
  try {
    const uniqueId = body.uniqueId || body.uniqueid;
    if (!uniqueId) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    // Get FY of the row before deletion to recalculate correctly
    const row = await db.prepare(`SELECT fy FROM student_money WHERE uniqueid = ?`).bind(uniqueId).first();
    const fyVal = row ? normalizeFyStr(row.fy) : "2026-2027";

    await db.prepare(`DELETE FROM student_money WHERE uniqueid = ?`).bind(uniqueId).run();

    // 💡 Auto Recalculate Running Balances
    await recalculateStudentMoneyBalances(db, fyVal);

    return { 
      success: true, 
      message: "ကျောင်းသား အပ်ငွေ/သုံးငွေ စာရင်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။" 
    };
  } catch (err) {
    console.error("Error in deleteStudentMoneyEntry:", err);
    return { success: false, message: "စာရင်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}
