/**
 * GOLDEN ERP SYSTEM - OFFICE & KITCHEN EXPENSE HANDLER (CLOUDFLARE D1)
 * File: handlers-office-kit.js 
 * 💡 Features: Safe Liabilities Handling (Negative & Credit/Debit Support),
 *              Crash-Proof Auto-Lock Enforcement (5-Prefix Lock Engine & Zero Client Bypass),
 *              Kitchen 16-Cols Schema (No Liabilities Column), Bulletproof Uniform Stock Reversion & Idempotent Upsert
 */

const BOOK_TABLE_MAP = {
  "kitchen": "kitchen", 
  "kitchen exp book": "kitchen", 
  "kitchen expense book": "kitchen",
  "office": "office", 
  "office exp book": "office", 
  "office expense book": "office",
  "payroll": "payroll",
  "hr payroll exp book": "payroll",
  "caoffice": "ca_office", 
  "cakitchen": "ca_kitchen"
};

function getTableName(rawBook) {
  if (!rawBook) return "office";
  const key = String(rawBook).trim().toLowerCase();
  return BOOK_TABLE_MAP[key] || "office";
}

function normalizeFyStr(fy) {
  if (!fy) return 'FY 2026-2027';
  let s = String(fy).trim();
  if (!s.toUpperCase().startsWith('FY ')) {
    s = 'FY ' + s;
  }
  return s;
}

function extractProductIdFromDescription(description) {
  if (!description) return null;
  const str = String(description).trim();
  const match = str.match(/PID\s*(\d+)/i);
  if (match && match[1]) return match[1].trim();
  const numMatch = str.match(/^(\d+)\s/);
  if (numMatch && numMatch[1]) return numMatch[1];
  return null;
}

/**
 * 💡 Safe Accounting Number Parser (-1000 & (1000) Parentheses Support)
 */
function parseAccountingNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  let s = String(val).trim().replace(/,/g, '');
  if (s.startsWith('(') && s.endsWith(')')) {
    s = '-' + s.slice(1, -1).trim();
  }
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

async function recalculateLedgerBalances(db, tableName) {
  if (!tableName) return;
  try {
    const fysRes = await db.prepare(`SELECT DISTINCT fy FROM ${tableName}`).all();
    const rawFys = (fysRes.results || []).map(r => normalizeFyStr(r.fy)).filter(Boolean);
    const fys = Array.from(new Set(rawFys));
    if (fys.length === 0) fys.push('FY 2026-2027');

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

    for (let i = 0; i < statements.length; i += 100) {
      await db.batch(statements.slice(i, i + 100));
    }
  } catch (e) {
    console.warn(`Running Balance & NO Recalculation Warning for ${tableName}:`, e);
  }
}

async function generateVoucherNo(db, tableName, prefix, entryDate) {
  let ddmmyy = "";
  const parts = String(entryDate || '').split('-');
  if (parts.length === 3) {
    const y = parts[0].slice(-2);
    ddmmyy = `${parts[2]}${parts[1]}${y}`;
  } else {
    const now = new Date();
    ddmmyy = `${String(now.getDate()).padStart(2, '0')}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(-2)}`;
  }

  const pattern = `${prefix}-${ddmmyy}-%`;
  const countRow = await db.prepare(
    `SELECT COUNT(*) as cnt FROM ${tableName} WHERE vr_no LIKE ? OR date = ?`
  ).bind(pattern, entryDate).first();

  const seq = (countRow ? parseInt(countRow.cnt, 10) : 0) + 1;
  return `${prefix}-${ddmmyy}-${String(seq).padStart(3, '0')}`;
}

async function generateFyNo(db, tableName, fy) {
  const normFy = normalizeFyStr(fy);
  const lastNoRow = await db.prepare(
    `SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM ${tableName} WHERE fy = ? OR fy = ?`
  ).bind(normFy, normFy.replace(/^FY\s*/i, '')).first();
  return (lastNoRow && lastNoRow.maxNo ? parseInt(lastNoRow.maxNo, 10) : 0) + 1;
}

async function syncUniformStock(db, productId, unitDelta) {
  if (!productId || unitDelta === 0) return;
  try {
    const rawPid = String(productId).trim();
    const cleanNum = rawPid.replace(/^PID\s*/i, '').trim();
    const formattedPid = `PID ${cleanNum.padStart(3, '0')}`;

    const item = await db.prepare(`
      SELECT * FROM uniform_ledger 
      WHERE uniqueid = ? 
         OR LOWER(product_id) = LOWER(?) 
         OR LOWER(product_id) = LOWER(?) 
         OR CAST(id AS TEXT) = ? 
      LIMIT 1
    `).bind(rawPid, rawPid, formattedPid, cleanNum).first();

    if (item) {
      const openStock = parseFloat(item.opening_stock || 0);
      const currentSellingUnit = parseFloat(item.selling_unit || 0);
      const newSellingUnit = Math.max(0, currentSellingUnit + unitDelta);
      const newCurrentQty = Math.max(0, openStock - newSellingUnit);
      const unitPrice = parseFloat(item.unit_price || 0);
      const newStockVal = newCurrentQty * unitPrice;

      await db.prepare(`
        UPDATE uniform_ledger SET 
          selling_unit = ?, 
          current_qty = ?, 
          total_stock_value = ? 
        WHERE id = ?
      `).bind(newSellingUnit, newCurrentQty, newStockVal, item.id).run();
    }
  } catch (e) {
    console.warn("Uniform Stock Sync Warning:", e);
  }
}

async function cleanLinkedAutoEntries(db, uniqueid) {
  if (!uniqueid) return;
  const profitUid = `UNIPROFIT_${uniqueid}`;
  const cashierUid = `UNICASHIER_${uniqueid}`;

  await db.prepare(`DELETE FROM cash WHERE uniqueid = ?`).bind(profitUid).run();
  await db.prepare(`DELETE FROM bank WHERE uniqueid = ?`).bind(profitUid).run();
  await db.prepare(`DELETE FROM ca_cash WHERE uniqueid = ?`).bind(cashierUid).run();
  await db.prepare(`DELETE FROM ca_bank WHERE uniqueid = ?`).bind(cashierUid).run();
}

async function postLinkedAutoEntries(db, body, entryDate, my, fy, createdBy, uniqueid) {
  const isUniform = (body.category === "Advance Uniform" || body.category === "Advance Unifrom");
  if (!isUniform) return;

  const normFy = normalizeFyStr(fy);
  const method = String(body.method || 'Cash').toLowerCase();
  const profit = parseFloat(body.profit || 0);
  const costDebit = parseFloat(body.debit || 0);
  const totalCashierIncome = costDebit + profit;
  const sourceBookTitle = body.bookName || 'Office Exp Book';

  if (profit > 0) {
    const mainTable = (method === 'bank') ? 'bank' : 'cash';
    const mainPrefix = (method === 'bank') ? 'BNK' : 'CAH';
    const mainVrNo = await generateVoucherNo(db, mainTable, mainPrefix, entryDate);
    const mainNo = await generateFyNo(db, mainTable, normFy);
    const mainProfitUid = `UNIPROFIT_${uniqueid}`;
    const mainDesc = `[Uniform Profit] ${body.description || ''}`.trim();

    await db.prepare(`
      INSERT OR REPLACE INTO ${mainTable} (
        no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      mainNo, entryDate, 'Uniform Profit', mainDesc, body.method || 'Cash', profit, 0, 0, '',
      mainVrNo, my, normFy, sourceBookTitle, createdBy, new Date().toISOString(), mainProfitUid
    ).run();

    await recalculateLedgerBalances(db, mainTable);
  }

  if (totalCashierIncome > 0) {
    const caTable = (method === 'bank') ? 'ca_bank' : 'ca_cash';
    const caPrefix = (method === 'bank') ? 'CAB' : 'CAC';
    const caVrNo = await generateVoucherNo(db, caTable, caPrefix, entryDate);
    const caNo = await generateFyNo(db, caTable, normFy);
    const caUid = `UNICASHIER_${uniqueid}`;
    const caDesc = String(body.description || '').trim();

    await db.prepare(`
      INSERT OR REPLACE INTO ${caTable} (
        no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      caNo, entryDate, 'Income Uniform', caDesc, body.method || 'Cash', totalCashierIncome, 0, 0, '',
      caVrNo, my, normFy, sourceBookTitle, createdBy, new Date().toISOString(), caUid
    ).run();

    await recalculateLedgerBalances(db, caTable);
  }
}

export async function getExpenseData(db, body) {
  try {
    const rawBook = body.bookName || body.book || "office";
    const tableName = getTableName(rawBook);
    const searchVal = String(body.searchVal || "").trim();
    const page = parseInt(body.page || 1, 10);
    const limit = parseInt(body.limit || 30, 10);
    const offset = (page - 1) * limit;
    const activeFy = normalizeFyStr(body.fy || "FY 2026-2027");

    const statsResult = await db.prepare(`
      SELECT 
        COALESCE(SUM(debit), 0) as totalIncome,
        COALESCE(SUM(credit), 0) as totalExpense
      FROM ${tableName}
      WHERE fy = ? OR fy = ?
    `).bind(activeFy, activeFy.replace(/^FY\s*/i, '')).first() || { totalIncome: 0, totalExpense: 0 };

    let totalIncome = parseFloat(statsResult.totalIncome || 0);
    let totalExpense = parseFloat(statsResult.totalExpense || 0);
    const balance = totalIncome - totalExpense;

    let whereClauses = [];
    let params = [];

    if (searchVal) {
      whereClauses.push(`(description LIKE ? OR category LIKE ? OR vr_no LIKE ? OR method LIKE ? OR transfer LIKE ? OR CAST(debit AS TEXT) LIKE ? OR CAST(credit AS TEXT) LIKE ? OR CAST(liabilities AS TEXT) LIKE ?)`);
      const p = `%${searchVal}%`;
      params.push(p, p, p, p, p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM ${tableName} ${whereSql}`).bind(...params).first();
    const totalRows = countRow ? countRow.count : 0;

    const dataQuery = `SELECT * FROM ${tableName} ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`;
    const rowsRes = await db.prepare(dataQuery).bind(...params, limit, offset).all();
    const rawRows = rowsRes.results || [];

    const formattedRows = rawRows.map(row => {
      const uid = String(row.uniqueid || row.uniqueId || '');
      const isAutoLocked = Boolean(row.is_locked || row.isLocked || uid.startsWith('UNIPROFIT_') || uid.startsWith('UNICASHIER_') || uid.startsWith('TRANS_') || uid.startsWith('DAILY_INC_') || uid.startsWith('INCMAIN_'));

      return {
        id: row.id,
        no: Math.floor(parseFloat(row.no || row.id || 1)),
        date: row.date || '',
        category: row.category || '',
        description: row.description || '',
        unit: parseFloat(row.unit || 0),
        unitPrice: parseFloat(row.unit_price !== undefined ? row.unit_price : (row.unitPrice || 0)),
        method: row.method || 'Cash',
        debit: parseFloat(row.debit || 0),
        credit: parseFloat(row.credit || 0),
        balances: parseFloat(row.balances || 0),
        liabilities: parseFloat(row.liabilities !== undefined ? row.liabilities : 0), // 💡 Handles negative numbers accurately
        unpaidBonus: parseFloat(row.unpaid_bonus !== undefined ? row.unpaid_bonus : (row.unpaidBonus || 0)),
        unpaidFund: parseFloat(row.unpaid_fund !== undefined ? row.unpaid_fund : (row.unpaidFund || 0)),
        transfer: row.transfer || '',
        vrNo: row.vr_no || row.vrNo || '',
        my: row.my || '',
        fy: normalizeFyStr(row.fy || activeFy),
        bookName: row.book_name || rawBook,
        uniqueId: uid || `ID_${row.id}`,
        isLocked: isAutoLocked
      };
    });

    return {
      success: true,
      data: formattedRows,
      totalRows: totalRows,
      page: page,
      limit: limit,
      stats: { totalIncome, totalExpense, balance }
    };
  } catch (err) {
    console.error("Error in getExpenseData handler:", err);
    return { success: false, message: "Expense ဒေတာ ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Save New Expense Entry
 */
export async function saveExpenseEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "office";
    const tableName = getTableName(rawBook);
    const createdBy = session?.name || body.createdBy || "Admin";

    const entryDate = body.date || new Date().toISOString().split('T')[0];
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;
    
    let fyYear = d.getFullYear();
    if (d.getMonth() < 3) fyYear -= 1;
    const fy = normalizeFyStr(body.fy || `FY ${fyYear}-${fyYear + 1}`);

    const debit = parseAccountingNum(body.debit);
    const credit = parseAccountingNum(body.credit);
    const unit = parseFloat(body.unit || 0);
    const unitPrice = parseFloat(body.unitPrice || 0);
    const liabilities = parseAccountingNum(body.liabilities); // 💡 Negative Liabilities Support

    // 🔒 1. PRIVILEGE ESCALATION DEFENSE
    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
    const isMigration = isPrivilegedAdmin && Boolean(body.isMigration || body.directImport || body.skipAutoPost);

    const uniqueid = (isMigration && body.uniqueId)
      ? String(body.uniqueId).trim()
      : `EXP_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    const newNo = (isMigration && body.no) ? parseInt(body.no, 10) : await generateFyNo(db, tableName, fy);
    const bookPrefix = tableName === 'kitchen' ? 'KIT' : (tableName === 'payroll' ? 'SAL' : 'OFF');
    const vrNo = body.vrNo || await generateVoucherNo(db, tableName, bookPrefix, entryDate);

    const sqlVerb = isMigration ? "INSERT OR REPLACE INTO" : "INSERT INTO";

    if (tableName === 'kitchen') {
      // 16 Columns (NO liabilities)
      const kitchenStmt = `
        ${sqlVerb} kitchen (
          no, date, category, description, method, debit, credit, balances, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, '', ?, ?, ?, datetime('now'), ?)
      `;
      await db.prepare(kitchenStmt).bind(
        newNo, entryDate, body.category || 'General', body.description || '',
        body.method || 'Cash', debit, credit, body.transfer || '',
        vrNo, fy, rawBook, createdBy, uniqueid
      ).run();
    } else if (tableName === 'payroll') {
      // 18 Columns
      const payrollStmt = `
        ${sqlVerb} payroll (
          no, date, category, description, method, debit, credit, balances, unpaid_bonus, unpaid_fund, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, '', ?, ?, ?, datetime('now'), ?)
      `;
      await db.prepare(payrollStmt).bind(
        newNo, entryDate, body.category || 'Full Time Salary', body.description || '',
        body.method || 'Cash', debit, credit, parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0),
        body.transfer || '', vrNo, normalizeFyStr(body.fy), rawBook, createdBy, uniqueid
      ).run();
    } else {
      // 19 Columns for Office (Includes liabilities)
      const officeStmt = `
        ${sqlVerb} office (
          no, date, category, description, unit, unit_price, method, debit, credit, balances, liabilities, transfer, vr_no, my, fy, book_name, created_by, created_at, uniqueid
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, '', ?, ?, ?, datetime('now'), ?)
      `;
      await db.prepare(officeStmt).bind(
        newNo, entryDate, body.category || 'General', body.description || '',
        unit, unitPrice, body.method || 'Cash', debit, credit, liabilities,
        body.transfer || '', vrNo, fy, rawBook, createdBy, uniqueid
      ).run();
    }

    if (isMigration) {
      return {
        success: true,
        message: "စာရင်းသစ် အောင်မြင်စွာ တိုက်ရိုက် သွင်းယူပြီးပါပြီ။",
        uniqueId: uniqueid,
        vrNo: vrNo
      };
    }

    // 💡 LIVE OPERATIONAL MODE
    await recalculateLedgerBalances(db, tableName);

    const isUniform = (body.category === "Advance Uniform" || body.category === "Advance Unifrom");
    const targetPid = body.id || extractProductIdFromDescription(body.description);
    if (isUniform && targetPid && unit > 0) {
      await syncUniformStock(db, targetPid, unit);
    }

    await postLinkedAutoEntries(db, body, entryDate, my, fy, createdBy, uniqueid);

    return {
      success: true,
      message: "စာရင်းသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      uniqueId: uniqueid,
      vrNo: vrNo
    };
  } catch (err) {
    console.error("Error in saveExpenseEntry handler:", err);
    return { success: false, message: "စာရင်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Update Expense Entry (Crash-Proof Lock Check & Negative Liabilities Support)
 */
export async function updateExpenseEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "office";
    const tableName = getTableName(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };

    // 🔒 1. CRASH-PROOF SERVER-SIDE LOCK ENFORCEMENT (SELECT * avoids "no such column: is_locked" error)
    const existing = await db.prepare(`SELECT * FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (!existing) return { success: false, message: "ပြင်ဆင်မည့် စာရင်း ရှာမတွေ့ပါ။" };

    const uid = String(existing.uniqueid || '');
    const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) ||
      uid.startsWith('TRANS_') ||
      uid.startsWith('UNIPROFIT_') ||
      uid.startsWith('UNICASHIER_') ||
      uid.startsWith('DAILY_INC_') ||
      uid.startsWith('INCMAIN_');

    const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
    if (isAutoLocked && !isPrivilegedAdmin) {
      return { 
        success: false, 
        message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် အခြားစာအုပ်မှ ချိတ်ဆက်ထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ပြင်ဆင်နိုင်ပါသည်။" 
      };
    }

    // 2. Fetch Old Entry to Revert Stock using Extracted Product ID
    if (existing.category === "Advance Uniform" || existing.category === "Advance Unifrom") {
      const oldUnit = parseFloat(existing.unit || 0);
      const oldPid = extractProductIdFromDescription(existing.description) || existing.id;
      if (oldPid && oldUnit > 0) {
        await syncUniformStock(db, oldPid, -oldUnit);
      }
    }

    await cleanLinkedAutoEntries(db, uniqueid);

    const entryDate = body.date || new Date().toISOString().split('T')[0];
    const d = new Date(entryDate);
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const my = `${monthNames[d.getMonth()]}-${d.getFullYear()}`;

    let fyYear = d.getFullYear();
    if (d.getMonth() < 3) fyYear -= 1;
    const fy = normalizeFyStr(body.fy || `FY ${fyYear}-${fyYear + 1}`);

    const debit = parseAccountingNum(body.debit);
    const credit = parseAccountingNum(body.credit);
    const unit = parseFloat(body.unit || 0);
    const unitPrice = parseFloat(body.unitPrice || 0);
    const liabilities = parseAccountingNum(body.liabilities); // 💡 Negative Liabilities Support

    if (tableName === 'kitchen') {
      await db.prepare(`
        UPDATE kitchen SET date=?, category=?, description=?, method=?, debit=?, credit=?, transfer=?, fy=? WHERE uniqueid=?
      `).bind(entryDate, body.category || 'General', body.description || '', body.method || 'Cash', debit, credit, body.transfer || '', fy, uniqueid).run();
    } else if (tableName === 'payroll') {
      await db.prepare(`
        UPDATE payroll SET date=?, category=?, description=?, method=?, debit=?, credit=?, unpaid_bonus=?, unpaid_fund=?, transfer=?, fy=? WHERE uniqueid=?
      `).bind(entryDate, body.category || 'Full Time Salary', body.description || '', body.method || 'Cash', debit, credit, parseFloat(body.unpaidBonus || 0), parseFloat(body.unpaidFund || 0), body.transfer || '', fy, uniqueid).run();
    } else {
      await db.prepare(`
        UPDATE office SET date=?, category=?, description=?, unit=?, unit_price=?, method=?, debit=?, credit=?, liabilities=?, transfer=?, fy=? WHERE uniqueid=?
      `).bind(entryDate, body.category || 'General', body.description || '', unit, unitPrice, body.method || 'Cash', debit, credit, liabilities, body.transfer || '', fy, uniqueid).run();
    }

    await recalculateLedgerBalances(db, tableName);

    // 3. Deduct New Stock
    const isUniform = (body.category === "Advance Uniform" || body.category === "Advance Unifrom");
    const targetPid = body.id || extractProductIdFromDescription(body.description);
    if (isUniform && targetPid && unit > 0) {
      await syncUniformStock(db, targetPid, unit);
    }

    // 4. Re-post Updated Linked Auto Entries & Recalculate Linked Books
    await postLinkedAutoEntries(db, body, entryDate, my, fy, session?.name || 'Admin', uniqueid);
    await recalculateLedgerBalances(db, 'cash');
    await recalculateLedgerBalances(db, 'bank');
    await recalculateLedgerBalances(db, 'ca_cash');
    await recalculateLedgerBalances(db, 'ca_bank');

    return { success: true, message: "စာရင်း အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in updateExpenseEntry handler:", err);
    return { success: false, message: "စာရင်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Delete Expense Entry (With Strict Server-Side Auto-Lock Guard)
 */
export async function deleteExpenseEntry(db, session, body) {
  try {
    const rawBook = body.bookName || body.book || "office";
    const tableName = getTableName(rawBook);
    const uniqueid = body.uniqueId || body.uniqueid;

    if (!uniqueid) return { success: false, message: "Unique ID မပါဝင်ပါ။" };

    // 🔒 1. CRASH-PROOF SERVER-SIDE LOCK ENFORCEMENT
    const existing = await db.prepare(`SELECT * FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).first();
    if (existing) {
      const uid = String(existing.uniqueid || '');
      const isAutoLocked = Boolean(existing.is_locked || existing.isLocked) ||
        uid.startsWith('TRANS_') ||
        uid.startsWith('UNIPROFIT_') ||
        uid.startsWith('UNICASHIER_') ||
        uid.startsWith('DAILY_INC_') ||
        uid.startsWith('INCMAIN_');

      const isPrivilegedAdmin = ['Owner', 'Admin'].includes(session?.role || '');
      if (isAutoLocked && !isPrivilegedAdmin) {
        return { 
          success: false, 
          message: "ဤစာရင်းသည် စနစ်မှ အလိုအလျောက် သို့မဟုတ် အခြားစာအုပ်မှ ချိတ်ဆက်ထားသော စာရင်းဖြစ်သဖြင့် မူရင်းစာအုပ်မှသာ ဖျက်သိမ်းနိုင်ပါသည်။" 
        };
      }
    }

    // Revert Stock in Uniform Ledger via Extracted Product ID
    if (existing && (existing.category === "Advance Uniform" || existing.category === "Advance Unifrom")) {
      const oldUnit = parseFloat(existing.unit || 0);
      const oldPid = extractProductIdFromDescription(existing.description) || existing.id;
      if (oldPid && oldUnit > 0) {
        await syncUniformStock(db, oldPid, -oldUnit);
      }
    }

    await db.prepare(`DELETE FROM ${tableName} WHERE uniqueid = ?`).bind(uniqueid).run();
    await cleanLinkedAutoEntries(db, uniqueid);

    await recalculateLedgerBalances(db, tableName);
    await recalculateLedgerBalances(db, 'cash');
    await recalculateLedgerBalances(db, 'bank');
    await recalculateLedgerBalances(db, 'ca_cash');
    await recalculateLedgerBalances(db, 'ca_bank');

    return { success: true, message: "စာရင်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in deleteExpenseEntry handler:", err);
    return { success: false, message: "စာရင်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}
