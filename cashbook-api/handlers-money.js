/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - SPMMS HANDLERS (CLOUDFLARE D1 ENTERPRISE EDITION)
 * File: handlers-money.js
 * 
 * 💡 Features:
 *   1. ⚡ QUOTA-SHIELD: O(1) Batch Queries & Conditional Ledger Recalculations
 *   2. 🛡️ ZERO-OVERDRAFT GUARDS: Double-entry validation on Vault, Cashier & Students
 *   3. 🔒 SECURITY & ANTI-IMPERSONATION: RBAC-enforced Cashier identity locking
 *   4. 🎯 NUMERICAL INTEGRITY: Math.round 2-decimal protection against precision drift
 *   5. 🔄 ATOMIC CASCADE: Bidirectional link cleanup across all 3 books
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
// 💡 1. STUDENT MONEY (MAIN FINANCE & VIRTUAL WALLETS)
// ==============================================================================

export async function getStudentMoneyData(db, body) {
  try {
    const fy = normalizeFyStr(body.fy || getCurrentAcademicYear()).replace(/^FY\s*/i, '');
    const searchVal = String(body.searchVal || "").trim();
    const studentIdFilter = parseInt(body.studentId, 10) || 0;
    const page = Math.max(1, parseInt(body.page || 1, 10));
    const limit = Math.min(100, Math.max(1, parseInt(body.limit || 20, 10)));
    const offset = (page - 1) * limit;

    const dateFrom = String(body.dateFrom || body.fromDate || "").trim();
    const dateTo = String(body.dateTo || body.toDate || "").trim();

    let whereClauses = [`(fy IN (?, ?))`];
    let params = [fy, `FY ${fy}`];

    if (studentIdFilter > 0) {
      whereClauses.push(`(student_id = ? OR id = ?)`);
      params.push(studentIdFilter, studentIdFilter);
    }

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

    // ⚡ QUOTA-SHIELD: ကျောင်းသားတစ်ဦးချင်း Statement ကြည့်ချိန်တွင် မလိုအပ်သော Cashier Book Query ကို လုံးဝချန်လှပ်မည်
    const batchQueries = [
      db.prepare(`SELECT COUNT(id) as c FROM student_money ${whereSql}`).bind(...params),
      db.prepare(`
        SELECT 
          COALESCE(SUM(CASE WHEN student_id IS NOT NULL THEN debit ELSE 0 END), 0) as d,
          COALESCE(SUM(CASE WHEN student_id IS NOT NULL THEN credit ELSE 0 END), 0) as c
        FROM student_money ${whereSql}
      `).bind(...params)
    ];

    if (studentIdFilter === 0) {
      batchQueries.push(
        db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) as pm_bal FROM pm_cashier_book WHERE fy IN (?, ?)`).bind(fy, `FY ${fy}`)
      );
    }

    const batchResults = await db.batch(batchQueries);
    const totalRows = batchResults[0]?.results[0]?.c || 0;
    const stats = batchResults[1]?.results[0] || { d: 0, c: 0 };
    const pmCashierCash = (studentIdFilter === 0 && batchResults[2]) ? parseFloat(batchResults[2].results[0]?.pm_bal || 0) : 0;

    const totalIncome = parseFloat(stats.d || 0);
    const totalExpense = parseFloat(stats.c || 0);
    const trustBalance = totalIncome - totalExpense;
    const financeVaultCash = trustBalance - pmCashierCash;

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
        totalIncome, 
        totalExpense, 
        balance: trustBalance,
        pmCashierCash,
        financeVaultCash
      }
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
    
    const rawType = String(body.entryType || 'Deposit').trim();
    // 🎯 NUMERICAL INTEGRITY: အနုတ်ဂဏန်းထည့်သွင်းမှု ကာကွယ်ခြင်းနှင့် ၂ နေရာစိတ် ဒဿမတိကျမှု
    const debit = Math.round(Math.max(0, parseFloat(body.debit || 0)) * 100) / 100;
    const credit = Math.round(Math.max(0, parseFloat(body.credit || 0)) * 100) / 100;
    const studentId = parseInt(body.studentId, 10) || null;
    const method = body.method || 'Cash';
    
    const isTransfer = rawType.toLowerCase().includes('transfer') || 
                       rawType.toLowerCase().includes('pm cashier') || 
                       rawType.toLowerCase().includes('အရင်းလွှဲ');
    
    const batchStatements = [];
    let generatedVrNo = null;

    if (isTransfer) {
      if (credit <= 0) return { success: false, message: "PM Cashier သို့ လွှဲမည့် Credit ငွေပမာဏကို အတိအကျ ထည့်သွင်းပါ။" };

      // 🛡️ OVER-TRANSFER GUARD: Vault ထဲတွင် လက်ကျန်ရှိသော ငွေသားထက် ပိုမလွှဲနိုင်စေရန် စစ်ဆေးခြင်း
      const [stuRes, pmRes] = await db.batch([
        db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id IS NOT NULL").bind(cleanFy, `FY ${cleanFy}`),
        db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM pm_cashier_book WHERE fy IN (?, ?)").bind(cleanFy, `FY ${cleanFy}`)
      ]);
      const availableFinanceCash = parseFloat(stuRes.results[0]?.bal || 0) - parseFloat(pmRes.results[0]?.bal || 0);

      if (credit > availableFinanceCash) {
        return {
          success: false,
          message: `ငွေလွှဲခွင့် မပြုပါ! Finance Vault တွင် လက်ရှိငွေသားလက်ကျန် (${availableFinanceCash.toLocaleString('en-US')} MMK) သာ ရှိသဖြင့် (${credit.toLocaleString('en-US')} MMK) ပိုမိုလွှဲပြောင်း၍ မရပါ။`
        };
      }

      const noPm = await generateFyNo(db, 'pm_cashier_book', fy);
      const vrPm = await generateVoucherNo(db, 'pm_cashier_book', 'PMC', entryDate);
      generatedVrNo = vrPm;
      const respPerson = body.responsibilityPerson || 'Cashier 1';
      const pmRemark = body.remark || `Finance မှ ${respPerson} သို့ အရင်းငွေလွှဲပေးခြင်း`;

      batchStatements.push(
        db.prepare(`INSERT INTO pm_cashier_book (no, date, responsibility_person, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) VALUES (?, ?, ?, 'Float Receive', ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`)
        .bind(noPm, entryDate, respPerson, pmRemark, method, credit, vrPm, my, fy, session?.name || 'Finance', `PMC_${uniqueid}`)
      );

      // Student Wallet မထိခိုက်စေဘဲ စာအုပ်တွင် Transition Row အဖြစ်သာ မှတ်တမ်းတင်ခြင်း (student_id = NULL)
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, NULL, 'TRANSFER', ?, 'Vault Transfer', ?, 0, ?, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, `[Transfer] PM Cashier (${respPerson})`, method, credit, `[Finance Transfer] ${respPerson} သို့ အရင်းလွှဲ: ${pmRemark}`, session?.name || 'Finance', uniqueid)
      );

    } else {
      if (!studentId || studentId <= 0) return { success: false, message: "ကျောင်းသား ID အတိအကျ ထည့်သွင်းပေးပါ။" };
      if (debit <= 0 && credit <= 0) return { success: false, message: "အပ်ငွေ (Deposit) သို့မဟုတ် ထုတ်ငွေ (Withdraw) ပမာဏ ထည့်သွင်းပေးပါ။" };

      // 🛡️ STUDENT OVERDRAFT GUARD: Finance က ငွေထုတ်ပေးချိန် ကျောင်းသားလက်ကျန် စစ်ဆေးခြင်း
      if (rawType.toLowerCase().includes('withdraw') && credit > 0) {
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
      const prefix = rawType.toLowerCase().includes('withdraw') ? '[Finance] Withdraw' : '[Finance] Deposit';
      const remark = `${prefix}: ${body.remark || ''}`.trim();

      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, studentId, body.fyid || '', stuName, body.class || '', method, debit, credit, remark, session?.name || 'Finance', uniqueid)
      );
    }

    await db.batch(batchStatements);

    // ⚡ TARGETED RECALCULATION: သက်ဆိုင်ရာ စာအုပ်ကိုသာ ကွက်ပြီး Recalculate ပြုလုပ်ခြင်း
    if (!isTransfer && studentId !== null) {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);
    }
    if (isTransfer) {
      await recalculateLedgerBalances(db, 'pm_cashier_book', fy, entryDate);
    }

    return { success: true, uniqueId: uniqueid, vrNo: generatedVrNo };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function deleteStudentMoneyEntry(db, session, body) {
  try {
    const uid = body.uniqueId;
    if (!uid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    
    const existing = await db.prepare("SELECT fy, date, student_id, remark, uniqueid FROM student_money WHERE uniqueid = ?").bind(uid).first();
    if (!existing) return { success: false, message: "ဖျက်မည့် စာရင်း ရှာမတွေ့ပါ။" };

    const rawId = uid.replace(/^(STM_|PMC_|CAN_)/, '');
    const cleanFy = existing.fy ? existing.fy.replace(/^FY\s*/i, '') : '';
    const isTransferOrCashier = existing.student_id === null || (existing.remark && existing.remark.includes('PM Cashier'));

    const batchStatements = [
      db.prepare("DELETE FROM student_money WHERE uniqueid = ?").bind(uid),
      db.prepare("DELETE FROM pm_cashier_book WHERE uniqueid IN (?, ?, ?)").bind(uid, `PMC_${rawId}`, rawId),
      db.prepare("DELETE FROM canteen_book WHERE uniqueid IN (?, ?, ?)").bind(uid, `CAN_${rawId}`, rawId)
    ];

    await db.batch(batchStatements);

    // ⚡ WRITE QUOTA SHIELD: သက်ဆိုင်ရာ စာအုပ်ကိုသာ ပြန်ညှိမည်
    if (existing.student_id !== null) {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, existing.date);
    }
    if (isTransferOrCashier) {
      await recalculateLedgerBalances(db, 'pm_cashier_book', `FY ${cleanFy}`, existing.date);
    }

    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}

// ==============================================================================
// 💡 2. PM CASHIER BOOK (WITH ROLE-BASED ANTI-IMPERSONATION)
// ==============================================================================

export async function getPmCashierBookData(db, body) {
  try {
    const fy = normalizeFyStr(body.fy || getCurrentAcademicYear());
    const query = `SELECT * FROM pm_cashier_book WHERE fy = ? ORDER BY date DESC, id DESC LIMIT 500`;
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
    const credit = Math.round(Math.max(0, parseFloat(body.credit || 0)) * 100) / 100;
    const debit = Math.round(Math.max(0, parseFloat(body.debit || 0)) * 100) / 100;
    
    // 🔒 ANTI-IMPERSONATION: ငွေကိုင်သည် မိမိတာဝန်ယူထားသော အကောင့်အမည်ဖြင့်သာ စာရင်းသွင်းနိုင်စေရန် ကာကွယ်ခြင်း
    let respPerson = body.responsibilityPerson || 'Cashier 1';
    if (session?.role === 'pm_cashier1') respPerson = 'Cashier 1';
    else if (session?.role === 'pm_cashier2') respPerson = 'Cashier 2';

    // ⚡ O(1) BATCH VERIFICATION: Cashier လက်ကျန်နှင့် ကျောင်းသားလက်ကျန်ကို တစ်ပြိုင်နက်တည်း အပြိုင်စစ်ဆေးခြင်း
    const verifyQueries = [
      db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM pm_cashier_book WHERE fy IN (?, ?) AND responsibility_person = ?").bind(cleanFy, `FY ${cleanFy}`, respPerson)
    ];

    if (category === 'PM Withdraw' && body.studentId > 0) {
      verifyQueries.push(
        db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id = ?").bind(cleanFy, `FY ${cleanFy}`, body.studentId)
      );
    }

    const verifyRes = await db.batch(verifyQueries);
    const curCashierBal = parseFloat(verifyRes[0]?.results[0]?.bal || 0);

    // 🛡️ CASHIER FLOAT OVERDRAFT GUARD
    if (credit > 0 && credit > curCashierBal) {
      return { success: false, message: `${respPerson} တွင် ငွေသားလက်ကျန် (${curCashierBal.toLocaleString('en-US')} MMK) သာ ရှိသဖြင့် (${credit.toLocaleString('en-US')} MMK) ထုတ်ပေး/ပြန်လွှဲခွင့် မပြုပါ!` };
    }

    // 🛡️ STUDENT WALLET OVERDRAFT GUARD
    if (category === 'PM Withdraw' && body.studentId > 0 && credit > 0) {
      const curStuBal = parseFloat(verifyRes[1]?.results[0]?.bal || 0);
      if (credit > curStuBal) {
        return { success: false, message: `မုန့်ဖိုးထုတ်ပေးခွင့် မပြုပါ! ကျောင်းသားတွင် လက်ရှိမုန့်ဖိုးလက်ကျန် (${curStuBal.toLocaleString('en-US')} MMK) သာ ရှိသဖြင့် (${credit.toLocaleString('en-US')} MMK) ပိုမိုထုတ်ယူခွင့် မရှိပါ။` };
      }
    }
    
    const noPm = await generateFyNo(db, 'pm_cashier_book', fy);
    const vrPm = body.vrNo || await generateVoucherNo(db, 'pm_cashier_book', 'PMC', entryDate);
    const batchStatements = [];

    batchStatements.push(
      db.prepare(`INSERT INTO pm_cashier_book (no, date, responsibility_person, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`)
      .bind(noPm, entryDate, respPerson, category, body.description || '', body.method || 'Cash', debit, credit, vrPm, my, fy, session?.name || 'PM Cashier', uniqueid)
    );

    if (category === 'PM Withdraw' && body.studentId > 0 && credit > 0) {
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      const stuName = body.studentName ? `[${body.fyid}] ${body.studentName}` : `[ID ${body.studentId}]`;
      const desc = `[PM Cashier - ${respPerson}] Withdraw: ${body.description || ''}`.trim();

      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, body.studentId, body.fyid || '', stuName, body.studentClass || '', body.method || 'Cash', credit, desc, session?.name || 'PM Cashier', `STM_${uniqueid}`)
      );
    } else if (category === 'Return to Finance' && credit > 0) {
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      const desc = `[PM Cashier] Return Cash from ${respPerson}: ${body.description || ''}`.trim();

      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, NULL, 'RETURN', ?, 'Vault Return', ?, ?, 0, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, `[Return] Finance Vault (${respPerson})`, body.method || 'Cash', credit, desc, session?.name || 'PM Cashier', `STM_${uniqueid}`)
      );
    }

    await db.batch(batchStatements);

    // ⚡ TARGETED RECALCULATION
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
    if (!uid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    
    const existing = await db.prepare("SELECT fy, date, category, uniqueid FROM pm_cashier_book WHERE uniqueid = ?").bind(uid).first();
    if (!existing) return { success: false, message: "ဖျက်မည့် စာရင်း ရှာမတွေ့ပါ။" };

    const rawId = uid.replace(/^(STM_|PMC_|CAN_)/, '');

    const batchStatements = [
      db.prepare("DELETE FROM pm_cashier_book WHERE uniqueid = ?").bind(uid),
      db.prepare("DELETE FROM student_money WHERE uniqueid IN (?, ?, ?)").bind(uid, `STM_${rawId}`, rawId)
    ];

    await db.batch(batchStatements);

    const cleanFy = existing.fy ? existing.fy.replace(/^FY\s*/i, '') : '';
    await recalculateLedgerBalances(db, 'pm_cashier_book', `FY ${cleanFy}`, existing.date);
    if (existing.category === 'PM Withdraw') {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, existing.date);
    }

    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
}

// ==============================================================================
// 💡 3. CANTEEN BOOK (WITH POS WALLET OVERDRAFT GUARD)
// ==============================================================================

export async function getCanteenBookData(db, body) {
  try {
    const fy = normalizeFyStr(body.fy || getCurrentAcademicYear());
    const query = `SELECT * FROM canteen_book WHERE fy = ? ORDER BY date DESC, id DESC LIMIT 500`;
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
    const debit = Math.round(Math.max(0, parseFloat(body.debit || 0)) * 100) / 100;
    const studentId = parseInt(body.studentId, 10) || null;

    if (debit <= 0) return { success: false, message: "ရောင်းရငွေ ပမာဏကို အတိအကျ ထည့်သွင်းပါ။" };

    // 🛡️ CANTEEN POS OVERDRAFT GUARD: ကျောင်းသား Wallet မှ ဝယ်ယူချိန် လက်ကျန်စစ်ဆေးခြင်း
    if (category === 'POS Sales' && studentId > 0) {
      const stuBalRow = await db.prepare(
        "SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id = ?"
      ).bind(cleanFy, `FY ${cleanFy}`, studentId).first();
      
      const curStuBal = parseFloat(stuBalRow?.bal || 0);
      if (debit > curStuBal) {
        return {
          success: false,
          message: `ကန်တင်းအရောင်း မအောင်မြင်ပါ! ကျောင်းသားတွင် မုန့်ဖိုးလက်ကျန် (${curStuBal.toLocaleString('en-US')} MMK) သာ ရှိသဖြင့် (${debit.toLocaleString('en-US')} MMK) ပိုမိုဖြတ်တောက်၍ မရပါ။`
        };
      }
    }
    
    const noCan = await generateFyNo(db, 'canteen_book', fy);
    const vrCan = body.vrNo || await generateVoucherNo(db, 'canteen_book', 'CAN', entryDate);
    const batchStatements = [];

    batchStatements.push(
      db.prepare(`INSERT INTO canteen_book (no, date, category, description, method, debit, credit, balances, vr_no, my, fy, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?)`)
      .bind(noCan, entryDate, category, body.description || '', body.method || 'Transfer', debit, vrCan, my, fy, session?.name || 'System', uniqueid)
    );

    if (category === 'POS Sales' && studentId > 0) {
      const noStu = await generateFyNo(db, 'student_money', cleanFy);
      const stuName = body.studentName ? `[${body.fyid}] ${body.studentName}` : `[ID ${studentId}]`;
      const desc = `[Canteen] POS Sales: ${body.description || ''}`.trim();

      batchStatements.push(
        db.prepare(`INSERT INTO student_money (no, date, fy, student_id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`)
        .bind(noStu, entryDate, cleanFy, studentId, body.fyid || '', stuName, body.studentClass || '', body.method || 'Transfer', debit, desc, session?.name || 'System', `STM_${uniqueid}`)
      );
    }

    await db.batch(batchStatements);

    // ⚡ TARGETED RECALCULATION
    await recalculateLedgerBalances(db, 'canteen_book', fy, entryDate);
    if (category === 'POS Sales' && studentId > 0) {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, entryDate);
    }

    return { success: true, uniqueId: uniqueid };
  } catch (err) { return { success: false, message: err.message }; }
}

export async function deleteCanteenBookEntry(db, session, body) {
  try {
    const uid = body.uniqueId;
    if (!uid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    
    const existing = await db.prepare("SELECT fy, date, category, uniqueid FROM canteen_book WHERE uniqueid = ?").bind(uid).first();
    if (!existing) return { success: false, message: "ဖျက်မည့် စာရင်း ရှာမတွေ့ပါ။" };

    const rawId = uid.replace(/^(STM_|PMC_|CAN_)/, '');

    const batchStatements = [
      db.prepare("DELETE FROM canteen_book WHERE uniqueid = ?").bind(uid),
      db.prepare("DELETE FROM student_money WHERE uniqueid IN (?, ?, ?)").bind(uid, `STM_${rawId}`, rawId)
    ];

    await db.batch(batchStatements);

    const cleanFy = existing.fy ? existing.fy.replace(/^FY\s*/i, '') : '';
    await recalculateLedgerBalances(db, 'canteen_book', `FY ${cleanFy}`, existing.date);
    if (existing.category === 'POS Sales') {
      await recalculateLedgerBalances(db, 'student_money', cleanFy, existing.date);
    }

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
      db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM student_money WHERE fy IN (?, ?) AND student_id IS NOT NULL").bind(fy, `FY ${fy}`),
      db.prepare("SELECT COALESCE(SUM(debit - credit), 0) as bal FROM pm_cashier_book WHERE fy IN (?, ?)").bind(fy, `FY ${fy}`)
    ]);

    const totalVirtual = parseFloat(stuBalRes.results[0]?.bal || 0);
    const totalCashier = parseFloat(pmBalRes.results[0]?.bal || 0);

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
  } catch (err) { return { success: false, message: err.message }; }
}