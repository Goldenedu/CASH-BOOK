var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ==============================================================================
// 💡 1. CORE HELPERS (Unified Timezone & Academic Year Definitions)
// ==============================================================================

function getMyanmarDateString(inputDate = null) {
  if (inputDate) return String(inputDate).trim().split("T")[0];
  const now = new Date(Date.now() + 6.5 * 3600 * 1e3);
  return now.toISOString().split("T")[0];
}
__name(getMyanmarDateString, "getMyanmarDateString");

function getCurrentAcademicYear(dateInput) {
  const d = dateInput ? new Date(dateInput) : new Date(Date.now() + 6.5 * 3600 * 1e3);
  const validDate = isNaN(d.getTime()) ? new Date(Date.now() + 6.5 * 3600 * 1e3) : d;
  let y = validDate.getFullYear();
  if (validDate.getMonth() < 2) {
    y -= 1;
  }
  return `${y}-${y + 1}`;
}
__name(getCurrentAcademicYear, "getCurrentAcademicYear");

function calculateAcademicFyFromDate(dateStr) {
  return getCurrentAcademicYear(dateStr);
}
__name(calculateAcademicFyFromDate, "calculateAcademicFyFromDate");

function normalizeFyClean(fy, dateInput = null) {
  let s = fy ? String(fy).trim() : getCurrentAcademicYear(dateInput);
  if (!s) s = getCurrentAcademicYear(dateInput);
  return s.replace(/^FY\s*/i, "");
}
__name(normalizeFyClean, "normalizeFyClean");

function getFyShortCode(fyStr) {
  if (fyStr) {
    const clean = String(fyStr).replace(/^FY\s*/i, "").trim();
    const parts = clean.split(/[-/]/);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      return parts[0].trim().slice(-2) + parts[1].trim().slice(-2);
    }
    if (/^\d{4}$/.test(clean)) return clean;
  }
  const currentFy = getCurrentAcademicYear();
  const p = currentFy.split("-");
  return p[0].slice(-2) + p[1].slice(-2);
}
__name(getFyShortCode, "getFyShortCode");

function sanitizeFyidStr(fyidStr) {
  const s = String(fyidStr || "").trim();
  if (!s) return s;
  if (s.indexOf(".0") === -1) return s;
  const cleaned = s.replace(/\.0/g, "");
  const parts = cleaned.split("-STU-");
  if (parts.length === 2) {
    const numPart = parseInt(parts[1], 10) || 0;
    return `${parts[0]}-STU-${String(numPart).padStart(4, "0")}`;
  }
  return cleaned;
}
__name(sanitizeFyidStr, "sanitizeFyidStr");

function autoDetectGender(nameStr) {
  if (!nameStr) return "Male";
  const clean = String(nameStr).trim();
  if (
    clean.startsWith("ဆရာမ") || clean.startsWith("တီချာ") || clean.startsWith("ဒေါ်") ||
    clean.startsWith("မေ") || clean.startsWith("နန်း") || clean.startsWith("နော်") ||
    clean.startsWith("ခင်") || clean.startsWith("နှင်း") || clean.startsWith("နွယ်") ||
    /^(May|Daw|Nang|Naw|Khin|Hnin|Nwe|Miss|Mrs|Teacher|Sayama)\b/i.test(clean) ||
    ((clean.startsWith("မ") && !clean.startsWith("မောင်") && !clean.startsWith("မင်း")) || /^(Ma)\b/i.test(clean))
  ) {
    return "Female";
  }
  return "Male";
}
__name(autoDetectGender, "autoDetectGender");

async function generateFyNo(db, tableName, fy) {
  const normFy = normalizeFyClean(fy);
  const lastNoRow = await db.prepare(
    `SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM ${tableName} WHERE fy = ? OR fy = ?`
  ).bind(normFy, `FY ${normFy}`).first();
  return (lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0) + 1;
}
__name(generateFyNo, "generateFyNo");

async function generateVoucherNo(db, tableName, prefix, entryDate) {
  let ddmmyy = "";
  const parts = String(entryDate || "").split("-");
  if (parts.length === 3) {
    const y = parts[0].slice(-2);
    ddmmyy = `${parts[2]}${parts[1]}${y}`;
  } else {
    const now = new Date(Date.now() + 6.5 * 3600 * 1e3);
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yy = String(now.getFullYear()).slice(-2);
    ddmmyy = `${dd}${mm}${yy}`;
  }
  const pattern = `${prefix}-${ddmmyy}-%`;
  const countRow = await db.prepare(
    `SELECT COUNT(*) as cnt FROM ${tableName} WHERE vr_no LIKE ? OR date = ?`
  ).bind(pattern, entryDate).first();
  const seq = (countRow ? parseInt(countRow.cnt, 10) : 0) + 1;
  return `${prefix}-${ddmmyy}-${String(seq).padStart(3, "0")}`;
}
__name(generateVoucherNo, "generateVoucherNo");

// ==============================================================================
// 💡 2. STUDENT HANDLERS
// ==============================================================================

async function getStudentData(db, body) {
  try {
    const activeFy = normalizeFyClean(body.fy);
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 5e3, 10);
    const offset = (page - 1) * limit;
    let whereClauses = [];
    let params = [];
    if (body.fy && body.fy !== "all") {
      whereClauses.push(`(fy = ? OR fy = ?)`);
      params.push(activeFy, `FY ${activeFy}`);
    }
    if (searchVal) {
      whereClauses.push(`(name LIKE ? OR fyid LIKE ? OR fyid_name LIKE ? OR CAST(student_id AS TEXT) LIKE ? OR class LIKE ? OR category LIKE ? OR phone_no LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p, p, p);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const statsQuery = `
      SELECT 
        COUNT(*) as totalCount,
        COALESCE(SUM(CASE WHEN LOWER(status) = 'active' THEN 1 ELSE 0 END), 0) as activeCount,
        COALESCE(SUM(CASE WHEN LOWER(status) = 'inactive' THEN 1 ELSE 0 END), 0) as inactiveCount
      FROM student ${whereSql}
    `;
    const statsRow = await db.prepare(statsQuery).bind(...params).first() || { totalCount: 0, activeCount: 0, inactiveCount: 0 };
    const totalRows = statsRow.totalCount || 0;
    const totalActive = statsRow.activeCount || 0;
    const totalInactive = statsRow.inactiveCount || 0;
    const dataQuery = `
      SELECT * FROM student 
      ${whereSql} 
      ORDER BY CAST(no AS INTEGER) DESC, id DESC 
      LIMIT ? OFFSET ?
    `;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];
    const formattedRows = rawRows.map((row) => {
      const transDateVal = row.transfer_date || row.transferDate || "";
      const finalStatus = transDateVal ? "Inactive" : row.status || "Active";
      return {
        id: parseInt(row.student_id || row.id, 10) || 1,
        no: parseInt(row.no, 10) || parseInt(row.student_id, 10) || 1,
        stuStatus: row.stu_status || "New Student",
        date: row.date || "",
        fy: row.fy || activeFy,
        studentId: parseInt(row.student_id || row.id, 10) || 1,
        fyid: sanitizeFyidStr(row.fyid || ""),
        name: row.name || "",
        fyidName: row.fyid_name || `[${sanitizeFyidStr(row.fyid)}] ${row.name}`,
        class: row.class || "",
        category: row.category || "Boarder",
        promo: row.promo || "Original price",
        status: finalStatus,
        transferDate: transDateVal,
        gender: row.gender || autoDetectGender(row.name),
        parentsName: row.parents_name || "",
        phoneNo: row.phone_no || "",
        address: row.address || "",
        uniqueId: row.uniqueid || `STU_${row.id}`
      };
    });
    return {
      success: true,
      data: formattedRows,
      totalRows,
      stats: { totalActive, totalInactive, total: totalRows }
    };
  } catch (err) {
    return { success: false, message: "Error loading students: " + err.message };
  }
}
__name(getStudentData, "getStudentData");

async function lookupStudentById(db, body) {
  try {
    const studentId = parseInt(body.studentId || body.id, 10);
    if (!studentId || isNaN(studentId)) {
      return { success: false, message: "Invalid Student ID." };
    }
    const row = await db.prepare(`SELECT * FROM student WHERE student_id = ? OR id = ? ORDER BY id DESC LIMIT 1`).bind(studentId, studentId).first();
    if (!row) {
      return { success: false, message: "Student Not Found." };
    }
    const cleanId = row.student_id || row.id;
    return {
      success: true,
      data: {
        id: cleanId,
        studentId: cleanId,
        name: row.name || "",
        class: row.class || "",
        category: row.category || "Boarder",
        promo: row.promo || "Original price",
        status: row.status || "Active",
        parentsName: row.parents_name || "",
        phoneNo: row.phone_no || "",
        address: row.address || "",
        fyid: sanitizeFyidStr(row.fyid || "")
      }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(lookupStudentById, "lookupStudentById");

async function saveStudentEntry(db, userSession, body) {
  try {
    const entryDate = body.date || getMyanmarDateString();
    const cleanFy = normalizeFyClean(body.fy, entryDate);
    const fyShort = body.fyShort || getFyShortCode(cleanFy);
    const isPrivilegedAdmin = ["Owner", "Admin"].includes(userSession?.role || "");
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport);
    let studentId = parseInt(body.studentId || body.id, 10);
    if (!studentId || isNaN(studentId)) {
      const maxRow = await db.prepare("SELECT MAX(CAST(student_id AS INTEGER)) as max_id FROM student WHERE fy = ? OR fy = ?").bind(cleanFy, `FY ${cleanFy}`).first();
      studentId = (maxRow && maxRow.max_id ? parseInt(maxRow.max_id, 10) : 0) + 1;
    }
    const paddedId = String(studentId).padStart(4, "0");
    const fyid = body.fyid && String(body.fyid).trim() ? sanitizeFyidStr(body.fyid) : `${fyShort}-STU-${paddedId}`;
    const studentName = String(body.name || "").trim();
    const fyidName = body.fyidName || `[${fyid}] ${studentName}`;
    const detectedGender = body.gender || autoDetectGender(studentName);
    const transferDateVal = body.transferDate || body.transfer_date || "";
    const finalStatus = transferDateVal ? "Inactive" : body.status || "Active";
    const assignedNo = isMigration && body.no ? parseInt(body.no, 10) : parseInt(body.no, 10) || await generateFyNo(db, "student", cleanFy);
    const uniqueid = isMigration && body.uniqueId ? String(body.uniqueId).trim() : `STU_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";
    const stmt = `
      ${sqlVerb} student (
        no, stu_status, date, fy, student_id, fyid, name, fyid_name,
        class, category, promo, transfer_date, status, gender,
        parents_name, phone_no, address, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    `;
    await db.prepare(stmt).bind(
      assignedNo, body.stuStatus || body.stu_status || "New Student", entryDate,
      cleanFy, studentId, fyid, studentName, fyidName, body.class || "KG Student",
      body.category || "Boarder", body.promo || "Original price", transferDateVal,
      finalStatus, detectedGender, body.parentsName || "", body.phoneNo || "",
      body.address || "", userSession?.name || "Admin", uniqueid
    ).run();
    return { success: true, message: "Student saved.", studentId, fyid, uniqueId: uniqueid };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(saveStudentEntry, "saveStudentEntry");

async function updateStudentEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID missing." };
    const entryDate = body.date || getMyanmarDateString();
    const cleanFy = normalizeFyClean(body.fy, entryDate);
    const studentId = parseInt(body.studentId || body.id, 10);
    const paddedId = String(studentId).padStart(4, "0");
    const fyShort = body.fyShort || getFyShortCode(cleanFy);
    const fyid = sanitizeFyidStr(body.fyid || `${fyShort}-STU-${paddedId}`);
    const studentName = String(body.name || "").trim();
    const fyidName = `[${fyid}] ${studentName}`;
    const detectedGender = body.gender || autoDetectGender(studentName);
    const transferDateVal = body.transferDate || body.transfer_date || "";
    const finalStatus = transferDateVal ? "Inactive" : body.status || "Active";
    const stmt = `
      UPDATE student SET
        stu_status = ?, date = ?, fy = ?, student_id = ?, fyid = ?, name = ?, fyid_name = ?,
        class = ?, category = ?, promo = ?, transfer_date = ?, status = ?, gender = ?,
        parents_name = ?, phone_no = ?, address = ?
      WHERE uniqueid = ?
    `;
    await db.prepare(stmt).bind(
      body.stuStatus || "New Student", entryDate, cleanFy, studentId, fyid, studentName, fyidName,
      body.class || "", body.category || "", body.promo || "", transferDateVal,
      finalStatus, detectedGender, body.parentsName || "", body.phoneNo || "",
      body.address || "", uniqueid
    ).run();
    return { success: true, message: "Student updated." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(updateStudentEntry, "updateStudentEntry");

async function deleteStudentEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID missing." };
    await db.prepare("DELETE FROM student WHERE uniqueid = ?").bind(uniqueid).run();
    return { success: true, message: "Student deleted." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(deleteStudentEntry, "deleteStudentEntry");

// ==============================================================================
// 💡 3. STAFF & HR PAYROLL HANDLERS
// ==============================================================================

function calculateFundDate(joinDateStr) {
  if (!joinDateStr) return "";
  const d = new Date(joinDateStr);
  if (isNaN(d.getTime())) return "";
  d.setFullYear(d.getFullYear() + 3);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
__name(calculateFundDate, "calculateFundDate");

async function getStaffData(db, body, userSession) {
  try {
    const isPartTime = String(body.category || "").toLowerCase().includes("part");
    const table = isPartTime ? "staff_parttime" : "staff_fulltime";
    const searchVal = String(body.searchVal || "").trim();
    let whereClauses = [];
    let params = [];
    if (searchVal) {
      whereClauses.push(`(name LIKE ? OR staff_idname LIKE ? OR CAST(staff_id AS TEXT) LIKE ? OR position LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM ${table} ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;
    const rows = await db.prepare(`SELECT * FROM ${table} ${whereSql} ORDER BY id DESC LIMIT 1000`).bind(...params).all();
    const rawStaffList = rows.results || [];
    const role = userSession?.role || "Viewer";
    const canSeeSensitive = ["Owner", "Admin", "Finance", "HR", "HR Staff", "HRStaff", "Accountant"].includes(role);
    
    let activeCount = 0;
    let maleCount = 0;
    let femaleCount = 0;
    let totalNetAmt = 0;
    
    const staffList = rawStaffList.map((item) => {
      const resignedDate = item.resigned_date || item.resignedDate || "";
      const isInactive = (item.status || "").toLowerCase() === "inactive" || !!resignedDate;
      const finalStatus = isInactive ? "Inactive" : "Active";
      
      let gender = String(item.gender || "").trim();
      if (!gender || gender.toLowerCase() === 'non') {
        gender = autoDetectGender(item.name);
      }

      if (!isInactive) {
        activeCount++;
        totalNetAmt += Number(item.total_net_amt ?? item.totalNetAmt ?? item.total_salary ?? item.totalSalary ?? 0);
        const gLow = gender.toLowerCase();
        if (gLow === "male" || gLow === "m" || gLow === "ကျား" || gLow.startsWith("mal")) maleCount++;
        else if (gLow === "female" || gLow === "f" || gLow === "မ" || gLow.startsWith("fem")) femaleCount++;
      }
      if (!canSeeSensitive) {
        return {
          id: item.id, no: item.no, joinDate: item.join_date || item.joinDate || "",
          category: item.category || "", staffId: item.staff_id || item.staffId || "",
          name: item.name || "", staffIdName: item.staff_idname || item.staffIdName || "",
          education: item.education || "", position: item.position || "", status: finalStatus,
          gender: gender, phoneNo: item.phone_no || item.phoneNo || "", email: item.email || "",
          salaryGrade: "***", workingDays: 0, basicAmt: 0, extraAmt: 0, totalSalary: 0,
          bonus: 0, fund: 0, totalNetAmt: 0, resignedDate, nrcNo: "***", bankAccount: "***",
          fundDate: "", unpaidBonus: 0, unpaidFund: 0, uniqueId: "***"
        };
      }
      return {
        id: item.id, no: item.no, joinDate: item.join_date || item.joinDate || "",
        category: item.category || "", staffId: item.staff_id || item.staffId || "",
        name: item.name || "", staffIdName: item.staff_idname || item.staffIdName || "",
        education: item.education || "", position: item.position || "",
        salaryGrade: item.salary_grade || item.salaryGrade || "",
        workingDays: parseFloat(item.working_days ?? item.workingDays ?? 26),
        basicAmt: parseFloat(item.basic_amt ?? item.basicAmt ?? 0),
        extraAmt: parseFloat(item.extra_amt ?? item.extraAmt ?? 0),
        totalSalary: parseFloat(item.total_salary ?? item.totalSalary ?? 0),
        bonus: parseFloat(item.bonus || 0),
        fund: parseFloat(item.fund || 0),
        totalNetAmt: parseFloat(item.total_net_amt ?? item.totalNetAmt ?? 0),
        resignedDate, status: finalStatus, gender: gender,
        nrcNo: item.nrc_no || item.nrcNo || "",
        bankAccount: item.bank_account || item.bankAccount || "",
        phoneNo: item.phone_no || item.phoneNo || "", email: item.email || "",
        fundDate: item.fund_date || item.fundDate || "",
        unpaidBonus: parseFloat(item.unpaid_bonus ?? item.unpaidBonus ?? 0),
        unpaidFund: parseFloat(item.unpaid_fund ?? item.unpaidFund ?? 0),
        uniqueId: item.uniqueid || item.uniqueId || `STF_${item.id}`
      };
    });
    return {
      success: true, data: staffList, totalRows,
      stats: { activeCount, totalNetAmt: canSeeSensitive ? totalNetAmt : 0, maleCount, femaleCount }
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(getStaffData, "getStaffData");

async function saveStaffEntry(db, userSession, body) {
  try {
    const isPartTime = String(body.category || "").toLowerCase().includes("part");
    const table = isPartTime ? "staff_parttime" : "staff_fulltime";
    const prefix = isPartTime ? "PID" : "FID";
    const isPrivilegedAdmin = ["Owner", "Admin"].includes(userSession?.role || "");
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport);
    const uniqueid = isMigration && body.uniqueId ? String(body.uniqueId).trim() : `STF_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    let staffIdNum = parseInt(body.staffId || body.id, 10);
    if (!staffIdNum || isNaN(staffIdNum)) {
      const maxRow = await db.prepare(`SELECT MAX(CAST(staff_id AS INTEGER)) as max_id FROM ${table}`).first();
      staffIdNum = (maxRow && maxRow.max_id ? parseInt(maxRow.max_id, 10) : 0) + 1;
    }
    const paddedId = String(staffIdNum).padStart(3, "0");
    const staffName = body.name || "";
    const staffIdName = `[${prefix} ${paddedId}] ${staffName}`;
    const joinDateVal = getMyanmarDateString(body.joinDate || body.join_date);
    const computedFundDate = body.fundDate || calculateFundDate(joinDateVal);
    const resignedDateVal = body.resignedDate || body.resigned_date || "";
    const computedStatus = resignedDateVal.trim() ? "Inactive" : body.status || "Active";
    const assignedNo = isMigration && body.no ? parseInt(body.no, 10) : staffIdNum;
    const sqlInsertVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";
    
    if (isPartTime) {
      await db.prepare(`${sqlInsertVerb} staff_parttime (
        no, join_date, category, staff_id, name, staff_idname, education, position,
        total_salary, total_net_amt, resigned_date, status, gender, nrc_no,
        bank_account, phone_no, email, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(
        assignedNo, joinDateVal, "Part Time", staffIdNum, staffName, staffIdName,
        body.education || "", body.position || "", parseFloat(body.totalSalary || 0),
        parseFloat(body.totalNetAmt || 0), resignedDateVal, computedStatus, body.gender || "Male",
        body.nrcNo || "", body.bankAccount || "", body.phoneNo || "", body.email || "",
        userSession?.name || "Admin", uniqueid
      ).run();
    } else {
      await db.prepare(`${sqlInsertVerb} staff_fulltime (
        no, join_date, category, staff_id, name, staff_idname, education, position,
        salary_grade, working_days, basic_amt, extra_amt, total_salary, bonus, fund,
        total_net_amt, resigned_date, status, gender, nrc_no, bank_account, phone_no,
        email, fund_date, unpaid_bonus, unpaid_fund, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(
        assignedNo, joinDateVal, "Full Time", staffIdNum, staffName, staffIdName,
        body.education || "", body.position || "", body.salaryGrade || "",
        parseFloat(body.workingDays || 26), parseFloat(body.basicAmt || 0),
        parseFloat(body.extraAmt || 0), parseFloat(body.totalSalary || 0),
        parseFloat(body.bonus || 0), parseFloat(body.fund || 0), parseFloat(body.totalNetAmt || 0),
        resignedDateVal, computedStatus, body.gender || "Male", body.nrcNo || "",
        body.bankAccount || "", body.phoneNo || "", body.email || "", computedFundDate,
        parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0),
        userSession?.name || "Admin", uniqueid
      ).run();
    }
    return { success: true, message: "Staff saved.", staffId: staffIdNum, staffIdName, uniqueId: uniqueid };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(saveStaffEntry, "saveStaffEntry");

async function updateStaffEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID missing." };
    const isPartTime = String(body.category || "").toLowerCase().includes("part");
    const table = isPartTime ? "staff_parttime" : "staff_fulltime";
    const prefix = isPartTime ? "PID" : "FID";
    const existing = await db.prepare(`SELECT id, staff_id FROM ${table} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) return { success: false, message: "Staff not found." };
    
    const staffIdNum = parseInt(body.staffId || body.id, 10) || existing.staff_id || 1;
    const paddedId = String(staffIdNum).padStart(3, "0");
    const staffName = body.name || "";
    const staffIdName = `[${prefix} ${paddedId}] ${staffName}`;
    const joinDateVal = getMyanmarDateString(body.joinDate || body.join_date);
    const computedFundDate = body.fundDate || calculateFundDate(joinDateVal);
    const resignedDateVal = body.resignedDate || body.resigned_date || "";
    const computedStatus = resignedDateVal.trim() ? "Inactive" : body.status || "Active";
    
    if (isPartTime) {
      await db.prepare(`UPDATE staff_parttime SET
        join_date = ?, category = ?, staff_id = ?, name = ?, staff_idname = ?,
        education = ?, position = ?, total_salary = ?, total_net_amt = ?,
        resigned_date = ?, status = ?, gender = ?, nrc_no = ?, bank_account = ?,
        phone_no = ?, email = ?
        WHERE uniqueid = ?`).bind(
        joinDateVal, "Part Time", staffIdNum, staffName, staffIdName,
        body.education || "", body.position || "", parseFloat(body.totalSalary || 0),
        parseFloat(body.totalNetAmt || 0), resignedDateVal, computedStatus, body.gender || "Male",
        body.nrcNo || "", body.bankAccount || "", body.phoneNo || "", body.email || "", uniqueid
      ).run();
    } else {
      await db.prepare(`UPDATE staff_fulltime SET
        join_date = ?, category = ?, staff_id = ?, name = ?, staff_idname = ?,
        education = ?, position = ?, salary_grade = ?, working_days = ?,
        basic_amt = ?, extra_amt = ?, total_salary = ?, bonus = ?, fund = ?,
        total_net_amt = ?, resigned_date = ?, status = ?, gender = ?, nrc_no = ?,
        bank_account = ?, phone_no = ?, email = ?, fund_date = ?, unpaid_bonus = ?, unpaid_fund = ?
        WHERE uniqueid = ?`).bind(
        joinDateVal, "Full Time", staffIdNum, staffName, staffIdName,
        body.education || "", body.position || "", body.salaryGrade || "",
        parseFloat(body.workingDays || 26), parseFloat(body.basicAmt || 0),
        parseFloat(body.extraAmt || 0), parseFloat(body.totalSalary || 0),
        parseFloat(body.bonus || 0), parseFloat(body.fund || 0), parseFloat(body.totalNetAmt || 0),
        resignedDateVal, computedStatus, body.gender || "Male", body.nrcNo || "",
        body.bankAccount || "", body.phoneNo || "", body.email || "", computedFundDate,
        parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0), uniqueid
      ).run();
    }
    return { success: true, message: "Staff updated." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(updateStaffEntry, "updateStaffEntry");

async function deleteStaffEntry(db, userSession, body) {
  try {
    const isPartTime = String(body.category || "").toLowerCase().includes("part");
    const table = isPartTime ? "staff_parttime" : "staff_fulltime";
    await db.prepare(`DELETE FROM ${table} WHERE uniqueid = ?`).bind(body.uniqueId || body.uniqueid).run();
    return { success: true, message: "Staff deleted." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(deleteStaffEntry, "deleteStaffEntry");

// ==============================================================================
// 💡 4. PAYROLL & SETTINGS HANDLERS
// ==============================================================================

async function saveHrPayrollForm(db, userSession, body) {
  try {
    const isPrivilegedAdmin = ["Owner", "Admin"].includes(userSession?.role || "");
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport);
    const uniqueid = isMigration && body.uniqueId ? String(body.uniqueId).trim() : `SAL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const dateStr = getMyanmarDateString(body.date);
    const category = body.category || "Full Time Salary";
    const staffIdStr = String(body.staffId || "").trim();
    
    const dObj = new Date(dateStr);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const myVal = `${monthNames[dObj.getMonth()]}-${String(dObj.getFullYear()).slice(-2)}`;
    const fy = normalizeFyClean(body.fy || calculateAcademicFyFromDate(dateStr));
    
    const vrNoVal = body.vrNo || await generateVoucherNo(db, "payroll", "SAL", dateStr);
    const newNo = isMigration && body.no ? parseInt(body.no, 10) : await generateFyNo(db, "payroll", fy);
    const debitVal = parseFloat(body.debit || 0);
    const creditVal = parseFloat(body.credit || 0);
    const unpaidBonus = parseFloat(body.unpaidBonus || 0);
    const unpaidFund = parseFloat(body.unpaidFund || 0);
    
    const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";
    const stmt = `${sqlVerb} payroll (
      no, date, category, description, method, debit, credit, balances,
      unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name,
      created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`;
    
    await db.prepare(stmt).bind(
      newNo, dateStr, category, body.description || "", body.method || "Cash",
      debitVal, creditVal, unpaidBonus, unpaidFund, body.transfer || "",
      vrNoVal, myVal, fy, "HR Payroll Exp Book", userSession?.name || "Admin", uniqueid
    ).run();

    await executeAutoRecalculateAll(db, { tableName: "payroll" });

    if (!isMigration && staffIdStr) {
      const targetStaffId = parseInt(staffIdStr, 10);
      const staffRow = await db.prepare("SELECT * FROM staff_fulltime WHERE staff_id = ? OR id = ? LIMIT 1").bind(targetStaffId, targetStaffId).first();
      if (staffRow) {
        if (category === "Full Time Salary") {
          const newUnpaidBonus = parseFloat(staffRow.unpaid_bonus || 0) + parseFloat(staffRow.bonus || 0);
          const newUnpaidFund = parseFloat(staffRow.unpaid_fund || 0) + parseFloat(staffRow.fund || 0);
          await db.prepare(`UPDATE staff_fulltime SET unpaid_bonus = ?, unpaid_fund = ? WHERE id = ?`).bind(newUnpaidBonus, newUnpaidFund, staffRow.id).run();
        } else if (category === "Full Time Bonus") {
          const currentBonus = parseFloat(staffRow.unpaid_bonus || 0);
          const newUnpaidBonus = Math.max(0, currentBonus - creditVal);
          await db.prepare(`UPDATE staff_fulltime SET unpaid_bonus = ? WHERE id = ?`).bind(newUnpaidBonus, staffRow.id).run();
        } else if (category === "Full Time Fund") {
          const currentFund = parseFloat(staffRow.unpaid_fund || 0);
          const newUnpaidFund = Math.max(0, currentFund - creditVal);
          await db.prepare(`UPDATE staff_fulltime SET unpaid_fund = ? WHERE id = ?`).bind(newUnpaidFund, staffRow.id).run();
        }
      }
    }
    return { success: true, message: "Payroll saved.", uniqueId: uniqueid, vrNo: vrNoVal };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(saveHrPayrollForm, "saveHrPayrollForm");

async function getPayrollSettings(db, body) {
  try {
    let matrix = await db.prepare("SELECT * FROM salary_grade_matrix WHERE id = 1").first();
    if (!matrix) {
      await db.prepare(`INSERT OR IGNORE INTO salary_grade_matrix (
        id, grade_a, grade_b, grade_c, grade_d, grade_e, grade_f, grade_g, grade_h, grade_i, grade_j, grade_k, grade_l, bonus_rate, fund_rate, updated_at
      ) VALUES (1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, datetime('now'))`).run();
      matrix = await db.prepare("SELECT * FROM salary_grade_matrix WHERE id = 1").first();
    }
    return { success: true, data: matrix || {} };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(getPayrollSettings, "getPayrollSettings");

async function updatePayrollSettings(db, userSession, body) {
  try {
    const existing = await db.prepare("SELECT id FROM salary_grade_matrix WHERE id = 1").first();
    if (existing) {
      await db.prepare(`UPDATE salary_grade_matrix SET 
        grade_a = ?, grade_b = ?, grade_c = ?, grade_d = ?, grade_e = ?, grade_f = ?, 
        grade_g = ?, grade_h = ?, grade_i = ?, grade_j = ?, grade_k = ?, grade_l = ?, 
        bonus_rate = ?, fund_rate = ?, updated_at = datetime('now') WHERE id = 1`).bind(
        parseFloat(body.gradeA || body["grade-A"] || 0), parseFloat(body.gradeB || body["grade-B"] || 0),
        parseFloat(body.gradeC || body["grade-C"] || 0), parseFloat(body.gradeD || body["grade-D"] || 0),
        parseFloat(body.gradeE || body["grade-E"] || 0), parseFloat(body.gradeF || body["grade-F"] || 0),
        parseFloat(body.gradeG || body["grade-G"] || 0), parseFloat(body.gradeH || body["grade-H"] || 0),
        parseFloat(body.gradeI || body["grade-I"] || 0), parseFloat(body.gradeJ || body["grade-J"] || 0),
        parseFloat(body.gradeK || body["grade-K"] || 0), parseFloat(body.gradeL || body["grade-L"] || 0),
        parseFloat(body.bonusRate || body.bonus || 0), parseFloat(body.fundRate || body.fund || 0.05)
      ).run();
    } else {
      await db.prepare(`INSERT INTO salary_grade_matrix (
        id, grade_a, grade_b, grade_c, grade_d, grade_e, grade_f, grade_g, grade_h, grade_i, grade_j, grade_k, grade_l, 
        bonus_rate, fund_rate, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).bind(
        parseFloat(body.gradeA || body["grade-A"] || 0), parseFloat(body.gradeB || body["grade-B"] || 0),
        parseFloat(body.gradeC || body["grade-C"] || 0), parseFloat(body.gradeD || body["grade-D"] || 0),
        parseFloat(body.gradeE || body["grade-E"] || 0), parseFloat(body.gradeF || body["grade-F"] || 0),
        parseFloat(body.gradeG || body["grade-G"] || 0), parseFloat(body.gradeH || body["grade-H"] || 0),
        parseFloat(body.gradeI || body["grade-I"] || 0), parseFloat(body.gradeJ || body["grade-J"] || 0),
        parseFloat(body.gradeK || body["grade-K"] || 0), parseFloat(body.gradeL || body["grade-L"] || 0),
        parseFloat(body.bonusRate || body.bonus || 0), parseFloat(body.fundRate || body.fund || 0.05)
      ).run();
    }
    return { success: true, message: "Settings saved." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(updatePayrollSettings, "updatePayrollSettings");

// ==============================================================================
// 💡 5. UNIFORM LEDGER HANDLERS
// ==============================================================================

async function getUniformData(db, body) {
  try {
    const search = String(body.searchVal || "").trim();
    const page = parseInt(body.page, 10) || 1;
    const limit = parseInt(body.limit, 10) || 1e3;
    const offset = (page - 1) * limit;
    let whereClauses = [];
    let params = [];
    if (search) {
      whereClauses.push(`(product_id LIKE ? OR product_name LIKE ? OR type LIKE ? OR size LIKE ?)`);
      const p = `%${search}%`;
      params = [p, p, p, p];
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM uniform_ledger ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;
    const query = `SELECT * FROM uniform_ledger ${whereSql} ORDER BY id ASC LIMIT ? OFFSET ?`;
    const rows = await db.prepare(query).bind(...params, limit, offset).all();
    const list = rows.results || [];
    let sellingUnit = 0, currentQty = 0, totalStockValue = 0;
    list.forEach((item) => {
      sellingUnit += Number(item.selling_unit ?? item.sellingUnit ?? 0);
      currentQty += Number(item.current_qty ?? item.currentQty ?? 0);
      totalStockValue += Number(item.total_stock_value ?? item.totalStockValue ?? 0);
    });
    return { success: true, data: list, totalRows, stats: { sellingUnit, currentQty, totalStockValue, totalProduct: totalRows } };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(getUniformData, "getUniformData");

async function saveUniformEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid || `UNI_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const createdBy = userSession?.name || userSession?.username || body.createdBy || "Admin";
    const maxNoRow = await db.prepare("SELECT MAX(CAST(no AS INTEGER)) as max_no FROM uniform_ledger").first();
    const nextNo = (maxNoRow && maxNoRow.max_no ? parseInt(maxNoRow.max_no, 10) : 0) + 1;
    const openingStock = parseFloat(body.openingStock ?? body.opening_stock ?? 0);
    const unitPrice = parseFloat(body.unitPrice ?? body.unit_price ?? 0);
    const sellingPrice = parseFloat(body.sellingPrice ?? body.selling_price ?? 0);
    const sellingUnit = parseFloat(body.sellingUnit ?? body.selling_unit ?? 0);
    const totalAmount = openingStock * unitPrice;
    const profitAmount = sellingPrice - unitPrice;
    const currentQty = Math.max(0, openingStock - sellingUnit);
    const totalStockValue = currentQty * unitPrice;
    const rawPid = body.productId || body.product_id;
    const productIdVal = rawPid ? String(rawPid).trim() : `PID ${String(nextNo).padStart(3, "0")}`;
    const stmt = `INSERT INTO uniform_ledger (
      no, product_id, product_name, type, size, opening_stock, unit_price,
      total_amount, selling_price, profit_amount, selling_unit, current_qty,
      total_stock_value, created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    await db.prepare(stmt).bind(
      nextNo, productIdVal, body.productName || body.product_name || "",
      body.type || "", body.size || "", openingStock, unitPrice, totalAmount,
      sellingPrice, profitAmount, sellingUnit, currentQty, totalStockValue,
      createdBy, (new Date(Date.now() + 6.5 * 3600 * 1e3)).toISOString(), uniqueid
    ).run();
    return { success: true, message: "Uniform saved.", uniqueId: uniqueid, productId: productIdVal };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(saveUniformEntry, "saveUniformEntry");

async function updateUniformEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    const rowId = body.id;
    if (!uniqueid && !rowId) return { success: false, message: "ID missing." };
    const existing = await db.prepare(`SELECT * FROM uniform_ledger WHERE uniqueid = ? OR id = ? LIMIT 1`).bind(uniqueid || "", rowId || 0).first();
    const existingSellingUnit = existing ? parseFloat(existing.selling_unit || 0) : 0;
    const openingStock = parseFloat(body.openingStock ?? body.opening_stock ?? (existing ? existing.opening_stock : 0));
    const unitPrice = parseFloat(body.unitPrice ?? body.unit_price ?? (existing ? existing.unit_price : 0));
    const sellingPrice = parseFloat(body.sellingPrice ?? body.selling_price ?? (existing ? existing.selling_price : 0));
    let sellingUnit = existingSellingUnit;
    if (body.sellingUnit !== void 0 && body.sellingUnit !== null) {
      sellingUnit = parseFloat(body.sellingUnit);
    } else if (body.selling_unit !== void 0 && body.selling_unit !== null) {
      sellingUnit = parseFloat(body.selling_unit);
    }
    const totalAmount = openingStock * unitPrice;
    const profitAmount = sellingPrice - unitPrice;
    const currentQty = Math.max(0, openingStock - sellingUnit);
    const totalStockValue = currentQty * unitPrice;
    const rawPid = body.productId || body.product_id;
    const productIdVal = rawPid ? String(rawPid).trim() : existing ? existing.product_id : "";
    await db.prepare(`UPDATE uniform_ledger SET 
      product_id = ?, product_name = ?, type = ?, size = ?, opening_stock = ?, unit_price = ?, 
      total_amount = ?, selling_price = ?, profit_amount = ?, selling_unit = ?, 
      current_qty = ?, total_stock_value = ? 
      WHERE uniqueid = ? OR id = ?`).bind(
      productIdVal, body.productName || body.product_name || (existing ? existing.product_name : ""),
      body.type || (existing ? existing.type : ""), body.size || (existing ? existing.size : ""),
      openingStock, unitPrice, totalAmount, sellingPrice, profitAmount, sellingUnit,
      currentQty, totalStockValue, uniqueid || "", rowId || 0
    ).run();
    return { success: true, message: "Uniform updated." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(updateUniformEntry, "updateUniformEntry");

async function deleteUniformEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    const rowId = body.id;
    if (!uniqueid && !rowId) return { success: false, message: "ID missing." };
    if (uniqueid) {
      await db.prepare("DELETE FROM uniform_ledger WHERE uniqueid = ?").bind(uniqueid).run();
    } else if (rowId) {
      await db.prepare("DELETE FROM uniform_ledger WHERE id = ?").bind(rowId).run();
    }
    return { success: true, message: "Uniform deleted." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(deleteUniformEntry, "deleteUniformEntry");

// ==============================================================================
// 💡 6. EXPENSE & LEDGER HANDLERS (Office, Kitchen, Bank, Cash, Cashier)
// ==============================================================================

const BOOK_TABLE_MAP = {
  "bank": "bank", "main bank book": "bank",
  "cash": "cash", "main cash book": "cash",
  "office": "office", "office exp book": "office", "office expense book": "office",
  "kitchen": "kitchen", "kitchen exp book": "kitchen", "kitchen expense book": "kitchen",
  "payroll": "payroll", "hr payroll exp book": "payroll",
  "cabank": "ca_bank", "ca_bank": "ca_bank", "cashier bank book": "ca_bank",
  "cacash": "ca_cash", "ca_cash": "ca_cash", "cashier cash book": "ca_cash",
  "caoffice": "ca_office", "ca_office": "ca_office", "cashier office book": "ca_office",
  "cakitchen": "ca_kitchen", "ca_kitchen": "ca_kitchen", "cashier kitchen book": "ca_kitchen",
  "capayroll": "ca_payroll", "ca_payroll": "ca_payroll", "cashier payroll book": "ca_payroll"
};

function getTableName(rawBook) {
  if (!rawBook) return "cash";
  return BOOK_TABLE_MAP[String(rawBook).trim().toLowerCase()] || "cash";
}
__name(getTableName, "getTableName");

function getTablePrefix(tableName) {
  switch (tableName) {
    case "bank": return "BNK";
    case "cash": return "CAH";
    case "office": return "OFF";
    case "kitchen": return "KIT";
    case "payroll": return "SAL";
    case "ca_bank": return "CAB";
    case "ca_cash": return "CAC";
    case "ca_office": return "CAO";
    case "ca_kitchen": return "CAK";
    case "ca_payroll": return "CAP";
    default: return "BCK";
  }
}
__name(getTablePrefix, "getTablePrefix");

function getBookTitle(tableName) {
  switch (tableName) {
    case "bank": return "Main Bank Book";
    case "cash": return "Main Cash Book";
    case "office": return "Office Exp Book";
    case "kitchen": return "Kitchen Exp Book";
    case "payroll": return "HR Payroll Exp Book";
    case "ca_bank": return "Cashier Bank Book";
    case "ca_cash": return "Cashier Cash Book";
    case "ca_office": return "Cashier Office Book";
    case "ca_kitchen": return "Cashier Kitchen Book";
    case "ca_payroll": return "Cashier Payroll Book";
    default: return tableName;
  }
}
__name(getBookTitle, "getBookTitle");

function extractProductId(body = {}, description = "", fallbackId = null) {
  if (body.id) return String(body.id).trim();
  if (body.productId) return String(body.productId).trim();
  if (body.product_id) return String(body.product_id).trim();
  if (description) {
    const str = String(description).trim();
    const match = str.match(/PID\s*(\d+)/i);
    if (match && match[1]) return `PID ${match[1].padStart(3, "0")}`;
    const numMatch = str.match(/^(\d+)\s/);
    if (numMatch && numMatch[1]) return numMatch[1];
  }
  return fallbackId ? String(fallbackId).trim() : null;
}
__name(extractProductId, "extractProductId");

function parseAccountingNum(val) {
  if (val === void 0 || val === null || val === "") return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  let s = String(val).trim().replace(/,/g, "");
  if (s.startsWith("(") && s.endsWith(")")) {
    s = "-" + s.slice(1, -1).trim();
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
__name(parseAccountingNum, "parseAccountingNum");

async function syncUniformStockLinked(db, productId, unitDelta) {
  if (!productId || unitDelta === 0) return;
  try {
    const rawPid = String(productId).trim();
    const cleanNum = rawPid.replace(/^PID\s*/i, "").trim();
    const formattedPid = `PID ${cleanNum.padStart(3, "0")}`;
    const item = await db.prepare(`SELECT * FROM uniform_ledger WHERE uniqueid = ? OR LOWER(product_id) = LOWER(?) OR CAST(id AS TEXT) = ? LIMIT 1`).bind(rawPid, formattedPid, cleanNum).first();
    if (item) {
      const openStock = parseFloat(item.opening_stock || 0);
      const currentSellingUnit = parseFloat(item.selling_unit || 0);
      const newSellingUnit = Math.max(0, currentSellingUnit + unitDelta);
      const newCurrentQty = Math.max(0, openStock - newSellingUnit);
      const unitPrice = parseFloat(item.unit_price || 0);
      const newStockVal = newCurrentQty * unitPrice;
      await db.prepare(`UPDATE uniform_ledger SET selling_unit = ?, current_qty = ?, total_stock_value = ? WHERE id = ?`).bind(newSellingUnit, newCurrentQty, newStockVal, item.id).run();
    }
  } catch (e) {}
}
__name(syncUniformStockLinked, "syncUniformStockLinked");

// ⚡ FIX: Use SELECT -> UPDATE/INSERT pattern instead of ON CONFLICT to avoid uniqueid constraint errors
async function createTargetTransferStatement(db, body, sourceTable, targetTable, entryDate, my, normFy, createdBy, transferUid) {
  const debit = parseFloat(body.debit || 0);
  const credit = parseFloat(body.credit || 0);
  const targetDebit = credit; // Source Expense = Target Income
  const targetCredit = debit;
  const targetPrefix = getTablePrefix(targetTable);
  const targetVrNo = await generateVoucherNo(db, targetTable, targetPrefix, entryDate);
  const targetNo = await generateFyNo(db, targetTable, normFy);
  const sourceBookTitle = getBookTitle(sourceTable);
  const targetBookTitle = getBookTitle(targetTable);
  const targetDesc = `[Transfer from ${sourceBookTitle}] ${body.description || ""}`.trim();
  const respPersonVal = body.respPerson || body.responsibility_person || "";

  // Instead of relying on ON CONFLICT, we just return the INSERT statement.
  // We clean up 'transferUid' records BEFORE executing this batch in update/delete.
  // So a straight INSERT is perfectly safe and won't hit constraint errors.
  if (targetTable === "office") {
    return db.prepare(`INSERT INTO office (no, date, category, description, unit, unit_price, method, debit, credit, balances, liabilities, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, 'Transfer', ?, 0, 0, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(targetNo, entryDate, targetDesc, body.method || "Cash", targetDebit, targetCredit, sourceBookTitle, targetVrNo, my, normFy, targetBookTitle, createdBy, transferUid);
  } else if (targetTable === "payroll") {
    return db.prepare(`INSERT INTO payroll (no, date, category, description, method, debit, credit, balances, unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, 'Transfer', ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(targetNo, entryDate, targetDesc, body.method || "Cash", targetDebit, targetCredit, sourceBookTitle, targetVrNo, my, normFy, targetBookTitle, createdBy, transferUid);
  } else if (targetTable.startsWith('ca_')) {
    return db.prepare(`INSERT INTO ${targetTable} (no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, ?, 'Transfer', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(targetNo, entryDate, respPersonVal, targetDesc, body.method || "Cash", targetDebit, targetCredit, sourceBookTitle, targetVrNo, my, normFy, targetBookTitle, createdBy, transferUid);
  } else {
    return db.prepare(`INSERT INTO ${targetTable} (no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, 'Transfer', ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(targetNo, entryDate, targetDesc, body.method || "Cash", targetDebit, targetCredit, sourceBookTitle, targetVrNo, my, normFy, targetBookTitle, createdBy, transferUid);
  }
}
__name(createTargetTransferStatement, "createTargetTransferStatement");

// --- GENERIC LEDGER GET (Handles Bank, Cash, Office, Kitchen, Payroll, Cashier) ---
async function getGenericLedgerData(db, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 50, 10);
    const offset = (page - 1) * limit;
    const activeFy = normalizeFyClean(body.fy || getCurrentAcademicYear());

    const statsResult = await db.prepare(`SELECT COALESCE(SUM(debit), 0) as totalIncome, COALESCE(SUM(credit), 0) as totalExpense FROM ${tableName} WHERE fy = ? OR fy = ?`).bind(activeFy, `FY ${activeFy}`).first() || { totalIncome: 0, totalExpense: 0 };
    let totalIncome = parseFloat(statsResult.totalIncome || 0);
    let totalExpense = parseFloat(statsResult.totalExpense || 0);
    const balance = totalIncome - totalExpense;

    let whereClauses = [];
    let params = [];
    if (searchVal) {
      if (tableName.startsWith('ca_')) {
        whereClauses.push(`(description LIKE ? OR category LIKE ? OR responsibility_person LIKE ? OR vr_no LIKE ? OR transfer LIKE ? OR CAST(debit AS TEXT) LIKE ? OR CAST(credit AS TEXT) LIKE ?)`);
        const p = `%${searchVal}%`;
        params.push(p, p, p, p, p, p, p);
      } else {
        whereClauses.push(`(description LIKE ? OR category LIKE ? OR vr_no LIKE ? OR transfer LIKE ? OR CAST(debit AS TEXT) LIKE ? OR CAST(credit AS TEXT) LIKE ?)`);
        const p = `%${searchVal}%`;
        params.push(p, p, p, p, p, p);
      }
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM ${tableName} ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    const rowsRes = await db.prepare(`SELECT * FROM ${tableName} ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();
    const formattedRows = (rowsRes.results || []).map((row) => {
      const uid = String(row.uniqueid || row.uniqueId || "");
      const isAutoLocked = Boolean(row.is_locked || row.isLocked || uid.startsWith("UNIPROFIT_") || uid.startsWith("UNICASHIER_") || uid.startsWith("INCCASHIER_") || uid.startsWith("TRANS_") || uid.startsWith("DAILY_INC_") || uid.startsWith("INCMAIN_"));
      return {
        id: row.id, no: Math.floor(parseFloat(row.no || row.id || 1)),
        date: row.date || "", category: row.category || "", description: row.description || "",
        method: row.method || "Cash", debit: parseFloat(row.debit || 0), credit: parseFloat(row.credit || 0),
        balances: parseFloat(row.balances || 0), transfer: row.transfer || "", vrNo: row.vr_no || row.vrNo || "",
        my: row.my || "", fy: normalizeFyClean(row.fy || activeFy), bookName: row.book_name || rawBook,
        uniqueId: uid || `ID_${row.id}`, isLocked: isAutoLocked,
        // Specifics
        respPerson: row.responsibility_person || row.respPerson || "",
        unit: parseFloat(row.unit || 0), unitPrice: parseFloat(row.unit_price ?? row.unitPrice ?? 0),
        liabilities: parseFloat(row.liabilities ?? 0),
        unpaidBonus: parseFloat(row.unpaid_bonus ?? row.unpaidBonus ?? 0), unpaidFund: parseFloat(row.unpaid_fund ?? row.unpaidFund ?? 0)
      };
    });
    return { success: true, data: formattedRows, totalRows, page, limit, stats: { totalIncome, totalExpense, balance } };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(getGenericLedgerData, "getGenericLedgerData");

// --- GENERIC LEDGER SAVE/UPDATE (Handles Bank, Cash, Office, Kitchen, Payroll, Cashier) ---
async function saveGenericLedgerEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const isCashier = tableName.startsWith('ca_');
    const createdBy = session?.name || (isCashier ? "Cashier" : "Admin");
    const entryDate = getMyanmarDateString(body.date);
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
    const fy = normalizeFyClean(body.fy || calculateAcademicFyFromDate(entryDate));
    const debit = parseAccountingNum(body.debit);
    const credit = parseAccountingNum(body.credit);
    
    const isPrivilegedAdmin = ["Owner", "Admin", "Finance", "Accountant"].includes(session?.role || "");
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);
    const uniqueid = isMigration && body.uniqueId ? String(body.uniqueId).trim() : `ENT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const newNo = isMigration && body.no ? parseInt(body.no, 10) : await generateFyNo(db, tableName, fy);
    const bookPrefix = getTablePrefix(tableName);
    const vrNo = body.vrNo || await generateVoucherNo(db, tableName, bookPrefix, entryDate);

    const batchStatements = [];

    // 1. Main Insert
    // For Save, we use standard INSERT INTO.
    if (tableName === "office") {
      batchStatements.push(db.prepare(`INSERT INTO office (no, date, category, description, unit, unit_price, method, debit, credit, balances, liabilities, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(newNo, entryDate, body.category || "General", body.description || "", parseFloat(body.unit || 0), parseFloat(body.unitPrice || 0), body.method || "Cash", debit, credit, parseAccountingNum(body.liabilities), body.transfer || "", vrNo, my, fy, getBookTitle(tableName), createdBy, uniqueid));
    } else if (tableName === "payroll") {
      batchStatements.push(db.prepare(`INSERT INTO payroll (no, date, category, description, method, debit, credit, balances, unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(newNo, entryDate, body.category || "Full Time Salary", body.description || "", body.method || "Cash", debit, credit, parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0), body.transfer || "", vrNo, my, fy, getBookTitle(tableName), createdBy, uniqueid));
    } else if (isCashier) {
      batchStatements.push(db.prepare(`INSERT INTO ${tableName} (no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(newNo, entryDate, body.respPerson || body.responsibility_person || "", body.category || "Income", body.description || "", body.method || "Cash", debit, credit, body.transfer || "", vrNo, my, fy, getBookTitle(tableName), createdBy, uniqueid));
    } else {
      batchStatements.push(db.prepare(`INSERT INTO ${tableName} (no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(newNo, entryDate, body.category || "Income", body.description || "", body.method || "Cash", debit, credit, body.transfer || "", vrNo, my, fy, getBookTitle(tableName), createdBy, uniqueid));
    }

    if (isMigration) {
      await db.batch(batchStatements);
      return { success: true, message: "Record saved.", uniqueId: uniqueid, vrNo };
    }

    // 2. Transfer Handling
    const isTransfer = String(body.category || "").trim() === "Transfer" && body.transfer;
    let targetTableName = null;
    if (isTransfer) {
      targetTableName = getTableName(body.transfer);
      if (targetTableName !== tableName) {
        const transferUid = `TRANS_${uniqueid}`;
        batchStatements.push(await createTargetTransferStatement(db, body, tableName, targetTableName, entryDate, my, fy, createdBy, transferUid));
      }
    }

    // 3. Advance Uniform Handling (Only from Office)
    const isUniform = (body.category === "Advance Uniform" || body.category === "Advance Unifrom") && tableName === "office";
    let hasLinkedMain = false, hasLinkedCashier = false;
    let mainTable = "", caTable = "";
    if (isUniform) {
      const method = String(body.method || "Cash").toLowerCase();
      const profit = parseFloat(body.profit || 0);
      const costDebit = parseFloat(body.debit || 0);
      const totalCashierIncome = costDebit + profit;
      mainTable = method === "bank" ? "bank" : "cash";
      caTable = method === "bank" ? "ca_bank" : "ca_cash";

      if (profit > 0) {
        hasLinkedMain = true;
        const mainVrNo = await generateVoucherNo(db, mainTable, getTablePrefix(mainTable), entryDate);
        const mainNo = await generateFyNo(db, mainTable, fy);
        batchStatements.push(db.prepare(`INSERT INTO ${mainTable} (no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, 'Uniform Profit', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Office Exp Book', ?, datetime('now'), ?)`).bind(mainNo, entryDate, `[Uniform Profit] ${body.description || ""}`.trim(), body.method || "Cash", profit, mainVrNo, my, fy, createdBy, `UNIPROFIT_${uniqueid}`));
      }
      if (totalCashierIncome > 0) {
        hasLinkedCashier = true;
        const caVrNo = await generateVoucherNo(db, caTable, getTablePrefix(caTable), entryDate);
        const caNo = await generateFyNo(db, caTable, fy);
        batchStatements.push(db.prepare(`INSERT INTO ${caTable} (no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, '', 'Income Uniform', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Office Exp Book', ?, datetime('now'), ?)`).bind(caNo, entryDate, String(body.description || "").trim(), body.method || "Cash", totalCashierIncome, caVrNo, my, fy, createdBy, `UNICASHIER_${uniqueid}`));
      }
    }

    // ⚡ Execute Atomic Batch
    await db.batch(batchStatements);

    // 4. Uniform Stock Sync
    if (isUniform) {
      const targetPid = extractProductId(body, body.description, null);
      if (targetPid && parseFloat(body.unit || 0) > 0) await syncUniformStockLinked(db, targetPid, parseFloat(body.unit || 0));
    }

    // 5. Global Recalculate (Using imported executeAutoRecalculateAll logic)
    await executeAutoRecalculateAll(db, { tableName });
    if (targetTableName && targetTableName !== tableName) await executeAutoRecalculateAll(db, { tableName: targetTableName });
    if (hasLinkedMain) await executeAutoRecalculateAll(db, { tableName: mainTable });
    if (hasLinkedCashier) await executeAutoRecalculateAll(db, { tableName: caTable });

    return { success: true, message: "Record saved successfully.", uniqueId: uniqueid, vrNo };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(saveGenericLedgerEntry, "saveGenericLedgerEntry");

async function updateGenericLedgerEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const isCashier = tableName.startsWith('ca_');
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID missing." };

    const existing = await db.prepare(`SELECT * FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) return { success: false, message: "Record not found." };

    const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) || String(uniqueid).startsWith("TRANS_") || String(uniqueid).startsWith("UNIPROFIT_") || String(uniqueid).startsWith("UNICASHIER_") || String(uniqueid).startsWith("DAILY_INC_") || String(uniqueid).startsWith("INCMAIN_");
    const isPrivilegedAdmin = ["Owner", "Admin", "Finance", "Accountant"].includes(session?.role || "");
    if (isAutoLocked && !isPrivilegedAdmin) return { success: false, message: "System locked record. Edit from source." };

    const entryDate = getMyanmarDateString(body.date || existing.date);
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
    const fy = normalizeFyClean(body.fy || calculateAcademicFyFromDate(entryDate));
    const oldFy = existing.fy ? normalizeFyClean(existing.fy) : null;

    const debit = parseAccountingNum(body.debit);
    const credit = parseAccountingNum(body.credit);

    const batchStatements = [];
    const transferUid = `TRANS_${uniqueid}`;
    const profitUid = `UNIPROFIT_${uniqueid}`;
    const cashierUid = `UNICASHIER_${uniqueid}`;

    // Clean linked records across all tables
    ["bank", "cash", "office", "kitchen", "payroll", "ca_bank", "ca_cash", "ca_office", "ca_kitchen", "ca_payroll"].forEach(tbl => {
      batchStatements.push(db.prepare(`DELETE FROM ${tbl} WHERE uniqueid IN (?, ?, ?)`).bind(transferUid, profitUid, cashierUid));
    });

    // Update Main Record
    if (tableName === "office") {
      batchStatements.push(db.prepare(`UPDATE office SET date=?, category=?, description=?, unit=?, unit_price=?, method=?, debit=?, credit=?, liabilities=?, transfer=?, my=?, fy=? WHERE uniqueid=?`).bind(entryDate, body.category || "General", body.description || "", parseFloat(body.unit || 0), parseFloat(body.unitPrice || 0), body.method || "Cash", debit, credit, parseAccountingNum(body.liabilities), body.transfer || "", my, fy, uniqueid));
    } else if (tableName === "payroll") {
      batchStatements.push(db.prepare(`UPDATE payroll SET date=?, category=?, description=?, method=?, debit=?, credit=?, unpaid_bonus=?, unpaid_fund=?, transfer=?, my=?, fy=? WHERE uniqueid=?`).bind(entryDate, body.category || "Full Time Salary", body.description || "", body.method || "Cash", debit, credit, parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0), body.transfer || "", my, fy, uniqueid));
    } else if (isCashier) {
      batchStatements.push(db.prepare(`UPDATE ${tableName} SET date=?, responsibility_person=?, category=?, description=?, method=?, debit=?, credit=?, transfer=?, my=?, fy=? WHERE uniqueid=?`).bind(entryDate, body.respPerson || body.responsibility_person || "", body.category || "Income", body.description || "", body.method || "Cash", debit, credit, body.transfer || "", my, fy, uniqueid));
    } else {
      batchStatements.push(db.prepare(`UPDATE ${tableName} SET date=?, category=?, description=?, method=?, debit=?, credit=?, transfer=?, my=?, fy=? WHERE uniqueid=?`).bind(entryDate, body.category || "Income", body.description || "", body.method || "Cash", debit, credit, body.transfer || "", my, fy, uniqueid));
    }

    // Transfers
    const isTransfer = String(body.category || "").trim() === "Transfer" && body.transfer;
    let targetTableName = null;
    if (isTransfer) {
      targetTableName = getTableName(body.transfer);
      if (targetTableName !== tableName) {
        batchStatements.push(await createTargetTransferStatement(db, body, tableName, targetTableName, entryDate, my, fy, session?.name || "Admin", transferUid));
      }
    }

    // Uniform Auto entries
    const wasUniform = (existing.category === "Advance Uniform" || existing.category === "Advance Unifrom") && tableName === "office";
    const isUniform = (body.category === "Advance Uniform" || body.category === "Advance Unifrom") && tableName === "office";
    let mainTable = "", caTable = "";
    if (isUniform) {
      const method = String(body.method || "Cash").toLowerCase();
      const profit = parseFloat(body.profit || 0);
      const costDebit = parseFloat(body.debit || 0);
      const totalCashierIncome = costDebit + profit;
      mainTable = method === "bank" ? "bank" : "cash";
      caTable = method === "bank" ? "ca_bank" : "ca_cash";

      if (profit > 0) {
        const mainVrNo = await generateVoucherNo(db, mainTable, getTablePrefix(mainTable), entryDate);
        const mainNo = await generateFyNo(db, mainTable, fy);
        batchStatements.push(db.prepare(`INSERT INTO ${mainTable} (no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, 'Uniform Profit', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Office Exp Book', ?, datetime('now'), ?)`).bind(mainNo, entryDate, `[Uniform Profit] ${body.description || ""}`.trim(), body.method || "Cash", profit, mainVrNo, my, fy, session?.name || "Admin", profitUid));
      }
      if (totalCashierIncome > 0) {
        const caVrNo = await generateVoucherNo(db, caTable, getTablePrefix(caTable), entryDate);
        const caNo = await generateFyNo(db, caTable, fy);
        batchStatements.push(db.prepare(`INSERT INTO ${caTable} (no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, '', 'Income Uniform', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Office Exp Book', ?, datetime('now'), ?)`).bind(caNo, entryDate, String(body.description || "").trim(), body.method || "Cash", totalCashierIncome, caVrNo, my, fy, session?.name || "Admin", cashierUid));
      }
    }

    await db.batch(batchStatements);

    // Stock Reversion
    if (wasUniform && existing.id) {
      const oldUnit = parseFloat(existing.unit || 0);
      const oldPid = extractProductId(existing, existing.description, existing.id);
      if (oldPid && oldUnit > 0) await syncUniformStockLinked(db, oldPid, -oldUnit);
    }
    if (isUniform) {
      const newUnit = parseFloat(body.unit || 0);
      const targetPid = extractProductId(body, body.description, null);
      if (targetPid && newUnit > 0) await syncUniformStockLinked(db, targetPid, newUnit);
    }

    // Global Recalculate
    await executeAutoRecalculateAll(db, { tableName });
    if (targetTableName && targetTableName !== tableName) await executeAutoRecalculateAll(db, { tableName: targetTableName });
    if (isUniform || wasUniform) {
      await executeAutoRecalculateAll(db, { tableName: "bank" });
      await executeAutoRecalculateAll(db, { tableName: "cash" });
      await executeAutoRecalculateAll(db, { tableName: "ca_bank" });
      await executeAutoRecalculateAll(db, { tableName: "ca_cash" });
    }

    return { success: true, message: "Record updated successfully." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(updateGenericLedgerEntry, "updateGenericLedgerEntry");

async function deleteGenericLedgerEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "cash";
    const tableName = getTableName(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID missing." };

    const existing = await db.prepare(`SELECT * FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) return { success: false, message: "Record not found." };

    const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) || String(uniqueid).startsWith("TRANS_") || String(uniqueid).startsWith("UNIPROFIT_") || String(uniqueid).startsWith("UNICASHIER_") || String(uniqueid).startsWith("DAILY_INC_") || String(uniqueid).startsWith("INCMAIN_");
    const isPrivilegedAdmin = ["Owner", "Admin", "Finance", "Accountant"].includes(session?.role || "");
    if (isAutoLocked && !isPrivilegedAdmin) return { success: false, message: "System locked record. Delete from source." };

    const batchStatements = [db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid)];
    const transferUid = `TRANS_${uniqueid}`;
    const profitUid = `UNIPROFIT_${uniqueid}`;
    const cashierUid = `UNICASHIER_${uniqueid}`;

    ["bank", "cash", "office", "kitchen", "payroll", "ca_bank", "ca_cash", "ca_office", "ca_kitchen", "ca_payroll"].forEach(tbl => {
      batchStatements.push(db.prepare(`DELETE FROM ${tbl} WHERE uniqueid IN (?, ?, ?)`).bind(transferUid, profitUid, cashierUid));
    });

    await db.batch(batchStatements);

    const wasUniform = (existing.category === "Advance Uniform" || existing.category === "Advance Unifrom") && tableName === "office";
    if (wasUniform) {
      const oldUnit = parseFloat(existing.unit || 0);
      const oldPid = extractProductId(existing, existing.description, existing.id);
      if (oldPid && oldUnit > 0) await syncUniformStockLinked(db, oldPid, -oldUnit);
    }

    await executeAutoRecalculateAll(db, { tableName });
    if (existing.transfer) await executeAutoRecalculateAll(db, { tableName: getTableName(existing.transfer) });
    if (wasUniform) {
      await executeAutoRecalculateAll(db, { tableName: "bank" });
      await executeAutoRecalculateAll(db, { tableName: "cash" });
      await executeAutoRecalculateAll(db, { tableName: "ca_bank" });
      await executeAutoRecalculateAll(db, { tableName: "ca_cash" });
    }

    return { success: true, message: "Record deleted successfully." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(deleteGenericLedgerEntry, "deleteGenericLedgerEntry");

// ==============================================================================
// 💡 7. INCOME HANDLERS
// ==============================================================================

async function getIncomeData(db, body) {
  try {
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 50, 10);
    const offset = (page - 1) * limit;
    const activeFy = normalizeFyClean(body.fy || getCurrentAcademicYear());

    let statsResult;
    if (body.fy && body.fy !== "all") {
      statsResult = await db.prepare(`SELECT COALESCE(SUM(credit), 0) as totalIncome, COALESCE(SUM(debit), 0) as totalExpense FROM income WHERE fy = ? OR fy = ?`).bind(activeFy, `FY ${activeFy}`).first();
    } else {
      statsResult = await db.prepare(`SELECT COALESCE(SUM(credit), 0) as totalIncome, COALESCE(SUM(debit), 0) as totalExpense FROM income`).first();
    }
    statsResult = statsResult || { totalIncome: 0, totalExpense: 0 };
    let totalIncome = parseFloat(statsResult.totalIncome || 0);
    let totalExpense = parseFloat(statsResult.totalExpense || 0);
    const balance = totalIncome - totalExpense;

    let whereClauses = [];
    let params = [];
    if (body.fy && body.fy !== "all") {
      whereClauses.push(`(fy = ? OR fy = ?)`);
      params.push(activeFy, `FY ${activeFy}`);
    }
    if (searchVal) {
      whereClauses.push(`(fyid_name LIKE ? OR fyid LIKE ? OR CAST(student_id AS TEXT) LIKE ? OR account_name LIKE ? OR category LIKE ? OR class LIKE ? OR vr_no LIKE ? OR remark LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p, p, p, p);
    }
    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM income ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;
    const rowsRes = await db.prepare(`SELECT * FROM income ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`).bind(...params, limit, offset).all();
    const formattedRows = (rowsRes.results || []).map((row) => {
      const uid = String(row.uniqueid || row.uniqueId || "");
      const isAutoLocked = Boolean(row.is_locked || row.isLocked || uid.startsWith("INCMAIN_") || uid.startsWith("INCCASHIER_") || uid.startsWith("DAILY_INC_"));
      return {
        id: parseCleanIntId(row.student_id || row.id),
        no: Math.floor(parseFloat(row.no || row.id || 1)),
        effDate: row.effect_date || row.effDate || row.date || "",
        date: row.date || "",
        fy: normalizeFyClean(row.fy || activeFy),
        fyid: sanitizeFyidStr(row.fyid || ""),
        fyidName: row.fyid_name || row.fyidName || "",
        class: row.class || "",
        category: row.category || "",
        accountName: row.account_name || row.accountName || "",
        method: row.method || "Cash",
        debit: parseFloat(row.debit || 0),
        credit: parseFloat(row.credit || 0),
        autAmount: parseFloat(row.aut_amount ?? row.autAmount ?? 0),
        promo: row.promo || "",
        my: row.my || "",
        vrNo: row.vr_no || row.vrNo || "",
        remark: row.remark || "",
        uniqueId: uid || `INC_${row.id}`,
        isLocked: isAutoLocked
      };
    });
    return { success: true, data: formattedRows, totalRows, page, limit, stats: { totalIncome, totalExpense, balance } };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(getIncomeData, "getIncomeData");

// ⚡ FIX: Use SELECT -> UPDATE/INSERT pattern instead of ON CONFLICT to avoid uniqueid constraint errors
async function upsertDailyIncomeRollup(db, tableName, entryDate, fy, createdBy) {
  const normFy = normalizeFyClean(fy);
  const isBank = tableName === "bank";
  const prefix = isBank ? "BNK" : "CAH";
  const methodLabel = isBank ? "Bank" : "Cash";
  const uniqueid = `DAILY_INC_${tableName.toUpperCase()}_${entryDate}`;
  
  const stats = await db.prepare(`SELECT COALESCE(SUM(credit - debit), 0) as netAmount, COUNT(DISTINCT student_id) as studentCount FROM income WHERE date = ? AND (LOWER(method) = LOWER(?) OR remark LIKE ?)`).bind(entryDate, methodLabel, `%[Split - ${methodLabel}]%`).first();
  const netAmount = parseFloat(stats?.netAmount || 0);
  const count = parseInt(stats?.studentCount || 0, 10);
  
  if (count <= 0 || netAmount <= 0) {
    await db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).run();
    await executeAutoRecalculateAll(db, { tableName });
    return;
  }
  
  const ddmmyy = formatDDMMYY(entryDate);
  const studentWord = count === 1 ? "Student" : "Students";
  const desc = `Daily Income | ${ddmmyy} | ${count} ${studentWord}`;
  const debit = netAmount > 0 ? netAmount : 0;
  const credit = netAmount < 0 ? Math.abs(netAmount) : 0;
  const my = getMonthYearLabel(entryDate);

  const existing = await db.prepare(`SELECT id FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
  if (existing) {
    await db.prepare(`UPDATE ${tableName} SET date=?, description=?, debit=?, credit=?, my=?, fy=? WHERE uniqueid=?`).bind(entryDate, desc, debit, credit, my, normFy, uniqueid).run();
  } else {
    const vrNo = await generateVoucherNo(db, tableName, prefix, entryDate);
    const no = await generateFyNo(db, tableName, normFy);
    await db.prepare(`INSERT INTO ${tableName} (no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, 'Student Income', ?, ?, ?, ?, 0, '', ?, ?, ?, 'Main Income Book', ?, datetime('now'), ?)`).bind(no, entryDate, desc, methodLabel, debit, credit, vrNo, my, normFy, createdBy, uniqueid).run();
  }
  await executeAutoRecalculateAll(db, { tableName });
}
__name(upsertDailyIncomeRollup, "upsertDailyIncomeRollup");

async function syncDailyIncomeRollupForDate(db, entryDate, fy, createdBy) {
  if (!entryDate) return;
  await upsertDailyIncomeRollup(db, "cash", entryDate, fy, createdBy);
  await upsertDailyIncomeRollup(db, "bank", entryDate, fy, createdBy);
}
__name(syncDailyIncomeRollupForDate, "syncDailyIncomeRollupForDate");

async function postCashierIndividualLine(db, targetMethod, amount, body, entryDate, my, fy, createdBy, uidSuffix) {
  if (amount <= 0) return;
  const normFy = normalizeFyClean(fy);
  const methodKey = String(targetMethod).toLowerCase() === "bank" ? "bank" : "cash";
  const caTable = methodKey === "bank" ? "ca_bank" : "ca_cash";
  const caPrefix = methodKey === "bank" ? "CAB" : "CAC";
  const caUid = `INCCASHIER_${uidSuffix}`;
  const caDesc = buildStudentDetailedDesc(body, null);

  const existing = await db.prepare(`SELECT id FROM ${caTable} WHERE uniqueid = ?`).bind(caUid).first();
  if (existing) {
    await db.prepare(`UPDATE ${caTable} SET date=?, responsibility_person=?, description=?, method=?, debit=?, credit=?, my=?, fy=? WHERE uniqueid=?`).bind(entryDate, createdBy || "Cashier", caDesc, targetMethod, amount, 0, my, normFy, caUid).run();
  } else {
    const caVrNo = await generateVoucherNo(db, caTable, caPrefix, entryDate);
    const caNo = await generateFyNo(db, caTable, normFy);
    await db.prepare(`INSERT INTO ${caTable} (no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, ?, 'Student Income', ?, ?, ?, 0, 0, '', ?, ?, ?, 'Main Income Book', ?, datetime('now'), ?)`).bind(caNo, entryDate, createdBy || "Cashier", caDesc, targetMethod, amount, caVrNo, my, normFy, createdBy || "Cashier", caUid).run();
  }
  await executeAutoRecalculateAll(db, { tableName: caTable });
}
__name(postCashierIndividualLine, "postCashierIndividualLine");

async function saveIncomeEntry(db, session, body) {
  const isPrivilegedAdmin = ["Owner", "Admin", "Finance", "Accountant"].includes(session?.role || "");
  const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);
  const uniqueid = isMigration && body.uniqueId ? String(body.uniqueId).trim() : `INC_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  try {
    const createdBy = session?.name || body.createdBy || "Admin";
    const entryDate = getMyanmarDateString(body.date);
    const effDate = body.effDate ? getMyanmarDateString(body.effDate) : entryDate;
    const my = getMonthYearLabel(entryDate);
    const fy = normalizeFyClean(body.fy || calculateAcademicFyFromDate(entryDate));
    const cleanStudentId = parseCleanIntId(body.id || body.studentId);
    const cleanFyid = sanitizeFyidStr(body.fyid || "");
    const assignedNo = isMigration && body.no ? parseInt(body.no, 10) : await generateFyNo(db, "income", fy);

    if (body.isSplit) {
      const cashAmt = parseFloat(body.cashAmount || 0);
      const bankAmt = parseFloat(body.bankAmount || 0);
      if (cashAmt > 0) {
        const cashNo = assignedNo;
        const cashVrNo = await generateVoucherNo(db, "income", "INC", entryDate);
        const cashUid = `${uniqueid}_CASH`;
        const cashRemark = `[Split - Cash] ${body.remark || ""}`.trim();
        await db.prepare(`INSERT INTO income (no, effect_date, date, fy, student_id, fyid, fyid_name, class, category, account_name, method, debit, credit, aut_amount, promo, my, vr_no, remark, created_by, created_at, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(cashNo, effDate, entryDate, fy, cleanStudentId, cleanFyid, body.fyidName || "", body.class || "", body.category || "Boarder", body.accountName || "Registration", "Cash", 0, cashAmt, parseFloat(body.autAmount || 0), body.promo || "", my, cashVrNo, cashRemark, createdBy, cashUid).run();
        if (!isMigration) {
          await postCashierIndividualLine(db, "Cash", cashAmt, body, entryDate, my, fy, createdBy, `${uniqueid}_CASH`);
        }
      }
      if (bankAmt > 0) {
        const bankNo = isMigration ? assignedNo : await generateFyNo(db, "income", fy);
        const bankVrNo = await generateVoucherNo(db, "income", "INC", entryDate);
        const bankUid = `${uniqueid}_BANK`;
        const bankRemark = `[Split - Bank] ${body.remark || ""}`.trim();
        await db.prepare(`INSERT INTO income (no, effect_date, date, fy, student_id, fyid, fyid_name, class, category, account_name, method, debit, credit, aut_amount, promo, my, vr_no, remark, created_by, created_at, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(bankNo, effDate, entryDate, fy, cleanStudentId, cleanFyid, body.fyidName || "", body.class || "", body.category || "Boarder", body.accountName || "Registration", "Bank", 0, bankAmt, 0, body.promo || "", my, bankVrNo, bankRemark, createdBy, bankUid).run();
        if (!isMigration) {
          await postCashierIndividualLine(db, "Bank", bankAmt, body, entryDate, my, fy, createdBy, `${uniqueid}_BANK`);
        }
      }
    } else {
      const vrNo = body.vrNo || await generateVoucherNo(db, "income", "INC", entryDate);
      const debit = parseFloat(body.debit || 0);
      const credit = parseFloat(body.credit || 0);
      await db.prepare(`INSERT INTO income (no, effect_date, date, fy, student_id, fyid, fyid_name, class, category, account_name, method, debit, credit, aut_amount, promo, my, vr_no, remark, created_by, created_at, uniqueid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(assignedNo, effDate, entryDate, fy, cleanStudentId, cleanFyid, body.fyidName || "", body.class || "", body.category || "Boarder", body.accountName || "Registration", body.method || "Cash", debit, credit, parseFloat(body.autAmount || 0), body.promo || "", my, vrNo, body.remark || "", createdBy, uniqueid).run();
      const netAmount = credit - debit;
      if (!isMigration && netAmount > 0) {
        await postCashierIndividualLine(db, body.method || "Cash", netAmount, body, entryDate, my, fy, createdBy, uniqueid);
      }
    }

    if (isMigration) return { success: true, message: "Record saved directly.", uniqueId: uniqueid };

    // Linked Refund Auto Entries (Fixing ON CONFLICT)
    const method = String(body.method || "Cash").toLowerCase();
    const debitAmt = parseFloat(body.debit || 0);
    if (debitAmt > 0) {
      const refundTable = method === "bank" ? "bank" : "cash";
      const refundPrefix = method === "bank" ? "BNK" : "CAH";
      const caTable = method === "bank" ? "ca_bank" : "ca_cash";
      const caPrefix = method === "bank" ? "CAB" : "CAC";
      const refundDesc = buildStudentDetailedDesc(body, "Student Refund");
      const mainRefUid = `INCMAIN_REFUND_${uniqueid}`;
      const caRefUid = `INCCASHIER_REFUND_${uniqueid}`;

      const exMain = await db.prepare(`SELECT id FROM ${refundTable} WHERE uniqueid = ?`).bind(mainRefUid).first();
      if (exMain) {
        await db.prepare(`UPDATE ${refundTable} SET date=?, description=?, credit=?, my=?, fy=? WHERE uniqueid=?`).bind(entryDate, refundDesc, debitAmt, my, fy, mainRefUid).run();
      } else {
        const mainVrNo = await generateVoucherNo(db, refundTable, refundPrefix, entryDate);
        const mainNo = await generateFyNo(db, refundTable, fy);
        await db.prepare(`INSERT INTO ${refundTable} (no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, 'Student Refund', ?, ?, 0, ?, 0, '', ?, ?, ?, 'Main Income Book', ?, datetime('now'), ?)`).bind(mainNo, entryDate, refundDesc, body.method || "Cash", debitAmt, mainVrNo, my, fy, createdBy, mainRefUid).run();
      }

      const exCa = await db.prepare(`SELECT id FROM ${caTable} WHERE uniqueid = ?`).bind(caRefUid).first();
      if (exCa) {
        await db.prepare(`UPDATE ${caTable} SET date=?, responsibility_person=?, description=?, credit=?, my=?, fy=? WHERE uniqueid=?`).bind(entryDate, createdBy || "Cashier", refundDesc, debitAmt, my, fy, caRefUid).run();
      } else {
        const caVrNo = await generateVoucherNo(db, caTable, caPrefix, entryDate);
        const caNo = await generateFyNo(db, caTable, fy);
        await db.prepare(`INSERT INTO ${caTable} (no, date, responsibility_person, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid) VALUES (?, ?, ?, 'Student Refund', ?, ?, 0, ?, 0, '', ?, ?, ?, 'Main Income Book', ?, datetime('now'), ?)`).bind(caNo, entryDate, createdBy || "Cashier", refundDesc, body.method || "Cash", debitAmt, caVrNo, my, fy, createdBy, caRefUid).run();
      }

      await executeAutoRecalculateAll(db, { tableName: refundTable });
      await executeAutoRecalculateAll(db, { tableName: caTable });
    }

    await syncDailyIncomeRollupForDate(db, entryDate, fy, createdBy);
    return { success: true, message: "Record saved successfully.", uniqueId: uniqueid };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(saveIncomeEntry, "saveIncomeEntry");

async function updateIncomeEntry(db, session, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID missing." };
    const existing = await db.prepare(`SELECT * FROM income WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) return { success: false, message: "Record not found." };
    
    const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) || String(uniqueid).startsWith("INCMAIN_") || String(uniqueid).startsWith("INCCASHIER_") || String(uniqueid).startsWith("DAILY_INC_");
    const isPrivilegedAdmin = ["Owner", "Admin", "Finance", "Accountant"].includes(session?.role || "");
    if (isAutoLocked && !isPrivilegedAdmin) return { success: false, message: "Locked record." };

    const oldDate = existing?.date || null;
    const oldFy = existing?.fy || null;

    const uids = [uniqueid, `${uniqueid}_CASH`, `${uniqueid}_BANK`, `INCMAIN_${uniqueid}`, `INCMAIN_${uniqueid}_CASH`, `INCMAIN_${uniqueid}_BANK`, `INCMAIN_REFUND_${uniqueid}`, `INCCASHIER_${uniqueid}`, `INCCASHIER_${uniqueid}_CASH`, `INCCASHIER_${uniqueid}_BANK`, `INCCASHIER_REFUND_${uniqueid}`];
    const placeholders = uids.map(() => "?").join(", ");
    await db.prepare(`DELETE FROM income WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
    await db.prepare(`DELETE FROM cash WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
    await db.prepare(`DELETE FROM bank WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
    await db.prepare(`DELETE FROM ca_cash WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
    await db.prepare(`DELETE FROM ca_bank WHERE uniqueid IN (${placeholders})`).bind(...uids).run();

    const res = await saveIncomeEntry(db, session, { ...body, uniqueId: uniqueid, skipAutoPost: false });
    
    await executeAutoRecalculateAll(db, { tableName: "ca_cash" });
    await executeAutoRecalculateAll(db, { tableName: "ca_bank" });

    const entryDate = getMyanmarDateString(body.date);
    if (oldDate && oldDate !== entryDate) {
      await syncDailyIncomeRollupForDate(db, oldDate, oldFy || body.fy, session?.name || "Admin");
    }
    return res;
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(updateIncomeEntry, "updateIncomeEntry");

async function deleteIncomeEntry(db, session, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) return { success: false, message: "Unique ID missing." };
    const existing = await db.prepare(`SELECT * FROM income WHERE uniqueid = ?`).bind(uniqueid).first();
    if (existing) {
      const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) || String(uniqueid).startsWith("INCMAIN_") || String(uniqueid).startsWith("INCCASHIER_") || String(uniqueid).startsWith("DAILY_INC_");
      const isPrivilegedAdmin = ["Owner", "Admin", "Finance", "Accountant"].includes(session?.role || "");
      if (isAutoLocked && !isPrivilegedAdmin) return { success: false, message: "Locked record." };
    }
    const entryDate = existing?.date || null;
    const fy = existing?.fy ? normalizeFyClean(existing.fy) : null;
    
    const uids = [uniqueid, `${uniqueid}_CASH`, `${uniqueid}_BANK`, `INCMAIN_${uniqueid}`, `INCMAIN_${uniqueid}_CASH`, `INCMAIN_${uniqueid}_BANK`, `INCMAIN_REFUND_${uniqueid}`, `INCCASHIER_${uniqueid}`, `INCCASHIER_${uniqueid}_CASH`, `INCCASHIER_${uniqueid}_BANK`, `INCCASHIER_REFUND_${uniqueid}`];
    const placeholders = uids.map(() => "?").join(", ");
    await db.prepare(`DELETE FROM income WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
    await db.prepare(`DELETE FROM cash WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
    await db.prepare(`DELETE FROM bank WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
    await db.prepare(`DELETE FROM ca_cash WHERE uniqueid IN (${placeholders})`).bind(...uids).run();
    await db.prepare(`DELETE FROM ca_bank WHERE uniqueid IN (${placeholders})`).bind(...uids).run();

    await executeAutoRecalculateAll(db, { tableName: "ca_cash" });
    await executeAutoRecalculateAll(db, { tableName: "ca_bank" });

    if (entryDate) await syncDailyIncomeRollupForDate(db, entryDate, fy, session?.name || "Admin");
    return { success: true, message: "Record deleted." };
  } catch (err) {
    return { success: false, message: err.message };
  }
}
__name(deleteIncomeEntry, "deleteIncomeEntry");

// ==============================================================================
// 💡 MAIN FETCH ROUTER (CLOUDFLARE WORKER EXPORT)
// ==============================================================================

export default {
  async fetch(request, env, ctx) {
    const requestOrigin = request.headers.get("Origin") || "";
    const allowedList = String(env.ALLOWED_ORIGIN || "*").split(",").map((s) => s.trim()).filter(Boolean);
    const isAllowed = allowedList.includes("*") || allowedList.includes(requestOrigin);
    const resolvedOrigin = isAllowed ? requestOrigin || allowedList[0] || "*" : allowedList[0];
    const corsHeaders = {
      "Access-Control-Allow-Origin": resolvedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, token, authToken, role",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json"
    };

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    try {
      const db = env.DB || env.school_db;
      if (!db) return new Response(JSON.stringify({ success: false, message: "D1 Database binding missing." }), { status: 500, headers: corsHeaders });
      
      const authSecret = env.AUTH_SECRET;
      if (!authSecret) return new Response(JSON.stringify({ success: false, message: "AUTH_SECRET missing." }), { status: 500, headers: corsHeaders });

      let body = {};
      let action = "";
      if (request.method === "GET") {
        const url = new URL(request.url);
        action = url.searchParams.get("action") || "";
        for (const [key, value] of url.searchParams.entries()) body[key] = value;
      } else {
        try {
          body = await request.json();
          if (typeof body.action === "object" && body.action !== null) {
            const innerAction = body.action.action || "";
            body = { ...body.action, ...body, action: innerAction };
          }
          action = typeof body.action === "string" ? body.action : "";
        } catch (e) { body = {}; }
      }

      if (request.method !== "GET" && typeof validateLedgerInput === "function") {
        const validation = validateLedgerInput(body);
        if (!validation.success) return new Response(JSON.stringify(validation), { status: 400, headers: corsHeaders });
      }

      const PUBLIC_ACTIONS = ["checkLogin"];
      let userSession = null;
      if (!PUBLIC_ACTIONS.includes(action)) {
        const authHeader = request.headers.get("Authorization") || "";
        const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : "";
        const tokenToVerify = tokenFromHeader || body.token || body.authToken || "";
        userSession = await verifyJwtToken(tokenToVerify, authSecret);
        if (!userSession) return new Response(JSON.stringify({ success: false, message: "Session expired. Please login again." }), { status: 401, headers: corsHeaders });
      }

      let result = null;
      switch (action) {
        case "checkLogin": {
          const username = String(body.username || "").trim();
          const password = String(body.password || "").trim();
          const lockoutStatus = await checkLoginLockout(db, username.toLowerCase());
          if (lockoutStatus.locked) {
            await writeAuditLog(db, username, "loginBlocked", body);
            return new Response(JSON.stringify({ success: false, message: `Account locked. Try again in ${lockoutStatus.remainingMinutes} minutes.` }), { status: 429, headers: corsHeaders });
          }
          const user = await db.prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?)").bind(username).first();
          if (user) {
            const { ok, needsRehash } = await verifyPassword(password, user.password_hash);
            if (ok) {
              if (needsRehash) {
                try {
                  const newHash = await hashPassword(password);
                  await db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").bind(newHash, user.username).run();
                } catch (e) {}
              }
              await resetLoginAttempts(db, user.username.toLowerCase());
              await writeAuditLog(db, user, "loginSuccess", { username: user.username, role: user.role });
              const token = await createJwtToken({ username: user.username, role: user.role, name: user.name || user.username }, authSecret);
              return new Response(JSON.stringify({ success: true, token, user: { username: user.username, role: user.role, name: user.name || user.username } }), { headers: corsHeaders });
            }
          }
          const gotLocked = await recordLoginFailure(db, username.toLowerCase());
          await writeAuditLog(db, username, "loginFailed", { username }, gotLocked ? "Account Locked" : "Invalid Credentials");
          return new Response(JSON.stringify({ success: false, message: "Invalid username or password." }), { headers: corsHeaders });
        }
        case "getDashboardData": result = await getDashboardData(db, body); break;
        case "getBankCashData":
        case "getCashierData":
        case "getExpenseData":
          if (!can(userSession, "ledger_read") && !can(userSession, "cashier_read")) return forbidden(corsHeaders);
          result = await getGenericLedgerData(db, body); break;
        case "saveBankCashEntry":
        case "saveExpenseEntry":
        case "saveCashierEntry":
        case "updatePayrollEntry":
          if (!can(userSession, "ledger_write") && !can(userSession, "cashier_write")) return forbidden(corsHeaders);
          result = await saveGenericLedgerEntry(db, userSession, body); break;
        case "updateBankCashEntry":
        case "updateExpenseEntry":
        case "updateCashierEntry":
          if (!can(userSession, "ledger_write") && !can(userSession, "cashier_write")) return forbidden(corsHeaders);
          result = await updateGenericLedgerEntry(db, userSession, body); break;
        case "deleteBankCashEntry":
        case "deleteExpenseEntry":
        case "deleteCashierEntry":
        case "deletePayrollEntry":
        case "deleteLedgerEntry":
          if (!can(userSession, "ledger_write") && !can(userSession, "cashier_write")) return forbidden(corsHeaders);
          result = await deleteGenericLedgerEntry(db, userSession, body); break;
        case "getIncomeData":
          if (!can(userSession, "ledger_read") && !can(userSession, "cashier_read")) return forbidden(corsHeaders);
          result = await getIncomeData(db, body); break;
        case "saveIncomeEntry":
          if (!can(userSession, "ledger_write") && !can(userSession, "cashier_write")) return forbidden(corsHeaders);
          result = await saveIncomeEntry(db, userSession, body); break;
        case "updateIncomeEntry":
          if (!can(userSession, "ledger_write")) return forbidden(corsHeaders);
          result = await updateIncomeEntry(db, userSession, body); break;
        case "deleteIncomeEntry":
          if (!can(userSession, "ledger_write")) return forbidden(corsHeaders);
          result = await deleteIncomeEntry(db, userSession, body); break;
        case "getStudentMoneyData":
        case "getStudentMoneySummary":
          if (!can(userSession, "ledger_read") && !can(userSession, "student_read")) return forbidden(corsHeaders);
          result = action === "getStudentMoneySummary" ? await getStudentMoneySummary(db, body) : await getStudentMoneyData(db, body); break;
        case "saveStudentMoneyEntry":
          if (!can(userSession, "ledger_write") && !can(userSession, "cashier_write")) return forbidden(corsHeaders);
          result = await saveStudentMoneyEntry(db, userSession, body); break;
        case "updateStudentMoneyEntry":
          if (!can(userSession, "ledger_write")) return forbidden(corsHeaders);
          result = await updateStudentMoneyEntry(db, userSession, body); break;
        case "deleteStudentMoneyEntry":
          if (!can(userSession, "ledger_write")) return forbidden(corsHeaders);
          result = await deleteStudentMoneyEntry(db, userSession, body); break;
        case "getStudentData":
        case "lookupStudentById":
          if (!can(userSession, "student_read")) return forbidden(corsHeaders);
          result = action === "lookupStudentById" ? await lookupStudentById(db, body) : await getStudentData(db, body); break;
        case "saveStudentEntry":
          if (!can(userSession, "student_write")) return forbidden(corsHeaders);
          result = await saveStudentEntry(db, userSession, body); break;
        case "updateStudentEntry":
          if (!can(userSession, "student_write")) return forbidden(corsHeaders);
          result = await updateStudentEntry(db, userSession, body); break;
        case "deleteStudentEntry":
          if (!can(userSession, "student_write")) return forbidden(corsHeaders);
          result = await deleteStudentEntry(db, userSession, body); break;
        case "getStaffData":
          if (!can(userSession, "staff_read")) return forbidden(corsHeaders);
          result = await getStaffData(db, body, userSession); break;
        case "saveStaffEntry":
          if (!can(userSession, "staff_write")) return forbidden(corsHeaders);
          result = await saveStaffEntry(db, userSession, body); break;
        case "updateStaffEntry":
          if (!can(userSession, "staff_write")) return forbidden(corsHeaders);
          result = await updateStaffEntry(db, userSession, body); break;
        case "deleteStaffEntry":
          if (!can(userSession, "staff_write")) return forbidden(corsHeaders);
          result = await deleteStaffEntry(db, userSession, body); break;
        case "saveHrPayrollForm":
          if (!can(userSession, "staff_write") && !can(userSession, "ledger_write")) return forbidden(corsHeaders);
          result = await saveHrPayrollForm(db, userSession, body); break;
        case "getPayrollSettings":
          result = await getPayrollSettings(db, body); break;
        case "updatePayrollSettings":
          if (!can(userSession, "grade_matrix")) return forbidden(corsHeaders);
          result = await updatePayrollSettings(db, userSession, body); break;
        case "getUniformData":
          if (!can(userSession, "uniform_read")) return forbidden(corsHeaders);
          result = await getUniformData(db, body); break;
        case "saveUniformEntry":
          if (!can(userSession, "uniform_write")) return forbidden(corsHeaders);
          result = await saveUniformEntry(db, userSession, body); break;
        case "updateUniformEntry":
          if (!can(userSession, "uniform_write")) return forbidden(corsHeaders);
          result = await updateUniformEntry(db, userSession, body); break;
        case "deleteUniformEntry":
          if (!can(userSession, "uniform_write")) return forbidden(corsHeaders);
          result = await deleteUniformEntry(db, userSession, body); break;
        case "getPromotionData":
          if (!can(userSession, "promo_read")) return forbidden(corsHeaders);
          result = await getPromotionData(db, body); break;
        case "savePromotionEntry":
          if (!can(userSession, "promo_write")) return forbidden(corsHeaders);
          result = await savePromotionEntry(db, userSession, body); break;
        case "updatePromotionEntry":
          if (!can(userSession, "promo_write")) return forbidden(corsHeaders);
          result = await updatePromotionEntry(db, userSession, body); break;
        case "deletePromotionEntry":
          if (!can(userSession, "promo_write")) return forbidden(corsHeaders);
          result = await deletePromotionEntry(db, userSession, body); break;
        case "getFinancialReportData":
        case "getIncomeDetailReportData":
        case "getMonthlyIncomeReportData":
        case "getStudentReportDetails":
        case "getFundReportData":
          if (!can(userSession, "report_read")) return forbidden(corsHeaders);
          if (action === "getFinancialReportData") result = await getFinancialReportData(db, body);
          else if (action === "getIncomeDetailReportData") result = await getIncomeDetailReportData(db, body);
          else if (action === "getMonthlyIncomeReportData") result = await getMonthlyIncomeReportData(db, body);
          else if (action === "getStudentReportDetails") result = await getStudentReportDetails(db, body);
          else if (action === "getFundReportData") result = await getFundReportData(db, body);
          break;
        case "getSettingsData":
          result = await getSettingsData(db, body); break;
        case "exportBookDataByFy":
        case "exportGroupDataByFy":
          if (!can(userSession, "backup_dispatch")) return forbidden(corsHeaders);
          result = await exportGroupDataByFy(db, body); break;
        case "sendEmailBackupByFy":
        case "sendGroupEmailBackupByFy":
          if (!can(userSession, "backup_dispatch")) return forbidden(corsHeaders);
          result = await sendGroupEmailBackupByFy(db, userSession, body, env); break;
        case "recalculateAllBalances":
        case "recalculateLedgerBalances":
          if (!can(userSession, "settings_write") && !can(userSession, "ledger_write")) return forbidden(corsHeaders);
          result = await executeAutoRecalculateAll(db, body); break;
        default:
          return new Response(JSON.stringify({ success: false, message: `Action '${action}' is not supported.` }), { headers: corsHeaders });
      }

      const isMutatingAction = /^(save|update|delete|export|send|recalculate)/i.test(action);
      if (isMutatingAction && result && result.success !== false && userSession) {
        if (ctx && typeof ctx.waitUntil === "function") {
          ctx.waitUntil(writeAuditLog(db, userSession, action, body, body.uniqueId || body.uniqueid || body.id || null));
        } else {
          await writeAuditLog(db, userSession, action, body, body.uniqueId || body.uniqueid || body.id || null);
        }
      }
      return new Response(JSON.stringify(result || { success: true }), { headers: corsHeaders });
    } catch (err) {
      console.error("Worker Execution Catch:", err);
      const errorMessage = env.ENVIRONMENT === "development" || env.ENVIRONMENT === "dev" ? `Server Error: ${err.message}` : "An internal server error occurred.";
      return new Response(JSON.stringify({ success: false, message: errorMessage }), { status: 500, headers: corsHeaders });
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
