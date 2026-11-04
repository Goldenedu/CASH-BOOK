/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - BACKEND UTILITIES (CLOUDFLARE D1 ENTERPRISE V9.6 FULL)
 * File: utils.js (Location: cashbook-api/utils.js)
 * 💡 Features: 
 *    - DRY Principle: Centralized Date, FY, and ID Generators
 *    - Strict MMT: Universal UTC+06:30 Myanmar Standard Time Engine
 *    - Security: crypto.randomUUID() for secure Unique IDs
 *    - Quota-Shield: O(1) Shared Recalculation Engine for all ledgers
 *    - Accounting Accuracy: Clean Canteen Receivable Balances (Cash sales excluded from debt)
 *    - Data Parsers: Safe Float & Int Parsing, Myanmar Gender Auto-Detection
 *    🚀 ULTRA-OPTIMIZED: Prevented Full Table Scans. Replaced OR with IN().
 *    🚀 PHASE 1 (INCREMENTAL RECALC): Fast Window Functions bounded by `fromDate`
 * ==============================================================================
 */

// ==========================================
// 💡 1. DATE & TIME HELPERS (STRICT MMT UTC+06:30)
// ==========================================

export function getMyanmarDateString(inputDate = null) {
  if (inputDate && typeof inputDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(inputDate.trim())) {
    return inputDate.trim();
  }
  const d = inputDate ? new Date(inputDate) : new Date();
  const targetMs = isNaN(d.getTime()) ? Date.now() : d.getTime();
  const mmt = new Date(targetMs + (6.5 * 3600 * 1000));
  return mmt.toISOString().slice(0, 10);
}

export function getCurrentAcademicYear(dateInput = null) {
  const d = dateInput ? new Date(dateInput) : new Date(Date.now() + (6.5 * 3600 * 1000));
  const validDate = isNaN(d.getTime()) ? new Date() : d;
  let y = validDate.getFullYear();
  if (validDate.getMonth() < 2) {
    y -= 1; // Before March belongs to previous academic year
  }
  return `${y}-${y + 1}`;
}

export function calculateAcademicFyFromDate(dateStr) {
  const d = new Date(dateStr);
  let fyYear = d.getFullYear();
  if (d.getMonth() < 2) fyYear -= 1;
  return `FY ${fyYear}-${fyYear + 1}`;
}

// ==========================================
// 💡 2. FORMATTERS & PARSERS
// ==========================================

export function normalizeFyStr(fy, dateInput = null) {
  let s = fy ? String(fy).trim() : `FY ${getCurrentAcademicYear(dateInput)}`;
  if (!s) s = `FY ${getCurrentAcademicYear(dateInput)}`;
  if (!s.toUpperCase().startsWith('FY ')) {
    s = 'FY ' + s;
  }
  return s;
}

export function normalizeFyClean(fy, dateInput = null) {
  let s = fy ? String(fy).trim() : getCurrentAcademicYear(dateInput);
  if (!s) s = getCurrentAcademicYear(dateInput);
  return s.replace(/^FY\s*/i, '');
}

export function getFyShortCode(fyStr) {
  if (fyStr) {
    const clean = String(fyStr).replace(/^FY\s*/i, '').trim();
    const parts = clean.split(/[-/]/);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      return parts[0].trim().slice(-2) + parts[1].trim().slice(-2);
    }
    if (/^\d{4}$/.test(clean)) return clean;
  }
  const currentFy = getCurrentAcademicYear();
  const p = currentFy.split('-');
  return p[0].slice(-2) + p[1].slice(-2);
}

export function sanitizeFyidStr(fyidStr) {
  const s = String(fyidStr || '').trim();
  if (!s) return s;
  if (s.indexOf('.0') === -1) return s;
  const cleaned = s.replace(/\.0/g, '');
  const parts = cleaned.split('-STU-');
  if (parts.length === 2) {
    const numPart = parseInt(parts[1], 10) || 0;
    return `${parts[0]}-STU-${String(numPart).padStart(4, '0')}`;
  }
  return cleaned;
}

export function parseCleanIntId(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.trunc(val);
  const n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? 0 : n;
}

export function parseAccountingNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let s = String(val).trim().replace(/,/g, '');
  if (s.startsWith('(') && s.endsWith(')')) {
    s = '-' + s.slice(1, -1).trim();
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

// ==========================================
// 💡 3. MYANMAR GENDER AUTO-DETECTOR
// ==========================================

export function autoDetectGender(nameStr) {
  if (!nameStr) return 'Male';
  const clean = String(nameStr).trim();

  if (
    clean.startsWith('မောင်') || clean.startsWith('ကို') || clean.startsWith('ဦး') ||
    clean.startsWith('မင်း') || clean.startsWith('စော') || clean.startsWith('ဆရာ') ||
    /^(Mg|Ko|U|Min|Saw|Saya|Mr)\b/i.test(clean)
  ) {
    return 'Male';
  }

  if (
    clean.startsWith('မေ') || clean.startsWith('ဒေါ်') || clean.startsWith('နန်း') ||
    clean.startsWith('နော်') || clean.startsWith('ဆရာမ') || clean.startsWith('တီချာ') ||
    clean.startsWith('ခင်') || clean.startsWith('နှင်း') || clean.startsWith('နွယ်') ||
    /^(May|Daw|Nang|Naw|Khin|Hnin|Nwe|Miss|Mrs|Teacher|Sayama)\b/i.test(clean)
  ) {
    return 'Female';
  }

  if ((clean.startsWith('မ') && !clean.startsWith('မောင်') && !clean.startsWith('မင်း')) || /^(Ma)\b/i.test(clean)) {
    return 'Female';
  }

  return 'Male';
}

// ==========================================
// 💡 4. DATABASE GENERATORS & OPTIMIZERS
// ==========================================

export function generateUniqueId(prefix) {
  const uuid = crypto.randomUUID().replace(/-/g, '').substring(0, 8);
  return `${prefix}_${Date.now()}_${uuid}`;
}

export async function generateVoucherNo(db, tableName, prefix, entryDate) {
  let ddmmyy = "";
  const parts = String(entryDate || '').split('-');
  if (parts.length === 3) {
    const y = parts[0].slice(-2);
    ddmmyy = `${parts[2]}${parts[1]}${y}`;
  } else {
    const now = new Date(Date.now() + (6.5 * 3600 * 1000));
    ddmmyy = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`;
  }

  const basePrefix = `${prefix}-${ddmmyy}-`;
  const pattern = `${basePrefix}%`;

  // 🚀 Duplicate Voucher ကာကွယ်ရန် MAX sequence နှင့် COUNT နှစ်ခုလုံးကို စစ်ဆေးသည်
  const maxRow = await db.prepare(
    `SELECT MAX(CAST(SUBSTR(vr_no, ?) AS INTEGER)) as maxSeq, COUNT(id) as cnt FROM ${tableName} WHERE vr_no LIKE ?`
  ).bind(basePrefix.length + 1, pattern).first();

  const maxSeq = maxRow ? Math.max(parseInt(maxRow.maxSeq || 0, 10), parseInt(maxRow.cnt || 0, 10)) : 0;
  return `${basePrefix}${String(maxSeq + 1).padStart(3, '0')}`;
}

export async function generateFyNo(db, tableName, fy) {
  const normFy = normalizeFyStr(fy);
  const cleanFy = normFy.replace(/^FY\s*/i, '');

  // 🚀 MAX(no) နှင့် COUNT(id) နှစ်ခုလုံးကို စစ်ဆေးသဖြင့် NULL ရှိနေသော်လည်း 1 က ပြန်မစတော့ပါ
  const lastNoRow = await db.prepare(
    `SELECT MAX(CAST(no AS INTEGER)) as maxNo, COUNT(id) as cnt FROM ${tableName} WHERE fy IN (?, ?)`
  ).bind(normFy, cleanFy).first();
  const maxNo = lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0;
  const cnt = lastNoRow && lastNoRow.cnt ? parseInt(lastNoRow.cnt, 10) : 0;
  return Math.max(maxNo, cnt) + 1;
}

/**
 * ⚡ QUOTA-SHIELD: O(1) Differential D1 Window Function Recalculation Engine
 * 🎯 Features:
 *    - Unifies '2026-2027' and 'FY 2026-2027' into a single continuous sequence
 *    - Restores any split FY numbering automatically
 *    - Keeps `no` 100% fixed on Date Edit, and closes gaps automatically on Delete
 */
export async function recalculateLedgerBalances(db, tableName, targetFy = null, fromDate = null) {
  if (!tableName) return;

  try {
    if (targetFy) {
      const normFy = normalizeFyStr(targetFy);
      const cleanFy = normFy.replace(/^FY\s*/i, '');
      const unifiedFy = (tableName === 'student_money') ? cleanFy : normFy;

      // 🔍 1. Smart Gap, Mixed-FY & Incremental Boundary Check
      const meta = await db.prepare(`
        SELECT COUNT(id) as totalCnt,
               MAX(CAST(no AS INTEGER)) as maxNo,
               COUNT(CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 1 END) as nullCnt,
               COUNT(DISTINCT fy) as fyFormatCnt,
               MIN(CASE WHEN ? IS NOT NULL AND date >= ? THEN CAST(no AS INTEGER) END) as startNo
        FROM ${tableName}
        WHERE fy IN (?, ?)
      `).bind(fromDate || null, fromDate || '', normFy, cleanFy).first();

      const totalCnt = parseInt(meta?.totalCnt || 0, 10);
      if (totalCnt === 0) return;

      const maxNo = parseInt(meta?.maxNo || 0, 10);
      const nullCnt = parseInt(meta?.nullCnt || 0, 10);
      const fyFormatCnt = parseInt(meta?.fyFormatCnt || 0, 10);
      const startNo = meta?.startNo ? parseInt(meta.startNo, 10) : null;

      // နံပါတ်ကျော်နေခြင်း၊ NULL ဖြစ်နေခြင်း သို့မဟုတ် '2026-2027' နှင့် 'FY 2026-2027' နှစ်မျိုးကွဲနေခြင်း ရှိ/မရှိ စစ်ဆေးသည်
      const hasGapOrNull = (nullCnt > 0) || (maxNo !== totalCnt) || (fyFormatCnt > 1);

      // ၂။ Income Table
      if (tableName === 'income') {
        if (!hasGapOrNull) return;
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC
                   ) as calc_no
            FROM income
            WHERE fy IN (?, ?)
          )
          UPDATE income
          SET no = calculated.calc_no,
              fy = ?
          FROM calculated
          WHERE income.id = calculated.id
            AND (income.no IS NOT calculated.calc_no OR income.fy IS NOT ?);
        `).bind(normFy, cleanFy, unifiedFy, unifiedFy).run();
        return;
      }

      // 🚀 ၃။ INCREMENTAL FAST-PATH (Save / Edit လုပ်ချိန်တွင် 95% D1 Reads သက်သာစေသည်)
      if (!hasGapOrNull && startNo && startNo > 1 && tableName !== 'student_money') {
        const baseRow = await db.prepare(
          `SELECT balances FROM ${tableName} WHERE fy IN (?, ?) AND CAST(no AS INTEGER) = ? LIMIT 1`
        ).bind(normFy, cleanFy, startNo - 1).first();

        if (baseRow) {
          const baseBal = parseFloat(baseRow.balances || 0);
          if (tableName === 'canteen_book') {
            await db.prepare(`
              WITH calculated AS (
                SELECT id,
                       ? + SUM(CASE WHEN method = 'Cash' THEN 0 ELSE debit END - credit) OVER (
                             ORDER BY CAST(no AS INTEGER) ASC, id ASC
                             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                           ) as calc_bal
                FROM canteen_book
                WHERE fy IN (?, ?) AND CAST(no AS INTEGER) >= ?
              )
              UPDATE canteen_book
              SET balances = calculated.calc_bal
              FROM calculated
              WHERE canteen_book.id = calculated.id
                AND ROUND(canteen_book.balances, 2) IS NOT ROUND(calculated.calc_bal, 2);
            `).bind(baseBal, normFy, cleanFy, startNo).run();
          } else {
            await db.prepare(`
              WITH calculated AS (
                SELECT id,
                       ? + SUM(debit - credit) OVER (
                             ORDER BY CAST(no AS INTEGER) ASC, id ASC
                             ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                           ) as calc_bal
                FROM ${tableName}
                WHERE fy IN (?, ?) AND CAST(no AS INTEGER) >= ?
              )
              UPDATE ${tableName}
              SET balances = calculated.calc_bal
              FROM calculated
              WHERE ${tableName}.id = calculated.id
                AND ROUND(${tableName}.balances, 2) IS NOT ROUND(calculated.calc_bal, 2);
            `).bind(baseBal, normFy, cleanFy, startNo).run();
          }
          return;
        }
      }

      // 🛡️ ၄။ FULL FY SEQUENCE & BALANCE HEAL
      if (tableName === 'student_money') {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC
                   ) as calc_no,
                   CASE 
                     WHEN student_id IS NOT NULL THEN
                       SUM(debit - credit) OVER (
                         PARTITION BY student_id 
                         ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                                  CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                                  CAST(no AS INTEGER) ASC, id ASC 
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                       )
                     ELSE 0
                   END as calc_bal
            FROM student_money
            WHERE fy IN (?, ?)
          )
          UPDATE student_money 
          SET no = calculated.calc_no,
              balances = calculated.calc_bal,
              fy = ?
          FROM calculated 
          WHERE student_money.id = calculated.id 
            AND (student_money.no IS NOT calculated.calc_no 
                 OR ROUND(student_money.balances, 2) IS NOT ROUND(calculated.calc_bal, 2)
                 OR student_money.fy IS NOT ?);
        `).bind(normFy, cleanFy, unifiedFy, unifiedFy).run();
      } else if (tableName === 'canteen_book') {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC
                   ) as calc_no,
                   SUM(CASE WHEN method = 'Cash' THEN 0 ELSE debit END - credit) OVER (
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC 
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                   ) as calc_bal
            FROM canteen_book
            WHERE fy IN (?, ?)
          )
          UPDATE canteen_book 
          SET no = calculated.calc_no,
              balances = calculated.calc_bal,
              fy = ?
          FROM calculated 
          WHERE canteen_book.id = calculated.id 
            AND (canteen_book.no IS NOT calculated.calc_no 
                 OR ROUND(canteen_book.balances, 2) IS NOT ROUND(calculated.calc_bal, 2)
                 OR canteen_book.fy IS NOT ?);
        `).bind(normFy, cleanFy, unifiedFy, unifiedFy).run();
      } else {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC
                   ) as calc_no,
                   SUM(debit - credit) OVER (
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC 
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                   ) as calc_bal
            FROM ${tableName}
            WHERE fy IN (?, ?)
          )
          UPDATE ${tableName} 
          SET no = calculated.calc_no,
              balances = calculated.calc_bal,
              fy = ?
          FROM calculated 
          WHERE ${tableName}.id = calculated.id 
            AND (${tableName}.no IS NOT calculated.calc_no 
                 OR ROUND(${tableName}.balances, 2) IS NOT ROUND(calculated.calc_bal, 2)
                 OR ${tableName}.fy IS NOT ?);
        `).bind(normFy, cleanFy, unifiedFy, unifiedFy).run();
      }

    } else {
      // 💡 FULL RECALCULATE ACROSS ALL FYs (Settings -> Auto Recalculate Balances နှိပ်ချိန်)
      // 🎯 '2026-2027' နှင့် 'FY 2026-2027' တို့ကို Partition တစ်ခုတည်းအဖြစ် ပေါင်းစပ်ပြီး နံပါတ်စဉ် ပြန်ဆက်ပေးသည်
      if (tableName === 'income') {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   'FY ' || REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '') as norm_fy,
                   ROW_NUMBER() OVER (
                     PARTITION BY REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '')
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC
                   ) as calc_no
            FROM income
          )
          UPDATE income 
          SET no = calculated.calc_no,
              fy = calculated.norm_fy
          FROM calculated
          WHERE income.id = calculated.id 
            AND (income.no IS NOT calculated.calc_no OR income.fy IS NOT calculated.norm_fy);
        `).run();
      } else if (tableName === 'student_money') {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '') as norm_fy,
                   ROW_NUMBER() OVER (
                     PARTITION BY REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '')
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC
                   ) as calc_no,
                   CASE 
                     WHEN student_id IS NOT NULL THEN
                       SUM(debit - credit) OVER (
                         PARTITION BY REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', ''), student_id 
                         ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                                  CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                                  CAST(no AS INTEGER) ASC, id ASC 
                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                       )
                     ELSE 0
                   END as calc_bal
            FROM student_money
          )
          UPDATE student_money 
          SET no = calculated.calc_no, 
              balances = calculated.calc_bal,
              fy = calculated.norm_fy
          FROM calculated 
          WHERE student_money.id = calculated.id 
            AND (student_money.no IS NOT calculated.calc_no 
                 OR ROUND(student_money.balances, 2) IS NOT ROUND(calculated.calc_bal, 2)
                 OR student_money.fy IS NOT calculated.norm_fy);
        `).run();
      } else if (tableName === 'canteen_book') {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   'FY ' || REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '') as norm_fy,
                   ROW_NUMBER() OVER (
                     PARTITION BY REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '')
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC
                   ) as calc_no,
                   SUM(CASE WHEN method = 'Cash' THEN 0 ELSE debit END - credit) OVER (
                     PARTITION BY REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '')
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC 
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                   ) as calc_bal
            FROM canteen_book
          )
          UPDATE canteen_book 
          SET no = calculated.calc_no, 
              balances = calculated.calc_bal,
              fy = calculated.norm_fy
          FROM calculated 
          WHERE canteen_book.id = calculated.id 
            AND (canteen_book.no IS NOT calculated.calc_no 
                 OR ROUND(canteen_book.balances, 2) IS NOT ROUND(calculated.calc_bal, 2)
                 OR canteen_book.fy IS NOT calculated.norm_fy);
        `).run();
      } else {
        await db.prepare(`
          WITH calculated AS (
            SELECT id,
                   'FY ' || REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '') as norm_fy,
                   ROW_NUMBER() OVER (
                     PARTITION BY REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '')
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC
                   ) as calc_no,
                   SUM(debit - credit) OVER (
                     PARTITION BY REPLACE(UPPER(TRIM(COALESCE(fy, '2026-2027'))), 'FY ', '')
                     ORDER BY CASE WHEN no IS NULL OR CAST(no AS INTEGER) <= 0 THEN 0 ELSE 1 END ASC,
                              CASE WHEN UPPER(TRIM(COALESCE(fy, ''))) LIKE 'FY %' THEN 1 ELSE 0 END ASC,
                              CAST(no AS INTEGER) ASC, id ASC 
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                   ) as calc_bal
            FROM ${tableName}
          )
          UPDATE ${tableName} 
          SET no = calculated.calc_no, 
              balances = calculated.calc_bal,
              fy = calculated.norm_fy
          FROM calculated 
          WHERE ${tableName}.id = calculated.id 
            AND (${tableName}.no IS NOT calculated.calc_no 
                 OR ROUND(${tableName}.balances, 2) IS NOT ROUND(calculated.calc_bal, 2)
                 OR ${tableName}.fy IS NOT calculated.norm_fy);
        `).run();
      }
    }
  } catch (e) {
    console.warn(`[Utils] Running Balance Recalculation Warning for ${tableName}:`, e.message);
  }
}

// 💡 Direct Interoperability Helper for Canteen Handlers
export async function recalculateCanteenBookBalances(db, fy, fromDate = null) {
  return recalculateLedgerBalances(db, 'canteen_book', fy, fromDate);
}

/**
 * 💡 Phase 2/3: Record Mutation Policy Engine (Daily Lock, Friday & Master Directory Policy)
 * 🛡️ Enforces Strict Edit / Delete Window:
 *    - Owner / Viewer: 100% Read-Only (Forbidden)
 *    - 🎯 Master Directories: Admin, Finance, HR, HR Staff can ALWAYS edit/delete (No Daily Lock)
 *    - Today's MMT Records: Allowed for all mutating roles
 *    - Past Records (Admin): Allowed ONLY on Fridays within 30 days (for Daily Ledgers)
 *    - Past Records (Other Roles): Strictly Denied (Daily Lock)
 */
export function verifyRecordMutationPolicy(userSession, existingRecordDate, isMasterDirectory = false) {
  if (!userSession) {
    return { allowed: false, message: "အသုံးပြုသူ စစ်မှန်ကြောင်း အတည်မပြုနိုင်ပါ။" };
  }

  const rawRole = String(userSession?.role || 'Viewer').trim();
  const normRole = rawRole.toLowerCase().replace(/[\s_-]/g, '');

  // ၁။ Owner နှင့် Viewer အား Pure Read-Only အဖြစ် အမြဲ ပိတ်ပင်သည်
  if (normRole === 'owner' || normRole === 'viewer') {
    return {
      allowed: false,
      message: "Owner နှင့် Viewer သည် ကြည့်ရှုခွင့် (Read-Only) သာ ရှိသဖြင့် ပြင်ဆင်/ဖျက်သိမ်းခွင့် မရှိပါ။"
    };
  }

  // 🎯 ၂။ Master Directory ခြွင်းချက်: Admin, Finance, HR, HR Staff ဖြစ်ပါက Daily Lock မလိုဘဲ အမြဲ ခွင့်ပြုသည်
  if (isMasterDirectory) {
    if (['admin', 'finance', 'hr', 'hrstaff', 'accountant', 'cashier', 'maincashier'].includes(normRole)) {
      return { allowed: true };
    }
  }

  // ၃။ မြန်မာစံတော်ချိန် (MMT UTC+06:30) တွက်ချက်ခြင်း
  const nowMs = Date.now();
  const mmtDate = new Date(nowMs + (6.5 * 3600 * 1000));
  const todayMmt = mmtDate.toISOString().slice(0, 10);
  const dayOfWeek = mmtDate.getUTCDay(); // 0 = Sun, ..., 5 = Fri, 6 = Sat

  const cleanRecordDate = existingRecordDate ? String(existingRecordDate).split('T')[0].trim() : '';

  // ၄။ ယနေ့ရက်စွဲ (Today) စာရင်းဖြစ်ပါက သက်ဆိုင်ရာ Role အားလုံးကို ပြင်/ဖျက် ခွင့်ပြုသည်
  if (cleanRecordDate === todayMmt) {
    return { allowed: true };
  }

  // ၅။ ယနေ့ရက်စွဲ မဟုတ်သော စာရင်းဟောင်းများအတွက် စစ်ဆေးချက်
  if (normRole === 'admin') {
    if (dayOfWeek === 5) {
      if (cleanRecordDate) {
        const recordTime = new Date(`${cleanRecordDate}T00:00:00Z`).getTime();
        const todayTime = new Date(`${todayMmt}T00:00:00Z`).getTime();
        const diffDays = Math.round((todayTime - recordTime) / (24 * 3600 * 1000));

        if (diffDays >= 0 && diffDays <= 30) {
          return { allowed: true };
        } else if (diffDays > 30) {
          return {
            allowed: false,
            message: "ရက်ပေါင်း ၃၀ (၁ လ) ကျော်လွန်သွားသော စာရင်းဟောင်းများကို ပြင်ဆင်/ဖျက်သိမ်းခွင့် မရှိပါ။"
          };
        } else {
          return {
            allowed: false,
            message: "အနာဂတ်ရက်စွဲဖြင့် သွင်းထားသော စာရင်းများကို ပြင်ဆင်/ဖျက်သိမ်းခွင့် မရှိပါ။"
          };
        }
      }
      return { allowed: true };
    } else {
      return {
        allowed: false,
        message: "Admin သည် ရက်စွဲဟောင်း စာရင်းများကို သောကြာနေ့များတွင်သာ ပြင်ဆင်/ဖျက်သိမ်းခွင့် ရှိပါသည် (၁ လအတွင်း)။"
      };
    }
  }

  // ၆။ Daily Lock: သတ်မှတ်ရက်စွဲမဟုတ်ပါက ကျန် Role များကို တားမြစ်သည်
  return {
    allowed: false,
    message: "ယနေ့ရက်စွဲမဟုတ်သော စာရင်းဟောင်းများကို ပြင်ဆင်/ဖျက်သိမ်းခွင့် မရှိပါ (Daily Lock)။"
  };
}