/**
 * GOLDEN ERP SYSTEM - DASHBOARD HANDLER (D1 DATABASE)
 * File: handlers-dashboard.js  
 * 💡 Features: Crash-Proof Safe Dashboard Analytics (Total Income, Total Expense, Net Profit, Active Force),
 *              Daily Balances, Liabilities, Receivables & Gender Demographics (Male/Female/Total)
 */

function normalizeFyStr(fy) {
  if (!fy) return '2026-2027';
  let s = String(fy).trim();
  s = s.replace(/^FY\s*/i, '');
  return s;
}

/**
 * 💡 Crash-Proof First Number SQL Helper
 */
async function safeFirstNum(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const res = await bound.first('total');
    return parseFloat(res || 0);
  } catch (e) {
    return 0;
  }
}

/**
 * 💡 Crash-Proof Count SQL Helper
 */
async function safeCount(db, sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const bound = params.length > 0 ? stmt.bind(...params) : stmt;
    const res = await bound.first('cnt');
    return parseInt(res || 0, 10);
  } catch (e) {
    return 0;
  }
}

/**
 * 💡 Gender Counter Helper
 */
function parseGenderCount(rows = []) {
  let m = 0, f = 0;
  rows.forEach(r => {
    const g = String(r.gender || '').toLowerCase().trim();
    const name = String(r.name || r.fyid_name || '').trim();
    
    if (g === 'female' || g === 'မ' || g.startsWith('f') || name.startsWith('မေ') || name.startsWith('ဒေါ်') || (name.startsWith('မ') && !name.startsWith('မောင်'))) {
      f++;
    } else {
      m++;
    }
  });
  return { m, f, total: rows.length };
}

/**
 * 💡 Fetch Dashboard Executive Summary & Analytics Data
 */
export async function getDashboardData(db, body) {
  try {
    const activeFy = normalizeFyStr(body.fy || '2026-2027');
    const fyPrefixed = `FY ${activeFy}`;

    // ----------------------------------------------------
    // 💡 1. TOP 4 KPI CARDS (Active FY Scoped)
    // ----------------------------------------------------
    // Total Income: Main Income Book (SUM(credit - debit) for active FY)
    const totalIncome = await safeFirstNum(db, 
      `SELECT COALESCE(SUM(credit - debit), 0) as total FROM income WHERE fy = ? OR fy = ?`,
      [activeFy, fyPrefixed]
    );

    // Total Expense: Office Exp + Kitchen Exp + HR Payroll Exp (SUM(credit) for active FY)
    const offExp = await safeFirstNum(db, `SELECT COALESCE(SUM(credit), 0) as total FROM office WHERE fy = ? OR fy = ?`, [activeFy, fyPrefixed]);
    const kitExp = await safeFirstNum(db, `SELECT COALESCE(SUM(credit), 0) as total FROM kitchen WHERE fy = ? OR fy = ?`, [activeFy, fyPrefixed]);
    const payExp = await safeFirstNum(db, `SELECT COALESCE(SUM(credit), 0) as total FROM payroll WHERE fy = ? OR fy = ?`, [activeFy, fyPrefixed]);
    
    const totalExpense = offExp + kitExp + payExp;
    const netProfit = totalIncome - totalExpense;

    // Active Force / Entries Count
    const bankCnt = await safeCount(db, `SELECT COUNT(*) as cnt FROM bank WHERE fy = ? OR fy = ?`, [activeFy, fyPrefixed]);
    const cashCnt = await safeCount(db, `SELECT COUNT(*) as cnt FROM cash WHERE fy = ? OR fy = ?`, [activeFy, fyPrefixed]);
    const incCnt = await safeCount(db, `SELECT COUNT(*) as cnt FROM income WHERE fy = ? OR fy = ?`, [activeFy, fyPrefixed]);
    const offCnt = await safeCount(db, `SELECT COUNT(*) as cnt FROM office WHERE fy = ? OR fy = ?`, [activeFy, fyPrefixed]);
    const kitCnt = await safeCount(db, `SELECT COUNT(*) as cnt FROM kitchen WHERE fy = ? OR fy = ?`, [activeFy, fyPrefixed]);
    const payCnt = await safeCount(db, `SELECT COUNT(*) as cnt FROM payroll WHERE fy = ? OR fy = ?`, [activeFy, fyPrefixed]);
    const totalEntries = bankCnt + cashCnt + incCnt + offCnt + kitCnt + payCnt;

    // ----------------------------------------------------
    // 💡 2. DAILY BALANCES (Current Ledger Balances)
    // ----------------------------------------------------
    const bankBal = await safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM bank");
    const cashBal = await safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM cash");
    const officeBal = await safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM office");
    const kitchenBal = await safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM kitchen");
    const payrollBal = await safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM payroll");

    // ----------------------------------------------------
    // 💡 3. LIABILITIES (ပေးရန်ကြွေးမြီ စာရင်းများ)
    // ----------------------------------------------------
    const bankLoan = await safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM bank WHERE LOWER(category) LIKE '%bank loan%'");
    const cashLoan = await safeFirstNum(db, "SELECT COALESCE(SUM(debit - credit), 0) as total FROM cash WHERE LOWER(category) LIKE '%cash loan%'");
    const officeLiabilities = await safeFirstNum(db, "SELECT COALESCE(SUM(liabilities), 0) as total FROM office");
    const hrUnpaidBonus = await safeFirstNum(db, "SELECT COALESCE(SUM(unpaid_bonus), 0) as total FROM staff_fulltime WHERE LOWER(status) = 'active'");
    const hrUnpaidFund = await safeFirstNum(db, "SELECT COALESCE(SUM(unpaid_fund), 0) as total FROM staff_fulltime WHERE LOWER(status) = 'active'");

    // ----------------------------------------------------
    // 💡 4. RECEIVABLES (ရရန်ကြွေးမြီ / ကြိုတင်ပေး စာရင်းများ)
    // ----------------------------------------------------
    const advSnack = await safeFirstNum(db, "SELECT COALESCE(SUM(credit - debit), 0) as total FROM office WHERE LOWER(category) LIKE '%snack%'");
    const advUniform = await safeFirstNum(db, "SELECT COALESCE(SUM(credit - debit), 0) as total FROM office WHERE LOWER(category) LIKE '%uniform%'");
    const othersAdv = await safeFirstNum(db, "SELECT COALESCE(SUM(credit - debit), 0) as total FROM office WHERE LOWER(category) LIKE '%adv%' AND LOWER(category) NOT LIKE '%snack%' AND LOWER(category) NOT LIKE '%uniform%'");

    // ----------------------------------------------------
    // 💡 5. ACTIVE DEMOGRAPHIC INFO (Male / Female / Total Active)
    // ----------------------------------------------------
    let stuRows = [];
    try {
      const res = await db.prepare(
        `SELECT gender, name FROM student WHERE LOWER(status) = 'active' AND (fy = ? OR fy = ?)`
      ).bind(activeFy, fyPrefixed).all();
      if (res && res.results) stuRows = res.results;
    } catch (e) {}
    const stuDemo = parseGenderCount(stuRows);

    let ftRows = [];
    try {
      const res = await db.prepare(`SELECT gender, name FROM staff_fulltime WHERE LOWER(status) = 'active'`).all();
      if (res && res.results) ftRows = res.results;
    } catch (e) {}
    const ftDemo = parseGenderCount(ftRows);

    let ptRows = [];
    try {
      const res = await db.prepare(`SELECT gender, name FROM staff_parttime WHERE LOWER(status) = 'active'`).all();
      if (res && res.results) ptRows = res.results;
    } catch (e) {}
    const ptDemo = parseGenderCount(ptRows);

    return {
      success: true,
      fy: activeFy,
      data: {
        financials: {
          totalIncome,
          totalExpense,
          netProfit,
          totalEntries
        },
        balances: {
          bank: bankBal,
          cash: cashBal,
          office: officeBal,
          kitchen: kitchenBal,
          payroll: payrollBal,
          total: bankBal + cashBal + officeBal + kitchenBal + payrollBal
        },
        liabilities: {
          bankLoan,
          cashLoan,
          officeLiabilities,
          hrBonus: hrUnpaidBonus,
          hrFund: hrUnpaidFund,
          total: bankLoan + cashLoan + officeLiabilities + hrUnpaidBonus + hrUnpaidFund
        },
        receivables: {
          advanceSnack: advSnack,
          advanceUniform: advUniform,
          otherAdvance: othersAdv,
          total: advSnack + advUniform + othersAdv
        },
        demographics: {
          students: { male: stuDemo.m, female: stuDemo.f, total: stuDemo.total },
          fullTimeStaff: { male: ftDemo.m, female: ftDemo.f, total: ftDemo.total },
          partTimeStaff: { male: ptDemo.m, female: ptDemo.f, total: ptDemo.total },
          totalActive: stuDemo.total + ftDemo.total + ptDemo.total,
          totalMale: stuDemo.m + ftDemo.m + ptDemo.m,
          totalFemale: stuDemo.f + ftDemo.f + ptDemo.f
        }
      }
    };
  } catch (err) {
    console.error("Error in getDashboardData:", err);
    return { success: false, message: err.message };
  }
}
