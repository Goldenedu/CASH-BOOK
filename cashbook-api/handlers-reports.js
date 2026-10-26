/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - FINANCIAL & DEMOGRAPHIC REPORTS HANDLER (CLOUDFLARE D1)
 * File: handlers-reports.js (Location: cashbook-api/handlers-reports.js)
 * 💡 Features: Refactored with utils.js for DRY Principle, Single-Pass Aggregations,
 *              🚀 OPTIMIZED: Explicit Column Selects (Avoided SELECT *),
 *              🚀 ULTRA-OPTIMIZED: Prevented Full Table Scans. Replaced OR with IN().
 *              🎯 Server-Side Pagination (LIMIT 50),
 *              🎯 12 Months Fiscal Year Logic (Mar to Feb),
 *              🎯 Auto Grade Sorting Reversed (Grade 12 to Pre School),
 *              🎯 Advanced "Unpaid Month" Logic (Accumulated check from Join Date),
 *              🔥 SMART LEAVE FILTER (TEXT-SCANNING ENGINE): Zero Quota Cost & Resilient,
 *              🎓 FULL SCHOLAR EXEMPTION: Automatically excludes Full Scholar students from Unpaid lists,
 *              ⚡ ADVANCE AUTO-ROLLOVER ENGINE: Automatically cascades lump-sum advance payments across upcoming months
 * ==============================================================================
 */

import { normalizeFyStr, getCurrentAcademicYear } from './utils.js';

function cleanIntegerId(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim().replace(/\.0+$/, '');
}

const REPORT_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const REPORT_MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  "ဇန်နဝါရီ": 0, "ဖေဖော်ဝါရီ": 1, "မတ်": 2, "ဧပြီ": 3, "မေ": 4, "ဇွန်": 5,
  "ဇူလိုင်": 6, "သြဂုတ်": 7, "ဩဂုတ်": 7, "စက်တင်ဘာ": 8, "အောက်တိုဘာ": 9, "နိုဝင်ဘာ": 10, "ဒီဇင်ဘာ": 11
};

/**
 * 💡 ပုံစံစုံ (YYYY-MM-DD, DD/MM/YYYY, Month-Year, Burmese Months) အား MMM-YY (e.g. Jun-26) သို့ အတိအကျ ပြောင်းပေးသည့် Parser
 */
function parseSafeMonthYear(val, activeFy = '') {
  if (!val || typeof val !== 'string') return '';
  const str = val.trim();
  if (!str) return '';

  const lower = str.toLowerCase();

  // ၁။ စာသားဖြင့် လအမည် ပါဝင်နေမှု စစ်ဆေးခြင်း (e.g. "Jun-2026", "June 2026", "ဇွန်-26")
  for (const [mName, mIdx] of Object.entries(REPORT_MONTH_MAP)) {
    if (lower.includes(mName)) {
      const yrMatch = str.match(/(?:20)?(2[4-9]|[3-9]\d)/);
      let yStr = '';
      if (yrMatch) {
        yStr = yrMatch[1].slice(-2);
      } else {
        const cleanFy = String(activeFy || '').replace(/^FY\s*/i, '');
        const startY = parseInt(cleanFy.split(/[-/]/)[0], 10) || 2026;
        const actualY = (mIdx >= 2) ? startY : startY + 1;
        yStr = String(actualY).slice(-2);
      }
      return `${REPORT_MONTH_NAMES[mIdx]}-${yStr}`;
    }
  }

  // ၂။ ဂဏန်းရက်စွဲ ပုံစံများ စစ်ဆေးခြင်း (YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, YYYY-MM စသည်)
  const cleanStr = str.split('T')[0].trim();
  const parts = cleanStr.split(/[-/.]/);

  if (parts.length >= 2) {
    let year = null;
    let month = null;

    // YYYY-MM-DD သို့မဟုတ် YYYY-MM
    if (parts[0].length === 4 && parseInt(parts[0], 10) >= 2020) {
      year = parts[0].slice(-2);
      month = parseInt(parts[1], 10);
    }
    // DD/MM/YYYY သို့မဟုတ် DD-MM-YYYY
    else if (parts.length >= 3 && parts[2].length === 4 && parseInt(parts[2], 10) >= 2020) {
      year = parts[2].slice(-2);
      month = parseInt(parts[1], 10);
    }
    // MM/YYYY သို့မဟုတ် MM-YYYY
    else if (parts[1].length === 4 && parseInt(parts[1], 10) >= 2020) {
      year = parts[1].slice(-2);
      month = parseInt(parts[0], 10);
    }
    // DD/MM/YY
    else if (parts.length === 3 && parts[2].length === 2) {
      year = parts[2];
      month = parseInt(parts[1], 10);
    }

    if (year && month >= 1 && month <= 12) {
      return `${REPORT_MONTH_NAMES[month - 1]}-${year}`;
    }
  }

  return '';
}

function monthLabelToYYYYMM(label) {
  const parts = String(label).trim().split('-');
  if (parts.length !== 2) return null;
  const mIdx = REPORT_MONTH_NAMES.indexOf(parts[0]);
  if (mIdx === -1) return null;
  const mm = String(mIdx + 1).padStart(2, '0');
  const yy = parts[1].length === 2 ? '20' + parts[1] : parts[1];
  return `${yy}-${mm}`;
}

/**
 * 💡 Generate 12 Fiscal Month Labels starting from March (e.g. Mar to Feb)
 */
function get12FiscalMonths(fyStr) {
  const dynamicFallback = getCurrentAcademicYear();
  let startYear = parseInt(dynamicFallback.split('-')[0], 10) || new Date().getFullYear();

  const parts = String(fyStr || '').replace(/^FY\s*/i, '').split(/[-/]/);
  if (parts.length >= 1 && !isNaN(parseInt(parts[0], 10))) {
    startYear = parseInt(parts[0], 10);
  }

  const monthsDef = [
    { m: "Mar", y: startYear }, { m: "Apr", y: startYear }, { m: "May", y: startYear },
    { m: "Jun", y: startYear }, { m: "Jul", y: startYear }, { m: "Aug", y: startYear },
    { m: "Sep", y: startYear }, { m: "Oct", y: startYear }, { m: "Nov", y: startYear },
    { m: "Dec", y: startYear }, { m: "Jan", y: startYear + 1 }, { m: "Feb", y: startYear + 1 }
  ];

  return monthsDef.map(item => `${item.m}-${String(item.y).slice(-2)}`);
}

/**
 * 💡 Helper to intelligently detect a student's regular monthly fee
 */
/* function detectStudentMonthlyFee(monthlyServices, remarksList = []) {
  const nonZero = monthlyServices.filter(v => v > 0);
  if (nonZero.length === 0) return 0;

  const freq = new Map();
  nonZero.forEach(v => freq.set(v, (freq.get(v) || 0) + 1));

  let maxCount = 0;
  let modeVal = nonZero[0];
  for (const [val, count] of freq.entries()) {
    if (count > maxCount) {
      maxCount = count;
      modeVal = val;
    }
  }

  const minVal = Math.min(...nonZero);
  const maxVal = Math.max(...nonZero);

  if (minVal < maxVal && (maxVal % minVal === 0 || maxVal >= 2 * minVal)) {
    return minVal;
  }

  if (maxCount >= 2) {
    return modeVal;
  }

  for (const r of remarksList) {
    const rLower = String(r || '').toLowerCase();
    const mMatch = rLower.match(/(\d+)\s*(?:months?|လ)/);
    if (mMatch && parseInt(mMatch[1], 10) > 1) {
      const numMonths = parseInt(mMatch[1], 10);
      if (maxVal % numMonths === 0) {
        return maxVal / numMonths;
      }
      return Math.round(maxVal / numMonths);
    }
  }

  return minVal;
} */

export async function getFinancialReportData(db, body) {
  try {
    const fallbackFy = `FY ${getCurrentAcademicYear()}`;
    const activeFy = normalizeFyStr(body.fy || fallbackFy);
    const fyClean = activeFy.replace(/^FY\s*/i, '');

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
      WHERE fy IN (?, ?)
    `).bind(activeFy, fyClean).first() || {};

    const boarder = parseFloat(incAgg.boarder || 0);
    const semiBoarder = parseFloat(incAgg.semiBoarder || 0);
    const dayStudent = parseFloat(incAgg.dayStudent || 0);
    const registration = parseFloat(incAgg.registration || 0);
    const services = parseFloat(incAgg.services || 0);
    const ferry = parseFloat(incAgg.ferry || 0);
    const nightStudy = parseFloat(incAgg.nightStudy || 0);
    const others = parseFloat(incAgg.others || 0);

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
      WHERE fy IN (?, ?)
    `).bind(activeFy, fyClean).first() || {};

    const kitAgg = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%rice%' THEN credit ELSE 0 END), 0) as riceOil,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%meat%' THEN credit ELSE 0 END), 0) as fishMeatEggs,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%beans%' THEN credit ELSE 0 END), 0) as beansVegetables,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%home%1%' THEN credit ELSE 0 END), 0) as home1Exp,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%home%2%' THEN credit ELSE 0 END), 0) as home2Exp,
        COALESCE(SUM(credit), 0) as kitchenOthers,
        COALESCE(SUM(credit), 0) as totalKitchen
      FROM kitchen 
      WHERE fy IN (?, ?)
    `).bind(activeFy, fyClean).first() || {};

    // 💡 0 D1 Quota Overhead: မူလ payroll query ထဲတွင် Liabilities များပါ တစ်ပြိုင်နက် ရယူခြင်း
    const payAgg = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%full%time%salary%' THEN credit ELSE 0 END), 0) as fullTimeSalary,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%part%time%salary%' THEN credit ELSE 0 END), 0) as partTimeSalary,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%full%time%bonus%' THEN credit ELSE 0 END), 0) as fullTimeBonus,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%full%time%fund%' THEN credit ELSE 0 END), 0) as fullTimeFund,
        COALESCE(SUM(credit), 0) as totalPayroll,
        -- 🎯 HR Payroll Bank Book Liabilities တွက်ချက်မှုများ
        COALESCE(SUM(CASE WHEN COALESCE(unpaid_bonus, 0) != 0 THEN unpaid_bonus WHEN LOWER(category) LIKE '%full%time%bonus%' THEN (debit - credit) ELSE 0 END), 0) as hrBonus,
        COALESCE(SUM(CASE WHEN COALESCE(unpaid_fund, 0) != 0 THEN unpaid_fund WHEN LOWER(category) LIKE '%full%time%fund%' THEN (debit - credit) ELSE 0 END), 0) as hrFund,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%bank%interest%' THEN debit ELSE 0 END), 0) as hrBankInterest,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%other%' THEN (debit - credit) ELSE 0 END), 0) as hrOther
      FROM payroll 
      WHERE fy IN (?, ?)
    `).bind(activeFy, fyClean).first() || {};

    const hrBonus = parseFloat(payAgg.hrBonus || 0);
    const hrFund = parseFloat(payAgg.hrFund || 0);
    const hrBankInterest = parseFloat(payAgg.hrBankInterest || 0);
    const hrOther = parseFloat(payAgg.hrOther || 0);
    const totalHrLiabilities = hrBonus + hrFund + hrBankInterest + hrOther;

    return {
      success: true,
      data: {
        fy: activeFy,
        categories: { boarder, semiBoarder, dayStudent, total: boarder + semiBoarder + dayStudent },
        accounts: { registration, services, ferry, nightStudy, others, total: registration + services + ferry + nightStudy + others },
        office: {
          adminExp: parseFloat(offAgg.adminExp || 0), vehicleExp: parseFloat(offAgg.vehicleExp || 0),
          donationSocial: parseFloat(offAgg.donationSocial || 0), assetsMaterials: parseFloat(offAgg.assetsMaterials || 0),
          construction: parseFloat(offAgg.construction || 0), hrStaffBenefit: parseFloat(offAgg.hrStaffBenefit || 0),
          studentRefund: parseFloat(offAgg.studentRefund || 0), ferryPayment: parseFloat(offAgg.ferryPayment || 0),
          drawingAcc1: parseFloat(offAgg.drawingAcc1 || 0), drawingAcc2: parseFloat(offAgg.drawingAcc2 || 0),
          total: parseFloat(offAgg.totalOffice || 0)
        },
        kitchen: {
          riceOil: parseFloat(kitAgg.riceOil || 0), fishMeatEggs: parseFloat(kitAgg.fishMeatEggs || 0),
          beansVegetables: parseFloat(kitAgg.beansVegetables || 0), home1Exp: parseFloat(kitAgg.home1Exp || 0),
          home2Exp: parseFloat(kitAgg.home2Exp || 0), others: parseFloat(kitAgg.kitchenOthers || 0),
          total: parseFloat(kitAgg.totalKitchen || 0)
        },
        payroll: {
          fullTimeSalary: parseFloat(payAgg.fullTimeSalary || 0), partTimeSalary: parseFloat(payAgg.partTimeSalary || 0),
          fullTimeBonus: parseFloat(payAgg.fullTimeBonus || 0), fullTimeFund: parseFloat(payAgg.fullTimeFund || 0),
          total: parseFloat(payAgg.totalPayroll || 0)
        },
        hrPayroll: {
          fullTimeBonus: hrBonus,
          fullTimeFund: hrFund,
          bankInterest: hrBankInterest,
          other: hrOther,
          total: totalHrLiabilities
        }
      }
    };
  } catch (err) {
    console.error("Error in getFinancialReportData handler:", err);
    return { success: false, message: "ဘဏ္ဍာရေး အစီရင်ခံစာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 2. Income Detail Report (InDetail Matrix)
 */
export async function getIncomeDetailReportData(db, body) {
  try {
    const fallbackFy = `FY ${getCurrentAcademicYear()}`;
    const activeFy = normalizeFyStr(body.fy || fallbackFy);
    const fyClean = activeFy.replace(/^FY\s*/i, '');

    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 50, 10);
    const offset = (page - 1) * limit;

    const searchVal = String(body.searchVal || "").trim().toLowerCase();
    const unpaidMonthLabel = String(body.unpaidMonthLabel || "").trim();

    const monthKeys = get12FiscalMonths(activeFy);
    const monthKeysYYYYMM = monthKeys.map(mk => monthLabelToYYYYMM(mk));

    const headers = [
      "NO", "FY", "ID", "FYID", "STUDENT NAME", "PROMO", "JOIN DATE", "TRANSFER MONTH", "STATUS", "CLASS",
      "Registration", "Ferry", "Night Study Fees", "Others",
      ...monthKeys,
      "TOTAL"
    ];

    let whereClauses = [`(s.fy IN (?, ?))`];
    let params = [activeFy, fyClean];

    if (searchVal) {
      whereClauses.push(`(LOWER(s.name) LIKE ? OR LOWER(s.fyid) LIKE ? OR LOWER(s.class) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p);
    }
    const whereSql = `WHERE ` + whereClauses.join(' AND ');

    // Fetch ONLY the students matching the criteria
    const allStudents = (await db.prepare(`
      SELECT s.student_id, s.id, s.fy, s.fyid, s.name, s.fyid_name, s.promo, s.date, s.transfer_date, s.status, s.class 
      FROM student s ${whereSql}
    `).bind(...params).all()).results || [];


    // Fetch Income Data including 'my' and 'remark'
    const allIncome = (await db.prepare(`
      SELECT student_id, account_name, credit, debit, effect_date, date, my, remark 
      FROM income 
      WHERE fy IN (?, ?)
    `).bind(activeFy, fyClean).all()).results || [];

    const studentGroupMap = new Map();

    allStudents.forEach(s => {
      const cleanStuId = parseInt(s.student_id || s.id, 10);
      studentGroupMap.set(cleanStuId, {
        fy: s.fy || activeFy,
        id: cleanStuId,
        fyid: s.fyid || '',
        name: s.name || s.fyid_name || '',
        promo: s.promo || 'Original price',
        joinDate: '',
        registrationDate: s.date || '',
        transferMonth: s.transfer_date || '-',
        status: s.status || 'Active',
        class: s.class || '',
        category: s.category || '',
        registration: 0,
        ferry: 0,
        nightStudy: 0,
        others: 0,
        monthlyServices: new Array(12).fill(0),
        leaveMonths: new Set(),
        remarksList: []
      });
    });

    const myanmarMonths = {
      'mar': ['mar', 'မတ်'], 'apr': ['apr', 'ဧပြီ'], 'may': ['may', 'မေ'],
      'jun': ['jun', 'ဇွန်'], 'jul': ['jul', 'ဇူလိုင်'], 'aug': ['aug', 'သြဂုတ်', 'ဩဂုတ်'],
      'sep': ['sep', 'စက်တင်ဘာ'], 'oct': ['oct', 'အောက်တိုဘာ'], 'nov': ['nov', 'နိုဝင်ဘာ'],
      'dec': ['dec', 'ဒီဇင်ဘာ'], 'jan': ['jan', 'ဇန်နဝါရီ'], 'feb': ['feb', 'ဖေဖော်ဝါရီ']
    };

    allIncome.forEach(row => {
      const cleanStuId = parseInt(row.student_id, 10);
      if (!studentGroupMap.has(cleanStuId)) return;

      const stGroup = studentGroupMap.get(cleanStuId);
      const acc = String(row.account_name || '').toLowerCase().trim();
      const credit = parseFloat(row.credit || 0) - parseFloat(row.debit || 0);
      const effDate = row.effect_date || row.date || '';

      // 🚀 Fail-Safe Month-Year Resolver: effect_date -> my -> date -> remark စဉ်ဆက်မပြတ် စစ်ဆေးခြင်း
      let mStr = parseSafeMonthYear(row.effect_date, activeFy);
      if (!mStr || !monthKeys.includes(mStr)) mStr = parseSafeMonthYear(row.my, activeFy);
      if (!mStr || !monthKeys.includes(mStr)) mStr = parseSafeMonthYear(row.date, activeFy);
      if (!mStr || !monthKeys.includes(mStr)) mStr = parseSafeMonthYear(row.remark, activeFy);

      const mIdx = mStr ? monthKeys.indexOf(mStr) : -1;

      if (row.remark) {
        stGroup.remarksList.push(row.remark);
      }

      // Smart Leave Filter
      const rText = String(row.remark || '').toLowerCase();
      if (rText.includes('leave') || rText.includes('inactive') || rText.includes('နား') || rText.includes('ခွင့်')) {
        let foundExplicitMonth = false;

        monthKeys.forEach((mKey, idx) => {
          const shortMonth = mKey.split('-')[0].toLowerCase();
          const keywords = myanmarMonths[shortMonth] || [shortMonth];
          if (keywords.some(kw => rText.includes(kw))) {
            stGroup.leaveMonths.add(idx);
            foundExplicitMonth = true;
          }
        });

        if (!foundExplicitMonth && mIdx >= 0) {
          stGroup.leaveMonths.add(mIdx);
        }
      }

      // 🚀 Account Classification & Safe Allocation (Logic Refined)
      const isReg = acc.includes('registration');
      const isFerry = acc.includes('ferry');
      const isNight = acc.includes('night');
      const isService = acc.includes('service') || acc.includes('tuition') || acc.includes('monthly') || acc.includes('school') || acc.includes('လခ') || acc.includes('လစဥ်');

      if (isReg) {
        stGroup.registration += credit;
      } else if (isFerry) {
        stGroup.ferry += credit;
      } else if (isNight) {
        stGroup.nightStudy += credit;
      } else if (isService) {
        if (!stGroup.joinDate || (effDate && effDate < stGroup.joinDate)) {
          stGroup.joinDate = effDate;
        }
        if (mIdx >= 0) {
          stGroup.monthlyServices[mIdx] += credit;
        } else {
          // လအမည် ခွဲမရပါက စာရင်းမပျောက်စေရန် Others ထဲ ထည့်သွင်းခြင်း
          stGroup.others += credit;
        }
      } else {
        // Uniform, Books, စာမေးပွဲကြေးနှင့် အခြားခေါင်းစဉ်များသည် Others ထဲသို့ မှန်ကန်စွာ ရောက်ရှိမည်
        stGroup.others += credit;
      }
    });

    /* // ⚡ ADVANCE AUTO-ROLLOVER ENGINE (Cascading advance payments forward)
    studentGroupMap.forEach(stGroup => {
      const regularFee = detectStudentMonthlyFee(stGroup.monthlyServices, stGroup.remarksList);

      if (regularFee > 0) {
        for (let m = 0; m < 12; m++) {
          if (stGroup.monthlyServices[m] >= regularFee * 1.5) {
            const totalPaidThisMonth = stGroup.monthlyServices[m];
            let remainingAdvance = totalPaidThisMonth - regularFee;
            stGroup.monthlyServices[m] = regularFee;

            for (let nextM = m + 1; nextM < 12 && remainingAdvance > 0; nextM++) {
              if (stGroup.monthlyServices[nextM] <= 0 && !stGroup.leaveMonths.has(nextM)) {
                const alloc = Math.min(remainingAdvance, regularFee);
                stGroup.monthlyServices[nextM] = alloc;
                remainingAdvance -= alloc;
              }
            }

            if (remainingAdvance > 0) {
              stGroup.monthlyServices[m] += remainingAdvance;
            }
          }
        }
      }
    }); */

    let processedList = Array.from(studentGroupMap.values());

    // Advanced "Unpaid Month" Logic with Leave & Full Scholar Exemption
    if (unpaidMonthLabel) {
      const targetIdx = monthKeys.indexOf(unpaidMonthLabel);
      if (targetIdx >= 0) {
        processedList = processedList.filter(st => {
          if (String(st.status).toLowerCase() !== 'active') return false;

          const promoStr = String(st.promo || '').toLowerCase().trim();
          const catStr = String(st.category || '').toLowerCase().trim();
          if ((promoStr.includes('full') && promoStr.includes('scholar')) ||
            (catStr.includes('full') && catStr.includes('scholar'))) {
            return false;
          }

          let joinDateStr = st.joinDate || st.registrationDate;
          let joinYYYYMM = '';
          if (joinDateStr) joinYYYYMM = joinDateStr.substring(0, 7);

          let joinIdx = monthKeysYYYYMM.indexOf(joinYYYYMM);
          if (joinIdx === -1) {
            if (joinYYYYMM && joinYYYYMM < monthKeysYYYYMM[0]) joinIdx = 0;
            else joinIdx = 999;
          }

          if (joinIdx > targetIdx) return false;

          let hasUnpaid = false;
          for (let i = joinIdx; i <= targetIdx; i++) {
            if (st.monthlyServices[i] <= 0 && !st.leaveMonths.has(i)) {
              hasUnpaid = true;
              break;
            }
          }

          return hasUnpaid;
        });
      }
    }

    const classOrder = ["Grade 12", "Grade 11", "Grade 10", "Grade 9", "Grade 8", "Grade 7", "Grade 6", "Grade 5", "Grade 4", "Grade 3", "Grade 2", "Grade 1", "KG Student", "Pre School"];
    processedList.sort((a, b) => {
      let idxA = classOrder.indexOf(a.class);
      let idxB = classOrder.indexOf(b.class);
      if (idxA === -1) idxA = 99;
      if (idxB === -1) idxB = 99;

      if (idxA === idxB) return String(a.name).localeCompare(String(b.name));
      return idxA - idxB;
    });

    const totalRows = processedList.length;
    const endIndex = Math.min(offset + limit, totalRows);
    const paginatedList = processedList.slice(offset, endIndex);

    const dataMatrix = [];
    const pageTotals = new Array(headers.length).fill(0);
    pageTotals[0] = "Page Total";
    for (let k = 1; k <= 9; k++) pageTotals[k] = "";

    let seqNo = offset + 1;
    paginatedList.forEach(st => {
      const servicesSum = st.monthlyServices.reduce((a, b) => a + b, 0);
      const rowTotal = st.registration + st.ferry + st.nightStudy + st.others + servicesSum;

      const finalMonthlyServices = st.monthlyServices.map((amt, idx) => {
        if (amt <= 0 && st.leaveMonths.has(idx)) return "Leave";
        return amt;
      });

      const rowArr = [
        seqNo++, st.fy, st.id, st.fyid, st.name, st.promo,
        st.joinDate || '-', st.transferMonth || '-', st.status, st.class,
        st.registration, st.ferry, st.nightStudy, st.others,
        ...finalMonthlyServices, rowTotal
      ];

      for (let c = 10; c < rowArr.length; c++) {
        if (typeof rowArr[c] === 'number') {
          pageTotals[c] += parseFloat(rowArr[c] || 0);
        }
      }
      dataMatrix.push(rowArr);
    });

    return {
      success: true,
      headers,
      data: dataMatrix,
      grandTotalRow: pageTotals,
      fy: activeFy,
      totalRows,
      page,
      limit
    };
  } catch (err) {
    console.error("Error in getIncomeDetailReportData handler:", err);
    return { success: false, message: "ဝင်ငွေ အသေးစိတ် အစီရင်ခံစာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 3. Monthly Income Report (InRep) - 🚀 SQL OPTIMIZED
 */
/**
 * 💡 3. Monthly Income Report (InRep) - 🚀 SQL OPTIMIZED with EXACT TOTALS
 */
export async function getMonthlyIncomeReportData(db, body) {
  try {
    const fallbackFy = `FY ${getCurrentAcademicYear()}`;
    const activeFy = normalizeFyStr(body.fy || fallbackFy);
    const fyClean = activeFy.replace(/^FY\s*/i, '');

    const rowsRes = await db.prepare(`SELECT account_name, category, credit, debit, effect_date, date, my FROM income WHERE fy IN (?, ?)`).bind(activeFy, fyClean).all();
    const list = rowsRes.results || [];

    const monthKeys = get12FiscalMonths(activeFy);
    const headers = ["ACCOUNT / CATEGORY", ...monthKeys, "TOTAL"];

    // ============================================
    // 🎯 TABLE 1: Primary Revenue Breakdown
    // ============================================
    const t1Totals = new Array(14).fill(0);
    const accounts = ["Registration", "Services", "Ferry", "Night Study Fees", "Others"];

    const t1Data = accounts.map(acc => {
      const monthAmts = new Array(12).fill(0);

      list.forEach(r => {
        const rawAcc = String(r.account_name || '').toLowerCase().trim();
        let isMatch = false;

        if (acc === 'Others') {
          // 🎯 Catch-All: Registration, Service, Ferry, Night မဟုတ်သမျှ အားလုံးသည် Others ထဲသို့ အလိုအလျောက် ဝင်မည် (စာလုံးပေါင်း မှားသည်ဖြစ်စေ)
          isMatch = !rawAcc.includes('registration') && !rawAcc.includes('service') &&
            !rawAcc.includes('ferry') && !rawAcc.includes('night');
        } else if (acc === 'Registration' && rawAcc.includes('registration')) {
          isMatch = true;
        } else if (acc === 'Services' && rawAcc.includes('service')) {
          isMatch = true;
        } else if (acc === 'Ferry' && rawAcc.includes('ferry')) {
          isMatch = true;
        } else if (acc === 'Night Study Fees' && rawAcc.includes('night')) {
          isMatch = true;
        }

        if (isMatch) {
          let mStr = parseSafeMonthYear(r.effect_date, activeFy) || parseSafeMonthYear(r.my, activeFy) || parseSafeMonthYear(r.date, activeFy);
          let idx = mStr ? monthKeys.indexOf(mStr) : -1;

          // 🎯 OOB Guard (Out of Bounds): ရက်စွဲသည် ဤဘဏ္ဍာနှစ် ၁၂ လ အတွင်း မပါဝင်ခဲ့လျှင်သော်လည်းကောင်း၊ Format မှားနေလျှင်သော်လည်းကောင်း ငွေမပျောက်စေရန် 
          // ပထမဆုံးလ (e.g. Mar-26) ထဲသို့ Default ထည့်သွင်းပေးမည်။ ထိုမှသာ Table 1 နှင့် Table 2 ၏ Grand Total အတိအကျ ညီမျှမည် ဖြစ်ပါသည်။
          if (idx === -1) idx = 0;

          monthAmts[idx] += (parseFloat(r.credit || 0) - parseFloat(r.debit || 0));
        }
      });

      const rowSum = monthAmts.reduce((a, b) => a + b, 0);
      monthAmts.forEach((amt, i) => t1Totals[i + 1] += amt);
      t1Totals[13] += rowSum;
      return [acc, ...monthAmts, rowSum];
    });
    const t1TotalRow = ["Total", ...t1Totals.slice(1)];


    // ============================================
    // 🎯 TABLE 2: Secondary Category Summary
    // ============================================
    const t2Totals = new Array(14).fill(0);
    const categories = ["Boarder", "Semi Boarder", "Day Student", "Other Category"];

    const t2Data = categories.map(cat => {
      const monthAmts = new Array(12).fill(0);

      list.forEach(r => {
        const rawCat = String(r.category || '').toLowerCase().trim();
        let isMatch = false;

        if (cat === 'Other Category') {
          // 🎯 Catch-All: Boarder, Semi, Day မဟုတ်သမျှ အားလုံး Other ထဲ ဝင်မည်
          isMatch = !rawCat.includes('boarder') && !rawCat.includes('semi') && !rawCat.includes('day');
        } else if (cat === 'Semi Boarder' && rawCat.includes('semi')) {
          isMatch = true;
        } else if (cat === 'Boarder' && rawCat.includes('boarder') && !rawCat.includes('semi')) {
          isMatch = true;
        } else if (cat === 'Day Student' && rawCat.includes('day')) {
          isMatch = true;
        }

        if (isMatch) {
          let mStr = parseSafeMonthYear(r.date, activeFy) || parseSafeMonthYear(r.effect_date, activeFy) || parseSafeMonthYear(r.my, activeFy);
          let idx = mStr ? monthKeys.indexOf(mStr) : -1;

          // 🎯 OOB Guard: ငွေမပျောက်စေရန် Default နေရာသို့ ထည့်သွင်းခြင်း
          if (idx === -1) idx = 0;

          monthAmts[idx] += (parseFloat(r.credit || 0) - parseFloat(r.debit || 0));
        }
      });

      const rowSum = monthAmts.reduce((a, b) => a + b, 0);
      monthAmts.forEach((amt, i) => t2Totals[i + 1] += amt);
      t2Totals[13] += rowSum;
      return [cat, ...monthAmts, rowSum];
    });
    const t2TotalRow = ["Total", ...t2Totals.slice(1)];

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
 * 💡 4. Student Demographics Details - 🚀 SQL OPTIMIZED
 */
export async function getStudentReportDetails(db, body) {
  try {
    const fallbackFy = getCurrentAcademicYear();
    const activeFy = body.fy ? body.fy.replace(/^FY\s*/i, '') : fallbackFy;
    const fyPrefixed = `FY ${activeFy}`;

    const list = (await db.prepare(`SELECT class, status, category, gender FROM student WHERE fy IN (?, ?)`).bind(activeFy, fyPrefixed).all()).results || [];

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
        if (cat.includes('semi')) sb++; else if (cat.includes('boarder')) b++; else ds++;
        const g = String(s.gender || 'Male').toLowerCase();
        if (g.includes('f') || g.includes('မ')) f++; else m++;
      });

      totB += b; totSB += sb; totDS += ds; totAct += act; totInact += inact; totM += m; totF += f;
      return [i + 1, activeFy, cls, b, sb, ds, act, inact, m, f];
    });

    const totalRow = ["Total", "", "", totB, totSB, totDS, totAct, totInact, totM, totF];
    return { success: true, table1: { title: `Current FY (${activeFy}) Student Demographics Report`, headers, data: t1Data, total: totalRow } };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * 💡 5. Staff Bonus & Fund Report Data - 🚀 SQL OPTIMIZED
 */
export async function getFundReportData(db, body) {
  try {
    const list = (await db.prepare(`SELECT id, staff_id, fund_date, name, staff_idname, unpaid_bonus, unpaid_fund, status FROM staff_fulltime ORDER BY id ASC LIMIT 1000`).all()).results || [];
    const data = list.map((r, i) => {
      const bonus = parseFloat(r.unpaid_bonus || 0);
      const fund = parseFloat(r.unpaid_fund || 0);
      return {
        no: i + 1, fundDate: r.fund_date || '-', staffId: cleanIntegerId(r.staff_id || r.id),
        name: r.name || r.staff_idname || '', bonusBalance: bonus, fundBalance: fund,
        totalBalances: bonus + fund, status: r.status || 'Active'
      };
    });
    return { success: true, data };
  } catch (err) {
    return { success: false, message: err.message };
  }
}