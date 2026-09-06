/**
 * GOLDEN ERP SYSTEM - STUDENT MONEY LEDGER & WALLET HANDLER (CLOUDFLARE D1)
 * File: handlers-money.js
 * 💡 Features: Crash-Proof Student Name Extraction & Auto-Lookup from student Table,
 *              Individual Student Wallet Summary (Group By Student ID), Statement Timelines,
 *              Chronological Running Balance Recalculator & Idempotent Upsert Engine
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

async function recalculateStudentMoneyBalances(db) {
  try {
    const fysRes = await db.prepare("SELECT DISTINCT fy FROM student_money").all();
    const fys = (fysRes.results || []).map(r => normalizeFyStr(r.fy)).filter(Boolean);

    for (const fyVal of fys) {
      const rows = await db.prepare(
        "SELECT id, debit, credit FROM student_money WHERE fy = ? OR fy = ? ORDER BY date ASC, id ASC"
      ).bind(fyVal, `FY ${fyVal}`).all();

      const list = rows.results || [];
      let currentBal = 0;
      let seqNo = 1;
      const statements = [];

      for (const row of list) {
        currentBal = currentBal + parseFloat(row.debit || 0) - parseFloat(row.credit || 0);
        statements.push(
          db.prepare("UPDATE student_money SET balances = ?, no = ?, fy = ? WHERE id = ?").bind(currentBal, seqNo, fyVal, row.id)
        );
        seqNo++;
      }

      for (let i = 0; i < statements.length; i += 100) {
        await db.batch(statements.slice(i, i + 100));
      }
    }
  } catch (e) {
    console.warn("Student Money Recalculation Warning:", e);
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
        fyid,
        fyid_name as fyidName,
        class,
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
 * 💡 Save Student Money Entry (Crash-Proof Auto Name Lookup)
 */
export async function saveStudentMoneyEntry(db, userSession, body) {
  try {
    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(userSession?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport);

    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : `STM_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const cleanFy = normalizeFyStr(body.fy || "2026-2027");
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
          "SELECT name, fyid_name, class FROM student WHERE student_id = ? OR id = ?"
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
      body.date || new Date().toISOString().split('T')[0],
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
      await recalculateStudentMoneyBalances(db);
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
 * 💡 Update Student Money Entry (Crash-Proof Auto Name Lookup)
 */
export async function updateStudentMoneyEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };

    const cleanFy = normalizeFyStr(body.fy || "2026-2027");
    const studentId = parseInt(body.studentId || body.id, 10) || 1;
    const fyid = sanitizeFyidStr(body.fyid || '');

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
          "SELECT name, fyid_name, class FROM student WHERE student_id = ? OR id = ?"
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
      body.date || '',
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

    await recalculateStudentMoneyBalances(db);

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
 * 💡 Delete Student Money Entry
 */
export async function deleteStudentMoneyEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };

    await db.prepare("DELETE FROM student_money WHERE uniqueid = ?").bind(uniqueid).run();
    await recalculateStudentMoneyBalances(db);

    return {
      success: true,
      message: "ကျောင်းသားငွေစာရင်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in deleteStudentMoneyEntry:", err);
    return { success: false, message: "ကျောင်းသားငွေစာရင်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}
