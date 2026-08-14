/**
 * GOLDEN ERP SYSTEM - CLOUDFLARE WORKER MAIN ROUTER (D1 MODULAR EDITION)
 * File: worker.js
 * 💡 Powered by Cloudflare D1 SQL Database & Modular Handlers
 */

import * as StudentHandlers from './handlers-student.js';
import * as PayrollStaffHandlers from './handlers-payroll-staff.js';
import * as UniformHandlers from './handlers-uniform.js';
import * as OfficeKitHandlers from './handlers-office-kit.js';
import * as BankCashHandlers from './handlers-bank-cash.js';
import * as IncomeHandlers from './handlers-income.js';
import * as PromotionHandlers from './handlers-promotion.js';
import * as CashierHandlers from './handlers-cashier.js';
import * as ReportHandlers from './handlers-reports.js';
import * as StudentMoneyHandlers from './handlers-money.js';
import * as SettingsHandlers from './handlers-settings.js';
import * as DashboardHandlers from './handlers-dashboard.js';
import { validateLedgerInput } from './validation.js';

// 💡 1. RESOURCE-SPECIFIC SERVER-SIDE RBAC PERMISSION MATRIX
const ROLE_PERMS = {
  Owner: { add: true, edit: true, del_ledger: true, del_cashier: true, del_staff: true, del_student: true, del_uniform: true, del_promo: true, grade: true, backup: true },
  Admin: { add: true, edit: true, del_ledger: true, del_cashier: true, del_staff: true, del_student: true, del_uniform: true, del_promo: true, grade: true, backup: true },
  Finance: { add: true, edit: true, del_ledger: true, del_cashier: true, del_staff: true, del_student: true, del_uniform: true, del_promo: true, grade: true, backup: true },
  Accountant: { add: true, edit: true, del_ledger: true, del_cashier: true, del_staff: true, del_student: true, del_uniform: true, del_promo: true, grade: true, backup: true },
  "HR": { add: true, edit: true, del_ledger: false, del_cashier: false, del_staff: true, del_student: false, del_uniform: false, del_promo: false, grade: true, backup: false }, // ✅ Added 'HR'
  "HR Staff": { add: true, edit: true, del_ledger: false, del_cashier: false, del_staff: true, del_student: false, del_uniform: false, del_promo: false, grade: true, backup: false },
  "HRStaff": { add: true, edit: true, del_ledger: false, del_cashier: false, del_staff: true, del_student: false, del_uniform: false, del_promo: false, grade: true, backup: false },
  Cashier: { add: true, edit: true, del_ledger: false, del_cashier: true, del_staff: false, del_student: false, del_uniform: false, del_promo: false, grade: false, backup: false },
  "Main Cashier": { add: true, edit: true, del_ledger: false, del_cashier: true, del_staff: false, del_student: false, del_uniform: false, del_promo: false, grade: false, backup: false },
  Staff: { add: true, edit: false, del_ledger: false, del_cashier: false, del_staff: false, del_student: false, del_uniform: false, del_promo: false, grade: false, backup: false },
  Viewer: { add: false, edit: false, del_ledger: false, del_cashier: false, del_staff: false, del_student: false, del_uniform: false, del_promo: false, grade: false, backup: false }
};

const BOOK_TABLE_MAP = {
  "bank": "bank", "Bank Book": "bank",
  "cash": "cash", "Cash Book": "cash",
  "kitchen": "kitchen", "Kitchen Exp Book": "kitchen",
  "office": "office", "Office Exp Book": "office",
  "payroll": "payroll", "HR Payroll Exp Book": "payroll",
  "caBank": "ca_bank", "CABank": "ca_bank",
  "caCash": "ca_cash", "CACash": "ca_cash",
  "caOffice": "ca_office", "CAOffice": "ca_office",
  "caKitchen": "ca_kitchen", "CAKitchen": "ca_kitchen",
  "caPayroll": "ca_payroll", "CAPayroll": "ca_payroll"
};

function can(session, perm) {
  const role = session?.role || "Viewer";
  const perms = ROLE_PERMS[role] || ROLE_PERMS.Viewer;
  return !!perms[perm];
}

function forbidden(corsHeaders) {
  return new Response(JSON.stringify({
    success: false,
    message: "ဒီလုပ်ဆောင်ချက်အတွက် ခွင့်ပြုချက် (Permission) မရှိပါ။"
  }), { status: 403, headers: corsHeaders });
}

// 💡 Base64URL Helpers (no padding, URL-safe)
function base64UrlEncode(bytesOrStr) {
  const bytes = typeof bytesOrStr === "string" ? new TextEncoder().encode(bytesOrStr) : bytesOrStr;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64UrlDecodeToString(str) {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/").padEnd(str.length + (4 - (str.length % 4)) % 4, "=");
  return atob(padded);
}

function base64UrlDecodeToBytes(str) {
  const binary = base64UrlDecodeToString(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
}

// 💡 JWT Signing & Verification
async function createJwtToken(payload, secret) {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + (8 * 3600) }));

  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`));
  const encodedSignature = base64UrlEncode(new Uint8Array(signature));

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

async function verifyJwtToken(token, secret) {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    const key = await hmacKey(secret);
    const signatureBytes = base64UrlDecodeToBytes(encodedSignature);
    const isValid = await crypto.subtle.verify(
      "HMAC", key, signatureBytes,
      new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
    );
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlDecodeToString(encodedPayload));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// 💡 Password Hashing (PBKDF2-SHA256 via Web Crypto)
const PBKDF2_ITERATIONS = 100000;

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

async function hashPassword(password, saltBytes) {
  const salt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hashHex = bytesToHex(new Uint8Array(derivedBits));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${hashHex}`;
}

function timingSafeEqualStr(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyPassword(password, stored) {
  if (!stored) return { ok: false, needsRehash: false };

  if (stored.startsWith("pbkdf2$")) {
    const [, iterStr, saltHex, hashHex] = stored.split("$");
    const iterations = parseInt(iterStr, 10);
    const salt = hexToBytes(saltHex);
    const keyMaterial = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]
    );
    const derivedBits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, keyMaterial, 256
    );
    const computedHex = bytesToHex(new Uint8Array(derivedBits));
    return { ok: timingSafeEqualStr(computedHex, hashHex), needsRehash: false };
  }

  const ok = timingSafeEqualStr(String(stored), String(password));
  return { ok, needsRehash: ok };
}

export default {
  async fetch(request, env, ctx) {
    const requestOrigin = request.headers.get("Origin") || "";
    const allowedOrigins = String(env.ALLOWED_ORIGIN || "").split(",").map(s => s.trim()).filter(Boolean);
    const resolvedOrigin = allowedOrigins.length === 0 ? "*" : (allowedOrigins.includes(requestOrigin) ? requestOrigin : allowedOrigins[0]);

    const corsHeaders = {
      "Access-Control-Allow-Origin": resolvedOrigin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Max-Age": "86400",
      "Content-Type": "application/json",
      "Vary": "Origin"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      const db = env.DB || env.school_db;
      if (!db) {
        return new Response(JSON.stringify({
          success: false,
          message: "Database Binding Error: D1 Database (env.DB) မတွေ့ရှိပါ။"
        }), { status: 500, headers: corsHeaders });
      }

      const authSecret = env.AUTH_SECRET;
      if (!authSecret) {
        return new Response(JSON.stringify({
          success: false,
          message: "Server Config Error: AUTH_SECRET မသတ်မှတ်ရသေးပါ။ Cloudflare Worker Settings > Environment Variables တွင် AUTH_SECRET ထည့်သွင်းပေးပါ။"
        }), { status: 500, headers: corsHeaders });
      }

      let body = {};
      let action = "";

      if (request.method === "GET") {
        const url = new URL(request.url);
        action = url.searchParams.get("action") || "";
        for (const [key, value] of url.searchParams.entries()) {
          body[key] = value;
        }
      } else {
        try {
          body = await request.json();
          if (typeof body.action === 'object' && body.action !== null) {
            const innerAction = body.action.action || "";
            body = { ...body.action, ...body, action: innerAction };
          }
          action = typeof body.action === 'string' ? body.action : "";
        } catch (e) {
          body = {};
        }
      }

      // 🛡️ Input Validation
      if (request.method !== "GET" && typeof validateLedgerInput === 'function') {
        const validation = validateLedgerInput(body);
        if (!validation.success) {
          return new Response(JSON.stringify(validation), { status: 400, headers: corsHeaders });
        }
      }

      // 🔒 AUTHENTICATION GUARD
      const PUBLIC_ACTIONS = ["checkLogin"];
      let userSession = null;

      if (!PUBLIC_ACTIONS.includes(action)) {
        const authHeader = request.headers.get("Authorization") || "";
        const tokenFromHeader = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : "";
        const tokenToVerify = tokenFromHeader || body.token || body.authToken || "";

        userSession = await verifyJwtToken(tokenToVerify, authSecret);

        if (!userSession) {
          return new Response(JSON.stringify({
            success: false,
            message: "Session သက်တမ်း ကုန်ဆုံးသွားပါပြီ။ ကျေးဇူးပြု၍ ပြန်လည် Login ဝင်ရောက်ပါ။"
          }), { status: 401, headers: corsHeaders });
        }
      }

      let result = null;

      switch (action) {
        // 🔑 1. LOGIN HANDLER
        case 'checkLogin': {
          const username = String(body.username || "").trim();
          const password = String(body.password || "").trim();

          const user = await db.prepare("SELECT * FROM users WHERE LOWER(username) = LOWER(?)").bind(username).first();

          if (user) {
            const { ok, needsRehash } = await verifyPassword(password, user.password_hash);

            if (ok) {
              if (needsRehash) {
                try {
                  const newHash = await hashPassword(password);
                  await db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").bind(newHash, user.username).run();
                } catch (e) {
                  console.error("Password rehash-on-login failed:", e);
                }
              }

              const token = await createJwtToken({ username: user.username, role: user.role, name: user.name || user.username }, authSecret);
              return new Response(JSON.stringify({
                success: true,
                token: token,
                user: { username: user.username, role: user.role, name: user.name || user.username }
              }), { headers: corsHeaders });
            }
          }

          return new Response(JSON.stringify({
            success: false,
            message: "Username သို့မဟုတ် Password မှားယွင်းနေပါသည်။"
          }), { headers: corsHeaders });
        }

        // 📊 2. DASHBOARD DATA
        case 'getDashboardData':
          result = await DashboardHandlers.getDashboardData(db, body);
          break;

        // 🎓 3. STUDENT DIRECTORY ROUTES
        case 'getStudentData':
          result = await StudentHandlers.getStudentData(db, body);
          break;

        case 'lookupStudentById':
          result = await StudentHandlers.lookupStudentById(db, body);
          break;

        case 'saveStudentEntry':
          if (!can(userSession, 'add')) return forbidden(corsHeaders);
          result = await StudentHandlers.saveStudentEntry(db, userSession, body);
          break;

        case 'updateStudentEntry':
          if (!can(userSession, 'edit')) return forbidden(corsHeaders);
          result = await StudentHandlers.updateStudentEntry(db, userSession, body);
          break;

        case 'deleteStudentEntry':
          if (!can(userSession, 'del_student')) return forbidden(corsHeaders);
          result = await StudentHandlers.deleteStudentEntry(db, userSession, body);
          break;

        // 👨‍🏫 4. HR PAYROLL & STAFF ROUTES
        case 'getStaffData':
          result = await PayrollStaffHandlers.getStaffData(db, body);
          break;

        case 'saveStaffEntry':
          if (!can(userSession, 'add')) return forbidden(corsHeaders);
          result = await PayrollStaffHandlers.saveStaffEntry(db, userSession, body);
          break;

        // ✅ ADDED: Missing updateStaffEntry Route
        case 'updateStaffEntry':
          if (!can(userSession, 'edit')) return forbidden(corsHeaders);
          result = await PayrollStaffHandlers.updateStaffEntry(db, userSession, body);
          break;

        case 'deleteStaffEntry':
          if (!can(userSession, 'del_staff')) return forbidden(corsHeaders);
          result = await PayrollStaffHandlers.deleteStaffEntry(db, userSession, body);
          break;

        case 'saveHrPayrollForm':
          if (!can(userSession, 'add')) return forbidden(corsHeaders);
          result = await PayrollStaffHandlers.saveHrPayrollForm(db, userSession, body);
          break;

        case 'getPayrollSettings':
          result = await PayrollStaffHandlers.getPayrollSettings(db, body);
          break;

        case 'updatePayrollSettings':
          if (!can(userSession, 'grade')) return forbidden(corsHeaders);
          result = await PayrollStaffHandlers.updatePayrollSettings(db, userSession, body);
          break;

        // 👕 5. UNIFORM LEDGER ROUTES
        case 'getUniformData':
          result = await UniformHandlers.getUniformData(db, body);
          break;

        case 'saveUniformEntry':
          if (!can(userSession, 'add')) return forbidden(corsHeaders);
          result = await UniformHandlers.saveUniformEntry(db, userSession, body);
          break;

        case 'updateUniformEntry':
          if (!can(userSession, 'edit')) return forbidden(corsHeaders);
          result = await UniformHandlers.updateUniformEntry(db, userSession, body);
          break;

        case 'deleteUniformEntry':
          if (!can(userSession, 'del_uniform')) return forbidden(corsHeaders);
          result = await UniformHandlers.deleteUniformEntry(db, userSession, body);
          break;

        // 📖 6. OFFICE & KITCHEN EXPENSE BOOKS
        case 'getExpenseData':
          result = await OfficeKitHandlers.getExpenseData(db, body);
          break;

        case 'saveExpenseEntry':
          if (!can(userSession, 'add')) return forbidden(corsHeaders);
          result = await OfficeKitHandlers.saveExpenseEntry(db, userSession, body);
          break;

        case 'updateExpenseEntry':
        case 'updatePayrollEntry':
          if (!can(userSession, 'edit')) return forbidden(corsHeaders);
          result = await OfficeKitHandlers.updateExpenseEntry(db, userSession, body);
          break;

        case 'deleteExpenseEntry':
        case 'deletePayrollEntry':
          if (!can(userSession, 'del_ledger')) return forbidden(corsHeaders);
          result = await OfficeKitHandlers.deleteExpenseEntry(db, userSession, body);
          break;

        // 🏦 7. MAIN BANK & MAIN CASH BOOKS
        case 'getBankCashData':
          result = await BankCashHandlers.getBankCashData(db, body);
          break;

        case 'saveBankCashEntry':
          if (!can(userSession, 'add')) return forbidden(corsHeaders);
          result = await BankCashHandlers.saveBankCashEntry(db, userSession, body);
          break;

        case 'updateBankCashEntry':
          if (!can(userSession, 'edit')) return forbidden(corsHeaders);
          result = await BankCashHandlers.updateBankCashEntry(db, userSession, body);
          break;

        case 'deleteBankCashEntry':
          if (!can(userSession, 'del_ledger')) return forbidden(corsHeaders);
          result = await BankCashHandlers.deleteBankCashEntry(db, userSession, body);
          break;

        // 💰 8. MAIN INCOME BOOK
        case 'getIncomeData':
          result = await IncomeHandlers.getIncomeData(db, body);
          break;

        case 'saveIncomeEntry':
          if (!can(userSession, 'add')) return forbidden(corsHeaders);
          result = await IncomeHandlers.saveIncomeEntry(db, userSession, body);
          break;

        case 'updateIncomeEntry':
          if (!can(userSession, 'edit')) return forbidden(corsHeaders);
          result = await IncomeHandlers.updateIncomeEntry(db, userSession, body);
          break;

        case 'deleteIncomeEntry':
          if (!can(userSession, 'del_ledger')) return forbidden(corsHeaders);
          result = await IncomeHandlers.deleteIncomeEntry(db, userSession, body);
          break;

        // 📖 9. CASHIER SUB-LEDGER BOOKS
        case 'getCashierData':
          result = await CashierHandlers.getCashierData(db, body);
          break;

        case 'getTodayIncomeForCashier':
          result = await CashierHandlers.getTodayIncomeForCashier(db, body);
          break;

        case 'saveCashierEntry':
          if (!can(userSession, 'add') && !can(userSession, 'del_cashier')) return forbidden(corsHeaders);
          result = await CashierHandlers.saveCashierEntry(db, userSession, body);
          break;

        case 'updateCashierEntry':
          if (!can(userSession, 'edit') && !can(userSession, 'del_cashier')) return forbidden(corsHeaders);
          result = await CashierHandlers.updateCashierEntry(db, userSession, body);
          break;

        case 'deleteCashierEntry':
        case 'deleteLedgerEntry':
          if (!can(userSession, 'del_cashier') && !can(userSession, 'del_ledger')) return forbidden(corsHeaders);
          result = await CashierHandlers.deleteCashierEntry(db, userSession, body);
          break;

        // 🏷️ 10. PROMOTION REFERENCE MATRIX
        case 'getPromotionData':
          result = await PromotionHandlers.getPromotionData(db, body);
          break;

        case 'savePromotionEntry':
          if (!can(userSession, 'add')) return forbidden(corsHeaders);
          result = await PromotionHandlers.savePromotionEntry(db, userSession, body);
          break;

        case 'updatePromotionEntry':
          if (!can(userSession, 'edit')) return forbidden(corsHeaders);
          result = await PromotionHandlers.updatePromotionEntry(db, userSession, body);
          break;

        case 'deletePromotionEntry':
          if (!can(userSession, 'del_promo') && !can(userSession, 'del_ledger')) return forbidden(corsHeaders);
          result = await PromotionHandlers.deletePromotionEntry(db, userSession, body);
          break;

        // 📈 11. FINANCIAL & DEMOGRAPHIC REPORTS
        case 'getFinancialReportData':
          result = await ReportHandlers.getFinancialReportData(db, body);
          break;

        case 'getIncomeDetailReportData':
          result = await ReportHandlers.getIncomeDetailReportData(db, body);
          break;

        case 'getMonthlyIncomeReportData':
          result = await ReportHandlers.getMonthlyIncomeReportData(db, body);
          break;

        case 'getStudentReportDetails':
          result = await ReportHandlers.getStudentReportDetails(db, body);
          break;

        case 'getFundReportData':
          result = await ReportHandlers.getFundReportData(db, body);
          break;

        // 🎒 12. STUDENT MONEY LEDGER ROUTES
        case 'getStudentMoneyData':
          result = await StudentMoneyHandlers.getStudentMoneyData(db, body);
          break;

        case 'saveStudentMoneyEntry':
          if (!can(userSession, 'add')) return forbidden(corsHeaders);
          result = await StudentMoneyHandlers.saveStudentMoneyEntry(db, userSession, body);
          break;

        case 'updateStudentMoneyEntry':
          if (!can(userSession, 'edit')) return forbidden(corsHeaders);
          result = await StudentMoneyHandlers.updateStudentMoneyEntry(db, userSession, body);
          break;

        case 'deleteStudentMoneyEntry':
          if (!can(userSession, 'del_ledger')) return forbidden(corsHeaders);
          result = await StudentMoneyHandlers.deleteStudentMoneyEntry(db, userSession, body);
          break;

        // ⚙️ 13. SYSTEM SETTINGS & CONTROLS ROUTES
        case 'getSettingsData':
          result = await SettingsHandlers.getSettingsData(db, body);
          break;

        case 'exportBookDataByFy':
        case 'exportGroupDataByFy':
          result = await SettingsHandlers.exportGroupDataByFy(db, body);
          break;

        case 'sendEmailBackupByFy':
        case 'sendGroupEmailBackupByFy':
          if (!can(userSession, 'backup')) return forbidden(corsHeaders);
          result = await SettingsHandlers.sendGroupEmailBackupByFy(db, userSession, body, env);
          break;

        default:
          return new Response(JSON.stringify({ success: false, message: `Action '${action}' မဟုတ်ပါ သို့မဟုတ် မပံ့ပိုးသေးပါ။` }), { headers: corsHeaders });
      }

      return new Response(JSON.stringify(result || { success: true }), { headers: corsHeaders });

    } catch (err) {
      console.error("Worker Execution Catch:", err);
      return new Response(JSON.stringify({
        success: false,
        message: "Server အတွင်း အမှားအယွင်း ဖြစ်ပေါ်နေပါသည်။",
        detail: err.message || String(err)
      }), { status: 500, headers: corsHeaders });
    }
  }
};
