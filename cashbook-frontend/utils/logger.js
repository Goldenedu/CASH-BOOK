/**
 * GOLDEN ERP SYSTEM - AUDIT TRAIL & SYSTEM LOGGER ENGINE 
 * File: logger.js (or utils/logger.js)
 * 💡 Serverless Audit Trail Logging to Google Sheets ('AuditLogs' Sheet) & Cloudflare Worker Console
 * 🛠️ SECURED (Phase 3): Relative Import Fix, Sensitive Data Masking (Password/Token) & Cell Limit Protection
 */

import { appendSheetValues } from './google.js'; // 💡 Cloudflare Worker Root Import Fix

/**
 * 💡 MASK SENSITIVE FIELDS (Password, Tokens, Secrets) BEFORE WRITING TO AUDIT SHEET
 * Audit Log ထဲတွင် Password နှင့် Auth Token များ Plaintext အဖြစ် ပေါက်ကြားမှုကို ကာကွယ်ခြင်း
 */
function sanitizeDetailsForAudit(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clean = Array.isArray(obj) ? [...obj] : { ...obj };

  const SENSITIVE_KEYS = ['password', 'token', 'authToken', 'authSecret', 'secret', 'access_token'];

  for (const key of Object.keys(clean)) {
    if (SENSITIVE_KEYS.some(k => key.toLowerCase().includes(k.toLowerCase()))) {
      clean[key] = '***';
    } else if (typeof clean[key] === 'object' && clean[key] !== null) {
      clean[key] = sanitizeDetailsForAudit(clean[key]);
    }
  }
  return clean;
}

/**
 * 💡 WRITE AUDIT TRAIL LOG TO GOOGLE SHEETS
 * မည်သူက မည်သည့်အချိန်တွင် မည်သည့် စာရင်းကို ဖျက်/ပြင်/သွင်း သွားသည်ဟူသော သမိုင်းကြောင်းအား AuditLogs Sheet တွင် မှတ်တမ်းတင်ခြင်း
 */
export async function writeAuditLog(spreadsheetId, accessToken, sessionOrUser, actionType, moduleOrPayload = {}, recordIdInput = null, extraDetails = {}) {
  try {
    const timestamp = new Date().toISOString();
    
    // 💡 1. Username & Role Resolver
    let username = "System";
    let role = "User";
    if (typeof sessionOrUser === "string") {
      username = sessionOrUser;
      role = "User";
    } else if (sessionOrUser && typeof sessionOrUser === "object") {
      username = sessionOrUser.username || sessionOrUser.user || "System";
      role = sessionOrUser.role || "User";
    }

    let moduleName = "General";
    let recordId = recordIdInput || "-";
    let detailsObj = extraDetails;

    // 💡 2. Flexible Payload / Module Resolver
    if (moduleOrPayload && typeof moduleOrPayload === "object") {
      detailsObj = moduleOrPayload;
      moduleName = moduleOrPayload.bookName || moduleOrPayload.category || moduleOrPayload.action || actionType || "General";
      if (!recordIdInput) {
        recordId = moduleOrPayload.uniqueId || moduleOrPayload.id || moduleOrPayload.staffId || moduleOrPayload.studentId || "-";
      }
    } else if (typeof moduleOrPayload === "string") {
      moduleName = moduleOrPayload;
    }

    // 🛡️ 3. Mask Sensitive Data (Password, Token, Secrets)
    const safeDetails = sanitizeDetailsForAudit(detailsObj);
    let detailsJson = typeof safeDetails === "object" ? JSON.stringify(safeDetails) : String(safeDetails || "");
    
    // 🛡️ 4. Google Sheets Cell Length Safety Limit (Max 4000 chars)
    if (detailsJson.length > 4000) {
      detailsJson = detailsJson.slice(0, 4000) + '...[TRUNCATED]';
    }

    const logRow = [
      timestamp,
      username,
      role,
      actionType || "ACTION",
      moduleName,
      recordId,
      detailsJson
    ];

    // 💡 Append 7-Column Audit Log Row to 'AuditLogs!A2:G'
    await appendSheetValues(spreadsheetId, accessToken, "AuditLogs!A2:G", [logRow]);
  } catch (err) {
    // Audit logging ပြုလုပ်ရာတွင် အမှားဖြစ်ခဲ့ပါက မူလ စာရင်းသွင်းမှု လုပ်ငန်းစဉ်အား မထိခိုက်စေရန် Fail-Safe ထိန်းသိမ်းခြင်း
    console.warn("[AuditLog Warning] Failed to persist audit log to Google Sheets:", err.message);
  }
}

/**
 * 💡 CONSOLE REQUEST LOGGER FOR CLOUDFLARE WORKERS
 */
export function logRequest(action, userSession, extraInfo = {}) {
  const time = new Date().toISOString();
  const user = userSession?.username || "Public/Anon";
  const role = userSession?.role || "None";
  console.log(`[REQ ${time}] Action: '${action}' | User: ${user} (${role})`, extraInfo);
}

/**
 * 💡 CONSOLE ERROR LOGGER FOR CLOUDFLARE WORKERS
 */
export function logError(action, error, userSession) {
  const time = new Date().toISOString();
  const user = userSession?.username || "Unknown";
  console.error(`[ERR ${time}] Action: '${action}' | User: ${user} | Message: ${error?.message || error}`, error?.stack || "");
}
