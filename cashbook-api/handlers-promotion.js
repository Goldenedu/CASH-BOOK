/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - PROMOTION MATRIX HANDLER (CLOUDFLARE D1)
 * File: handlers-promotion.js 
 * 💡 Features: Refactored with utils.js for DRY Principle
 *              🚀 OPTIMIZED: Explicit Column Selects (Avoided SELECT *)
 *              🚀 ULTRA-OPTIMIZED: Prevented Full Table Scans. Replaced OR with IN().
 * ==============================================================================
 */

import { normalizeFyClean, generateUniqueId } from './utils.js';

/**
 * 💡 Fetch Promotion Fee Rates Matrix Data
 */
export async function getPromotionData(db, body) {
  try {
    const search = String(body.searchVal || "").trim();
    const fyFilter = body.fy ? normalizeFyClean(body.fy) : "";

    let whereClauses = [];
    let params = [];

    // 🚀 ULTRA-OPTIMIZATION: Replace OR with IN() to leverage Index Seek
    if (fyFilter) {
      whereClauses.push(`(fy IN (?, ?))`);
      params.push(fyFilter, `FY ${fyFilter}`);
    }

    // Search Query (class, category, remark, fy)
    if (search) {
      whereClauses.push(`(fy LIKE ? OR class LIKE ? OR category LIKE ? OR remark LIKE ?)`);
      const p = `%${search}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
    
    // 🚀 OPTIMIZATION: Avoid SELECT *, fetch only necessary columns
    const query = `
      SELECT id, no, fy, class, category, registration, original_price, pro_a, pro_b, pro_c, pro_d, pro_e, half_scholar, full_scholar, remark, uniqueid 
      FROM promotion 
      ${whereSql} 
      ORDER BY fy DESC, id ASC 
      LIMIT 500
    `;

    const rows = await db.prepare(query).bind(...params).all();
    const rawList = rows.results || [];

    const list = rawList.map((item, idx) => ({
      id: item.id,
      no: Math.floor(parseFloat(item.no || (idx + 1))),
      fy: item.fy || '2026-2027',
      class: item.class || '',
      category: item.category || '',
      registration: parseFloat(item.registration || 0),
      originalPrice: parseFloat(item.original_price || 0),
      proA: parseFloat(item.pro_a || 0),
      proB: parseFloat(item.pro_b || 0),
      proC: parseFloat(item.pro_c || 0),
      proD: parseFloat(item.pro_d || 0),
      proE: parseFloat(item.pro_e || 0),
      halfScholar: parseFloat(item.half_scholar || 0),
      fullScholar: parseFloat(item.full_scholar || 0),
      remark: item.remark || '',
      uniqueId: item.uniqueid || item.uniqueId || `PRO_${item.id}`
    }));

    return {
      success: true,
      data: list,
      totalRows: list.length
    };
  } catch (err) {
    console.error("Error in getPromotionData handler:", err);
    return {
      success: false,
      message: "Promotion Data ခေါ်ယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Save New Promotion Rate Entry (With Dual Payload Keys & Duplicate Protection)
 */
export async function savePromotionEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || generateUniqueId('PRO');
    const createdBy = userSession?.name || userSession?.username || body.createdBy || "Admin";

    const fy = normalizeFyClean(body.fy || "2026-2027");
    const className = String(body.class || '').trim();
    const category = String(body.category || '').trim();

    // 💡 Duplicate Check: Prevent identical FY + Class + Category rate rows
    // 🚀 ULTRA-OPTIMIZATION: Replace OR with IN() to leverage Index Seek
    if (className && category) {
      const existing = await db.prepare(
        `SELECT id FROM promotion WHERE fy IN (?, ?) AND LOWER(class) = LOWER(?) AND LOWER(category) = LOWER(?)`
      ).bind(fy, `FY ${fy}`, className, category).first();

      if (existing) {
        return {
          success: false,
          message: `"${fy}" ပညာသင်နှစ်အတွက် "${className} (${category})" နှုန်းထား စာရင်းရှိနှင့်ပြီးဖြစ်ပါသည်။ ကျေးဇူးပြု၍ မူရင်းစာရင်းကို Edit ပြုလုပ်ပေးပါ။`
        };
      }
    }

    // 🚀 ULTRA-OPTIMIZATION: Replace OR with IN()
    const maxNoRow = await db.prepare(
      "SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM promotion WHERE fy IN (?, ?)"
    ).bind(fy, `FY ${fy}`).first();
    const nextNo = (maxNoRow && maxNoRow.maxNo ? parseInt(maxNoRow.maxNo, 10) : 0) + 1;

    const stmt = `
      INSERT INTO promotion (
        no, fy, class, category, registration, original_price, pro_a, pro_b, pro_c, pro_d, pro_e, half_scholar, full_scholar, remark, created_by, created_at, uniqueid
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    await db.prepare(stmt).bind(
      nextNo,
      fy,
      className,
      category,
      parseFloat(body.registration || 0),
      parseFloat(body.originalPrice ?? body.original_price ?? 0),
      parseFloat(body.proA ?? body.pro_a ?? 0),
      parseFloat(body.proB ?? body.pro_b ?? 0),
      parseFloat(body.proC ?? body.pro_c ?? 0),
      parseFloat(body.proD ?? body.pro_d ?? 0),
      parseFloat(body.proE ?? body.pro_e ?? 0),
      parseFloat(body.halfScholar ?? body.half_scholar ?? 0),
      parseFloat(body.fullScholar ?? body.full_scholar ?? 0),
      body.remark || '',
      createdBy,
      new Date().toISOString(),
      uniqueid
    ).run();

    return {
      success: true,
      message: "Promotion Rate နှုန်းထားများ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။",
      uniqueId: uniqueid
    };
  } catch (err) {
    console.error("Error in savePromotionEntry handler:", err);
    return {
      success: false,
      message: "Promotion Rate သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Update Existing Promotion Rate Entry (With Dual Payload Keys)
 */
export async function updatePromotionEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    const fy = normalizeFyClean(body.fy || "2026-2027");

    const stmt = `
      UPDATE promotion SET 
        fy = ?, class = ?, category = ?, registration = ?, original_price = ?,
        pro_a = ?, pro_b = ?, pro_c = ?, pro_d = ?, pro_e = ?,
        half_scholar = ?, full_scholar = ?, remark = ?
      WHERE uniqueid = ?
    `;

    await db.prepare(stmt).bind(
      fy,
      body.class || '',
      body.category || '',
      parseFloat(body.registration || 0),
      parseFloat(body.originalPrice ?? body.original_price ?? 0),
      parseFloat(body.proA ?? body.pro_a ?? 0),
      parseFloat(body.proB ?? body.pro_b ?? 0),
      parseFloat(body.proC ?? body.pro_c ?? 0),
      parseFloat(body.proD ?? body.pro_d ?? 0),
      parseFloat(body.proE ?? body.pro_e ?? 0),
      parseFloat(body.halfScholar ?? body.half_scholar ?? 0),
      parseFloat(body.fullScholar ?? body.full_scholar ?? 0),
      body.remark || '',
      uniqueid
    ).run();

    return {
      success: true,
      message: "Promotion Rate နှုန်းထားများ အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in updatePromotionEntry handler:", err);
    return {
      success: false,
      message: "Promotion Rate ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}

/**
 * 💡 Delete Promotion Rate Entry
 */
export async function deletePromotionEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    if (!uniqueid) {
      return { success: false, message: "Unique ID မပါဝင်ပါ။" };
    }

    await db.prepare("DELETE FROM promotion WHERE uniqueid = ?").bind(uniqueid).run();

    return {
      success: true,
      message: "Promotion Rate နှုန်းထား အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။"
    };
  } catch (err) {
    console.error("Error in deletePromotionEntry handler:", err);
    return {
      success: false,
      message: "Promotion Rate ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message
    };
  }
}
