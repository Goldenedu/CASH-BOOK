/**
 * GOLDEN ERP SYSTEM - STUDENT D1 SQL HANDLER MODULE
 * File: handlers-student.js 
 * 💡 Features: FY-Scoped Student Lookup (SELECT * FROM student WHERE fy = ?), Strict 4-Digit FYID Padding (2627-STU-0002),
 *              Accurate Pagination Offset Engine, History Lookup & Precision Gender Auto-Detection
 */

/**
 * 💡 Gender Auto-Detection by Myanmar/English Name Prefix
 */
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

/**
 * 💡 FY String Normalizer (Ensures "FY 2026-2027" or "2026-2027" match)
 */
function normalizeFyStr(fy) {
  if (!fy) return '2026-2027';
  let s = String(fy).trim();
  s = s.replace(/^FY\s*/i, '');
  return s;
}

/**
 * 💡 System-Wide FY Short Code Generator (Format: 2026-2027 -> 2627)
 */
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

/**
 * 💡 Safe Integer ID Parser
 */
function parseCleanIntId(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : Math.trunc(val);
  const n = parseInt(String(val).trim(), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 💡 Fetch Student Data with Pagination & FY Scoping Support
 */
export async function getStudentData(db, body) {
  try {
    const search = String(body.searchVal || "").trim();
    const fyFilter = body.fy || body.fyFilter ? normalizeFyStr(body.fy || body.fyFilter) : "";
    const page = parseInt(body.page, 10) || 1;
    const limit = parseInt(body.limit, 10) || 50;
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let params = [];

    // 💡 FY-Scoped Filter (Both raw and FY-prefixed)
    if (fyFilter) {
      whereClauses.push(`(fy = ? OR fy = ?)`);
      params.push(fyFilter, `FY ${fyFilter}`);
    }

    if (search) {
      whereClauses.push(`(name LIKE ? OR fyid LIKE ? OR fyid_name LIKE ? OR CAST(student_id AS TEXT) LIKE ?)`);
      const p = `%${search}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Total Count Query for Accurate Pagination
    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM student ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    // Data Query with LIMIT and OFFSET
    const query = `SELECT * FROM student ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;
    const rows = await db.prepare(query).bind(...params, limit, offset).all();
    const studentList = rows.results || [];

    // Compute Active / Inactive Stats within current filter scope
    let totalActive = 0;
    let totalInactive = 0;

    studentList.forEach(row => {
      const isTransferred = !!(row.transfer_date || row.transferDate);
      const isInactive = isTransferred || (row.status || "").toLowerCase() === "inactive";
      if (isInactive) {
        totalInactive++;
      } else {
        totalActive++;
      }
    });

    return {
      success: true,
      data: studentList,
      totalRows: totalRows,
      page: page,
      limit: limit,
      stats: {
        totalActive,
        totalInactive,
        total: totalRows
      }
    };
  } catch (err) {
    console.error("Error in getStudentData handler:", err);
    return { success: false, message: "ကျောင်းသား စာရင်း ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Precision Old Student Lookup by ID / FYID
 */
export async function lookupStudentById(db, body) {
  try {
    const rawId = String(body.studentId || body.id || "").trim();
    if (!rawId) {
      return { success: false, message: "Student ID ထည့်သွင်းပေးရန် လိုအပ်ပါသည်။" };
    }

    const cleanNum = parseCleanIntId(rawId);
    const paddedPattern = cleanNum > 0 ? `%-STU-${String(cleanNum).padStart(4, '0')}` : `%-STU-%`;

    const row = await db.prepare(`
      SELECT * FROM student 
      WHERE student_id = ? 
         OR id = ? 
         OR fyid = ? 
         OR fyid LIKE ?
      ORDER BY id DESC LIMIT 1
    `).bind(cleanNum, cleanNum, rawId, paddedPattern).first();

    if (!row) {
      return { success: false, message: "မူရင်း ကျောင်းသား ရာဇဝင် ရှာမတွေ့ပါ။" };
    }

    return {
      success: true,
      data: row
    };
  } catch (err) {
    console.error("Error in lookupStudentById handler:", err);
    return { success: false, message: "ကျောင်းသား ရှာဖွေရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Save New Student Entry
 */
export async function saveStudentEntry(db, userSession, body) {
  try {
    const fy = normalizeFyStr(body.fy || "2026-2027");
    const isOldStudent = (body.stuStatus || body.stu_status) === "Old Student";

    // 1. Resolve Strict Integer Student ID
    let studentIdNum = parseCleanIntId(body.studentId || body.id);
    if (!studentIdNum || !isOldStudent) {
      const maxIdRow = await db.prepare("SELECT MAX(CAST(student_id AS INTEGER)) as max_id FROM student").first();
      const currentMax = maxIdRow && maxIdRow.max_id ? parseInt(maxIdRow.max_id, 10) : 0;
      studentIdNum = currentMax + 1;
    }

    // 2. Resolve FY-Scoped Sequence NO
    const maxNoRow = await db.prepare(
      "SELECT MAX(CAST(no AS INTEGER)) as max_no FROM student WHERE fy = ? OR fy = ?"
    ).bind(fy, `FY ${fy}`).first();
    const currentNoMax = maxNoRow && maxNoRow.max_no ? parseInt(maxNoRow.max_no, 10) : 0;
    const nextNo = currentNoMax + 1;

    // 3. Auto Generate 4-Digit FYID (e.g. 2627-STU-0002)
    const fyShort = getFyShortCode(fy);
    const paddedId = String(studentIdNum).padStart(4, '0');
    const fyid = `${fyShort}-STU-${paddedId}`;
    const name = String(body.name || '').trim();
    const fyidName = `[${fyid}] ${name}`;

    const transferDate = body.transferDate || body.transfer_date || '';
    const status = transferDate ? 'Inactive' : (body.status || 'Active');
    const gender = body.gender || autoDetectGender(name);

    const uniqueid = body.uniqueId || body.uniqueid || `STU_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const createdBy = userSession?.name || userSession?.username || body.createdBy || 'Admin';

    await db.prepare(`INSERT INTO student (
      no, stu_status, date, fy, student_id, fyid, name, fyid_name,
      class, category, promo, transfer_date, status, gender,
      parents_name, phone_no, address, created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      nextNo,
      body.stuStatus || body.stu_status || 'New Student',
      body.date || new Date().toISOString().split('T')[0],
      fy,
      studentIdNum,
      fyid,
      name,
      fyidName,
      body.class || '',
      body.category || '',
      body.promo || 'Original price',
      transferDate,
      status,
      gender,
      body.parentsName || body.parents_name || '',
      body.phoneNo || body.phone_no || '',
      body.address || '',
      createdBy,
      new Date().toISOString(),
      uniqueid
    ).run();

    return {
      success: true,
      message: "ကျောင်းသားသစ် မှတ်တမ်း အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      uniqueId: uniqueid,
      studentId: studentIdNum,
      no: nextNo,
      fyid: fyid
    };
  } catch (err) {
    console.error("Error in saveStudentEntry handler:", err);
    return { success: false, message: "ကျောင်းသား မှတ်တမ်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Update Existing Student Entry
 */
export async function updateStudentEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const transferDate = body.transferDate || body.transfer_date || '';
    const status = transferDate ? 'Inactive' : (body.status || 'Active');
    const name = String(body.name || '').trim();
    const gender = body.gender || autoDetectGender(name);

    const fy = normalizeFyStr(body.fy || '2026-2027');
    const fyShort = getFyShortCode(fy);
    const studentIdNum = parseCleanIntId(body.studentId || body.id) || 1;
    const paddedId = String(studentIdNum).padStart(4, '0');
    const fyid = `${fyShort}-STU-${paddedId}`;
    const fyidName = `[${fyid}] ${name}`;

    await db.prepare(`UPDATE student SET 
      date = ?, fy = ?, student_id = ?, fyid = ?, fyid_name = ?, name = ?, 
      class = ?, category = ?, promo = ?, stu_status = ?, status = ?, 
      gender = ?, transfer_date = ?, parents_name = ?, phone_no = ?, address = ? 
      WHERE uniqueid = ?`).bind(
      body.date || '',
      fy,
      studentIdNum,
      fyid,
      fyidName,
      name,
      body.class || '',
      body.category || '',
      body.promo || 'Original price',
      body.stuStatus || body.stu_status || 'New Student',
      status,
      gender,
      transferDate,
      body.parentsName || body.parents_name || '',
      body.phoneNo || body.phone_no || '',
      body.address || '',
      uniqueid
    ).run();

    return { success: true, message: "ကျောင်းသား မှတ်တမ်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။" };
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
    return { success: true, message: "ကျောင်းသား မှတ်တမ်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in deleteStudentEntry handler:", err);
    return { success: false, message: "ကျောင်းသား မှတ်တမ်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}
