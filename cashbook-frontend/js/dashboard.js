/**
 * GOLDEN ERP SYSTEM - HOME DASHBOARD CONTROLLER
 * File: js/dashboard.js 
 * 💡 Features: Active FY Scoped Analytics, Daily Balances, Liabilities, Receivables,
 *              and Gender Demographic Breakdown (Male / Female / Total)
 */

function formatMoney(val) {
  const num = typeof window.cleanNumber === 'function' ? window.cleanNumber(val) : Number(val) || 0;
  return num.toLocaleString('en-US');
}

function formatNumber(val) {
  const num = typeof window.cleanNumber === 'function' ? window.cleanNumber(val) : Number(val) || 0;
  return num.toLocaleString('en-US');
}

function setElementText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * 💡 Load Home Dashboard Analytics Data
 */
async function loadDashboardData(isSilent = false, forceRefresh = false) {
  const token = localStorage.getItem('golden_auth_token');
  if (!token) return;

  try {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);

    const res = await callApi('getDashboardData', { forceRefresh: forceRefresh }, 'GET');

    const d = (res && res.success && res.data) ? res.data : {};

    const fin = d.financials || {};
    const bal = d.balances || {};
    const liab = d.liabilities || {};
    const rec = d.receivables || {};
    const demo = d.demographics || {};

    // 1. Top KPI Cards
    setElementText('db-total-income', formatMoney(fin.totalIncome) + ' MMK');
    setElementText('db-total-expense', formatMoney(fin.totalExpense) + ' MMK');
    setElementText('db-net-profit', formatMoney(fin.netProfit) + ' MMK');
    setElementText('db-total-entries', formatNumber(fin.totalEntries || 0));

    // 2. Daily Balances
    setElementText('db-bal-bank', formatMoney(bal.bank) + ' MMK');
    setElementText('db-bal-cash', formatMoney(bal.cash) + ' MMK');
    setElementText('db-bal-office', formatMoney(bal.office) + ' MMK');
    setElementText('db-bal-kitchen', formatMoney(bal.kitchen) + ' MMK');
    setElementText('db-bal-payroll', formatMoney(bal.payroll) + ' MMK');
    setElementText('db-bal-total', formatMoney(bal.total) + ' MMK');

    // 3. Liabilities
    setElementText('db-lia-bank', formatMoney(liab.bankLoan) + ' MMK');
    setElementText('db-lia-cash', formatMoney(liab.cashLoan) + ' MMK');
    setElementText('db-lia-office', formatMoney(liab.officeLiabilities) + ' MMK');
    setElementText('db-lia-bonus', formatMoney(liab.hrBonus) + ' MMK');
    setElementText('db-lia-fund', formatMoney(liab.hrFund) + ' MMK');
    setElementText('db-lia-total', formatMoney(liab.total) + ' MMK');

    // 4. Receivables
    setElementText('db-rec-snack', formatMoney(rec.advanceSnack) + ' MMK');
    setElementText('db-rec-uniform', formatMoney(rec.advanceUniform) + ' MMK');
    setElementText('db-rec-other', formatMoney(rec.otherAdvance) + ' MMK');
    setElementText('db-rec-total', formatMoney(rec.total) + ' MMK');

    // 5. Active Demographic Info (Male / Female / Total Active)
    const stu = demo.students || { male: 0, female: 0, total: 0 };
    const ft = demo.fullTimeStaff || { male: 0, female: 0, total: 0 };
    const pt = demo.partTimeStaff || { male: 0, female: 0, total: 0 };

    // Students
    setElementText('db-stu-male', formatNumber(stu.male));
    setElementText('db-stu-female', formatNumber(stu.female));
    setElementText('db-stu-total', formatNumber(stu.total));

    // Full Time Staff
    setElementText('db-ft-male', formatNumber(ft.male));
    setElementText('db-ft-female', formatNumber(ft.female));
    setElementText('db-ft-total', formatNumber(ft.total));

    // Part Time Staff
    setElementText('db-pt-male', formatNumber(pt.male));
    setElementText('db-pt-female', formatNumber(pt.female));
    setElementText('db-pt-total', formatNumber(pt.total));

    // Demographics Grand Totals
    setElementText('db-demo-tot-male', formatNumber(demo.totalMale || (stu.male + ft.male + pt.male)));
    setElementText('db-demo-tot-female', formatNumber(demo.totalFemale || (stu.female + ft.female + pt.female)));
    setElementText('db-demo-tot-all', formatNumber(demo.totalActive || (stu.total + ft.total + pt.total)));

  } catch (err) {
    console.warn("Dashboard loading fallback applied:", err.message);
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

// 💡 EXPOSE GLOBALLY FOR APP.JS
window.loadDashboardData = loadDashboardData;
