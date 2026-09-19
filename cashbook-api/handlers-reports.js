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
 *              🎯 ZERO HARDCODING: Dynamic Fiscal Year Fallbacks via getCurrentAcademicYear
 * ==============================================================================
 */

import { normalizeFyStr, getCurrentAcademicYear } from './utils.js';

function cleanIntegerId(val) {
  if (val === null || val === undefined) return '';
  return String(val).trim().replace(/\.0+$/, '');
}

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

function monthLabelToYYYYMM(label) {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parts = String(label).trim().split('-');
  if (parts.length !== 2) return null;
  const mIdx = monthNames.indexOf(parts[0]);
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

export async function getFinancialReportData(db, body) {
  try {
    const fallbackFy = `FY ${getCurrentAcademicYear()}`;
    const activeFy = normalizeFyStr(body.fy || fallbackFy);
    const fyClean = activeFy.replace(/^FY\s*/i, '');

    // 🚀 ULTRA-OPTIMIZATION: `fy IN (?, ?)` prevents Table Full Scans
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
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%others%' THEN credit ELSE 0 END), 0) as kitchenOthers,
        COALESCE(SUM(credit), 0) as totalKitchen
      FROM kitchen 
      WHERE fy IN (?, ?)
    `).bind(activeFy, fyClean).first() || {};

    const payAgg = await db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%full%time%salary%' THEN credit ELSE 0 END), 0) as fullTimeSalary,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%part%time%salary%' THEN credit ELSE 0 END), 0) as partTimeSalary,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%full%time%bonus%' THEN credit ELSE 0 END), 0) as fullTimeBonus,
        COALESCE(SUM(CASE WHEN LOWER(category) LIKE '%full%time%fund%' THEN credit ELSE 0 END), 0) as fullTimeFund,
        COALESCE(SUM(credit), 0) as totalPayroll
      FROM payroll 
      WHERE fy IN (?, ?)
    `).bind(activeFy, fyClean).first() || {};

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
        }
      }
    };
  } catch (err) {
    console.error("Error in getFinancialReportData handler:", err);
    return { success: false, message: "ဘဏ္ဍာရေး အစီရင်ခံစာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 2. Income Detail Report (InDetail Matrix) - 🚀 SQL OPTIMIZED
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

    // 🚀 ULTRA-OPTIMIZATION: `s.fy IN (?, ?)` prevents Table Full Scans
    let whereClauses = [`(s.fy IN (?, ?))`];
    let params = [activeFy, fyClean];

    if (searchVal) {
      whereClauses.push(`(LOWER(s.name) LIKE ? OR LOWER(s.fyid) LIKE ? OR LOWER(s.class) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p);
    }
    const whereSql = `WHERE ` + whereClauses.join(' AND ');

    // Fetch ONLY the students matching the criteria (Paginated processing logic below)
    const allStudents = (await db.prepare(`
      SELECT s.student_id, s.id, s.fy, s.fyid, s.name, s.fyid_name, s.promo, s.date, s.transfer_date, s.status, s.class 
      FROM student s ${whereSql}
    `).bind(...params).all()).results || [];
    
    // 🚀 ULTRA-OPTIMIZATION: `fy IN (?, ?)` prevents Table Full Scans
    const allIncome = (await db.prepare(`
      SELECT student_id, account_name, credit, debit, effect_date, date 
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
        registration: 0,
        ferry: 0,
        nightStudy: 0,
        others: 0,
        monthlyServices: new Array(12).fill(0)
      });
    });

    allIncome.forEach(row => {
      const cleanStuId = parseInt(row.student_id, 10);
      if (!studentGroupMap.has(cleanStuId)) return;

      const stGroup = studentGroupMap.get(cleanStuId);
      const acc = String(row.account_name || '').toLowerCase().trim();
      const credit = parseFloat(row.credit || 0) - parseFloat(row.debit || 0);
      const effDate = row.effect_date || row.date || '';

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

    let processedList = Array.from(studentGroupMap.values());

    // Advanced "Unpaid Month" Logic
    if (unpaidMonthLabel) {
      const targetIdx = monthKeys.indexOf(unpaidMonthLabel);
      if (targetIdx >= 0) {
        processedList = processedList.filter(st => {
          if (String(st.status).toLowerCase() !== 'active') return false;

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
            if (st.monthlyServices[i] <= 0) {
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

      const rowArr = [
        seqNo++, st.fy, st.id, st.fyid, st.name, st.promo,
        st.joinDate || '-', st.transferMonth || '-', st.status, st.class,
        st.registration, st.ferry, st.nightStudy, st.others,
        ...st.monthlyServices, rowTotal
      ];

      for (let c = 10; c < rowArr.length; c++) {
        pageTotals[c] += parseFloat(rowArr[c] || 0);
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
export async function getMonthlyIncomeReportData(db, body) {
  try {
    const fallbackFy = `FY ${getCurrentAcademicYear()}`;
    const activeFy = normalizeFyStr(body.fy || fallbackFy);
    const fyClean = activeFy.replace(/^FY\s*/i, '');

    // 🚀 ULTRA-OPTIMIZATION: `fy IN (?, ?)` prevents Table Full Scans
    const rowsRes = await db.prepare(`SELECT account_name, category, credit, debit, effect_date, date FROM income WHERE fy IN (?, ?)`).bind(activeFy, fyClean).all();
    const list = rowsRes.results || [];

    const monthKeys = get12FiscalMonths(activeFy);
    const headers = ["ACCOUNT / CATEGORY", ...monthKeys, "TOTAL"];

    const accounts = ["Registration", "Services", "Ferry", "Night Study Fees", "Others"];
    const t1Totals = new Array(14).fill(0);

    const t1Data = accounts.map(acc => {
      const monthAmts = new Array(12).fill(0);
      list.filter(r => String(r.account_name || '').toLowerCase().trim() === acc.toLowerCase()).forEach(r => {
        const effDate = r.effect_date || r.date || '';
        const mStr = parseSafeMonthYear(effDate);
        const idx = monthKeys.indexOf(mStr);
        if (idx >= 0) monthAmts[idx] += (parseFloat(r.credit || 0) - parseFloat(r.debit || 0));
      });

      const rowSum = monthAmts.reduce((a, b) => a + b, 0);
      monthAmts.forEach((amt, i) => t1Totals[i + 1] += amt);
      t1Totals[13] += rowSum;
      return [acc, ...monthAmts, rowSum];
    });

    const t1TotalRow = ["Total", ...t1Totals.slice(1)];
    const categories = ["Boarder", "Semi Boarder", "Day Student"];
    const t2Totals = new Array(14).fill(0);

    const t2Data = categories.map(cat => {
      const monthAmts = new Array(12).fill(0);
      list.filter(r => String(r.category || '').toLowerCase().trim().includes(cat.toLowerCase())).forEach(r => {
        const txDate = r.date || r.effect_date || '';
        const mStr = parseSafeMonthYear(txDate);
        const idx = monthKeys.indexOf(mStr);
        if (idx >= 0) monthAmts[idx] += (parseFloat(r.credit || 0) - parseFloat(r.debit || 0));
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

    // 🚀 ULTRA-OPTIMIZATION: `fy IN (?, ?)` prevents Table Full Scans
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
    // 🚀 OPTIMIZATION: Added LIMIT 1000 to prevent runaway memory usage
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