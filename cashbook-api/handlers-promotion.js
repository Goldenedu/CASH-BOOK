/**
 * GOLDEN ERP SYSTEM - PROMOTION MATRIX HANDLER (CLOUDFLARE D1)
 * File: handlers-promotion.js
 * 💡 Features: Promotion Rates CRUD Engine with Snake_case & CamelCase D1 Schema Normalization,
 *              FY-Scoped Filtering, Duplicate Rate Prevention & Integer Sequence NO Reset
 */

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
 * 💡 Fetch Promotion Fee Rates Matrix Data
 */
export async function getPromotionData(db, body) {
  try {
    const search = String(body.searchVal || "").trim();
    const fyFilter = body.fy ? normalizeFyStr(body.fy) : "";

    let whereClauses = [];
    let params = [];

    // 💡 Explicit FY Filter
    if (fyFilter) {
      whereClauses.push(`(fy = ? OR fy = ?)`);
      params.push(fyFilter, `FY ${fyFilter}`);
    }

    // Search Query (class, category, remark, fy)
    if (search) {
      whereClauses.push(`(fy LIKE ? OR class LIKE ? OR category LIKE ? OR remark LIKE ?)`);
      const p = `%${search}%`;
      params.push(p, p, p, p);
    }

    const whereSql = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
    const query = `SELECT * FROM promotion ${whereSql} ORDER BY fy DESC, id ASC LIMIT 500`;

    const rows = await db.prepare(query).bind(...params).all();
    const rawList = rows.results || [];

    const list = rawList.map((item, idx) => ({
      id: item.id,
      no: Math.floor(parseFloat(item.no || (idx + 1))),
      fy: item.fy || '2026-2027',
      class: item.class || '',
      category: item.category || '',
      registration: parseFloat(item.registration || 0),
      originalPrice: parseFloat(item.original_price !== undefined ? item.original_price : (item.originalPrice || 0)),
      proA: parseFloat(item.pro_a !== undefined ? item.pro_a : (item.proA || 0)),
      proB: parseFloat(item.pro_b !== undefined ? item.pro_b : (item.proB || 0)),
      proC: parseFloat(item.pro_c !== undefined ? item.pro_c : (item.proC || 0)),
      proD: parseFloat(item.pro_d !== undefined ? item.pro_d : (item.proD || 0)),
      proE: parseFloat(item.pro_e !== undefined ? item.pro_e : (item.proE || 0)),
      halfScholar: parseFloat(item.half_scholar !== undefined ? item.half_scholar : (item.halfScholar || 0)),
      fullScholar: parseFloat(item.full_scholar !== undefined ? item.full_scholar : (item.fullScholar || 0)),
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
    const uniqueid = body.uniqueId || `PRO_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const createdBy = userSession?.name || userSession?.username || body.createdBy || "Admin";

    const fy = normalizeFyStr(body.fy || "2026-2027");
    const className = String(body.class || '').trim();
    const category = String(body.category || '').trim();

    // 💡 Duplicate Check: Prevent identical FY + Class + Category rate rows
    if (className && category) {
      const existing = await db.prepare(
        `SELECT id FROM promotion WHERE (fy = ? OR fy = ?) AND LOWER(class) = LOWER(?) AND LOWER(category) = LOWER(?)`
      ).bind(fy, `FY ${fy}`, className, category).first();

      if (existing) {
        return {
          success: false,
          message: `"${fy}" ပညာသင်နှစ်အတွက် "${className} (${category})" နှုန်းထား စာရင်းရှိနှင့်ပြီးဖြစ်ပါသည်။ ကျေးဇူးပြု၍ မူရင်းစာရင်းကို Edit ပြုလုပ်ပေးပါ။`
        };
      }
    }

    const maxNoRow = await db.prepare(
      "SELECT MAX(CAST(no AS INTEGER)) as maxNo FROM promotion WHERE fy = ? OR fy = ?"
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

    const fy = normalizeFyStr(body.fy || "2026-2027");

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