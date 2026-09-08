/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - STUDENT MONEY LEDGER & WALLET HANDLER (CLOUDFLARE D1)
 * File: handlers-money.js
 * 💡 Features: Crash-Proof Student Name Extraction & Auto-Lookup from student Table,
 *              Individual Student Wallet Summary (Group By Student ID), Statement Timelines,
 *              ⚡ O(1) D1 Write-Optimized Window Function Recalculator (Zero D1 Quota Waste),
 *              🎯 Dynamic Date-derived FY Auto-Detection & Multi-FY Cross-Year Transition Safety
 * ==============================================================================
 */

function normalizeFyStr(fy) {
  if (!fy) return '2026-2027';
  let s = String(fy).trim();
  return s.replace(/^FY\s*/i, '');
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

/**
 * ⚡ FIX PERF #1: O(1) Single-Query Window Function Recalculation Engine
 * JS loops နှင့် 100-batch updates များကို ဖယ်ရှားပြီး
 * SQLite Window Function ဖြင့် ၁ ကြိမ်တည်း Update လုပ်သည်။
 */
async function recalculateStudentMoneyBalances(db, targetFy = null) {
  try {
    if (targetFy) {
      // 🎯 သီးသန့် FY တစ်ခုတည်းကိုသာ ထိရောက်စွာ Update လုပ်ခြင်း
      const cleanFy = normalizeFyStr(targetFy);
      const fyPrefixed = `FY ${cleanFy}`;

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
          FROM student_money
          WHERE fy = ? OR fy = ?
        )
        UPDATE student_money 
        SET no = (SELECT calc_no FROM calculated WHERE calculated.id = student_money.id),
            balances = (SELECT calc_bal FROM calculated WHERE calculated.id = student_money.id),
            fy = ?
        WHERE id IN (SELECT id FROM calculated);
      `).bind(cleanFy, fyPrefixed, cleanFy).run();
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
          FROM student_money
        )
        UPDATE student_money 
        SET no = (SELECT calc_no FROM calculated WHERE calculated.id = student_money.id),
            balances = (SELECT calc_bal FROM calculated WHERE calculated.id = student_money.id)
        WHERE id IN (SELECT id FROM calculated);
      `).run();
    }
  } catch (e) {
    console.warn("Student Money Recalculation Warning:", e.message);
  }
}

/**
 * 💡 1. Fetch Transaction History (Tab 1)
 */
export async function getStudentMoneyData(db, body) {
  try {
    const activeFy = normalizeFyStr(body.fy || "2026-2027");
    const searchVal = String(body.searchVal || "").trim();
    const studentIdFilter = parseInt(body.studentId, 10) || 0;
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 50, 10);
    const offset = (page - 1) * limit;

    let whereClauses = [`(fy = ? OR fy = ?)`];
    let params = [activeFy, `FY ${activeFy}`];

    if (studentIdFilter > 0) {
      whereClauses.push(`(student_id = ? OR id = ?)`);
      params.push(studentIdFilter, studentIdFilter);
    }

    if (searchVal) {
      whereClauses.push(`(fyid_name LIKE ? OR fyid LIKE ? OR CAST(student_id AS TEXT) LIKE ? OR class LIKE ? OR remark LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    // Overall FY Stats
    const statsResult = await db.prepare(`
      SELECT 
        COALESCE(SUM(debit), 0) as totalIncome,
        COALESCE(SUM(credit), 0) as totalExpense
      FROM student_money
      WHERE fy = ? OR fy = ?
    `).bind(activeFy, `FY ${activeFy}`).first() || { totalIncome: 0, totalExpense: 0 };

    const totalIncome = parseFloat(statsResult.totalIncome || 0);
    const totalExpense = parseFloat(statsResult.totalExpense || 0);
    const balance = totalIncome - totalExpense;

    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM student_money ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    const dataQuery = `
      SELECT * FROM student_money 
      ${whereSql} 
      ORDER BY id DESC 
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => ({
      id: row.id,
      no: parseInt(row.no, 10) || row.id,
      date: row.date || '',
      fy: normalizeFyStr(row.fy || activeFy),
      studentId: row.student_id || row.id,
      fyid: sanitizeFyidStr(row.fyid || ''),
      fyidName: row.fyid_name || '',
      class: row.class || '',
      method: row.method || 'Cash',
      debit: parseFloat(row.debit || 0),
      credit: parseFloat(row.credit || 0),
      balances: parseFloat(row.balances || 0),
      remark: row.remark || '',
      uniqueId: row.uniqueid || `STM_${row.id}`
    }));

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
    console.error("Error in getStudentMoneyData:", err);
    return { success: false, message: "Student Money စာရင်း ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 2. Fetch Individual Student Wallet Summary (Tab 2 - 1 Student = 1 Row)
 */
export async function getStudentMoneySummary(db, body) {
  try {
    const activeFy = normalizeFyStr(body.fy || "2026-2027");
    const searchVal = String(body.searchVal || "").trim();

    let whereClauses = [`(fy = ? OR fy = ?)`];
    let params = [activeFy, `FY ${activeFy}`];

    if (searchVal) {
      whereClauses.push(`(fyid_name LIKE ? OR fyid LIKE ? OR CAST(student_id AS TEXT) LIKE ? OR class LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    const query = `
      SELECT 
        student_id as studentId,
        MAX(fyid) as fyid,
        MAX(fyid_name) as fyidName,
        MAX(class) as class,
        COALESCE(SUM(debit), 0) as totalDeposit,
        COALESCE(SUM(credit), 0) as totalWithdraw,
        COALESCE(SUM(debit - credit), 0) as netBalance,
        COUNT(*) as transactionCount,
        MAX(date) as lastDate
      FROM student_money
      ${whereSql}
      GROUP BY student_id
      ORDER BY netBalance DESC, student_id ASC
    `;

    const rowsRes = await db.prepare(query).bind(...params).all();
    const rawList = rowsRes.results || [];

    let totalDepositedAll = 0;
    let totalWithdrawnAll = 0;
    let totalNetBalanceAll = 0;
    let positiveCount = 0;
    let negativeCount = 0;
    let zeroCount = 0;

    const formattedList = rawList.map((r, idx) => {
      const bal = Number(r.netBalance || 0);
      totalDepositedAll += Number(r.totalDeposit || 0);
      totalWithdrawnAll += Number(r.totalWithdraw || 0);
      totalNetBalanceAll += bal;

      if (bal > 0) positiveCount++;
      else if (bal < 0) negativeCount++;
      else zeroCount++;

      return {
        no: idx + 1,
        studentId: r.studentId,
        fyid: sanitizeFyidStr(r.fyid || ''),
        fyidName: r.fyidName || '',
        class: r.class || '',
        totalDeposit: Number(r.totalDeposit || 0),
        totalWithdraw: Number(r.totalWithdraw || 0),
        netBalance: bal,
        transactionCount: Number(r.transactionCount || 0),
        lastDate: r.lastDate || ''
      };
    });

    return {
      success: true,
      data: formattedList,
      totalStudents: formattedList.length,
      stats: {
        totalDeposited: totalDepositedAll,
        totalWithdrawn: totalWithdrawnAll,
        totalBalance: totalNetBalanceAll,
        studentCount: formattedList.length,
        positiveCount,
        negativeCount,
        zeroCount
      }
    };
  } catch (err) {
    console.error("Error in getStudentMoneySummary:", err);
    return { success: false, message: "ကျောင်းသား လက်ကျန်ချုပ် ရယူ၍ မရပါ: " + err.message };
  }
}

/**
 * 💡 Save Student Money Entry (Crash-Proof Auto Name Lookup & Scoped Recalculation)
 */
export async function saveStudentMoneyEntry(db, userSession, body) {
  try {
    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(userSession?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport);

    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : `STM_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // 🎯 Transaction Date အလိုက် Dynamic FY ကို တွက်ချက်ခြင်း
    const entryDate = body.date || new Date().toISOString().split('T')[0];
    const d = new Date(entryDate);
    let fyYear = d.getFullYear();
    if (d.getMonth() < 3) fyYear -= 1;
    const computedFy = `${fyYear}-${fyYear + 1}`;
    const cleanFy = normalizeFyStr(body.fy || computedFy);

    const studentId = parseInt(body.studentId || body.id, 10) || 1;
    const fyid = sanitizeFyidStr(body.fyid || '');

    // 💡 INTELLIGENT STUDENT NAME RESOLVER
    let studentName = String(body.name || body.studentName || '').trim();
    let rawFyidName = String(body.fyidName || body.fyid_name || '').trim();
    let studentClass = String(body.class || '').trim();

    if (!studentName && rawFyidName.includes(']')) {
      const parts = rawFyidName.split(']');
      studentName = parts.length > 1 ? parts[1].trim() : rawFyidName;
    }

    // 💡 Auto-Lookup from `student` table if name or class is missing
    if ((!studentName || !studentClass) && studentId) {
      try {
        const studentRow = await db.prepare(
          "SELECT name, fyid_name, class FROM student WHERE student_id = ? OR id = ? LIMIT 1"
        ).bind(studentId, studentId).first();

        if (studentRow) {
          if (!studentName) studentName = studentRow.name || '';
          if (!rawFyidName) rawFyidName = studentRow.fyid_name || '';
          if (!studentClass) studentClass = studentRow.class || '';
        }
      } catch (e) {}
    }

    const finalFyidName = rawFyidName || (studentName ? `[${fyid}] ${studentName}` : `[${fyid}] ID ${studentId}`);

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);

    const lastNoRow = await db.prepare(
      "SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM student_money WHERE fy = ? OR fy = ?"
    ).bind(cleanFy, `FY ${cleanFy}`).first();
    const nextNo = (isMigration && body.no) ? parseInt(body.no, 10) : ((lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0) + 1);

    const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";

    await db.prepare(`
      ${sqlVerb} student_money (
        no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, datetime('now'), ?)
    `).bind(
      nextNo,
      entryDate,
      cleanFy,
      studentId,
      fyid,
      finalFyidName,
      studentClass,
      body.method || 'Cash',
      debit,
      credit,
      body.remark || '',
      userSession?.name || 'Admin',
      uniqueid
    ).run();

    if (!isMigration) {
      // ⚡ သက်ဆိုင်ရာ FY တစ်ခုတည်းကိုသာ O(1) Window function ဖြင့် ချက်ချင်း recalculate ပြုလုပ်သည်
      await recalculateStudentMoneyBalances(db, cleanFy);
    }

    return {
      success: true,
      message: "ကျောင်းသားငွေစာရင်း အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      uniqueId: uniqueid
    };
  } catch (err) {
    console.error("Error in saveStudentMoneyEntry:", err);
    return { success: false, message: "ကျောင်းသားငွေစာရင်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Update Student Money Entry (Crash-Proof Auto Name Lookup & Multi-FY Safety)
 */
export async function updateStudentMoneyEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };

    // 🔒 Capture existing FY before update
    const existing = await db.prepare("SELECT * FROM student_money WHERE uniqueid = ?").bind(uniqueid).first();
    if (!existing) return { success: false, message: "ပြင်ဆင်မည့် ကျောင်းသားငွေစာရင်း ရှာမတွေ့ပါ။" };

    const oldFy = existing?.fy ? normalizeFyStr(existing.fy) : null;

    const entryDate = body.date || existing.date || new Date().toISOString().split('T')[0];
    const d = new Date(entryDate);
    let fyYear = d.getFullYear();
    if (d.getMonth() < 3) fyYear -= 1;
    const computedFy = `${fyYear}-${fyYear + 1}`;
    const cleanFy = normalizeFyStr(body.fy || computedFy);

    const studentId = parseInt(body.studentId || body.id, 10) || existing.student_id || 1;
    const fyid = sanitizeFyidStr(body.fyid || existing.fyid || '');

    let studentName = String(body.name || body.studentName || '').trim();
    let rawFyidName = String(body.fyidName || body.fyid_name || '').trim();
    let studentClass = String(body.class || '').trim();

    if (!studentName && rawFyidName.includes(']')) {
      const parts = rawFyidName.split(']');
      studentName = parts.length > 1 ? parts[1].trim() : rawFyidName;
    }

    if ((!studentName || !studentClass) && studentId) {
      try {
        const studentRow = await db.prepare(
          "SELECT name, fyid_name, class FROM student WHERE student_id = ? OR id = ? LIMIT 1"
        ).bind(studentId, studentId).first();

        if (studentRow) {
          if (!studentName) studentName = studentRow.name || '';
          if (!rawFyidName) rawFyidName = studentRow.fyid_name || '';
          if (!studentClass) studentClass = studentRow.class || '';
        }
      } catch (e) {}
    }

    const finalFyidName = rawFyidName || (studentName ? `[${fyid}] ${studentName}` : `[${fyid}] ID ${studentId}`);

    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);

    await db.prepare(`
      UPDATE student_money SET 
        date = ?, fy = ?, student_id = ?, fyid = ?, fyid_name = ?, class = ?, method = ?, debit = ?, credit = ?, remark = ?
      WHERE uniqueid = ?
    `).bind(
      entryDate,
      cleanFy,
      studentId,
      fyid,
      finalFyidName,
      studentClass,
      body.method || 'Cash',
      debit,
      credit,
      body.remark || '',
      uniqueid
    ).run();

    // ⚡ သက်ဆိုင်ရာ cleanFy ၏ balances ကို recalculate ပြုလုပ်သည်
    await recalculateStudentMoneyBalances(db, cleanFy);

    // ⚡ အကယ်၍ စာရင်းအား အခြား FY သို့ ရွှေ့လိုက်ပါက FY အဟောင်းကိုပါ အလိုအလျောက် ပြန်ညှိပေးသည်
    if (oldFy && oldFy !== cleanFy) {
      await recalculateStudentMoneyBalances(db, oldFy);
    }

    return {
      success: true,
      message: "ကျောင်းသားငွေစာရင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in updateStudentMoneyEntry:", err);
    return { success: false, message: "ကျောင်းသားငွေစာရင်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Delete Student Money Entry (Fast Scoped Recalculation)
 */
export async function deleteStudentMoneyEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };

    const existing = await db.prepare("SELECT fy FROM student_money WHERE uniqueid = ?").bind(uniqueid).first();
    if (!existing) return { success: false, message: "ဖျက်သိမ်းမည့် ကျောင်းသားငွေစာရင်း ရှာမတွေ့ပါ။" };

    const targetFy = existing?.fy ? normalizeFyStr(existing.fy) : null;

    await db.prepare("DELETE FROM student_money WHERE uniqueid = ?").bind(uniqueid).run();

    // ⚡ သက်ဆိုင်ရာ targetFy ကိုသာ 1-Query ဖြင့် recalculate လုပ်သည်
    await recalculateStudentMoneyBalances(db, targetFy);

    return {
      success: true,
      message: "ကျောင်းသားငွေစာရင်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in deleteStudentMoneyEntry:", err);
    return { success: false, message: "ကျောင်းသားငွေစာရင်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}
