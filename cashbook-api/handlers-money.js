/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - SPMMS HANDLERS (CLOUDFLARE D1)
 * File: handlers-money.js
 * 💡 Features: 3-Ledgers Strict Double-Entry Architecture
 *              🛡️ OVER-TRANSFER GUARD: Prevents transferring more than Finance Vault cash
 *              🔄 NON-DESTRUCTIVE TRANSITIONS: Transfer rows visible without altering Trust KPIs
 *              🚀 RECONCILIATION: O(1) Financial Audit Engine
 * ==============================================================================
 */

import {
  getMyanmarDateString, normalizeFyStr, sanitizeFyidStr, generateUniqueId,
  generateVoucherNo, generateFyNo, recalculateLedgerBalances, getCurrentAcademicYear
} from './utils.js';

function computeAcademicFy(dateStr) {
  if (!dateStr) return getCurrentAcademicYear();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return getCurrentAcademicYear();
  let year = d.getFullYear();
  if (d.getMonth() < 2) year -= 1;
  return `${year}-${year + 1}`;
}

// ==============================================================================
// 💡 1. STUDENT MONEY (MAIN FINANCE & VIRTUAL WALLET)
// ==============================================================================

export async function getStudentMoneyData(db, body) {
  try {
    const fy = normalizeFyStr(body.fy || getCurrentAcademicYear()).replace(/^FY\s*/i, '');
    const searchVal = String(body.searchVal || "").trim();
    const studentIdFilter = parseInt(body.studentId, 10) || 0;
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 20, 10); // 🎯 Default 20 rows per page
    const offset = (page - 1) * limit;

    const dateFrom = String(body.dateFrom || body.fromDate || "").trim();
    const dateTo = String(body.dateTo || body.toDate || "").trim();

    let whereClauses = [`(fy IN (?, ?))`];
    let params = [fy, `FY ${fy}`];

    if (studentIdFilter > 0) {
      whereClauses.push(`(student_id = ? OR id = ?)`);
      params.push(studentIdFilter, studentIdFilter);
    }

    // 🎯 SQL Level Date Filter (D1 Quota သက်သာစေရန်)
    if (dateFrom) {
      whereClauses.push(`date >= ?`);
      params.push(dateFrom);
    }
    if (dateTo) {
      whereClauses.push(`date <= ?`);
      params.push(dateTo);
    }

    if (searchVal) {
      whereClauses.push(`(fyid_name LIKE ? OR fyid LIKE ? OR remark LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    // 🚀 D1 Batch: Count, Filtered Stats, and Cashier Cash in 1 roundtrip
    const [countRow, statsRow, pmStatsRow] = await db.batch([
      db.prepare(`SELECT COUNT(id) as c FROM student_money ${whereSql}`).bind(...params),
      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN student_id IS NOT NULL THEN debit ELSE 0 END), 0) as d,
          COALESCE(SUM(CASE WHEN student_id IS NOT NULL THEN credit ELSE 0 END), 0) as c
        FROM student_money ${whereSql}
      `).bind(...params),
      db.prepare(`
        SELECT COALESCE(SUM(debit - credit), 0) as pm_bal 
        FROM pm_cashier_book WHERE fy IN (?, ?)
      `).bind(fy, `FY ${fy}`)
    ]);

    const totalRows = countRow.results[0]?.c || 0;
    const stats = statsRow.results[0] || { d: 0, c: 0 };
    const pmCashierCash = parseFloat(pmStatsRow.results[0]?.pm_bal || 0);

    const totalIncome = parseFloat(stats.d || 0);
    const totalExpense = parseFloat(stats.c || 0);
    const trustBalance = totalIncome - totalExpense;
    const financeVaultCash = trustBalance - pmCashierCash;

    // 🎯 ORDER BY date DESC, id DESC ဖြင့် အသစ်ဆုံးကို အပေါ်ကထားပြီး LIMIT 20 OFFSET ဖြင့်သာ ဆွဲယူသည်
    const dataQuery = `
      SELECT id, no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, uniqueid 
      FROM student_money ${whereSql} 
      ORDER BY date DESC, id DESC 
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();

    return {
      success: true,
      data: (rowsRes.results || []).map(r => ({
        ...r, studentId: r.student_id, fyidName: r.fyid_name, uniqueId: r.uniqueid
      })),
      totalRows, page, limit,
      stats: { 
        totalIncome: totalIncome, 
        totalExpense: totalExpense, 
        balance: trustBalance,
        pmCashierCash: pmCashierCash,
        financeVaultCash: financeVaultCash
      }
    };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function getStudentMoneySummary(db, body) {
  try {
    const fy = normalizeFyStr(body.fy || getCurrentAcademicYear()).replace(/^FY\s*/i, '');
    const searchVal = String(body.searchVal || "").trim();

    // Exclude system rows
    let whereClauses = [`(fy IN (?, ?)) AND student_id IS NOT NULL`];
    let params = [fy, `FY ${fy}`];

    if (searchVal) {
      whereClauses.push(`(fyid_name LIKE ? OR fyid LIKE ? OR CAST(student_id AS TEXT) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p);
    }

    const query = `
      SELECT student_id as studentId, MAX(fyid) as fyid, MAX(fyid_name) as fyidName, MAX(class) as class,
             SUM(debit) as totalDeposit, SUM(credit) as totalWithdraw, SUM(debit - credit) as netBalance,
             COUNT(student_id) as transactionCount
      FROM student_money WHERE ${whereClauses.join(' AND ')}
      GROUP BY student_id ORDER BY netBalance DESC
    `;
    
    const rowsRes = await db.prepare(query).bind(...params).all();
    const formatted = (rowsRes.results || []).map((r, i) => ({ no: i + 1, ...r }));

    let tD = 0, tW = 0, tB = 0;
    formatted.forEach(r => { tD += r.totalDeposit; tW += r.totalWithdraw; tB += r.netBalance; });

    return { 
      success: true, data: formatted, 
      stats: { totalDeposited: tD, totalWithdrawn: tW, totalBalance: tB, studentCount: formatted.length }
    };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function saveStudentMoneyEntry(db, session, body) {
  try {
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
    
    const fy = normalizeFyStr(body.fy || computeAcademicFy(entryDate));
    const cleanFy = fy.replace(/^FY\s*/i, '');
    const uniqueid = body.uniqueId ? String(body.uniqueId).trim() : generateUniqueId('STM');
    
    const entryType = body.entryType || 'Deposit';
    const debit = parseFloat(body.debit || 0);
    const credit = parseFloat(body.credit || 0);
    const studentId = parseInt(body.studentId, 10) || null;
    const method = body.method || 'Cash';
    
    const batchStatements = [];

    // =========================================================================
    // 💡 SCENARIO 1: TRANSFER TO PM CASHIER (WITH OVER-TRANSFER GUARD)
    // =========================================================================
    if (entryType === 'Transfer to PM Cashier' && credit > 0) {
      const [stuRes, pmRes] = await db.batch([
        db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id IS NOT NULL").bind(cleanFy, `FY ${cleanFy}`),
        db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM pm_cashier_book WHERE fy IN (?, ?)").bind(cleanFy, `FY ${cleanFy}`)
      ]);
      const totalVirtual = parseFloat(stuRes.results[0]?.bal || 0);
      const totalCashier = parseFloat(pmRes.results[0]?.bal || 0);
      const availableFinanceCash = totalVirtual - totalCashier;

      if (credit > availableFinanceCash) {
        return {
          success: false,
          message: `ငွေလွှဲခွင့် မပြုပါ! Finance Vault တွင် လက်ရှိငွေသားလက်ကျန် (${availableFinanceCash.toLocaleString('en-US')} MMK) သာ ရှိသဖြင့် (${credit.toLocaleString('en-US')} MMK) ပိုမိုလွှဲပြောင်း၍ မရပါ။`
        };
      }

      const noPm = await generateFyNo(db, 'pm_cashier_book', fy);
      const vrPm = await generateVoucherNo(db, 'pm_cashier_book', 'PMC', entryDate);
      const respPerson = body.responsibilityPerson || 'Cashier 1';
      const pmRemark = body.remark || `Finance မှ ${respPerson} သို့ အရင်းငွေလွှဲပေးခြင်း`;

      batchStatements.push(
        db.prepare(`INSERT INTO pm_cashier_book (no, date, responsibility_person, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) VALUES (?, ?, ?, 'Float Receive', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`)
        .bind(noPm, entryDate, respPerson, pmRemark, method, credit, vrPm, my, fy, session?.name || 'Finance', `PMC_${uniqueid}`)
      );

      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, NULL, 'TRANSFER', ?, 'Vault Transfer', ?, 0, ?, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, `[Transfer] PM Cashier (${respPerson})`, method, credit, `[Finance Transfer] ${respPerson} သို့ အရင်းလွှဲ: ${pmRemark}`, session?.name || 'Finance', uniqueid)
      );

    } else {
      // =========================================================================
      // 💡 SCENARIO 2: REGULAR STUDENT DEPOSIT OR WITHDRAW
      // =========================================================================

      // 🛡️ STUDENT OVERDRAFT GUARD (ကျောင်းသားလက်ကျန်ထက် ပိုမထုတ်နိုင်စေရန် စစ်ဆေးခြင်း)
      if (entryType === 'Withdraw' && credit > 0 && studentId) {
        const stuBalRow = await db.prepare(
          "SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id = ?"
        ).bind(cleanFy, `FY ${cleanFy}`, studentId).first();
        
        const curStuBal = parseFloat(stuBalRow?.bal || 0);
        if (credit > curStuBal) {
          return {
            success: false,
            message: `ငွေထုတ်ယူခွင့် မပြုပါ! ကျောင်းသားတွင် လက်ရှိမုန့်ဖိုးလက်ကျန် (${curStuBal.toLocaleString('en-US')} MMK) သာ ရှိသဖြင့် (${credit.toLocaleString('en-US')} MMK) ပိုမိုထုတ်ယူခွင့် မရှိပါ။`
          };
        }
      }

      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      const stuName = body.name ? `[${body.fyid}] ${body.name}` : `[ID ${studentId}]`;
      const prefix = entryType === 'Deposit' ? '[Finance] Deposit' : '[Finance] Withdraw';
      const remark = `${prefix}: ${body.remark || ''}`.trim();

      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, studentId, body.fyid || '', stuName, body.class || '', method, debit, credit, remark, session?.name || 'Finance', uniqueid)
      );
    }

    await db.batch(batchStatements);

    if (studentId !== null) {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);
    }
    if (entryType === 'Transfer to PM Cashier') {
      await recalculateLedgerBalances(db, 'pm_cashier_book', fy, entryDate);
    }

    return { success: true, uniqueId: uniqueid };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function deleteStudentMoneyEntry(db, session, body) {
  try {
    const uid = body.uniqueId;
    if (!uid) return { success: false };
    
    const existing = await db.prepare("SELECT fy, date, remark, student_id FROM student_money WHERE uniqueid = ?").bind(uid).first();
    if (!existing) return { success: false };

    const batchStatements = [];
    batchStatements.push(db.prepare("DELETE FROM student_money WHERE uniqueid = ?").bind(uid));
    
    if (existing.remark && existing.remark.includes('Transfer to PM Cashier')) {
      batchStatements.push(db.prepare("DELETE FROM pm_cashier_book WHERE uniqueid = ?").bind(`PMC_${uid}`));
    }

    await db.batch(batchStatements);

    if (existing.student_id !== null) {
      await recalculateLedgerBalances(db, 'student_money', existing.fy.replace(/^FY\s*/i, ''), existing.date);
    }
    if (existing.remark && existing.remark.includes('Transfer to PM Cashier')) {
      await recalculateLedgerBalances(db, 'pm_cashier_book', `FY ${existing.fy.replace(/^FY\s*/i, '')}`, existing.date);
    }

    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}

// ==============================================================================
// 💡 2. PM CASHIER BOOK (WITH RETURN TO FINANCE TRANSITION)
// ==============================================================================

export async function getPmCashierBookData(db, body) {
  try {
    const fy = normalizeFyStr(body.fy || getCurrentAcademicYear());
    const query = `SELECT * FROM pm_cashier_book WHERE fy = ? ORDER BY date DESC, id DESC LIMIT 2000`;
    const res = await db.prepare(query).bind(fy).all();
    return { success: true, data: (res.results || []).map(r => ({ ...r, uniqueId: r.uniqueid })) };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function savePmCashierBookEntry(db, session, body) {
  try {
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || computeAcademicFy(entryDate));
    const cleanFy = fy.replace(/^FY\s*/i, '');
    
    const uniqueid = body.uniqueId ? String(body.uniqueId).trim() : generateUniqueId('PMC');
    const category = body.category || 'PM Withdraw';
    const credit = parseFloat(body.credit || 0);
    const debit = parseFloat(body.debit || 0);
    const respPerson = body.responsibilityPerson || 'Cashier 1';

    // 🛡️ 1. CASHIER FLOAT GUARD: ငွေကိုင်ထံတွင် ငွေသားလက်ကျန် လုံလောက်မှုရှိမရှိ စစ်ဆေးခြင်း
    if (credit > 0) {
      const cashierBalRow = await db.prepare(
        "SELECT COALESCE(SUM(debit - credit), 0) as bal FROM pm_cashier_book WHERE fy IN (?, ?) AND responsibility_person = ?"
      ).bind(cleanFy, `FY ${cleanFy}`, respPerson).first();
      
      const curCashierBal = parseFloat(cashierBalRow?.bal || 0);

      if (credit > curCashierBal) {
        return {
          success: false,
          message: `${respPerson} တွင် ငွေသားလက်ကျန် (${curCashierBal.toLocaleString('en-US')} MMK) သာ ရှိသဖြင့် (${credit.toLocaleString('en-US')} MMK) ထုတ်ပေး/ပြန်လွှဲခွင့် မပြုပါ!`
        };
      }
    }

    // 🛡️ 2. STUDENT OVERDRAFT GUARD: ကျောင်းသားတွင် မုန့်ဖိုးလက်ကျန် လုံလောက်မှုရှိမရှိ စစ်ဆေးခြင်း
    if (category === 'PM Withdraw' && body.studentId > 0 && credit > 0) {
      const stuBalRow = await db.prepare(
        "SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id = ?"
      ).bind(cleanFy, `FY ${cleanFy}`, body.studentId).first();
      
      const curStuBal = parseFloat(stuBalRow?.bal || 0);

      if (credit > curStuBal) {
        return {
          success: false,
          message: `မုန့်ဖိုးထုတ်ပေးခွင့် မပြုပါ! ကျောင်းသားတွင် လက်ရှိမုန့်ဖိုးလက်ကျန် (${curStuBal.toLocaleString('en-US')} MMK) သာ ရှိသဖြင့် (${credit.toLocaleString('en-US')} MMK) ပိုမိုထုတ်ယူခွင့် မရှိပါ။`
        };
      }
    }
    
    const noPm = await generateFyNo(db, 'pm_cashier_book', fy);
    const vrPm = body.vrNo || await generateVoucherNo(db, 'pm_cashier_book', 'PMC', entryDate);
    const batchStatements = [];

    // 1. PM Cashier Entry
    batchStatements.push(
      db.prepare(`INSERT INTO pm_cashier_book (no, date, responsibility_person, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`)
      .bind(noPm, entryDate, respPerson, category, body.description || '', body.method || 'Cash', debit, credit, vrPm, my, fy, session?.name || 'PM Cashier', uniqueid)
    );

    // 2A. Scenario 1: PM Withdraw -> Deduct from Student Wallet
    if (category === 'PM Withdraw' && body.studentId > 0 && credit > 0) {
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      const stuName = body.studentName ? `[${body.fyid}] ${body.studentName}` : `[ID ${body.studentId}]`;
      const desc = `[PM Cashier - ${respPerson}] Withdraw: ${body.description || ''}`.trim();

      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, body.studentId, body.fyid || '', stuName, body.studentClass || '', body.method || 'Cash', credit, desc, session?.name || 'PM Cashier', `STM_${uniqueid}`)
      );
    }
    // 2B. Scenario 2: Return to Finance -> Record Transition in Student Money Book
    else if (category === 'Return to Finance' && credit > 0) {
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      const desc = `[PM Cashier] Return Cash from ${respPerson}: ${body.description || ''}`.trim();

      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, NULL, 'RETURN', ?, 'Vault Return', ?, ?, 0, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, `[Return] Finance Vault (${respPerson})`, body.method || 'Cash', credit, desc, session?.name || 'PM Cashier', `STM_${uniqueid}`)
      );
    }

    await db.batch(batchStatements);

    await recalculateLedgerBalances(db, 'pm_cashier_book', fy, entryDate);
    if (category === 'PM Withdraw') {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);
    }

    return { success: true, uniqueId: uniqueid, vrNo: vrPm };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function deletePmCashierBookEntry(db, session, body) {
  try {
    const uid = body.uniqueId;
    if (!uid) return { success: false };
    
    const existing = await db.prepare("SELECT fy, date, category FROM pm_cashier_book WHERE uniqueid = ?").bind(uid).first();
    if (!existing) return { success: false };

    const batchStatements = [];
    batchStatements.push(db.prepare("DELETE FROM pm_cashier_book WHERE uniqueid = ?").bind(uid));
    
    if (existing.category === 'PM Withdraw' || existing.category === 'Return to Finance') {
      batchStatements.push(db.prepare("DELETE FROM student_money WHERE uniqueid = ?").bind(`STM_${uid}`));
    }

    await db.batch(batchStatements);

    await recalculateLedgerBalances(db, 'pm_cashier_book', existing.fy, existing.date);
    if (existing.category === 'PM Withdraw') {
      await recalculateLedgerBalances(db, 'student_money', existing.fy.replace(/^FY\s*/i, ''), existing.date);
    }

    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}

// ==============================================================================
// 💡 3. CANTEEN BOOK
// ==============================================================================

export async function getCanteenBookData(db, body) {
  try {
    const fy = normalizeFyStr(body.fy || getCurrentAcademicYear());
    const query = `SELECT * FROM canteen_book WHERE fy = ? ORDER BY date DESC, id DESC LIMIT 2000`;
    const res = await db.prepare(query).bind(fy).all();
    return { success: true, data: (res.results || []).map(r => ({ ...r, uniqueId: r.uniqueid })) };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function saveCanteenBookEntry(db, session, body) {
  try {
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const my = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]}-${d.getFullYear()}`;
    const fy = normalizeFyStr(body.fy || computeAcademicFy(entryDate));
    const cleanFy = fy.replace(/^FY\s*/i, '');
    
    const uniqueid = body.uniqueId ? String(body.uniqueId).trim() : generateUniqueId('CAN');
    const category = body.category || 'POS Sales';
    const debit = parseFloat(body.debit || 0);
    const studentId = parseInt(body.studentId, 10) || null;
    
    const noCan = await generateFyNo(db, 'canteen_book', fy);
    const vrCan = body.vrNo || await generateVoucherNo(db, 'canteen_book', 'CAN', entryDate);
    const batchStatements = [];

    // 1. Debit Canteen Book
    batchStatements.push(
      db.prepare(`INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`)
      .bind(noCan, entryDate, category, body.description || '', body.method || 'Transfer', debit, vrCan, my, fy, session?.name || 'System', uniqueid)
    );

    // 2. Deduct from Student Money
    if (category === 'POS Sales' && studentId > 0 && debit > 0) {
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      const stuName = body.studentName ? `[${body.fyid}] ${body.studentName}` : `[ID ${studentId}]`;
      const desc = `[Canteen] POS Sales: ${body.description || ''}`.trim();

      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, studentId, body.fyid || '', stuName, body.studentClass || '', body.method || 'Transfer', debit, desc, session?.name || 'System', `STM_${uniqueid}`)
      );
    }

    await db.batch(batchStatements);

    await recalculateLedgerBalances(db, 'canteen_book', fy, entryDate);
    if (category === 'POS Sales') await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);

    return { success: true, uniqueId: uniqueid };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function deleteCanteenBookEntry(db, session, body) {
  try {
    const uid = body.uniqueId;
    if (!uid) return { success: false };
    
    const existing = await db.prepare("SELECT fy, date, category FROM canteen_book WHERE uniqueid = ?").bind(uid).first();
    if (!existing) return { success: false };

    const batchStatements = [];
    batchStatements.push(db.prepare("DELETE FROM canteen_book WHERE uniqueid = ?").bind(uid));
    
    if (existing.category === 'POS Sales') {
      batchStatements.push(db.prepare("DELETE FROM student_money WHERE uniqueid = ?").bind(`STM_${uid}`));
    }

    await db.batch(batchStatements);

    await recalculateLedgerBalances(db, 'canteen_book', existing.fy, existing.date);
    if (existing.category === 'POS Sales') await recalculateLedgerBalances(db, 'student_money', existing.fy.replace(/^FY\s*/i, ''), existing.date);

    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}

// ==============================================================================
// 💡 4. SPMMS RECONCILIATION AUDIT ENGINE
// ==============================================================================

export async function getSpmmsReconciliation(db, body) {
  try {
    const fy = normalizeFyStr(body.fy || getCurrentAcademicYear()).replace(/^FY\s*/i, '');
    
    const [stuBalRes, pmBalRes] = await db.batch([
      // 1. Total Student Virtual Liability (Only genuine student balances)
      db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id IS NOT NULL").bind(fy, `FY ${fy}`),
      
      // 2. Total PM Cashier Physical Cash in Hand
      db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM pm_cashier_book WHERE fy IN (?, ?)").bind(fy, `FY ${fy}`)
    ]);

    const totalVirtual = parseFloat(stuBalRes.results[0]?.bal || 0);
    const totalCashier = parseFloat(pmBalRes.results[0]?.bal || 0);

    // 3. Finance Vault Physical Cash = Total Student Trust Liability - PM Cashier Float Cash
    const totalFinance = totalVirtual - totalCashier;
    const totalPhysicalCash = totalFinance + totalCashier;

    const variance = totalVirtual - totalPhysicalCash;
    const isMatched = Math.abs(variance) < 0.01;

    return {
      success: true,
      data: {
        totalVirtual,
        totalFinance,
        totalCashier,
        totalPhysicalCash,
        variance,
        isMatched
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}