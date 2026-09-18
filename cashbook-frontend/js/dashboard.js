/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - HOME DASHBOARD CONTROLLER
 * File: js/dashboard.js (Location: cashbook-frontend/js/dashboard.js)
 * 💡 Features: Refactored with Global api.js for DRY Principle
 *              🎯 BUG FIX: Removed "MMK" from numeric values to prevent truncation
 *              🎯 FEATURE: Auto-scaling Font Size for KPI numbers & added (MMK) to titles
 * ==============================================================================
 */

function formatMoney(val) {
  const num = window.cleanNumber ? window.cleanNumber(val) : Number(val) || 0;
  return num.toLocaleString('en-US');
}

function formatNumber(val) {
  const num = window.cleanNumber ? window.cleanNumber(val) : Number(val) || 0;
  return num.toLocaleString('en-US');
}

function setElementText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

/**
 * 💡 Update Labels to include (MMK) automatically
 */
function updateKpiLabels() {
  const labels = {
    'db-total-income': 'TOTAL INCOME (MMK)',
    'db-total-expense': 'TOTAL EXPENSE (MMK)',
    'db-net-profit': 'NET PROFIT (MMK)'
  };
  
  for (const [id, text] of Object.entries(labels)) {
    const valueEl = document.getElementById(id);
    if (valueEl) {
      const parent = valueEl.parentElement;
      if (parent) {
        // Typically the title is inside a <p> tag above the <h3>
        const labelEl = parent.querySelector('p'); 
        if (labelEl) labelEl.textContent = text;
      }
    }
  }
}

/**
 * 💡 Auto-Scale Font Size to Prevent Truncation on Large Numbers
 */
function adjustKpiFontSizes() {
  const kpiIds = ['db-total-income', 'db-total-expense', 'db-net-profit', 'db-total-entries'];
  kpiIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    // Reset to default large size & prevent wrapping
    el.style.fontSize = '24px'; 
    el.style.whiteSpace = 'nowrap';
    
    let currentSize = 24;
    // Reduce font size until scrollWidth fits within clientWidth (max drop to 12px)
    while (el.scrollWidth > el.clientWidth && currentSize > 12) {
      currentSize--;
      el.style.fontSize = currentSize + 'px';
    }
  });
}

// 💡 Ensure it resizes correctly when the browser window changes
window.addEventListener('resize', adjustKpiFontSizes);

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

    // 1. Update Titles to include (MMK)
    updateKpiLabels();

    // 2. Top KPI Cards (Removed " MMK" from the end)
    setElementText('db-total-income', formatMoney(fin.totalIncome));
    setElementText('db-total-expense', formatMoney(fin.totalExpense));
    setElementText('db-net-profit', formatMoney(fin.netProfit));
    setElementText('db-total-entries', formatNumber(fin.totalEntries || 0));

    // Trigger Auto Scale after placing values
    setTimeout(adjustKpiFontSizes, 50);

    // 3. Daily Balances (Removed " MMK" from the end)
    setElementText('db-bal-bank', formatMoney(bal.bank));
    setElementText('db-bal-cash', formatMoney(bal.cash));
    setElementText('db-bal-office', formatMoney(bal.office));
    setElementText('db-bal-kitchen', formatMoney(bal.kitchen));
    setElementText('db-bal-payroll', formatMoney(bal.payroll));
    setElementText('db-bal-total', formatMoney(bal.total));

    // 4. Liabilities (Removed " MMK" from the end)
    setElementText('db-lia-bank', formatMoney(liab.bankLoan));
    setElementText('db-lia-cash', formatMoney(liab.cashLoan));
    setElementText('db-lia-office', formatMoney(liab.officeLiabilities));
    setElementText('db-lia-bonus', formatMoney(liab.hrBonus));
    setElementText('db-lia-fund', formatMoney(liab.hrFund));
    setElementText('db-lia-total', formatMoney(liab.total));

    // 5. Receivables (Removed " MMK" from the end)
    setElementText('db-rec-snack', formatMoney(rec.advanceSnack));
    setElementText('db-rec-uniform', formatMoney(rec.advanceUniform));
    setElementText('db-rec-other', formatMoney(rec.otherAdvance));
    setElementText('db-rec-total', formatMoney(rec.total));

    // 6. Active Demographic Info (Male / Female / Total Active)
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
window.adjustKpiFontSizes = adjustKpiFontSizes;
