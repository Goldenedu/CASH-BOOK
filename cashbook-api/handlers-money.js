/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - SPMMS HANDLERS (CLOUDFLARE D1)
 * File: handlers-money.js
 * 💡 Features: 3-Ledgers Strict Double-Entry Architecture
 *              🚀 Fixed: computeAcademicFy local helper (No missing import error)
 *              🚀 Foreign Key Safe: System rows use NULL student_id
 *              🔄 Bidirectional Transfers: Finance <-> PM Cashier Cash Flow
 *              🛡️ RECONCILIATION: O(1) Financial Audit Engine included
 * ==============================================================================
 */

import {
  getMyanmarDateString, normalizeFyStr, sanitizeFyidStr, generateUniqueId,
  generateVoucherNo, generateFyNo, recalculateLedgerBalances, getCurrentAcademicYear
} from './utils.js';

// 💡 Local Helper: Calculate Academic FY safely from any Date string (March Boundary)
function computeAcademicFy(dateStr) {
  if (!dateStr) return getCurrentAcademicYear();
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return getCurrentAcademicYear();
  let year = d.getFullYear();
  if (d.getMonth() < 2) year -= 1; // Jan & Feb belong to previous academic year
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
    const limit = parseInt(body.limit || 50, 10);
    const offset = (page - 1) * limit;

    let whereClauses = [`(fy IN (?, ?))`];
    let params = [fy, `FY ${fy}`];

    if (studentIdFilter > 0) {
      whereClauses.push(`(student_id = ? OR id = ?)`);
      params.push(studentIdFilter, studentIdFilter);
    }

    if (searchVal) {
      whereClauses.push(`(fyid_name LIKE ? OR fyid LIKE ? OR remark LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p);
    }

    const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

    const [countRow, statsRow] = await db.batch([
      db.prepare(`SELECT COUNT(id) as c FROM student_money ${whereSql}`).bind(...params),
      db.prepare(`SELECT SUM(debit) as d, SUM(credit) as c FROM student_money WHERE fy IN (?, ?)`).bind(fy, `FY ${fy}`)
    ]);

    const totalRows = countRow.results[0]?.c || 0;
    const stats = statsRow.results[0] || { d: 0, c: 0 };

    const dataQuery = `
      SELECT id, no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, uniqueid 
      FROM student_money ${whereSql} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();

    return {
      success: true,
      data: (rowsRes.results || []).map(r => ({
        ...r, studentId: r.student_id, fyidName: r.fyid_name, uniqueId: r.uniqueid
      })),
      totalRows, page, limit,
      stats: { totalIncome: stats.d, totalExpense: stats.c, balance: stats.d - stats.c }
    };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function getStudentMoneySummary(db, body) {
  try {
    const fy = normalizeFyStr(body.fy || getCurrentAcademicYear()).replace(/^FY\s*/i, '');
    const searchVal = String(body.searchVal || "").trim();

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

    if (entryType === 'Transfer to PM Cashier' && credit > 0) {
      // 1. Debit -> PM Cashier Book
      const noPm = await generateFyNo(db, 'pm_cashier_book', fy);
      const vrPm = await generateVoucherNo(db, 'pm_cashier_book', 'PMC', entryDate);
      const pmRemark = body.remark || "Finance မှ PM Cashier သို့ အရင်းငွေလွှဲပေးခြင်း";
      const respPerson = body.responsibilityPerson || 'Cashier 1';

      batchStatements.push(
        db.prepare(`INSERT INTO pm_cashier_book (no, date, responsibility_person, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) VALUES (?, ?, ?, 'Float Receive', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`)
        .bind(noPm, entryDate, respPerson, pmRemark, method, credit, vrPm, my, fy, session?.name || 'Finance', `PMC_${uniqueid}`)
      );

      // 2. Credit -> Student Money (student_id = NULL for system vault transfer)
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, NULL, 'FINANCE', 'Finance Vault', 'Vault', ?, 0, ?, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, method, credit, `[Finance] Transfer to PM Cashier (${respPerson}): ${pmRemark}`, session?.name || 'Finance', uniqueid)
      );

    } else {
      // Regular Student Deposit or Withdraw
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

    await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);
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
    
    const existing = await db.prepare("SELECT fy, date, remark FROM student_money WHERE uniqueid = ?").bind(uid).first();
    if (!existing) return { success: false };

    const batchStatements = [];
    batchStatements.push(db.prepare("DELETE FROM student_money WHERE uniqueid = ?").bind(uid));
    
    if (existing.remark && existing.remark.includes('Transfer to PM Cashier')) {
      batchStatements.push(db.prepare("DELETE FROM pm_cashier_book WHERE uniqueid = ?").bind(`PMC_${uid}`));
    } else if (existing.remark && existing.remark.includes('Settlement to Canteen')) {
      batchStatements.push(db.prepare("DELETE FROM canteen_book WHERE uniqueid = ?").bind(`CAN_${uid}`));
    }

    await db.batch(batchStatements);

    await recalculateLedgerBalances(db, 'student_money', existing.fy.replace(/^FY\s*/i, ''), existing.date);
    if (existing.remark && existing.remark.includes('Transfer to PM Cashier')) {
      await recalculateLedgerBalances(db, 'pm_cashier_book', `FY ${existing.fy.replace(/^FY\s*/i, '')}`, existing.date);
    }

    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}

// ==============================================================================
// 💡 2. PM CASHIER BOOK (WITH BIDIRECTIONAL CASH RETURN SUPPORT)
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
    
    // 🎯 FIX: Used computeAcademicFy instead of undefined function
    const fy = normalizeFyStr(body.fy || computeAcademicFy(entryDate));
    const cleanFy = fy.replace(/^FY\s*/i, '');
    
    const uniqueid = body.uniqueId ? String(body.uniqueId).trim() : generateUniqueId('PMC');
    const category = body.category || 'PM Withdraw';
    const credit = parseFloat(body.credit || 0);
    const debit = parseFloat(body.debit || 0);
    const respPerson = body.responsibilityPerson || 'Cashier 1';
    
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
    // 2B. Scenario 2: Return to Finance -> Debit to Student Money Vault (student_id = NULL)
    else if (category === 'Return to Finance' && credit > 0) {
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      const desc = `[PM Cashier] Return Cash from ${respPerson}: ${body.description || ''}`.trim();

      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, NULL, 'FINANCE', 'Finance Vault', 'Vault', ?, ?, 0, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, body.method || 'Cash', credit, desc, session?.name || 'PM Cashier', `STM_${uniqueid}`)
      );
    }

    await db.batch(batchStatements);

    // Atomic Recalculations
    await recalculateLedgerBalances(db, 'pm_cashier_book', fy, entryDate);
    if (category === 'PM Withdraw' || category === 'Return to Finance') {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);
    }

    return { success: true, uniqueId: uniqueid };
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
    if (existing.category === 'PM Withdraw' || existing.category === 'Return to Finance') {
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
    
    // 🎯 FIX: Used computeAcademicFy instead of undefined function
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
    
    const [stuBalRes, pmBalRes, finRes] = await db.batch([
      // 1. Total Student Virtual Balance (Only student accounts)
      db.prepare("SELECT SUM(debit - credit) as bal FROM student_money WHERE fy IN (?, ?) AND student_id IS NOT NULL").bind(fy, `FY ${fy}`),
      
      // 2. Total PM Cashier Physical Cash in Hand
      db.prepare("SELECT SUM(debit - credit) as bal FROM pm_cashier_book WHERE fy IN (?, ?)").bind(fy, `FY ${fy}`),
      
      // 3. Finance Vault Physical Cash
      db.prepare(`
        SELECT SUM(
          CASE 
            WHEN student_id IS NOT NULL THEN (debit - (CASE WHEN remark LIKE '[Finance] Withdraw%' THEN credit ELSE 0 END))
            ELSE (debit - credit)
          END
        ) as bal 
        FROM student_money WHERE fy IN (?, ?)
      `).bind(fy, `FY ${fy}`)
    ]);

    const totalVirtual = parseFloat(stuBalRes.results[0]?.bal || 0);
    const totalCashier = parseFloat(pmBalRes.results[0]?.bal || 0);
    const totalFinance = parseFloat(finRes.results[0]?.bal || 0);

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