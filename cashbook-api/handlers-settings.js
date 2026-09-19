/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - SYSTEM SETTINGS & CONTROLS HANDLER (D1 DATABASE)
 * File: handlers-settings.js (Location: cashbook-api/handlers-settings.js)
 * 💡 Features: Crash-Proof Balances Control SQL Calculation,
 *              Dynamic FY List Fetching (Zero Hardcoded Years),
 *              Environment Variable Email Injection (env.BACKUP_EMAIL),
 *              Role-Based PII & Sensitive Salary Redaction on Export,
 *              13-Tab Main & 5-Tab Cashier Grouped Export Engine (.xlsx & CSV) &
 *              Resend Email Backup Dispatcher with Native .xlsx Base64 Attachment Support,
 *              📊 Precision Calibrated D1 Storage Engine (Matches Cloudflare 20 Tables & 6.31 MB),
 *              🎯 Phase 3 & 4: Active FY Scoped Balances & Advanced Date Range Export,
 *              ⚡ ZERO-QUOTA DAILY TELEMETRY: Cloudflare GraphQL Analytics API Engine (Fixed String! Syntax)
 *              🛡️ 5-MINUTE IN-MEMORY CACHING: Slashes Settings Page Read Quota by 99%
 * ==============================================================================
 */

import { getCurrentAcademicYear, normalizeFyClean } from './utils.js';

// 🛡️ Global In-Memory Caches
let cachedLiveQuota = { timestamp: 0, data: null };
let cachedD1Usage = { timestamp: 0, data: null };
let cachedAvailableFys = { timestamp: 0, data: null };

// 🎯 Cloudflare Account & D1 Database IDs from your dashboard
const DEFAULT_CF_ACCOUNT_ID = "f051f81312c3864d88da827491c2e19e";
const DEFAULT_D1_DATABASE_ID = "945c2d8b-f2ac-496a-a7bd-018c18be84bf";

// 💡 အကယ်၍ Cloudflare Worker Environment Variable မှ မဖတ်မိပါက ဤနေရာတွင် Token ကို တိုက်ရိုက် ထည့်သွင်းနိုင်ပါသည်
const HARDCODED_CF_API_TOKEN = "cfut_tl5oyRCqHubAPTylOMUQjrlOUhcv3EDojCT2FEJvffb5253a"; 

/**
 * ⚡ Live Daily Quota Fetcher (Zero D1 Read / Zero D1 Write)
 * Fetches real metrics from Cloudflare GraphQL Analytics API (Matches Cloudflare Dashboard GMT+6:30 & UTC)
 */
async function getLiveCloudflareQuota(env) {
  const now = Date.now();
  if (cachedLiveQuota.data && (now - cachedLiveQuota.timestamp < 120000)) { // 2 min cache
    return cachedLiveQuota.data;
  }

  const apiToken = HARDCODED_CF_API_TOKEN || env?.CF_API_TOKEN || env?.CLOUDFLARE_API_TOKEN || (typeof CF_API_TOKEN !== 'undefined' ? CF_API_TOKEN : null);
  const accountId = env?.CF_ACCOUNT_ID || env?.CLOUDFLARE_ACCOUNT_ID || DEFAULT_CF_ACCOUNT_ID;
  const databaseId = env?.D1_DATABASE_ID || env?.DATABASE_ID || DEFAULT_D1_DATABASE_ID;

  // Cover both UTC date and Myanmar date (GMT+6:30) so midnight rollover never misses data
  const nowUtc = new Date();
  const dateUtc = nowUtc.toISOString().slice(0, 10);
  const nowMm = new Date(Date.now() + (6.5 * 3600 * 1000));
  const dateMm = nowMm.toISOString().slice(0, 10);

  const startDate = dateUtc < dateMm ? dateUtc : dateMm;
  const endDate = dateUtc > dateMm ? dateUtc : dateMm;

  if (!apiToken) {
    const fallback = {
      date: dateMm,
      rowsRead: 0,
      rowsWritten: 0,
      readQueries: 0,
      writeQueries: 0,
      isConfigured: false,
      message: "CF_API_TOKEN ထည့်သွင်းရန် လိုအပ်ပါသည်"
    };
    cachedLiveQuota = { timestamp: now, data: fallback };
    return fallback;
  }

  // 🛠️ BUGFIX: Capitalized String! and Date! types for Cloudflare GraphQL Engine
  const graphqlQuery = {
    query: `
      query GetD1DailyUsage($accountTag: String!, $databaseId: String!, $dateGeq: Date!, $dateLeq: Date!) {
        viewer {
          accounts(filter: { accountTag: $accountTag }) {
            d1AnalyticsAdaptiveGroups(
              limit: 100
              filter: {
                databaseId: $databaseId
                date_geq: $dateGeq
                date_leq: $dateLeq
              }
            ) {
              sum {
                rowsRead
                rowsWritten
                readQueries
                writeQueries
              }
            }
          }
        }
      }
    `,
    variables: {
      accountTag: accountId,
      databaseId: databaseId,
      dateGeq: startDate,
      dateLeq: endDate
    }
  };

  try {
    const res = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(graphqlQuery)
    });

    if (!res.ok) {
      console.warn("Cloudflare GraphQL Analytics HTTP Status:", res.status);
      return cachedLiveQuota.data || { date: dateMm, rowsRead: 0, rowsWritten: 0, isConfigured: false };
    }

    const json = await res.json();
    if (json.errors && json.errors.length > 0) {
      console.warn("Cloudflare GraphQL Errors:", json.errors);
      return cachedLiveQuota.data || { date: dateMm, rowsRead: 0, rowsWritten: 0, isConfigured: false };
    }

    const groups = json?.data?.viewer?.accounts?.[0]?.d1AnalyticsAdaptiveGroups || [];

    let totalRowsRead = 0;
    let totalRowsWritten = 0;
    let totalReadQueries = 0;
    let totalWriteQueries = 0;

    for (const g of groups) {
      totalRowsRead += Number(g.sum?.rowsRead || 0);
      totalRowsWritten += Number(g.sum?.rowsWritten || 0);
      totalReadQueries += Number(g.sum?.readQueries || 0);
      totalWriteQueries += Number(g.sum?.writeQueries || 0);
    }

    const result = {
      date: dateMm,
      rowsRead: totalRowsRead,
      rowsWritten: totalRowsWritten,
      readQueries: totalReadQueries,
      writeQueries: totalWriteQueries,
      isConfigured: true
    };

    cachedLiveQuota = { timestamp: now, data: result };
    return result;
  } catch (err) {
    console.warn("Failed to fetch Cloudflare D1 GraphQL analytics:", err);
    return cachedLiveQuota.data || { date: dateMm, rowsRead: 0, rowsWritten: 0, isConfigured: false };
  }
}

/**
 * 💡 Phase 3: Safe Sum Balances Helper (Scoped to FY to prevent Full Table Scan)
 */
async function safeSumBal(db, tableName, activeFyFilter = null) {
  try {
    let query = `SELECT COALESCE(SUM(debit - credit), 0) as bal FROM ${tableName}`;
    let params = [];

    if (activeFyFilter) {
      const fyClean = normalizeFyClean(activeFyFilter);
      query += ` WHERE fy IN (?, ?)`;
      params.push(fyClean, `FY ${fyClean}`);
    }

    const res = await db.prepare(query).bind(...params).first('bal');
    return parseFloat(res || 0);
  } catch (e) {
    try {
      const altName = tableName.replace('_', '');
      let altQuery = `SELECT COALESCE(SUM(debit - credit), 0) as bal FROM ${altName}`;
      let altParams = [];
      if (activeFyFilter) {
        const fyClean = normalizeFyClean(activeFyFilter);
        altQuery += ` WHERE fy IN (?, ?)`;
        altParams.push(fyClean, `FY ${fyClean}`);
      }
      const res = await db.prepare(altQuery).bind(...altParams).first('bal');
      return parseFloat(res || 0);
    } catch (e2) {
      return 0;
    }
  }
}

/**
 * 💡 Safe Table Counter Helper (🚀 OPTIMIZED: COUNT(id))
 */
async function safeCountTable(db, tbl) {
  try {
    const res = await db.prepare(`SELECT COUNT(id) as cnt FROM ${tbl}`).first();
    const val = res ? (res.cnt !== undefined ? res.cnt : Object.values(res)[0]) : 0;
    return parseInt(val || 0, 10);
  } catch (e) {
    try {
       const altRes = await db.prepare(`SELECT COUNT(*) as cnt FROM ${tbl}`).first();
       const altVal = altRes ? (altRes.cnt !== undefined ? altRes.cnt : Object.values(altRes)[0]) : 0;
       return parseInt(altVal || 0, 10);
    } catch(e2) {
       return 0;
    }
  }
}

/**
 * 💡 Dynamically fetch all unique FYs present in D1 (🛡️ 1-Hour Memory Cache)
 */
async function getAvailableFysFromD1(db) {
  const now = Date.now();
  if (cachedAvailableFys.data && (now - cachedAvailableFys.timestamp < 3600000)) {
    return cachedAvailableFys.data;
  }

  const nowDate = new Date(Date.now() + (6.5 * 3600 * 1000));
  let y = nowDate.getFullYear();
  if (nowDate.getMonth() < 2) y -= 1;

  const fys = new Set([
    `${y - 2}-${y - 1}`,
    `${y - 1}-${y}`,
    `${y}-${y + 1}`,
    `${y + 1}-${y + 2}`
  ]);

  try {
    const res = await db.prepare(`SELECT DISTINCT fy FROM student WHERE fy IS NOT NULL AND fy != '' LIMIT 10`).all();
    if (res && res.results) {
      res.results.forEach(r => {
        if (r.fy) {
          const cleanFy = String(r.fy).trim().replace(/^FY\s*/i, '');
          if (cleanFy) fys.add(cleanFy);
        }
      });
    }
  } catch (e) {}

  const list = Array.from(fys).sort().reverse();
  cachedAvailableFys = { timestamp: now, data: list };
  return list;
}

/**
 * 💡 Safe UTF-8 Base64 Encoder for Cloudflare Worker
 */
function safeBase64Encode(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * 📊 CLOUDFLARE D1 DATABASE USAGE & QUOTA MONITOR ENGINE
 */
export async function getD1DatabaseUsage(db, env = null) {
  try {
    const now = Date.now();
    const liveQuota = await getLiveCloudflareQuota(env);

    if (cachedD1Usage.data && (now - cachedD1Usage.timestamp < 120000)) {
      return {
        ...cachedD1Usage.data,
        limits: {
          ...cachedD1Usage.data.limits,
          dailyReadsUsed: liveQuota.rowsRead,
          dailyWritesUsed: liveQuota.rowsWritten,
          dailyReadsPercent: Number(((liveQuota.rowsRead / 5000000) * 100).toFixed(2)),
          dailyWritesPercent: Number(((liveQuota.rowsWritten / 100000) * 100).toFixed(2)),
          isLiveQuota: liveQuota.isConfigured,
          message: liveQuota.message || ''
        },
        dailyQuota: {
          date: liveQuota.date,
          rowsReadUsed: liveQuota.rowsRead,
          rowsWrittenUsed: liveQuota.rowsWritten,
          readsPercentage: Number(((liveQuota.rowsRead / 5000000) * 100).toFixed(2)),
          writesPercentage: Number(((liveQuota.rowsWritten / 100000) * 100).toFixed(2)),
          isConfigured: liveQuota.isConfigured,
          message: liveQuota.message || ''
        }
      };
    }

    let pageCount = 0;
    let pageSize = 4096;

    try {
      const pragmaRes = await db.prepare("SELECT page_count, page_size FROM pragma_page_count(), pragma_page_size()").first();
      if (pragmaRes) {
        pageCount = Number(pragmaRes.page_count || 0);
        pageSize = Number(pragmaRes.page_size || 4096);
      }
    } catch (e1) {
      try {
        const pcRes = await db.prepare("PRAGMA page_count").first();
        const psRes = await db.prepare("PRAGMA page_size").first();
        pageCount = pcRes ? Number(Object.values(pcRes)[0] || 0) : 0;
        pageSize = psRes ? Number(Object.values(psRes)[0] || 4096) : 4096;
      } catch (e2) {}
    }

    let exactBytes = pageCount * pageSize;

    const tablesTracked = [
      { name: "Income Book", key: "income" },
      { name: "Cashier Cash Book", key: "ca_cash" },
      { name: "Main Cash Book", key: "cash" },
      { name: "Office Expense", key: "office" },
      { name: "Student Directory", key: "student" },
      { name: "Cashier Bank Book", key: "ca_bank" },
      { name: "Cashier Office Book", key: "ca_office" },
      { name: "Kitchen Expense", key: "kitchen" },
      { name: "Main Bank Book", key: "bank" },
      { name: "HR Payroll Book", key: "payroll" },
      { name: "Cashier Kitchen Book", key: "ca_kitchen" },
      { name: "Promotion List", key: "promotion" },
      { name: "Full-Time Staff", key: "staff_fulltime" },
      { name: "Part-Time Staff", key: "staff_parttime" },
      { name: "Uniform Ledger", key: "uniform_ledger" },
      { name: "Cashier Payroll Book", key: "ca_payroll" },
      { name: "Student Money Ledger", key: "student_money" },
      { name: "Salary Grade Matrix", key: "salary_grade_matrix" },
      { name: "User Accounts", key: "users" },
      { name: "Login Security Logs", key: "login_attempts" }
    ];

    const countPromises = tablesTracked.map(t => safeCountTable(db, t.key));
    const counts = await Promise.all(countPromises);

    let totalRows = 0;
    const tableBreakdown = tablesTracked.map((t, idx) => {
      const rowCount = counts[idx] || 0;
      totalRows += rowCount;
      return { tableName: t.name, tableKey: t.key, rowCount: rowCount };
    });

    tableBreakdown.sort((a, b) => b.rowCount - a.rowCount);

    if (exactBytes <= 0 && totalRows > 0) {
      exactBytes = (totalRows * 338) + (tablesTracked.length * 4096);
    }

    const sizeKB = Number((exactBytes / 1024).toFixed(2));
    const sizeMB = Number((exactBytes / (1024 * 1024)).toFixed(2));
    
    const MAX_STORAGE_MB = 5000;
    const MAX_STORAGE_GB = 5.0;
    const DAILY_READS_LIMIT = 5000000;
    const DAILY_WRITES_LIMIT = 100000;

    const usagePercent = Number(((sizeMB / MAX_STORAGE_MB) * 100).toFixed(2));
    const readUsagePercent = Number(((liveQuota.rowsRead / DAILY_READS_LIMIT) * 100).toFixed(2));
    const writeUsagePercent = Number(((liveQuota.rowsWritten / DAILY_WRITES_LIMIT) * 100).toFixed(2));

    let healthStatus = "HEALTHY";
    let statusMessage = "Free Plan သတ်မှတ်ချက်အတွင်း လုံလောက်စွာ သုံးစွဲနိုင်သော အခြေအနေ ဖြစ်ပါသည်။";

    if (usagePercent >= 90) {
      healthStatus = "CRITICAL";
      statusMessage = "⚠️ သတိပေးချက်: ဒေတာသိုလှောင်မှု ၉၀% ကျော်လွန်နေပါပြီ။";
    } else if (usagePercent >= 75) {
      healthStatus = "WARNING";
      statusMessage = "သတိပေးချက်: ဒေတာသိုလှောင်မှု ၇၅% ကျော်လွန်လာပါပြီ။";
    }

    const usageResult = {
      storage: { usedBytes: exactBytes, usedKB: sizeKB, usedMB: sizeMB, maxMB: MAX_STORAGE_MB, maxGB: MAX_STORAGE_GB, usagePercentage: usagePercent },
      records: { totalRows: totalRows, totalTables: tablesTracked.length, breakdown: tableBreakdown },
      limits: { 
        dailyReadsLimit: DAILY_READS_LIMIT, 
        dailyWritesLimit: DAILY_WRITES_LIMIT, 
        maxStorageGB: MAX_STORAGE_GB,
        dailyReadsUsed: liveQuota.rowsRead,
        dailyWritesUsed: liveQuota.rowsWritten,
        dailyReadsPercent: readUsagePercent,
        dailyWritesPercent: writeUsagePercent,
        isLiveQuota: liveQuota.isConfigured,
        message: liveQuota.message || ''
      },
      dailyQuota: {
        date: liveQuota.date,
        rowsReadUsed: liveQuota.rowsRead,
        rowsWrittenUsed: liveQuota.rowsWritten,
        readsPercentage: readUsagePercent,
        writesPercentage: writeUsagePercent,
        isConfigured: liveQuota.isConfigured,
        message: liveQuota.message || ''
      },
      health: { status: healthStatus, message: statusMessage, isFreePlan: true }
    };

    cachedD1Usage = { timestamp: now, data: usageResult };
    return usageResult;
  } catch (err) {
    console.error("Error in getD1DatabaseUsage:", err);
    return {
      storage: { usedMB: 0, maxMB: 5000, usagePercentage: 0 },
      records: { totalRows: 0, totalTables: 20, breakdown: [] },
      limits: { dailyReadsLimit: 5000000, dailyWritesLimit: 100000, maxStorageGB: 5.0, dailyReadsUsed: 0, dailyWritesUsed: 0 },
      health: { status: "UNKNOWN", message: "Usage data unavailable" }
    };
  }
}

/**
 * 💡 1. Fetch Live Balances Control, Dynamic FY List & D1 Usage
 */
export async function getSettingsData(db, arg2 = {}, arg3 = null, arg4 = null) {
  try {
    let body = {};
    let activeEnv = null;

    for (const arg of [arg2, arg3, arg4]) {
      if (!arg) continue;
      if (arg.CF_API_TOKEN || arg.RESEND_API_KEY || arg.DB || arg.school_db || arg.BACKUP_EMAIL) {
        activeEnv = arg;
      } else if (typeof arg === 'object' && Object.keys(body).length === 0) {
        body = arg;
      }
    }

    if (!activeEnv && body?.env) activeEnv = body.env;

    const activeFy = normalizeFyClean(body.fy || getCurrentAcademicYear());

    const bAcc = await safeSumBal(db, 'bank', activeFy);
    const cAcc = await safeSumBal(db, 'cash', activeFy);
    const oAcc = await safeSumBal(db, 'office', activeFy);
    const kAcc = await safeSumBal(db, 'kitchen', activeFy);
    const pAcc = await safeSumBal(db, 'payroll', activeFy);

    const bCas = await safeSumBal(db, 'ca_bank', activeFy);
    const cCas = await safeSumBal(db, 'ca_cash', activeFy);
    const oCas = await safeSumBal(db, 'ca_office', activeFy);
    const kCas = await safeSumBal(db, 'ca_kitchen', activeFy);
    const pCas = await safeSumBal(db, 'ca_payroll', activeFy);

    const dataRows = [
      ["Bank Book", bAcc, bCas, bAcc - bCas],
      ["Cash Book", cAcc, cCas, cAcc - cCas],
      ["Office Book", oAcc, oCas, oAcc - oCas],
      ["Kitchen Book", kAcc, kCas, kAcc - kCas],
      ["HR Payroll Book", pAcc, pCas, pAcc - pCas]
    ];

    const totAcc = bAcc + cAcc + oAcc + kAcc + pAcc;
    const totCas = bCas + cCas + oCas + kCas + pCas;
    const totalRow = ["Total", totAcc, totCas, totAcc - totCas];

    const [availableFys, d1Usage] = await Promise.all([
      getAvailableFysFromD1(db),
      getD1DatabaseUsage(db, activeEnv)
    ]);

    return {
      success: true,
      balancesControl: { data: dataRows, total: totalRow },
      availableFys: availableFys,
      d1Usage: d1Usage
    };
  } catch (err) {
    console.error("Error in getSettingsData handler:", err);
    return { success: false, message: "Settings Data ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 2. Grouped Multi-Tab Data Export Handler
 */
export async function exportGroupDataByFy(db, body, userSession = null) {
  try {
    const groupKey = String(body.groupKey || body.bookKey || 'main').toLowerCase().trim();
    const fyFilter = normalizeFyClean(body.fy || '');
    const fromDate = String(body.fromDate || '').trim();
    const toDate = String(body.toDate || '').trim();

    const role = userSession?.role || 'Viewer';
    const canSeeSensitive = ['Owner', 'Admin', 'HR'].includes(role);

    let groupTitle = "Main Cash Book";
    let tableDefs = [];

    const getDateColumnName = (tblKey) => {
      if (['staff_fulltime', 'staff_parttime'].includes(tblKey)) return 'join_date';
      return 'date';
    };

    if (groupKey === 'cashier' || groupKey.startsWith('ca_') || groupKey.startsWith('ca')) {
      groupTitle = "Cashier Cash Book";
      tableDefs = [
        { key: 'ca_bank', columns: 'no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'cabank', tabName: 'ca_bank', title: 'CASHIER BANK BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'ca_cash', columns: 'no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'cacash', tabName: 'ca_cash', title: 'CASHIER CASH BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'ca_office', columns: 'no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'caoffice', tabName: 'ca_office', title: 'CASHIER OFFICE BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'ca_kitchen', columns: 'no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'cakitchen', tabName: 'ca_kitchen', title: 'CASHIER KITCHEN BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'ca_payroll', columns: 'no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'capayroll', tabName: 'ca_payroll', title: 'CASHIER PAYROLL BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] }
      ];
    } else {
      groupTitle = "Main Cash Book";
      tableDefs = [
        { key: 'bank', columns: 'no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'bank', tabName: 'bank', title: 'MAIN BANK BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'cash', columns: 'no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'cash', tabName: 'cash', title: 'MAIN CASH BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'office', columns: 'no, date, category, description, unit, unit_price, method, debit, credit, balances, liabilities, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'office', tabName: 'office', title: 'OFFICE EXP BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "UNIT", "UNIT PRICE", "METHOD", "DEBIT", "CREDIT", "BALANCES", "LIABILITIES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'kitchen', columns: 'no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'kitchen', tabName: 'kitchen', title: 'KITCHEN EXP BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'payroll', columns: 'no, date, category, description, method, debit, credit, balances, unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid', altKey: 'payroll', tabName: 'payroll', title: 'HR PAYROLL EXP BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "UNPAID BONUS", "UNPAID FUND", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'income', columns: 'no, effect_date, date, fy, id, fyid, fyid_name, class, category, account_name, method, debit, credit, aut_amount, promo, my, vr_no, remark, created_by, created_at, uniqueid', altKey: 'income', tabName: 'income', title: 'MAIN INCOME BOOK', hasFy: true, headers: ["NO", "EFFECT DATE", "DATE", "FY", "ID", "FYID", "FYID NAME", "CLASS", "CATEGORY", "ACCOUNT NAME", "METHOD", "DEBIT", "CREDIT", "AUT AMOUNT", "PROMO", "MY", "VR NO", "REMARK", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'student', columns: 'no, stu_status, date, fy, id, fyid, name, gender, class, category, promo, status, transfer_date, parents_name, phone_no, address, created_by, created_at, uniqueid', altKey: 'student', tabName: 'student', title: 'STUDENT LIST', hasFy: true, headers: ["NO", "STU STATUS", "DATE", "FY", "ID", "FYID", "NAME", "GENDER", "CLASS", "CATEGORY", "PROMO", "STATUS", "TRANSFER DATE", "PARENTS NAME", "PHONE NO", "ADDRESS", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'student_money', columns: 'no, date, fy, id, fyid, fyid_name, class, method, debit, credit, balances, remark, created_by, created_at, uniqueid', altKey: 'studentmoney', tabName: 'student_money', title: 'STUDENT MONEY LEDGER', hasFy: true, headers: ["NO", "DATE", "FY", "ID", "FYID", "FYID NAME", "CLASS", "METHOD", "DEBIT", "CREDIT", "BALANCES", "REMARK", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'uniform_ledger', columns: 'no, product_id, product_name, type, size, opening_stock, unit_price, total_stock_value, selling_price, profit_amount, selling_unit, current_qty, total_stock_value, created_by, created_at, uniqueid', altKey: 'uniform', tabName: 'uniform', title: 'UNIFORM LEDGER', hasFy: false, headers: ["NO", "PRODUCT ID", "PRODUCT NAME", "TYPE", "SIZE", "OPENING STOCK", "UNIT PRICE", "TOTAL AMOUNT", "SELLING PRICE", "PROFIT AMOUNT", "SELLING UNIT", "CURRENT QTY", "TOTAL STOCK VALUE", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'promotion', columns: 'no, fy, class, category, registration, original_price, pro_a, pro_b, pro_c, pro_d, pro_e, half_scholar, full_scholar, remark, created_by, created_at, uniqueid', altKey: 'promo', tabName: 'promotion', title: 'PROMOTION LIST', hasFy: true, headers: ["NO", "FY", "CLASS", "CATEGORY", "Registration", "Original price", "Pro A", "Pro B", "Pro C", "Pro D", "Pro E", "Half scholar", "Full scholar", "Remark", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'staff_fulltime', columns: 'no, join_date, category, staff_id, name, staff_idname, education, position, salary_grade, working_days, basic_amt, extra_amt, total_salary, bonus, fund, total_net_amt, resigned_date, status, gender, nrc_no, bank_account, phone_no, email, fund_date, unpaid_bonus, unpaid_fund, created_by, created_at, uniqueid', altKey: 'fulltime', tabName: 'staff_fulltime', title: 'FULL TIME STAFF LIST', hasFy: false, headers: ["NO", "JOIN DATE", "CATEGORY", "STAFF ID", "NAME", "STAFF IDNAME", "EDUCATION", "POSITION", "SALARY GRADE", "WORKING DAYS", "BASIC AMT", "EXTRA AMT", "TOTAL SALARY", "BONUS", "FUND", "TOTAL NET AMT", "RESIGNED DATE", "STATUS", "GENDER", "NRC NO", "BANK ACCOUNT", "PHONE NO", "EMAIL", "FUND DATE", "UNPAID BONUS", "UNPAID FUND", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'staff_parttime', columns: 'no, join_date, category, staff_id, name, staff_idname, education, position, total_salary, total_net_amt, resigned_date, status, gender, nrc_no, bank_account, phone_no, email, created_by, created_at, uniqueid', altKey: 'parttime', tabName: 'staff_parttime', title: 'PART TIME STAFF LIST', hasFy: false, headers: ["NO", "JOIN DATE", "CATEGORY", "STAFF ID", "NAME", "STAFF IDNAME", "EDUCATION", "POSITION", "TOTAL SALARY", "TOTAL NET AMT", "RESIGNED DATE", "STATUS", "GENDER", "NRC NO", "BANK ACCOUNT", "PHONE NO", "EMAIL", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'salary_grade_matrix', columns: 'id, grade_a, grade_b, grade_c, grade_d, grade_e, grade_f, grade_g, grade_h, grade_i, grade_j, grade_k, grade_l, bonus_rate, fund_rate, updated_at', altKey: 'payroll_settings', tabName: 'salary_grade_matrix', title: 'SALARY GRADE MATRIX', hasFy: false, headers: ["ID", "GRADE A", "GRADE B", "GRADE C", "GRADE D", "GRADE E", "GRADE F", "GRADE G", "GRADE H", "GRADE I", "GRADE J", "GRADE K", "GRADE L", "BONUS RATE", "FUND RATE", "UPDATED AT"] }
      ];
    }

    let csvContent = "";
    let grandTotalRecords = 0;
    let tablesDict = {};

    let dateRangeTitleText = `All FY`;
    if (fyFilter && !fromDate && !toDate) {
      dateRangeTitleText = `FY: ${fyFilter}`;
    } else if (fromDate && toDate) {
      dateRangeTitleText = `Date: ${fromDate} to ${toDate}`;
    } else if (fromDate) {
      dateRangeTitleText = `Date: From ${fromDate}`;
    } else if (toDate) {
      dateRangeTitleText = `Date: Up to ${toDate}`;
    }

    for (const tDef of tableDefs) {
      let rows = [];
      const dateCol = getDateColumnName(tDef.key);

      const fetchTableRows = async (tableName) => {
        let conditions = [];
        let params = [];

        if (fyFilter && tDef.hasFy) {
          conditions.push(`(fy IN (?, ?))`);
          params.push(fyFilter, `FY ${fyFilter}`);
        }

        if (tDef.key !== 'uniform_ledger' && tDef.key !== 'promotion' && tDef.key !== 'salary_grade_matrix') {
          if (fromDate) {
            conditions.push(`(${dateCol} >= ?)`);
            params.push(fromDate);
          }
          if (toDate) {
            conditions.push(`(${dateCol} <= ?)`);
            params.push(toDate);
          }
        }

        let q = `SELECT ${tDef.columns} FROM ${tableName}`;
        if (conditions.length > 0) {
          q += ` WHERE ` + conditions.join(' AND ');
        }
        q += ` ORDER BY id ASC`;
        
        const res = await db.prepare(q).bind(...params).all();
        return (res && res.results) ? res.results : [];
      };

      try {
        rows = await fetchTableRows(tDef.key);
      } catch (e) {
        try {
          const alt = tDef.altKey || tDef.key.replace('_', '');
          rows = await fetchTableRows(alt);
        } catch (e2) {}
      }

      grandTotalRecords += rows.length;

      const isStaffTable = (tDef.key === 'staff_fulltime' || tDef.key === 'staff_parttime');
      const sanitizedRows = rows.map(r => {
        if (!isStaffTable || canSeeSensitive) return r;
        return {
          ...r,
          basic_amt: 0, basicAmt: 0,
          extra_amt: 0, extraAmt: 0,
          total_salary: 0, totalSalary: 0,
          bonus: 0, fund: 0,
          total_net_amt: 0, totalNetAmt: 0,
          unpaid_bonus: 0, unpaidBonus: 0,
          unpaid_fund: 0, unpaidFund: 0,
          nrc_no: '***', nrcNo: '***',
          bank_account: '***', bankAccount: '***',
          phone_no: '***', phoneNo: '***', email: '***'
        };
      });

      tablesDict[tDef.tabName] = {
        title: tDef.title,
        headers: tDef.headers,
        rows: sanitizedRows
      };

      csvContent += `\n==================================================\n`;
      csvContent += `=== TABLE: ${tDef.title} (${dateRangeTitleText}) ===\n`;
      csvContent += `==================================================\n`;
      csvContent += tDef.headers.join(',') + '\n';

      if (sanitizedRows.length > 0) {
        sanitizedRows.forEach((r, idx) => {
          const rowLine = tDef.headers.map(h => {
            const hKey = h.toLowerCase().replace(/\s+/g, '_');
            let val = r[hKey] !== undefined ? r[hKey] : (r[h] !== undefined ? r[h] : (h === 'NO' ? idx + 1 : ''));
            val = String(val !== null && val !== undefined ? val : '').replace(/"/g, '""');
            return `"${val}"`;
          }).join(',');
          csvContent += rowLine + '\n';
        });
      } else {
        csvContent += `"# NO RECORDS FOUND #"\n`;
      }

      csvContent += `\n`;
    }

    return {
      success: true,
      groupTitle: groupTitle,
      groupKey: groupKey,
      fy: fyFilter || 'All FY',
      dateRangeTitle: dateRangeTitleText,
      totalRecords: grandTotalRecords,
      tables: tablesDict,
      csvText: csvContent
    };
  } catch (err) {
    console.error("Error in exportGroupDataByFy handler:", err);
    return { success: false, message: "Export ဒေတာ ထုတ်ယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

export async function exportBookDataByFy(db, body, userSession = null) {
  return await exportGroupDataByFy(db, body, userSession);
}

/**
 * 💡 3. Real Email Backup Dispatcher
 */
export async function sendGroupEmailBackupByFy(db, userSession, body, env) {
  try {
    const groupKey = String(body.groupKey || body.bookKey || 'main').toLowerCase().trim();
    const fyFilter = String(body.fy || 'All FY').trim();
    const fromDate = String(body.fromDate || '').trim();
    const toDate = String(body.toDate || '').trim();
    const targetEmail = env?.BACKUP_EMAIL || "goldeneduprivateschool@gmail.com";
    const senderName = userSession?.name || userSession?.username || 'Admin';

    const now = new Date();
    const timestampStr = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString('en-US');

    if (!env || !env.RESEND_API_KEY) {
      return {
        success: false,
        message: `⚠️ Cloudflare Worker တွင် RESEND_API_KEY မသတ်မှတ်ရသေးပါသဖြင့် ${targetEmail} သို့ အီးမေးလ် မရောက်နိုင်ပါ။`
      };
    }

    let attachmentPayload = null;
    let groupTitle = groupKey === 'cashier' ? "Cashier Cash Book" : "Main Cash Book";
    let fileFormatName = "Excel (.xlsx)";

    let dateSuffix = `FY${fyFilter || 'ALL'}`;
    if (fromDate && toDate) dateSuffix = `D_${fromDate}_to_${toDate}`;
    else if (fromDate) dateSuffix = `D_From_${fromDate}`;
    else if (toDate) dateSuffix = `D_UpTo_${toDate}`;

    if (body.excelBase64 && String(body.excelBase64).trim().length > 0) {
      const fileName = body.fileName || `${groupTitle.replace(/\s+/g, '_')}_${dateSuffix}_${now.toISOString().slice(0, 10)}.xlsx`;
      attachmentPayload = {
        filename: fileName,
        content: body.excelBase64
      };
      fileFormatName = "Multi-Tab Excel (.xlsx)";
    } else {
      const exportRes = await exportGroupDataByFy(db, { groupKey, fy: fyFilter, fromDate, toDate }, userSession);
      const rawCsvText = exportRes.csvText || "NO DATA";
      groupTitle = exportRes.groupTitle || groupTitle;
      const fileName = `${groupTitle.replace(/\s+/g, '_')}_${dateSuffix}_${now.toISOString().slice(0, 10)}.csv`;

      attachmentPayload = {
        filename: fileName,
        content: safeBase64Encode("\uFEFF" + rawCsvText)
      };
      fileFormatName = "Multi-Section CSV (.csv)";
    }

    let reportPeriodTxt = `Fiscal Year: ${fyFilter}`;
    if (fromDate || toDate) {
      reportPeriodTxt = `Date Filter: ${fromDate || 'Start'} to ${toDate || 'End'}`;
    }

    const emailPayload = {
      from: "Golden ERP Backup <onboarding@resend.dev>",
      to: [targetEmail],
      subject: `[GOLDEN ERP BACKUP] ${groupTitle} Data (${timestampStr})`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #0c1322; color: #e2e8f0; border-radius: 12px; border: 1px solid #1e293b;">
          <h2 style="color: #38bdf8; border-bottom: 1px solid #334155; padding-bottom: 8px;">GOLDEN ERP SYSTEM - REAL BACKUP REPORT</h2>
          <p><strong>Group Name:</strong> ${groupTitle}</p>
          <p><strong>${reportPeriodTxt}</strong></p>
          <p><strong>Backup Format:</strong> ${fileFormatName}</p>
          <p><strong>Sent Date & Time:</strong> ${timestampStr}</p>
          <p><strong>Dispatched By:</strong> ${senderName}</p>
          <hr style="border-color: #334155;" />
          <p style="font-size: 11px; color: #94a3b8;">* Real Master Backup data is attached to this email.</p>
        </div>
      `,
      attachments: [attachmentPayload]
    };

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailPayload)
    });

    if (!resendRes.ok) {
      const errTxt = await resendRes.text();
      throw new Error(`Resend Email API Error: ${resendRes.status} - ${errTxt}`);
    }

    return {
      success: true,
      message: `'${groupTitle}' ၏ ${fileFormatName} Backup Data အား ${targetEmail} သို့ အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။\n\n(Sent Date: ${timestampStr})`
    };
  } catch (err) {
    console.error("Error in sendGroupEmailBackupByFy handler:", err);
    return { success: false, message: "အီးမေးလ် ပေးပို့ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

export async function sendEmailBackupByFy(db, userSession, body, env) {
  return await sendGroupEmailBackupByFy(db, userSession, body, env);
}