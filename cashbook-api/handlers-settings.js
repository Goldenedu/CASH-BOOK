/**
 * GOLDEN ERP SYSTEM - SYSTEM SETTINGS & CONTROLS HANDLER (D1 DATABASE)
 * File: handlers-settings.js 
 * 💡 Features: Crash-Proof Balances Control SQL Calculation, Dynamic FY List Fetching,
 *              13-Tab Main & 5-Tab Cashier Grouped Export Engine (.xlsx & CSV) &
 *              Resend Email Backup Dispatcher with Native .xlsx Base64 Attachment Support
 */

/**
 * 💡 Safe Sum Balances Helper (Prevents 500 Server Crash if table doesn't exist)
 */
async function safeSumBal(db, tableName) {
  try {
    const res = await db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) as bal FROM ${tableName}`).first('bal');
    return parseFloat(res || 0);
  } catch (e) {
    try {
      const altName = tableName.replace('_', '');
      const res = await db.prepare(`SELECT COALESCE(SUM(debit - credit), 0) as bal FROM ${altName}`).first('bal');
      return parseFloat(res || 0);
    } catch (e2) {
      return 0;
    }
  }
}

/**
 * 💡 Dynamically fetch all unique FYs present in the D1 Database across all tables (Crash Safe)
 */
async function getAvailableFysFromD1(db) {
  const fys = new Set(['2025-2026', '2026-2027', '2027-2028']);
  const tables = ['bank', 'cash', 'office', 'kitchen', 'payroll', 'income', 'student', 'student_money'];
  
  for (const tbl of tables) {
    try {
      const res = await db.prepare(`SELECT DISTINCT fy FROM ${tbl} WHERE fy IS NOT NULL AND fy != ''`).all();
      if (res && res.results) {
        res.results.forEach(r => {
          if (r.fy) {
            const cleanFy = String(r.fy).trim().replace(/^FY\s*/i, '');
            if (cleanFy) fys.add(cleanFy);
          }
        });
      }
    } catch (e) {
      // Silently ignore if table doesn't exist
    }
  }
  return Array.from(fys).sort().reverse();
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
 * 💡 1. Fetch Live Balances Control (Accountant vs Cashier) & Dynamic FY List
 */
export async function getSettingsData(db, body) {
  try {
    // Safe Accountant Balances (Main Books)
    const bAcc = await safeSumBal(db, 'bank');
    const cAcc = await safeSumBal(db, 'cash');
    const oAcc = await safeSumBal(db, 'office');
    const kAcc = await safeSumBal(db, 'kitchen');
    const pAcc = await safeSumBal(db, 'payroll');

    // Safe Cashier Balances (Cashier Sub-Ledger)
    const bCas = await safeSumBal(db, 'ca_bank');
    const cCas = await safeSumBal(db, 'ca_cash');
    const oCas = await safeSumBal(db, 'ca_office');
    const kCas = await safeSumBal(db, 'ca_kitchen');
    const pCas = await safeSumBal(db, 'ca_payroll');

    // Build Balances Control Data Rows
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

    const availableFys = await getAvailableFysFromD1(db);

    return {
      success: true,
      balancesControl: {
        data: dataRows,
        total: totalRow
      },
      availableFys: availableFys
    };
  } catch (err) {
    console.error("Error in getSettingsData handler:", err);
    return { success: false, message: "Settings Data ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 2. Grouped Multi-Tab Data Export Handler
 * Main Cash Book: 13 Tabs
 * Cashier Cash Book: 5 Tabs
 */
export async function exportGroupDataByFy(db, body) {
  try {
    const groupKey = String(body.groupKey || body.bookKey || 'main').toLowerCase().trim();
    const fyFilter = String(body.fy || '').trim();

    let groupTitle = "Main Cash Book";
    let tableDefs = [];

    if (groupKey === 'cashier' || groupKey.startsWith('ca_') || groupKey.startsWith('ca')) {
      groupTitle = "Cashier Cash Book";
      tableDefs = [
        { key: 'ca_bank', altKey: 'cabank', tabName: 'ca_bank', title: 'CASHIER BANK BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'ca_cash', altKey: 'cacash', tabName: 'ca_cash', title: 'CASHIER CASH BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'ca_office', altKey: 'caoffice', tabName: 'ca_office', title: 'CASHIER OFFICE BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'ca_kitchen', altKey: 'cakitchen', tabName: 'ca_kitchen', title: 'CASHIER KITCHEN BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'ca_payroll', altKey: 'capayroll', tabName: 'ca_payroll', title: 'CASHIER PAYROLL BOOK', hasFy: true, headers: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] }
      ];
    } else {
      groupTitle = "Main Cash Book";
      tableDefs = [
        { key: 'bank', altKey: 'bank', tabName: 'bank', title: 'MAIN BANK BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'cash', altKey: 'cash', tabName: 'cash', title: 'MAIN CASH BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'office', altKey: 'office', tabName: 'office', title: 'OFFICE EXP BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "UNIT", "UNIT PRICE", "METHOD", "DEBIT", "CREDIT", "BALANCES", "LIABILITIES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'kitchen', altKey: 'kitchen', tabName: 'kitchen', title: 'KITCHEN EXP BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'payroll', altKey: 'payroll', tabName: 'payroll', title: 'HR PAYROLL EXP BOOK', hasFy: true, headers: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "UNPAID BONUS", "UNPAID FUND", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'income', altKey: 'income', tabName: 'income', title: 'MAIN INCOME BOOK', hasFy: true, headers: ["NO", "EFFECT DATE", "DATE", "FY", "ID", "FYID", "FYID NAME", "CLASS", "CATEGORY", "ACCOUNT NAME", "METHOD", "DEBIT", "CREDIT", "AUT AMOUNT", "PROMO", "MY", "VR NO", "REMARK", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'student', altKey: 'student', tabName: 'student', title: 'STUDENT LIST', hasFy: true, headers: ["NO", "STU STATUS", "DATE", "FY", "ID", "FYID", "NAME", "GENDER", "CLASS", "CATEGORY", "PROMO", "STATUS", "TRANSFER DATE", "PARENTS NAME", "PHONE NO", "ADDRESS", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'student_money', altKey: 'studentmoney', tabName: 'student_money', title: 'STUDENT MONEY LEDGER', hasFy: true, headers: ["NO", "DATE", "FY", "ID", "FYID", "FYID NAME", "CLASS", "METHOD", "DEBIT", "CREDIT", "BALANCES", "REMARK", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'uniform_ledger', altKey: 'uniform', tabName: 'uniform', title: 'UNIFORM LEDGER', hasFy: false, headers: ["NO", "PRODUCT ID", "PRODUCT NAME", "TYPE", "SIZE", "OPENING STOCK", "UNIT PRICE", "TOTAL AMOUNT", "SELLING PRICE", "PROFIT AMOUNT", "SELLING UNIT", "CURRENT QTY", "TOTAL STOCK VALUE", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'promotion', altKey: 'promo', tabName: 'promotion', title: 'PROMOTION LIST', hasFy: true, headers: ["NO", "FY", "CLASS", "CATEGORY", "Registration", "Original price", "Pro A", "Pro B", "Pro C", "Pro D", "Pro E", "Half scholar", "Full scholar", "Remark", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'staff_fulltime', altKey: 'fulltime', tabName: 'staff_fulltime', title: 'FULL TIME STAFF LIST', hasFy: false, headers: ["NO", "JOIN DATE", "CATEGORY", "STAFF ID", "NAME", "STAFF IDNAME", "EDUCATION", "POSITION", "SALARY GRADE", "WORKING DAYS", "BASIC AMT", "EXTRA AMT", "TOTAL SALARY", "BONUS", "FUND", "TOTAL NET AMT", "RESIGNED DATE", "STATUS", "GENDER", "NRC NO", "BANK ACCOUNT", "PHONE NO", "EMAIL", "FUND DATE", "UNPAID BONUS", "UNPAID FUND", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'staff_parttime', altKey: 'parttime', tabName: 'staff_parttime', title: 'PART TIME STAFF LIST', hasFy: false, headers: ["NO", "JOIN DATE", "CATEGORY", "STAFF ID", "NAME", "STAFF IDNAME", "EDUCATION", "POSITION", "TOTAL SALARY", "TOTAL NET AMT", "RESIGNED DATE", "STATUS", "GENDER", "NRC NO", "BANK ACCOUNT", "PHONE NO", "EMAIL", "CREATED BY", "CREATED AT", "UNIQUEID"] },
        { key: 'salary_grade_matrix', altKey: 'payroll_settings', tabName: 'salary_grade_matrix', title: 'SALARY GRADE MATRIX', hasFy: false, headers: ["ID", "GRADE A", "GRADE B", "GRADE C", "GRADE D", "GRADE E", "GRADE F", "GRADE G", "GRADE H", "GRADE I", "GRADE J", "GRADE K", "GRADE L", "BONUS RATE", "FUND RATE", "UPDATED AT"] }
      ];
    }

    let csvContent = "";
    let grandTotalRecords = 0;
    let tablesDict = {};

    for (const tDef of tableDefs) {
      let rows = [];
      try {
        let q = `SELECT * FROM ${tDef.key}`;
        let params = [];
        if (fyFilter && tDef.hasFy) {
          q += ` WHERE (fy = ? OR fy LIKE ?)`;
          params.push(fyFilter, `%${fyFilter}%`);
        }
        q += ` ORDER BY id ASC`;
        const res = await db.prepare(q).bind(...params).all();
        if (res && res.results) rows = res.results;
      } catch (e) {
        try {
          const alt = tDef.altKey || tDef.key.replace('_', '');
          let q = `SELECT * FROM ${alt}`;
          let params = [];
          if (fyFilter && tDef.hasFy) {
            q += ` WHERE (fy = ? OR fy LIKE ?)`;
            params.push(fyFilter, `%${fyFilter}%`);
          }
          q += ` ORDER BY id ASC`;
          const res = await db.prepare(q).bind(...params).all();
          if (res && res.results) rows = res.results;
        } catch (e2) {}
      }

      grandTotalRecords += rows.length;

      // Store in JSON tables dictionary for SheetJS Multi-Tab Excel generation
      tablesDict[tDef.tabName] = {
        title: tDef.title,
        headers: tDef.headers,
        rows: rows
      };

      // Build Multi-Section CSV Text
      csvContent += `\n==================================================\n`;
      csvContent += `=== TABLE: ${tDef.title} (FY: ${fyFilter || 'All FY'}) ===\n`;
      csvContent += `==================================================\n`;
      csvContent += tDef.headers.join(',') + '\n';

      if (rows.length > 0) {
        rows.forEach((r, idx) => {
          const rowLine = tDef.headers.map(h => {
            const hKey = h.toLowerCase().replace(/\s+/g, '_');
            let val = r[hKey] !== undefined ? r[hKey] : (r[h] !== undefined ? r[h] : (h === 'NO' ? idx + 1 : ''));
            val = String(val !== null && val !== undefined ? val : '').replace(/"/g, '""');
            return `"${val}"`;
          }).join(',');
          csvContent += rowLine + '\n';
        });
      } else {
        csvContent += `"# NO RECORDS FOUND FOR THIS FY #"\n`;
      }

      csvContent += `\n`;
    }

    return {
      success: true,
      groupTitle: groupTitle,
      groupKey: groupKey,
      fy: fyFilter || 'All FY',
      totalRecords: grandTotalRecords,
      tables: tablesDict,
      csvText: csvContent
    };
  } catch (err) {
    console.error("Error in exportGroupDataByFy handler:", err);
    return { success: false, message: "Export ဒေတာ ထုတ်ယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

export async function exportBookDataByFy(db, body) {
  return await exportGroupDataByFy(db, body);
}

/**
 * 💡 3. Real Email Backup Dispatcher (Supports Direct .xlsx Base64 Attachment)
 */
export async function sendGroupEmailBackupByFy(db, userSession, body, env) {
  try {
    const groupKey = String(body.groupKey || body.bookKey || 'main').toLowerCase().trim();
    const fyFilter = String(body.fy || 'All FY').trim();
    const targetEmail = "goldeneduprivateschool@gmail.com";
    const senderName = userSession?.name || userSession?.username || 'Admin';

    const now = new Date();
    const timestampStr = now.toLocaleDateString('en-GB') + ' ' + now.toLocaleTimeString('en-US');

    // Check if Resend API Key is set
    if (!env || !env.RESEND_API_KEY) {
      return {
        success: false,
        message: `⚠️ Cloudflare Worker တွင် RESEND_API_KEY မသတ်မှတ်ရသေးပါသဖြင့် ${targetEmail} သို့ အီးမေးလ် မရောက်နိုင်ပါ။ Cloudflare Worker Settings > Environment Variables တွင် RESEND_API_KEY ထည့်သွင်းပေးပါ။`
      };
    }

    let attachmentPayload = null;
    let groupTitle = groupKey === 'cashier' ? "Cashier Cash Book" : "Main Cash Book";
    let fileFormatName = "Excel (.xlsx)";

    // 💡 1. Prefer Direct Multi-Tab Excel Base64 from Frontend
    if (body.excelBase64 && String(body.excelBase64).trim().length > 0) {
      const fileName = body.fileName || `${groupTitle.replace(/\s+/g, '_')}_FY${fyFilter || 'ALL'}_${now.toISOString().slice(0, 10)}.xlsx`;
      attachmentPayload = {
        filename: fileName,
        content: body.excelBase64
      };
      fileFormatName = "Multi-Tab Excel (.xlsx)";
    } else {
      // 💡 2. Fallback to Multi-Section CSV Text
      const exportRes = await exportGroupDataByFy(db, { groupKey, fy: fyFilter });
      const rawCsvText = exportRes.csvText || "NO DATA";
      groupTitle = exportRes.groupTitle || groupTitle;
      const fileName = `${groupTitle.replace(/\s+/g, '_')}_FY${fyFilter || 'ALL'}_${now.toISOString().slice(0, 10)}.csv`;

      attachmentPayload = {
        filename: fileName,
        content: safeBase64Encode("\uFEFF" + rawCsvText)
      };
      fileFormatName = "Multi-Section CSV (.csv)";
    }

    const emailPayload = {
      from: "Golden ERP Backup <onboarding@resend.dev>",
      to: [targetEmail],
      subject: `[GOLDEN ERP BACKUP] ${groupTitle} Data - FY ${fyFilter} (${timestampStr})`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; background-color: #0c1322; color: #e2e8f0; border-radius: 12px; border: 1px solid #1e293b;">
          <h2 style="color: #38bdf8; border-bottom: 1px solid #334155; padding-bottom: 8px;">GOLDEN ERP SYSTEM - REAL BACKUP REPORT</h2>
          <p><strong>Group Name:</strong> ${groupTitle}</p>
          <p><strong>Fiscal Year:</strong> ${fyFilter}</p>
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
      message: `'${groupTitle}' (${fyFilter}) ၏ ${fileFormatName} Backup Data အား ${targetEmail} သို့ အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။\n\n(Sent Date: ${timestampStr})`
    };
  } catch (err) {
    console.error("Error in sendGroupEmailBackupByFy handler:", err);
    return { success: false, message: "အီးမေးလ် ပေးပို့ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

export async function sendEmailBackupByFy(db, userSession, body, env) {
  return await sendGroupEmailBackupByFy(db, userSession, body, env);
}
