/**
 * GOLDEN ERP SYSTEM - HR PAYROLL & STAFF D1 SQL HANDLER MODULE
 * File: handlers-payroll-staff.js 
 * 💡 Features: PII & Salary Data Protection (Role-Based Redaction including uniqueid),
 *              Privilege Escalation Defense (Server-Generated UUIDs for new records),
 *              Fund Date Calculation (Join Date + 3 Years), Bonus/Fund Accrual & Payout Deduction Engine,
 *              Date-Based VR No (SAL-080826-001), FY Integer NO Reset & Grade Matrix Upsert
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
 * 💡 Calculate Fund Date (Join Date + 3 Years)
 */
function calculateFundDate(joinDateStr) {
  if (!joinDateStr) return '';
  const d = new Date(joinDateStr);
  if (isNaN(d.getTime())) return '';
  d.setFullYear(d.getFullYear() + 3);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * 💡 Cloudflare D1 Batch Running Balance & Integer NO Recalculation Engine for Payroll
 */
async function recalculateLedgerBalances(db, tableName) {
  if (!tableName) return;
  try {
    const fysRes = await db.prepare(`SELECT DISTINCT fy FROM ${tableName}`).all();
    const rawFys = (fysRes.results || []).map(r => normalizeFyStr(r.fy)).filter(Boolean);
    const fys = Array.from(new Set(rawFys));

    if (fys.length === 0) {
      fys.push('FY 2026-2027');
    }

    const statements = [];

    for (const fyVal of fys) {
      const rows = await db.prepare(
        `SELECT id, debit, credit FROM ${tableName} WHERE fy = ? OR fy = ? ORDER BY date ASC, id ASC`
      ).bind(fyVal, fyVal.replace(/^FY\s*/i, '')).all();

      const list = rows.results || [];
      let currentBal = 0;
      let seqNo = 1;

      for (const row of list) {
        const debit = parseFloat(row.debit || 0);
        const credit = parseFloat(row.credit || 0);
        currentBal = currentBal + debit - credit;

        statements.push(
          db.prepare(`UPDATE ${tableName} SET balances = ?, no = ?, fy = ? WHERE id = ?`).bind(currentBal, seqNo, fyVal, row.id)
        );
        seqNo++;
      }
    }

    const chunkSize = 100;
    for (let i = 0; i < statements.length; i += chunkSize) {
      const chunk = statements.slice(i, i + chunkSize);
      await db.batch(chunk);
    }
  } catch (e) {
    console.warn(`Running Balance & NO Recalculation Warning for ${tableName}:`, e);
  }
}

/**
 * 💡 Date-Based Voucher Number Generator (Format: SAL-080826-001)
 */
async function generateVoucherNo(db, tableName, prefix, entryDate) {
  let ddmmyy = "";
  const parts = String(entryDate || '').split('-');
  if (parts.length === 3) {
    const y = parts[0].slice(-2);
    ddmmyy = `${parts[2]}${parts[1]}${y}`;
  } else {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yy = String(now.getFullYear()).slice(-2);
    ddmmyy = `${dd}${mm}${yy}`;
  }

  const pattern = `${prefix}-${ddmmyy}-%`;
  const countRow = await db.prepare(
    `SELECT COUNT(*) as cnt FROM ${tableName} WHERE vr_no LIKE ? OR date = ?`
  ).bind(pattern, entryDate).first();

  const seq = (countRow ? parseInt(countRow.cnt, 10) : 0) + 1;
  return `${prefix}-${ddmmyy}-${String(seq).padStart(3, '0')}`;
}

/**
 * 💡 FY-Based Integer NO Generator
 */
async function generateFyNo(db, tableName, fy) {
  const normFy = normalizeFyStr(fy);
  const lastNoRow = await db.prepare(
    `SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM ${tableName} WHERE fy = ? OR fy = ?`
  ).bind(normFy, normFy.replace(/^FY\s*/i, '')).first();
  return (lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0) + 1;
}

/**
 * 💡 Get Staff Data & Compute KPI Stats (With Role-Based PII & Salary Data Protection)
 */
export async function getStaffData(db, body, userSession) {
  try {
    const isPartTime = String(body.category || '').toLowerCase().includes('part');
    const table = isPartTime ? 'staff_parttime' : 'staff_fulltime';
    const searchVal = String(body.searchVal || '').trim();

    let whereClauses = [];
    let params = [];

    if (searchVal) {
      whereClauses.push(`(name LIKE ? OR staff_idname LIKE ? OR CAST(staff_id AS TEXT) LIKE ? OR position LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM ${table} ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    const rows = await db.prepare(`SELECT * FROM ${table} ${whereSql} ORDER BY id DESC LIMIT 1000`).bind(...params).all();
    const rawStaffList = rows.results || [];

    // 💡 1. ROLE-BASED PII ACCESS CHECK
    const role = userSession?.role || 'Viewer';
    const canSeeSensitive = ['Owner', 'Admin', 'Finance', 'HR', 'HR Staff', 'HRStaff', 'Accountant'].includes(role);

    let activeCount = 0;
    let maleCount = 0;
    let femaleCount = 0;
    let totalNetAmt = 0;

    const staffList = rawStaffList.map(item => {
      const isAct = (item.status || 'Active') === 'Active';
      if (isAct) activeCount++;

      const gender = (item.gender || 'Male').toLowerCase();
      if (gender === 'male' || gender === 'ကျား') maleCount++;
      else if (gender === 'female' || gender === 'မ') femaleCount++;

      const rowNet = Number(item.total_net_amt ?? item.totalNetAmt ?? item.total_salary ?? item.totalSalary ?? 0);
      totalNetAmt += rowNet;

      // 🛡️ Redact sensitive financial, personal & ID fields for unauthorized roles (Staff, Viewer, Cashier)
      if (!canSeeSensitive) {
        return {
          id: item.id,
          no: item.no,
          joinDate: item.join_date || item.joinDate || '',
          category: item.category || '',
          staffId: item.staff_id || item.staffId || '',
          name: item.name || '',
          staffIdName: item.staff_idname || item.staffIdName || '',
          education: item.education || '',
          position: item.position || '',
          status: item.status || 'Active',
          gender: item.gender || 'Male',
          phoneNo: item.phone_no || item.phoneNo || '',
          email: item.email || '',
          salaryGrade: '***',
          workingDays: 0,
          basicAmt: 0,
          extraAmt: 0,
          totalSalary: 0,
          bonus: 0,
          fund: 0,
          totalNetAmt: 0,
          resignedDate: '',
          nrcNo: '***',
          bankAccount: '***',
          fundDate: '',
          unpaidBonus: 0,
          unpaidFund: 0,
          uniqueId: '***' // 🛡️ Internal ID Redacted to prevent IDOR probing
        };
      }

      return {
        id: item.id,
        no: item.no,
        joinDate: item.join_date || item.joinDate || '',
        category: item.category || '',
        staffId: item.staff_id || item.staffId || '',
        name: item.name || '',
        staffIdName: item.staff_idname || item.staffIdName || '',
        education: item.education || '',
        position: item.position || '',
        salaryGrade: item.salary_grade || item.salaryGrade || '',
        workingDays: parseFloat(item.working_days !== undefined ? item.working_days : (item.workingDays || 26)),
        basicAmt: parseFloat(item.basic_amt !== undefined ? item.basic_amt : (item.basicAmt || 0)),
        extraAmt: parseFloat(item.extra_amt !== undefined ? item.extra_amt : (item.extraAmt || 0)),
        totalSalary: parseFloat(item.total_salary !== undefined ? item.total_salary : (item.totalSalary || 0)),
        bonus: parseFloat(item.bonus || 0),
        fund: parseFloat(item.fund || 0),
        totalNetAmt: parseFloat(item.total_net_amt !== undefined ? item.total_net_amt : (item.totalNetAmt || 0)),
        resignedDate: item.resigned_date || item.resignedDate || '',
        status: item.status || 'Active',
        gender: item.gender || 'Male',
        nrcNo: item.nrc_no || item.nrcNo || '',
        bankAccount: item.bank_account || item.bankAccount || '',
        phoneNo: item.phone_no || item.phoneNo || '',
        email: item.email || '',
        fundDate: item.fund_date || item.fundDate || '',
        unpaidBonus: parseFloat(item.unpaid_bonus !== undefined ? item.unpaid_bonus : (item.unpaidBonus || 0)),
        unpaidFund: parseFloat(item.unpaid_fund !== undefined ? item.unpaid_fund : (item.unpaidFund || 0)),
        uniqueId: item.uniqueid || item.uniqueId || `STF_${item.id}`
      };
    });

    return {
      success: true,
      data: staffList,
      totalRows: totalRows,
      stats: {
        activeCount,
        totalNetAmt: canSeeSensitive ? totalNetAmt : 0,
        maleCount,
        femaleCount
      }
    };
  } catch (err) {
    console.error("Error in getStaffData handler:", err);
    return { success: false, message: "Staff စာရင်း ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Save Staff Record (Protected against Privilege Escalation / Server-Generated UUIDs)
 */
export async function saveStaffEntry(db, userSession, body) {
  try {
    const isPartTime = String(body.category || '').toLowerCase().includes('part');
    const table = isPartTime ? 'staff_parttime' : 'staff_fulltime';
    const prefix = isPartTime ? 'PID' : 'FID';

    // 🔒 1. PRIVILEGE ESCALATION DEFENSE: Server-generated UUID only for new records
    // Client-provided uniqueId is strictly ignored for normal creation to prevent overwriting existing records
    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(userSession?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport);

    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : `STF_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    let staffIdNum = parseInt(body.staffId || body.id, 10);
    if (!staffIdNum || isNaN(staffIdNum)) {
      const maxRow = await db.prepare(`SELECT MAX(CAST(staff_id AS INTEGER)) as max_id FROM ${table}`).first();
      const currentMax = maxRow && maxRow.max_id ? parseInt(maxRow.max_id, 10) : 0;
      staffIdNum = currentMax + 1;
    }

    const paddedId = String(staffIdNum).padStart(3, '0');
    const staffName = body.name || '';
    const staffIdName = `[${prefix} ${paddedId}] ${staffName}`;

    const joinDateVal = body.joinDate || new Date().toISOString().split('T')[0];
    const computedFundDate = body.fundDate || calculateFundDate(joinDateVal);

    const assignedNo = (isMigration && body.no) ? parseInt(body.no, 10) : staffIdNum;

    // 🔒 2. SAFE INSERTION: Use INSERT INTO (or INSERT OR REPLACE ONLY for authenticated Admin migration)
    const sqlInsertVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";

    if (isPartTime) {
      await db.prepare(`${sqlInsertVerb} staff_parttime (
        no, join_date, category, staff_id, name, staff_idname, education, position,
        total_salary, total_net_amt, resigned_date, status, gender, nrc_no,
        bank_account, phone_no, email, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(
        assignedNo, joinDateVal, 'Part Time', staffIdNum, staffName, staffIdName,
        body.education || '', body.position || '', parseFloat(body.totalSalary || 0), parseFloat(body.totalNetAmt || 0),
        body.resignedDate || '', body.status || 'Active', body.gender || 'Male', body.nrcNo || '', body.bankAccount || '',
        body.phoneNo || '', body.email || '', userSession?.name || 'Admin', uniqueid
      ).run();
    } else {
      await db.prepare(`${sqlInsertVerb} staff_fulltime (
        no, join_date, category, staff_id, name, staff_idname, education, position,
        salary_grade, working_days, basic_amt, extra_amt, total_salary, bonus, fund,
        total_net_amt, resigned_date, status, gender, nrc_no, bank_account, phone_no,
        email, fund_date, unpaid_bonus, unpaid_fund, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`).bind(
        assignedNo, joinDateVal, 'Full Time', staffIdNum, staffName, staffIdName,
        body.education || '', body.position || '', body.salaryGrade || '', parseFloat(body.workingDays || 26),
        parseFloat(body.basicAmt || 0), parseFloat(body.extraAmt || 0), parseFloat(body.totalSalary || 0),
        parseFloat(body.bonus || 0), parseFloat(body.fund || 0), parseFloat(body.totalNetAmt || 0),
        body.resignedDate || '', body.status || 'Active', body.gender || 'Male', body.nrcNo || '', body.bankAccount || '',
        body.phoneNo || '', body.email || '', computedFundDate, parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0),
        userSession?.name || 'Admin', uniqueid
      ).run();
    }

    return { 
      success: true, 
      message: "ဝန်ထမ်း မှတ်တမ်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။", 
      staffId: staffIdNum, 
      staffIdName, 
      uniqueId: uniqueid 
    };
  } catch (err) {
    console.error("Error in saveStaffEntry handler:", err);
    return { success: false, message: "ဝန်ထမ်း မှတ်တမ်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Update Staff Record (Strict Permission Guarded)
 */
export async function updateStaffEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const isPartTime = String(body.category || '').toLowerCase().includes('part');
    const table = isPartTime ? 'staff_parttime' : 'staff_fulltime';
    const prefix = isPartTime ? 'PID' : 'FID';

    // Verify existing record
    const existing = await db.prepare(`SELECT id, staff_id FROM ${table} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) {
      return { success: false, message: "ပြင်ဆင်မည့် ဝန်ထမ်းမှတ်တမ်း ရှာမတွေ့ပါ။" };
    }

    const staffIdNum = parseInt(body.staffId || body.id, 10) || existing.staff_id || 1;
    const paddedId = String(staffIdNum).padStart(3, '0');
    const staffName = body.name || '';
    const staffIdName = `[${prefix} ${paddedId}] ${staffName}`;

    const joinDateVal = body.joinDate || new Date().toISOString().split('T')[0];
    const computedFundDate = body.fundDate || calculateFundDate(joinDateVal);

    if (isPartTime) {
      await db.prepare(`UPDATE staff_parttime SET
        join_date = ?, category = ?, staff_id = ?, name = ?, staff_idname = ?,
        education = ?, position = ?, total_salary = ?, total_net_amt = ?,
        resigned_date = ?, status = ?, gender = ?, nrc_no = ?, bank_account = ?,
        phone_no = ?, email = ?
        WHERE uniqueid = ?`).bind(
        joinDateVal, 'Part Time', staffIdNum, staffName, staffIdName,
        body.education || '', body.position || '', parseFloat(body.totalSalary || 0), parseFloat(body.totalNetAmt || 0),
        body.resignedDate || '', body.status || 'Active', body.gender || 'Male', body.nrcNo || '', body.bankAccount || '',
        body.phoneNo || '', body.email || '', uniqueid
      ).run();
    } else {
      await db.prepare(`UPDATE staff_fulltime SET
        join_date = ?, category = ?, staff_id = ?, name = ?, staff_idname = ?,
        education = ?, position = ?, salary_grade = ?, working_days = ?,
        basic_amt = ?, extra_amt = ?, total_salary = ?, bonus = ?, fund = ?,
        total_net_amt = ?, resigned_date = ?, status = ?, gender = ?, nrc_no = ?,
        bank_account = ?, phone_no = ?, email = ?, fund_date = ?, unpaid_bonus = ?, unpaid_fund = ?
        WHERE uniqueid = ?`).bind(
        joinDateVal, 'Full Time', staffIdNum, staffName, staffIdName,
        body.education || '', body.position || '', body.salaryGrade || '', parseFloat(body.workingDays || 26),
        parseFloat(body.basicAmt || 0), parseFloat(body.extraAmt || 0), parseFloat(body.totalSalary || 0),
        parseFloat(body.bonus || 0), parseFloat(body.fund || 0), parseFloat(body.totalNetAmt || 0),
        body.resignedDate || '', body.status || 'Active', body.gender || 'Male', body.nrcNo || '', body.bankAccount || '',
        body.phoneNo || '', body.email || '', computedFundDate, parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0),
        uniqueid
      ).run();
    }

    return { success: true, message: "ဝန်ထမ်း မှတ်တမ်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in updateStaffEntry handler:", err);
    return { success: false, message: "ဝန်ထမ်း မှတ်တမ်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Delete Staff Entry
 */
export async function deleteStaffEntry(db, userSession, body) {
  try {
    const isPartTime = String(body.category || '').toLowerCase().includes('part');
    const table = isPartTime ? 'staff_parttime' : 'staff_fulltime';
    await db.prepare(`DELETE FROM ${table} WHERE uniqueid = ?`).bind(body.uniqueId || body.uniqueid).run();
    return { success: true, message: "ဝန်ထမ်း မှတ်တမ်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in deleteStaffEntry handler:", err);
    return { success: false, message: "ဝန်ထမ်း မှတ်တမ်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Save HR Payroll Entry & Auto Accrue / Deduct Bonus & Fund in staff_fulltime Table
 */
export async function saveHrPayrollForm(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || `SAL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const dateStr = body.date || new Date().toISOString().split('T')[0];
    const category = body.category || 'Full Time Salary';
    const staffIdStr = String(body.staffId || '').trim();

    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dObj = new Date(dateStr);
    const now = new Date();
    const fallbackMY = `${months[now.getMonth()]}-${String(now.getFullYear()).slice(-2)}`;
    const myVal = !isNaN(dObj.getTime()) ? `${months[dObj.getMonth()]}-${String(dObj.getFullYear()).slice(-2)}` : fallbackMY;

    const fy = normalizeFyStr(body.fy || 'FY 2026-2027');

    const vrNoVal = body.vrNo || await generateVoucherNo(db, 'payroll', 'SAL', dateStr);
    const newNo = await generateFyNo(db, 'payroll', fy);

    const debitVal = parseFloat(body.debit || 0);
    const creditVal = parseFloat(body.credit || 0);

    const unpaidBonus = parseFloat(body.unpaidBonus || 0);
    const unpaidFund = parseFloat(body.unpaidFund || 0);

    const stmt = `INSERT OR REPLACE INTO payroll (
      no, date, category, description, method, debit, credit, balances,
      unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name,
      created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`;

    await db.prepare(stmt).bind(
      newNo, dateStr, category, body.description || '', body.method || 'Cash',
      debitVal, creditVal, unpaidBonus, unpaidFund,
      body.transfer || '', vrNoVal, myVal, fy,
      'HR Payroll Exp Book', userSession?.name || 'Admin', uniqueid
    ).run();

    await recalculateLedgerBalances(db, 'payroll');

    // 💡 AUTO-SYNC & DEDUCTION TO staff_fulltime TABLE
    if (staffIdStr) {
      const targetStaffId = parseInt(staffIdStr, 10);
      const staffRow = await db.prepare("SELECT * FROM staff_fulltime WHERE staff_id = ? OR id = ?").bind(targetStaffId, targetStaffId).first();

      if (staffRow) {
        if (category === 'Full Time Salary') {
          const newUnpaidBonus = (parseFloat(staffRow.unpaid_bonus || 0)) + parseFloat(staffRow.bonus || 0);
          const newUnpaidFund = (parseFloat(staffRow.unpaid_fund || 0)) + parseFloat(staffRow.fund || 0);

          await db.prepare(`UPDATE staff_fulltime SET 
            unpaid_bonus = ?, unpaid_fund = ? 
            WHERE id = ?`).bind(newUnpaidBonus, newUnpaidFund, staffRow.id).run();

        } else if (category === 'Full Time Bonus') {
          const currentBonus = parseFloat(staffRow.unpaid_bonus || 0);
          const newUnpaidBonus = Math.max(0, currentBonus - creditVal);

          await db.prepare(`UPDATE staff_fulltime SET 
            unpaid_bonus = ? WHERE id = ?`).bind(newUnpaidBonus, staffRow.id).run();

        } else if (category === 'Full Time Fund') {
          const currentFund = parseFloat(staffRow.unpaid_fund || 0);
          const newUnpaidFund = Math.max(0, currentFund - creditVal);

          await db.prepare(`UPDATE staff_fulltime SET 
            unpaid_fund = ? WHERE id = ?`).bind(newUnpaidFund, staffRow.id).run();
        }
      }
    }

    return { 
      success: true, 
      message: "HR Payroll စာရင်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီး ဝန်ထမ်း Balance အား Update ပြုလုပ်ပြီးပါပြီ။", 
      uniqueId: uniqueid, 
      vrNo: vrNoVal 
    };
  } catch (err) {
    console.error("Error in saveHrPayrollForm handler:", err);
    return { success: false, message: "HR Payroll သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Get Salary Grade Matrix Settings
 */
export async function getPayrollSettings(db, body) {
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
    console.error("Error in getPayrollSettings handler:", err);
    return { success: false, message: "Salary Grade Matrix ရယူ၍ မရပါ: " + err.message };
  }
}

/**
 * 💡 Update Salary Grade Matrix Settings (Safe Upsert)
 */
export async function updatePayrollSettings(db, userSession, body) {
  try {
    const existing = await db.prepare("SELECT id FROM salary_grade_matrix WHERE id = 1").first();

    if (existing) {
      await db.prepare(`UPDATE salary_grade_matrix SET 
        grade_a = ?, grade_b = ?, grade_c = ?, grade_d = ?, grade_e = ?, grade_f = ?, 
        grade_g = ?, grade_h = ?, grade_i = ?, grade_j = ?, grade_k = ?, grade_l = ?, 
        bonus_rate = ?, fund_rate = ?, updated_at = datetime('now') WHERE id = 1`).bind(
        parseFloat(body.gradeA || body['grade-A'] || 0), parseFloat(body.gradeB || body['grade-B'] || 0),
        parseFloat(body.gradeC || body['grade-C'] || 0), parseFloat(body.gradeD || body['grade-D'] || 0),
        parseFloat(body.gradeE || body['grade-E'] || 0), parseFloat(body.gradeF || body['grade-F'] || 0),
        parseFloat(body.gradeG || body['grade-G'] || 0), parseFloat(body.gradeH || body['grade-H'] || 0),
        parseFloat(body.gradeI || body['grade-I'] || 0), parseFloat(body.gradeJ || body['grade-J'] || 0),
        parseFloat(body.gradeK || body['grade-K'] || 0), parseFloat(body.gradeL || body['grade-L'] || 0),
        parseFloat(body.bonusRate || body.bonus || 0), parseFloat(body.fundRate || body.fund || 0.05)
      ).run();
    } else {
      await db.prepare(`INSERT INTO salary_grade_matrix (
        id, grade_a, grade_b, grade_c, grade_d, grade_e, grade_f, grade_g, grade_h, grade_i, grade_j, grade_k, grade_l, 
        bonus_rate, fund_rate, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`).bind(
        parseFloat(body.gradeA || body['grade-A'] || 0), parseFloat(body.gradeB || body['grade-B'] || 0),
        parseFloat(body.gradeC || body['grade-C'] || 0), parseFloat(body.gradeD || body['grade-D'] || 0),
        parseFloat(body.gradeE || body['grade-E'] || 0), parseFloat(body.gradeF || body['grade-F'] || 0),
        parseFloat(body.gradeG || body['grade-G'] || 0), parseFloat(body.gradeH || body['grade-H'] || 0),
        parseFloat(body.gradeI || body['grade-I'] || 0), parseFloat(body.gradeJ || body['grade-J'] || 0),
        parseFloat(body.gradeK || body['grade-K'] || 0), parseFloat(body.gradeL || body['grade-L'] || 0),
        parseFloat(body.bonusRate || body.bonus || 0), parseFloat(body.fundRate || body.fund || 0.05)
      ).run();
    }

    return { success: true, message: "Salary Grade Matrix နှုန်းထားများကို Cloudflare D1 Database ထဲသို့ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in updatePayrollSettings handler:", err);
    return { success: false, message: "Salary Grade Matrix သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}
