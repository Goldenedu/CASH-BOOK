/**
 * GOLDEN ERP SYSTEM - STUDENT DIRECTORY D1 HANDLER MODULE
 * File: handlers-student.js
 * 💡 Features: Direct isMigration Mode (Preserves exact NO, ID, FYID from Google Sheets),
 *              Server-Side Privilege Escalation Defense, Myanmar Gender Auto-Detection,
 *              FY-Based Sequential Fallbacks & Strict Ordering by NO/ID Descending
 */

function sanitizeFyidStr(fyidStr) {
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

function getFyShortCode(fyStr) {
  if (!fyStr) return '2627';
  const parts = String(fyStr).replace(/^FY\s*/i, '').split(/[-/]/);
  if (parts.length >= 2) {
    const y1 = parts[0].trim().slice(-2);
    const y2 = parts[1].trim().slice(-2);
    return `${y1}${y2}`;
  }
  return '2627';
}

function autoDetectGender(nameStr) {
  if (!nameStr) return 'Male';
  const clean = String(nameStr).trim();

  if (clean.startsWith('မောင်') || clean.startsWith('ကို') || clean.startsWith('ဦး') ||
      /^(Mg|Ko|U)\b/i.test(clean) || /^(မောင်|ကို|ဦး)/.test(clean)) {
    return 'Male';
  }

  if (clean.startsWith('မေ') || clean.startsWith('ဒေါ်') || clean.startsWith('Daw') || clean.startsWith('May') ||
      /^(May|Daw)\b/i.test(clean)) {
    return 'Female';
  }

  if ((clean.startsWith('မ') && !clean.startsWith('မောင်')) || /^(Ma)\b/i.test(clean)) {
    return 'Female';
  }

  return 'Male';
}

async function generateFyNo(db, tableName, fy) {
  const normFy = String(fy || '').replace(/^FY\s*/i, '');
  const lastNoRow = await db.prepare(
    `SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM ${tableName} WHERE fy = ? OR fy = ?`
  ).bind(normFy, `FY ${normFy}`).first();
  return (lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0) + 1;
}

/**
 * 💡 Get Student Data (Ordered strictly by NO / ID Descending)
 */
export async function getStudentData(db, body) {
  try {
    const activeFy = String(body.fy || "2026-2027").replace(/^FY\s*/i, '');
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 5000, 10); // Supports full dataset
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let params = [];

    if (body.fy && body.fy !== 'all') {
      whereClauses.push(`(fy = ? OR fy = ?)`);
      params.push(activeFy, `FY ${activeFy}`);
    }

    if (searchVal) {
      whereClauses.push(`(name LIKE ? OR fyid LIKE ? OR fyid_name LIKE ? OR CAST(student_id AS TEXT) LIKE ? OR class LIKE ? OR category LIKE ? OR phone_no LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM student ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    // 💡 Fetch Accurate Stats Directly from Database SQL
    const activeRow = await db.prepare(`SELECT COUNT(*) as count FROM student ${whereSql} ${whereSql ? 'AND' : 'WHERE'} LOWER(status) = 'active'`).bind(...params).first();
    const inactiveRow = await db.prepare(`SELECT COUNT(*) as count FROM student ${whereSql} ${whereSql ? 'AND' : 'WHERE'} LOWER(status) = 'inactive'`).bind(...params).first();

    const dataQuery = `
      SELECT * FROM student 
      ${whereSql} 
      ORDER BY CAST(no AS INTEGER) DESC, id DESC 
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => ({
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
      status: row.status || 'Active',
      transferDate: row.transfer_date || '',
      gender: row.gender || autoDetectGender(row.name),
      parentsName: row.parents_name || '',
      phoneNo: row.phone_no || '',
      address: row.address || '',
      uniqueId: row.uniqueid || `STU_${row.id}`
    }));

    return {
      success: true,
      data: formattedRows,
      totalRows: totalRows,
      stats: {
        totalActive: activeRow ? activeRow.count : 0,
        totalInactive: inactiveRow ? inactiveRow.count : 0,
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

    const row = await db.prepare(
      `SELECT * FROM student WHERE student_id = ? OR id = ? ORDER BY id DESC LIMIT 1`
    ).bind(studentId, studentId).first();

    if (!row) {
      return { success: false, message: "ကျောင်းသား ရှာမတွေ့ပါ။" };
    }

    return {
      success: true,
      data: {
        id: row.student_id || row.id,
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
    const cleanFy = String(body.fy || "2026-2027").replace(/^FY\s*/i, '');
    const fyShort = body.fyShort || getFyShortCode(cleanFy);

    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(userSession?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport);

    // 💡 1. PRESERVE EXACT ID FROM GOOGLE SHEET (Column E)
    let studentId = parseInt(body.studentId || body.id, 10);
    if (!studentId || isNaN(studentId)) {
      const maxRow = await db.prepare("SELECT MAX(CAST(student_id AS INTEGER)) as max_id FROM student WHERE fy = ? OR fy = ?").bind(cleanFy, `FY ${cleanFy}`).first();
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

    // 💡 3. PRESERVE EXACT NO FROM GOOGLE SHEET (Column A)
    const assignedNo = (isMigration && body.no)
      ? parseInt(body.no, 10)
      : (parseInt(body.no, 10) || studentId);

    // 💡 4. PRESERVE UNIQUEID WHEN MIGRATING
    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : `STU_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";

    const stmt = `
      ${sqlVerb} student (
        no, stu_status, date, fy, student_id, fyid, name, fyid_name,
        class, category, promo, transfer_date, status, gender,
        parents_name, phone_no, address, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `;

    await db.prepare(stmt).bind(
      assignedNo, body.stuStatus || body.stu_status || 'New Student', body.date || new Date().toISOString().split('T')[0],
      cleanFy, studentId, fyid, studentName, fyidName,
      body.class || 'KG Student', body.category || 'Boarder', body.promo || 'Original price',
      body.transferDate || '', body.status || 'Active', detectedGender,
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
 * 💡 Update Student Entry
 */
export async function updateStudentEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const cleanFy = String(body.fy || "2026-2027").replace(/^FY\s*/i, '');
    const studentId = parseInt(body.studentId || body.id, 10);
    const paddedId = String(studentId).padStart(4, '0');
    const fyShort = body.fyShort || getFyShortCode(cleanFy);
    const fyid = sanitizeFyidStr(body.fyid || `${fyShort}-STU-${paddedId}`);
    const studentName = String(body.name || '').trim();
    const fyidName = `[${fyid}] ${studentName}`;
    const detectedGender = body.gender || autoDetectGender(studentName);

    const stmt = `
      UPDATE student SET
        stu_status = ?, date = ?, fy = ?, student_id = ?, fyid = ?, name = ?, fyid_name = ?,
        class = ?, category = ?, promo = ?, transfer_date = ?, status = ?, gender = ?,
        parents_name = ?, phone_no = ?, address = ?
      WHERE uniqueid = ?
    `;

    await db.prepare(stmt).bind(
      body.stuStatus || 'New Student', body.date || '', cleanFy, studentId, fyid, studentName, fyidName,
      body.class || '', body.category || '', body.promo || '', body.transferDate || '',
      body.status || 'Active', detectedGender, body.parentsName || '', body.phoneNo || '',
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
