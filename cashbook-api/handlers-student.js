/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - STUDENT DIRECTORY D1 HANDLER MODULE
 * File: handlers-student.js (Location: cashbook-api/handlers-student.js)
 * 💡 Features: Refactored with utils.js for DRY Principle
 *              🚀 OPTIMIZED: SQL-Side Active/Inactive Aggregations
 *              🎯 EXPLICIT SELECTS: Avoided SELECT *, Exact Column Mapping
 *              🚀 ULTRA-OPTIMIZED: Prevented Full Table Scans. Replaced OR with IN().
 * ==============================================================================
 */

import {
  normalizeFyClean,
  getFyShortCode,
  sanitizeFyidStr,
  autoDetectGender,
  generateUniqueId
} from './utils.js';

async function generateFyNo(db, tableName, fy) {
  const normFy = normalizeFyClean(fy);
  // 🚀 ULTRA-OPTIMIZATION: Replace OR with IN() to leverage Index Seek
  const lastNoRow = await db.prepare(
    `SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM ${tableName} WHERE fy IN (?, ?)`
  ).bind(normFy, `FY ${normFy}`).first();
  return (lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0) + 1;
}

/**
 * 💡 Get Student Data (⚡ 1-Query Combined Stats Optimization & Explicit Columns)
 */
export async function getStudentData(db, body) {
  try {
    const activeFy = normalizeFyClean(body.fy);
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 5000, 10); // Supports full dataset
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let params = [];

    // 🚀 ULTRA-OPTIMIZATION: Replace OR with IN() to leverage Index Seek
    if (body.fy && body.fy !== 'all') {
      whereClauses.push(`(fy IN (?, ?))`);
      params.push(activeFy, `FY ${activeFy}`);
    }

    if (searchVal) {
      whereClauses.push(`(name LIKE ? OR fyid LIKE ? OR fyid_name LIKE ? OR CAST(student_id AS TEXT) LIKE ? OR class LIKE ? OR category LIKE ? OR phone_no LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // ⚡ OPTIMIZED: Single Combined Query for Total, Active and Inactive Counts
    const statsQuery = `
      SELECT 
        COUNT(id) as totalCount,
        COALESCE(SUM(CASE WHEN LOWER(status) = 'active' THEN 1 ELSE 0 END), 0) as activeCount,
        COALESCE(SUM(CASE WHEN LOWER(status) = 'inactive' THEN 1 ELSE 0 END), 0) as inactiveCount
      FROM student ${whereSql}
    `;
    const statsRow = await db.prepare(statsQuery).bind(...params).first() || { totalCount: 0, activeCount: 0, inactiveCount: 0 };

    const totalRows = statsRow.totalCount || 0;
    const totalActive = statsRow.activeCount || 0;
    const totalInactive = statsRow.inactiveCount || 0;

    // 🚀 OPTIMIZATION: Explicit columns using exact DB Schema names
    const dataQuery = `
      SELECT id, student_id, no, stu_status, date, fy, fyid, name, fyid_name, class, category, promo, status, transfer_date, gender, parents_name, phone_no, address, uniqueid 
      FROM student 
      ${whereSql} 
      ORDER BY CAST(no AS INTEGER) DESC, id DESC 
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => {
      const transDateVal = row.transfer_date || '';
      const isTransferred = !!transDateVal;
      const finalStatus = isTransferred ? 'Inactive' : (row.status || 'Active');

      return {
        id: parseInt(row.student_id || row.id, 10) || 1,
        no: parseInt(row.no, 10) || parseInt(row.student_id, 10) || 1,
        stuStatus: row.stu_status || 'New Student',
        date: row.date || '',
        fy: row.fy || activeFy,
        studentId: parseInt(row.student_id || row.id, 10) || 1,
        fyid: sanitizeFyidStr(row.fyid || ''),
        name: row.name || '',
        fyidName: row.fyid_name || `[${sanitizeFyidStr(row.fyid)}] ${row.name}`,
        class: row.class || '',
        category: row.category || 'Boarder',
        promo: row.promo || 'Original price',
        status: finalStatus,
        transferDate: transDateVal,
        gender: row.gender || autoDetectGender(row.name),
        parentsName: row.parents_name || '',
        phoneNo: row.phone_no || '',
        address: row.address || '',
        uniqueId: row.uniqueid || `STU_${row.id}`
      };
    });

    return {
      success: true,
      data: formattedRows,
      totalRows: totalRows,
      stats: {
        totalActive,
        totalInactive,
        total: totalRows
      }
    };
  } catch (err) {
    console.error("Error in getStudentData handler:", err);
    return { success: false, message: "ကျောင်းသားစာရင်း ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Lookup Student by ID
 */
export async function lookupStudentById(db, body) {
  try {
    const studentId = parseInt(body.studentId || body.id, 10);
    if (!studentId || isNaN(studentId)) {
      return { success: false, message: "Student ID မမှန်ကန်ပါ။" };
    }

    // 🚀 OPTIMIZATION: Explicit columns
    const row = await db.prepare(
      `SELECT student_id, id, name, class, category, promo, status, parents_name, phone_no, address, fyid FROM student WHERE student_id = ? OR id = ? ORDER BY id DESC LIMIT 1`
    ).bind(studentId, studentId).first();

    if (!row) {
      return { success: false, message: "ကျောင်းသား ရှာမတွေ့ပါ။" };
    }

    const cleanId = row.student_id || row.id;
    return {
      success: true,
      data: {
        id: cleanId,
        studentId: cleanId,
        name: row.name || '',
        class: row.class || '',
        category: row.category || 'Boarder',
        promo: row.promo || 'Original price',
        status: row.status || 'Active',
        parentsName: row.parents_name || '',
        phoneNo: row.phone_no || '',
        address: row.address || '',
        fyid: sanitizeFyidStr(row.fyid || '')
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * 💡 Save Student Entry (Preserves exact Column A NO, Column E ID, Column F FYID from Google Sheets)
 */
export async function saveStudentEntry(db, userSession, body) {
  try {
    const entryDate = body.date || new Date().toISOString().split('T')[0];
    const cleanFy = normalizeFyClean(body.fy, entryDate);
    const fyShort = body.fyShort || getFyShortCode(cleanFy);

    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(userSession?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport);

    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : generateUniqueId('STU');

    // 💡 1. PRESERVE EXACT ID FROM GOOGLE SHEET (Column E)
    let studentId = parseInt(body.studentId || body.id, 10);
    if (!studentId || isNaN(studentId)) {
      // 🚀 ULTRA-OPTIMIZATION: Replace OR with IN() to leverage Index Seek
      const maxRow = await db.prepare("SELECT MAX(CAST(student_id AS INTEGER)) as max_id FROM student WHERE fy IN (?, ?)").bind(cleanFy, `FY ${cleanFy}`).first();
      const currentMax = maxRow && maxRow.max_id ? parseInt(maxRow.max_id, 10) : 0;
      studentId = currentMax + 1;
    }

    // 💡 2. PRESERVE EXACT FYID FROM GOOGLE SHEET (Column F)
    const paddedId = String(studentId).padStart(4, '0');
    const fyid = (body.fyid && String(body.fyid).trim())
      ? sanitizeFyidStr(body.fyid)
      : `${fyShort}-STU-${paddedId}`;

    const studentName = String(body.name || '').trim();
    const fyidName = body.fyidName || `[${fyid}] ${studentName}`;
    const detectedGender = body.gender || autoDetectGender(studentName);

    // 💡 3. TRANSFER DATE STATUS GUARD: Transfer date ပါပါက Status အား Inactive အဖြစ် တိုက်ရိုက်သတ်မှတ်သည်
    const transferDateVal = body.transferDate || body.transfer_date || '';
    const finalStatus = transferDateVal ? 'Inactive' : (body.status || 'Active');

    // 💡 4. PRESERVE EXACT NO FROM GOOGLE SHEET (Column A) or GENERATE PROPER FY NO
    const assignedNo = (isMigration && body.no)
      ? parseInt(body.no, 10)
      : (parseInt(body.no, 10) || await generateFyNo(db, 'student', cleanFy));

    const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";

    const stmt = `
      ${sqlVerb} student (
        no, stu_status, date, fy, student_id, fyid, name, fyid_name,
        class, category, promo, transfer_date, status, gender,
        parents_name, phone_no, address, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `;

    await db.prepare(stmt).bind(
      assignedNo, body.stuStatus || body.stu_status || 'New Student', entryDate,
      cleanFy, studentId, fyid, studentName, fyidName,
      body.class || 'KG Student', body.category || 'Boarder', body.promo || 'Original price',
      transferDateVal, finalStatus, detectedGender,
      body.parentsName || '', body.phoneNo || '', body.address || '',
      userSession?.name || 'Admin', uniqueid
    ).run();

    return {
      success: true,
      message: "ကျောင်းသားသစ် မှတ်တမ်း အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      studentId: studentId,
      fyid: fyid,
      uniqueId: uniqueid
    };
  } catch (err) {
    console.error("Error in saveStudentEntry handler:", err);
    return { success: false, message: "ကျောင်းသား မှတ်တမ်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Update Student Entry (With Server-side Transfer Status Enforcement)
 */
export async function updateStudentEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const entryDate = body.date || '';
    const cleanFy = normalizeFyClean(body.fy, entryDate);
    const studentId = parseInt(body.studentId || body.id, 10);
    const paddedId = String(studentId).padStart(4, '0');
    const fyShort = body.fyShort || getFyShortCode(cleanFy);
    const fyid = sanitizeFyidStr(body.fyid || `${fyShort}-STU-${paddedId}`);
    const studentName = String(body.name || '').trim();
    const fyidName = `[${fyid}] ${studentName}`;
    const detectedGender = body.gender || autoDetectGender(studentName);

    // 💡 TRANSFER DATE STATUS GUARD: Transfer date ပါပါက Status အား Inactive အဖြစ် တိုက်ရိုက်သတ်မှတ်သည်
    const transferDateVal = body.transferDate || body.transfer_date || '';
    const finalStatus = transferDateVal ? 'Inactive' : (body.status || 'Active');

    const stmt = `
      UPDATE student SET
        stu_status = ?, date = ?, fy = ?, student_id = ?, fyid = ?, name = ?, fyid_name = ?,
        class = ?, category = ?, promo = ?, transfer_date = ?, status = ?, gender = ?,
        parents_name = ?, phone_no = ?, address = ?
      WHERE uniqueid = ?
    `;

    await db.prepare(stmt).bind(
      body.stuStatus || 'New Student', entryDate, cleanFy, studentId, fyid, studentName, fyidName,
      body.class || '', body.category || '', body.promo || '', transferDateVal,
      finalStatus, detectedGender, body.parentsName || '', body.phoneNo || '',
      body.address || '', uniqueid
    ).run();

    return {
      success: true,
      message: "ကျောင်းသား မှတ်တမ်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in updateStudentEntry handler:", err);
    return { success: false, message: "ကျောင်းသား မှတ်တမ်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Delete Student Entry
 */
export async function deleteStudentEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    await db.prepare("DELETE FROM student WHERE uniqueid = ?").bind(uniqueid).run();

    return {
      success: true,
      message: "ကျောင်းသား မှတ်တမ်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in deleteStudentEntry handler:", err);
    return { success: false, message: "ကျောင်းသား မှတ်တမ်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}
