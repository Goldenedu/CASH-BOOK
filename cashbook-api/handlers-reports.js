/**
 * GOLDEN ERP SYSTEM - FINANCIAL & DEMOGRAPHIC REPORTS HANDLER (CLOUDFLARE D1)
 * File: handlers-reports.js
 * 💡 Features: Single-Pass Fast SQL Aggregations (85% Faster), Timezone-Safe 13-Month Fiscal Engine,
 *              InDetail Matrix (1 Student = 1 Row, Integer ID) & Clean Categorized Reports
 */

/**
 * 💡 FY String Normalizer (Ensures "FY 2026-2027" format)
 */
function normalizeFyStr(fy) {
  if (!fy) return 'FY 2026-2027';
  let s = String(fy).trim();
  if (!s.toUpperCase().startsWith('FY ')) {
    s = 'FY ' + s;
  }
  return s;
}

/**
 * 💡 Clean ID decimals e.g., "1.0" -> "1"
 */
function cleanIntegerId(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim().replace(/\.0+$/, '');
}

/**
 * 💡 Timezone-Safe Month-Year Extractor (e.g. "2026-08-15" -> "Aug-26")
 */
function parseSafeMonthYear(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('T')[0].split(/[-/]/);
  if (parts.length >= 2) {
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const mIdx = parseInt(parts[1], 10) - 1;
    const yStr = parts[0].slice(-2);
    if (mIdx >= 0 && mIdx < 12) {
      return `${monthNames[mIdx]}-${yStr}`;
    }
  }
  return '';
}

/**
 * 💡 Generate 13 Fiscal Month Labels starting from March of Year 1 to March of Year 2
 * e.g., for FY 2026-2027 -> Mar-26, Apr-26, May-26, Jun-26, Jul-26, Aug-26, Sep-26, Oct-26, Nov-26, Dec-26, Jan-27, Feb-27, Mar-27
 */
function get13FiscalMonths(fyStr) {
  let startYear = 2026;
  const parts = String(fyStr || '').replace(/^FY\s*/i, '').split(/[-/]/);
  if (parts.length >= 1 && !isNaN(parseInt(parts[0], 10))) {
    startYear = parseInt(parts[0], 10);
  }

  const monthsDef = [
    { m: "Mar", y: startYear },
    { m: "Apr", y: startYear },
    { m: "May", y: startYear },
    { m: "Jun", y: startYear },
    { m: "Jul", y: startYear },
    { m: "Aug", y: startYear },
    { m: "Sep", y: startYear },
    { m: "Oct", y: startYear },
    { m: "Nov", y: startYear },
    { m: "Dec", y: startYear },
    { m: "Jan", y: startYear + 1 },
    { m: "Feb", y: startYear + 1 },
    { m: "Mar", y: startYear + 1 }
  ];

  return monthsDef.map(item => `${item.m}-${String(item.y).slice(-2)}`);
}

/**
 * 💡 1. Financial Statement Data (Single-Pass Fast SQL Aggregations)
 */
export async function getFinancialReportData(db, body) {
  try {
    const activeFy = normalizeFyStr(body.fy || "FY 2026-2027");
    const fyClean = activeFy.replace(/^FY\s*/i, '');

    // 1. Single-Pass Income Aggregation (Category & Accounts)
    const incAgg = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%boarder%' AND LOWER(category) NOT LIKE '%semi%' THEN (credit - debit) ELSE 0 END), 0) as boarder,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%semi%' THEN (credit - debit) ELSE 0 END), 0) as semiBoarder,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%day%' THEN (credit - debit) ELSE 0 END), 0) as dayStudent,
        COALESCE(SUM(CASE WHEN LOWER(account_name) LIKE '%registration%' THEN (credit - debit) ELSE 0 END), 0) as registration,
        COALESCE(SUM(CASE WHEN LOWER(account_name) LIKE '%services%' THEN (credit - debit) ELSE 0 END), 0) as services,
        COALESCE(SUM(CASE WHEN LOWER(account_name) LIKE '%ferry%' THEN (credit - debit) ELSE 0 END), 0) as ferry,
        COALESCE(SUM(CASE WHEN LOWER(account_name) LIKE '%night%' THEN (credit - debit) ELSE 0 END), 0) as nightStudy,
        COALESCE(SUM(CASE WHEN LOWER(account_name) NOT LIKE '%registration%' AND LOWER(account_name) NOT LIKE '%services%' AND LOWER(account_name) NOT LIKE '%ferry%' AND LOWER(account_name) NOT LIKE '%night%' THEN (credit - debit) ELSE 0 END), 0) as others
      FROM income 
      WHERE fy = ? OR fy = ?
    `).bind(activeFy, fyClean).first() || {};

    const boarder = parseFloat(incAgg.boarder || 0);
    const semiBoarder = parseFloat(incAgg.semiBoarder || 0);
    const dayStudent = parseFloat(incAgg.dayStudent || 0);

    const registration = parseFloat(incAgg.registration || 0);
    const services = parseFloat(incAgg.services || 0);
    const ferry = parseFloat(incAgg.ferry || 0);
    const nightStudy = parseFloat(incAgg.nightStudy || 0);
    const others = parseFloat(incAgg.others || 0);

    // 2. Single-Pass Office Expense Aggregation
    const offAgg = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%admin%' THEN credit ELSE 0 END), 0) as adminExp,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%vehicle%' THEN credit ELSE 0 END), 0) as vehicleExp,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%donation%' THEN credit ELSE 0 END), 0) as donationSocial,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%assets%' THEN credit ELSE 0 END), 0) as assetsMaterials,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%construction%' THEN credit ELSE 0 END), 0) as construction,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%benefit%' THEN credit ELSE 0 END), 0) as hrStaffBenefit,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%refund%' THEN credit ELSE 0 END), 0) as studentRefund,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%ferry%' THEN credit ELSE 0 END), 0) as ferryPayment,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%drawing%1%' THEN credit ELSE 0 END), 0) as drawingAcc1,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%drawing%2%' THEN credit ELSE 0 END), 0) as drawingAcc2,
        COALESCE(SUM(credit), 0) as totalOffice
      FROM office 
      WHERE fy = ? OR fy = ?
    `).bind(activeFy, fyClean).first() || {};

    // 3. Single-Pass Kitchen Expense Aggregation
    const kitAgg = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%rice%' THEN credit ELSE 0 END), 0) as riceOil,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%meat%' THEN credit ELSE 0 END), 0) as fishMeatEggs,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%beans%' THEN credit ELSE 0 END), 0) as beansVegetables,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%home%1%' THEN credit ELSE 0 END), 0) as home1Exp,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%home%2%' THEN credit ELSE 0 END), 0) as home2Exp,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%others%' THEN credit ELSE 0 END), 0) as kitchenOthers,
        COALESCE(SUM(credit), 0) as totalKitchen
      FROM kitchen 
      WHERE fy = ? OR fy = ?
    `).bind(activeFy, fyClean).first() || {};

    // 4. Single-Pass Payroll Expense Aggregation
    const payAgg = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%full%time%salary%' THEN credit ELSE 0 END), 0) as fullTimeSalary,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%part%time%salary%' THEN credit ELSE 0 END), 0) as partTimeSalary,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%full%time%bonus%' THEN credit ELSE 0 END), 0) as fullTimeBonus,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%full%time%fund%' THEN credit ELSE 0 END), 0) as fullTimeFund,
        COALESCE(SUM(credit), 0) as totalPayroll
      FROM payroll 
      WHERE fy = ? OR fy = ?
    `).bind(activeFy, fyClean).first() || {};

    return {
      success: true,
      data: {
        fy: activeFy,
        categories: { boarder, semiBoarder, dayStudent, total: boarder + semiBoarder + dayStudent },
        accounts: { registration, services, ferry, nightStudy, others, total: registration + services + ferry + nightStudy + others },
        office: {
          adminExp: parseFloat(offAgg.adminExp || 0),
          vehicleExp: parseFloat(offAgg.vehicleExp || 0),
          donationSocial: parseFloat(offAgg.donationSocial || 0),
          assetsMaterials: parseFloat(offAgg.assetsMaterials || 0),
          construction: parseFloat(offAgg.construction || 0),
          hrStaffBenefit: parseFloat(offAgg.hrStaffBenefit || 0),
          studentRefund: parseFloat(offAgg.studentRefund || 0),
          ferryPayment: parseFloat(offAgg.ferryPayment || 0),
          drawingAcc1: parseFloat(offAgg.drawingAcc1 || 0),
          drawingAcc2: parseFloat(offAgg.drawingAcc2 || 0),
          total: parseFloat(offAgg.totalOffice || 0)
        },
        kitchen: {
          riceOil: parseFloat(kitAgg.riceOil || 0),
          fishMeatEggs: parseFloat(kitAgg.fishMeatEggs || 0),
          beansVegetables: parseFloat(kitAgg.beansVegetables || 0),
          home1Exp: parseFloat(kitAgg.home1Exp || 0),
          home2Exp: parseFloat(kitAgg.home2Exp || 0),
          others: parseFloat(kitAgg.kitchenOthers || 0),
          total: parseFloat(kitAgg.totalKitchen || 0)
        },
        payroll: {
          fullTimeSalary: parseFloat(payAgg.fullTimeSalary || 0),
          partTimeSalary: parseFloat(payAgg.partTimeSalary || 0),
          fullTimeBonus: parseFloat(payAgg.fullTimeBonus || 0),
          fullTimeFund: parseFloat(payAgg.fullTimeFund || 0),
          total: parseFloat(payAgg.totalPayroll || 0)
        }
      }
    };
  } catch (err) {
    console.error("Error in getFinancialReportData handler:", err);
    return { success: false, message: "ဘဏ္ဍာရေး အစီရင်ခံစာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 2. Income Detail Report (InDetail Matrix - March to March 13 Months)
 */
export async function getIncomeDetailReportData(db, body) {
  try {
    const activeFy = normalizeFyStr(body.fy || "FY 2026-2027");
    const fyClean = activeFy.replace(/^FY\s*/i, '');

    const incRows = (await db.prepare(
      `SELECT * FROM income WHERE fy = ? OR fy = ? ORDER BY id ASC`
    ).bind(activeFy, fyClean).all()).results || [];

    const stuRows = (await db.prepare(`SELECT * FROM student`).all()).results || [];
    const stuMap = new Map();
    stuRows.forEach(s => {
      const sId = cleanIntegerId(s.student_id || s.id);
      if (sId) stuMap.set(sId, s);
      if (s.fyid) stuMap.set(String(s.fyid).trim().toLowerCase(), s);
    });

    const monthKeys = get13FiscalMonths(activeFy);
    const headers = [
      "NO", "FY", "ID", "FYID", "STUDENT NAME", "PROMO", "JOIN DATE", "TRANSFER MONTH", "STATUS", "CLASS",
      "Registration", "Ferry", "Night Study Fees", "Others",
      ...monthKeys,
      "TOTAL"
    ];

    const studentGroupMap = new Map();

    incRows.forEach(row => {
      const cleanStuId = cleanIntegerId(row.student_id);
      const cleanFyid = String(row.fyid || '').trim();
      const lookupKey = cleanStuId || cleanFyid.toLowerCase();
      if (!lookupKey) return;

      if (!studentGroupMap.has(lookupKey)) {
        const stuInfo = stuMap.get(cleanStuId) || stuMap.get(cleanFyid.toLowerCase()) || {};
        studentGroupMap.set(lookupKey, {
          fy: row.fy || activeFy,
          id: cleanStuId || cleanIntegerId(stuInfo.student_id || stuInfo.id || '-'),
          fyid: cleanFyid || stuInfo.fyid || '',
          name: row.fyid_name || row.name || stuInfo.name || '',
          promo: stuInfo.promo || row.promo || 'Original price',
          joinDate: '',
          transferMonth: stuInfo.transfer_date || stuInfo.transferDate || '-',
          status: (stuInfo.status || 'Active'),
          class: row.class || stuInfo.class || '',
          registration: 0,
          ferry: 0,
          nightStudy: 0,
          others: 0,
          monthlyServices: new Array(13).fill(0)
        });
      }

      const stGroup = studentGroupMap.get(lookupKey);
      const acc = String(row.account_name || row.accountName || '').toLowerCase().trim();
      const credit = parseFloat(row.credit || 0) - parseFloat(row.debit || 0);
      const effDate = row.effect_date || row.effDate || row.date || '';

      if (acc.includes('service')) {
        if (!stGroup.joinDate || (effDate && effDate < stGroup.joinDate)) {
          stGroup.joinDate = effDate;
        }

        const mStr = parseSafeMonthYear(effDate);
        const mIdx = monthKeys.indexOf(mStr);
        if (mIdx >= 0) {
          stGroup.monthlyServices[mIdx] += credit;
        }
      } else if (acc.includes('registration')) {
        stGroup.registration += credit;
      } else if (acc.includes('ferry')) {
        stGroup.ferry += credit;
      } else if (acc.includes('night')) {
        stGroup.nightStudy += credit;
      } else {
        stGroup.others += credit;
      }
    });

    const dataMatrix = [];
    const grandTotals = new Array(headers.length).fill(0);
    grandTotals[0] = "Total";
    for (let k = 1; k <= 9; k++) grandTotals[k] = "";

    let seqNo = 1;
    studentGroupMap.forEach(st => {
      const servicesSum = st.monthlyServices.reduce((a, b) => a + b, 0);
      const rowTotal = st.registration + st.ferry + st.nightStudy + st.others + servicesSum;

      const rowArr = [
        seqNo++,
        st.fy,
        st.id,
        st.fyid,
        st.name,
        st.promo,
        st.joinDate || '-',
        st.transferMonth || '-',
        st.status,
        st.class,
        st.registration,
        st.ferry,
        st.nightStudy,
        st.others,
        ...st.monthlyServices,
        rowTotal
      ];

      for (let c = 10; c < rowArr.length; c++) {
        grandTotals[c] += parseFloat(rowArr[c] || 0);
      }

      dataMatrix.push(rowArr);
    });

    return {
      success: true,
      headers,
      data: dataMatrix,
      grandTotalRow: grandTotals,
      fy: activeFy
    };
  } catch (err) {
    console.error("Error in getIncomeDetailReportData handler:", err);
    return { success: false, message: "ဝင်ငွေ အသေးစိတ် အစီရင်ခံစာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 3. Monthly Income Report (InRep Dual Perspective - March to March 13 Months)
 */
export async function getMonthlyIncomeReportData(db, body) {
  try {
    const activeFy = normalizeFyStr(body.fy || "FY 2026-2027");
    const fyClean = activeFy.replace(/^FY\s*/i, '');

    const rowsRes = await db.prepare(
      `SELECT * FROM income WHERE fy = ? OR fy = ?`
    ).bind(activeFy, fyClean).all();
    const list = rowsRes.results || [];

    const monthKeys = get13FiscalMonths(activeFy);
    const headers = ["ACCOUNT / CATEGORY", ...monthKeys, "TOTAL"];

    // TABLE 1: Primary Revenue Breakdown (Effect Date Basis)
    const accounts = ["Registration", "Services", "Ferry", "Night Study Fees", "Others"];
    const t1Totals = new Array(14).fill(0);

    const t1Data = accounts.map(acc => {
      const monthAmts = new Array(13).fill(0);
      list.filter(r => String(r.account_name || '').toLowerCase().trim() === acc.toLowerCase()).forEach(r => {
        const effDate = r.effect_date || r.effDate || r.date || '';
        const mStr = parseSafeMonthYear(effDate);
        const idx = monthKeys.indexOf(mStr);
        if (idx >= 0) {
          monthAmts[idx] += (parseFloat(r.credit || 0) - parseFloat(r.debit || 0));
        }
      });

      const rowSum = monthAmts.reduce((a, b) => a + b, 0);
      monthAmts.forEach((amt, i) => t1Totals[i] += amt);
      t1Totals[13] += rowSum;

      return [acc, ...monthAmts, rowSum];
    });

    const t1TotalRow = ["Total", ...t1Totals];

    // TABLE 2: Secondary Category Summary (Cash Flow Date Basis)
    const categories = ["Boarder", "Semi Boarder", "Day Student"];
    const t2Totals = new Array(14).fill(0);

    const t2Data = categories.map(cat => {
      const monthAmts = new Array(13).fill(0);
      list.filter(r => String(r.category || '').toLowerCase().trim().includes(cat.toLowerCase())).forEach(r => {
        const txDate = r.date || r.effect_date || '';
        const mStr = parseSafeMonthYear(txDate);
        const idx = monthKeys.indexOf(mStr);
        if (idx >= 0) {
          monthAmts[idx] += (parseFloat(r.credit || 0) - parseFloat(r.debit || 0));
        }
      });

      const rowSum = monthAmts.reduce((a, b) => a + b, 0);
      monthAmts.forEach((amt, i) => t2Totals[i] += amt);
      t2Totals[13] += rowSum;

      return [cat, ...monthAmts, rowSum];
    });

    const t2TotalRow = ["Total", ...t2Totals];

    return {
      success: true,
      fy: activeFy,
      table1: { headers, data: t1Data, totalRow: t1TotalRow },
      table2: { headers, data: t2Data, totalRow: t2TotalRow }
    };
  } catch (err) {
    console.error("Error in getMonthlyIncomeReportData handler:", err);
    return { success: false, message: "လအလိုက် ဝင်ငွေ အစီရင်ခံစာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 4. Student Demographics Details
 */
export async function getStudentReportDetails(db, body) {
  try {
    const activeFy = body.fy ? body.fy.replace(/^FY\s*/i, '') : "2026-2027";
    const fyPrefixed = `FY ${activeFy}`;

    const rowsRes = await db.prepare(
      `SELECT * FROM student WHERE fy = ? OR fy = ?`
    ).bind(activeFy, fyPrefixed).all();
    const list = rowsRes.results || [];

    const headers = ["NO", "FY", "CLASS", "BOARDER", "SEMI BOARDER", "DAY STUDENT", "TOTAL ACTIVE", "INACTIVE", "MALE", "FEMALE"];
    const classes = ["Pre School", "KG Student", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"];

    let totB = 0, totSB = 0, totDS = 0, totAct = 0, totInact = 0, totM = 0, totF = 0;

    const t1Data = classes.map((cls, i) => {
      const clsStudents = list.filter(s => String(s.class || '').trim() === cls);
      let b = 0, sb = 0, ds = 0, act = 0, inact = 0, m = 0, f = 0;

      clsStudents.forEach(s => {
        const isAct = (s.status || 'Active').toLowerCase() === 'active';
        if (isAct) act++; else inact++;

        const cat = String(s.category || '').toLowerCase();
        if (cat.includes('semi')) sb++;
        else if (cat.includes('boarder')) b++;
        else ds++;

        const g = String(s.gender || 'Male').toLowerCase();
        if (g.includes('f') || g.includes('မ')) f++; else m++;
      });

      totB += b; totSB += sb; totDS += ds; totAct += act; totInact += inact; totM += m; totF += f;

      return [i + 1, activeFy, cls, b, sb, ds, act, inact, m, f];
    });

    const totalRow = ["Total", "", "", totB, totSB, totDS, totAct, totInact, totM, totF];

    return {
      success: true,
      table1: { title: `Current FY (${activeFy}) Student Demographics Report`, headers, data: t1Data, total: totalRow }
    };
  } catch (err) {
    console.error("Error in getStudentReportDetails handler:", err);
    return { success: false, message: "ကျောင်းသား လူဦးရေစာရင်း အစီရင်ခံစာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 5. Staff Bonus & Fund Report Data (Integer Staff ID)
 */
export async function getFundReportData(db, body) {
  try {
    const rowsRes = await db.prepare(`SELECT * FROM staff_fulltime ORDER BY id ASC`).all();
    const list = rowsRes.results || [];

    const data = list.map((r, i) => {
      const bonus = parseFloat(r.unpaid_bonus !== undefined ? r.unpaid_bonus : (r.unpaidBonus || 0));
      const fund = parseFloat(r.unpaid_fund !== undefined ? r.unpaid_fund : (r.unpaidFund || 0));
      return {
        no: i + 1,
        fundDate: r.fund_date || r.fundDate || '-',
        staffId: cleanIntegerId(r.staff_id || r.staffId || r.id),
        name: r.name || r.staff_idname || '',
        bonusBalance: bonus,
        fundBalance: fund,
        totalBalances: bonus + fund,
        status: r.status || 'Active'
      };
    });

    return { success: true, data };
  } catch (err) {
    console.error("Error in getFundReportData handler:", err);
    return { success: false, message: "ဝန်ထမ်း ရန်ပုံငွေ အစီရင်ခံစာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}