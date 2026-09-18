/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - UNIFORM INVENTORY D1 SQL HANDLER MODULE
 * File: handlers-uniform.js (Location: cashbook-api/handlers-uniform.js)
 * 💡 Features: Refactored with utils.js for DRY Principle
 *              🚀 OPTIMIZED: Aggregations natively in SQL (SUM/COUNT), Avoided SELECT *
 * ==============================================================================
 */

import { generateUniqueId } from './utils.js';

/**
 * 💡 Fetch Uniform Inventory Data
 */
export async function getUniformData(db, body) {
  try {
    const search = String(body.searchVal || "").trim();
    const page = parseInt(body.page, 10) || 1;
    const limit = parseInt(body.limit, 10) || 1000;
    const offset = (page - 1) * limit;

    let whereClauses = [];
    let params = [];

    if (search) {
      whereClauses.push(`(product_id LIKE ? OR product_name LIKE ? OR type LIKE ? OR size LIKE ?)`);
      const p = `%${search}%`;
      params = [p, p, p, p];
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // 🚀 OPTIMIZATION 1: Fetch Aggregate Totals directly from SQL (Avoids iterating all rows in JS)
    const statsRow = await db.prepare(`
      SELECT 
        COUNT(id) as count,
        COALESCE(SUM(selling_unit), 0) as sellingUnit,
        COALESCE(SUM(current_qty), 0) as currentQty,
        COALESCE(SUM(total_stock_value), 0) as totalStockValue
      FROM uniform_ledger ${whereSql}
    `).bind(...params).first();

    const totalRows = statsRow ? statsRow.count : 0;
    const sellingUnit = statsRow ? parseFloat(statsRow.sellingUnit || 0) : 0;
    const currentQty = statsRow ? parseFloat(statsRow.currentQty || 0) : 0;
    const totalStockValue = statsRow ? parseFloat(statsRow.totalStockValue || 0) : 0;

    // 🚀 OPTIMIZATION 2: Explicit Columns Select
    const query = `
      SELECT id, no, product_id, product_name, type, size, opening_stock, unit_price, total_amount, selling_price, profit_amount, selling_unit, current_qty, total_stock_value, uniqueid 
      FROM uniform_ledger 
      ${whereSql} 
      ORDER BY id ASC 
      LIMIT ? OFFSET ?
    `;
    const rows = await db.prepare(query).bind(...params, limit, offset).all();
    const list = rows.results || [];

    return {
      success: true,
      data: list,
      totalRows: totalRows,
      stats: {
        sellingUnit,
        currentQty,
        totalStockValue,
        totalProduct: totalRows
      }
    };
  } catch (err) {
    console.error("Error in getUniformData handler:", err);
    return { success: false, message: "ယူနီဖောင်း စာရင်း ရယူရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Save New Uniform Product Entry
 */
export async function saveUniformEntry(db, userSession, body) {
  try {
    // ⚡ Refactored: Uses generateUniqueId from utils.js
    const uniqueid = body.uniqueId || body.uniqueid || generateUniqueId('UNI');
    const createdBy = userSession?.name || userSession?.username || body.createdBy || 'Admin';

    const maxNoRow = await db.prepare("SELECT MAX(CAST(no AS INTEGER)) as max_no FROM uniform_ledger").first();
    const currentMax = maxNoRow && maxNoRow.max_no ? parseInt(maxNoRow.max_no, 10) : 0;
    const nextNo = currentMax + 1;

    const openingStock = parseFloat(body.openingStock ?? body.opening_stock ?? 0);
    const unitPrice = parseFloat(body.unitPrice ?? body.unit_price ?? 0);
    const sellingPrice = parseFloat(body.sellingPrice ?? body.selling_price ?? 0);
    const sellingUnit = parseFloat(body.sellingUnit ?? body.selling_unit ?? 0);
    
    const totalAmount = openingStock * unitPrice;
    const profitAmount = sellingPrice - unitPrice;
    const currentQty = Math.max(0, openingStock - sellingUnit);
    const totalStockValue = currentQty * unitPrice;

    const rawPid = body.productId || body.product_id;
    const productIdVal = rawPid ? String(rawPid).trim() : `PID ${String(nextNo).padStart(3, '0')}`;

    const stmt = `INSERT INTO uniform_ledger (
      no, product_id, product_name, type, size, opening_stock, unit_price,
      total_amount, selling_price, profit_amount, selling_unit, current_qty,
      total_stock_value, created_by, created_at, uniqueid
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

    await db.prepare(stmt).bind(
      nextNo,
      productIdVal,
      body.productName || body.product_name || '',
      body.type || '',
      body.size || '',
      openingStock,
      unitPrice,
      totalAmount,
      sellingPrice,
      profitAmount,
      sellingUnit,
      currentQty,
      totalStockValue,
      createdBy,
      new Date().toISOString(),
      uniqueid
    ).run();

    return { 
      success: true, 
      message: "ယူနီဖောင်း ကုန်ပစ္စည်း အသစ် အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။", 
      uniqueId: uniqueid,
      productId: productIdVal
    };
  } catch (err) {
    console.error("Error in saveUniformEntry handler:", err);
    return { success: false, message: "ကုန်ပစ္စည်း သိမ်းဆည်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Update Uniform Product Entry (With Selling Unit Data Loss Protection)
 */
export async function updateUniformEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    const rowId = body.id;

    if (!uniqueid && !rowId) {
      return { success: false, message: "Unique ID သို့မဟုတ် Row ID မပါဝင်ပါ။" };
    }

    // 1. Fetch Existing Record to prevent wiping selling_unit
    const existing = await db.prepare(
      `SELECT opening_stock, selling_unit, unit_price, selling_price, product_id, product_name, type, size FROM uniform_ledger WHERE uniqueid = ? OR id = ? LIMIT 1`
    ).bind(uniqueid || '', rowId || 0).first();

    const existingSellingUnit = existing ? parseFloat(existing.selling_unit || 0) : 0;
    const openingStock = parseFloat(body.openingStock ?? body.opening_stock ?? (existing ? existing.opening_stock : 0));
    const unitPrice = parseFloat(body.unitPrice ?? body.unit_price ?? (existing ? existing.unit_price : 0));
    const sellingPrice = parseFloat(body.sellingPrice ?? body.selling_price ?? (existing ? existing.selling_price : 0));

    // Preserve selling_unit if not explicitly provided in update payload
    let sellingUnit = existingSellingUnit;
    if (body.sellingUnit !== undefined && body.sellingUnit !== null) {
      sellingUnit = parseFloat(body.sellingUnit);
    } else if (body.selling_unit !== undefined && body.selling_unit !== null) {
      sellingUnit = parseFloat(body.selling_unit);
    }

    const totalAmount = openingStock * unitPrice;
    const profitAmount = sellingPrice - unitPrice;
    const currentQty = Math.max(0, openingStock - sellingUnit);
    const totalStockValue = currentQty * unitPrice;

    const rawPid = body.productId || body.product_id;
    const productIdVal = rawPid ? String(rawPid).trim() : (existing ? existing.product_id : '');

    await db.prepare(`UPDATE uniform_ledger SET 
      product_id = ?, product_name = ?, type = ?, size = ?, opening_stock = ?, unit_price = ?, 
      total_amount = ?, selling_price = ?, profit_amount = ?, selling_unit = ?, 
      current_qty = ?, total_stock_value = ? 
      WHERE uniqueid = ? OR id = ?`).bind(
      productIdVal,
      body.productName || body.product_name || (existing ? existing.product_name : ''),
      body.type || (existing ? existing.type : ''),
      body.size || (existing ? existing.size : ''),
      openingStock,
      unitPrice,
      totalAmount,
      sellingPrice,
      profitAmount,
      sellingUnit,
      currentQty,
      totalStockValue,
      uniqueid || '',
      rowId || 0
    ).run();

    return { success: true, message: "ယူနီဖောင်း ကုန်ပစ္စည်း အချက်အလက်များ အောင်မြင်စွာ ပြင်ဆင်ပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in updateUniformEntry handler:", err);
    return { success: false, message: "ကုန်ပစ္စည်း ပြင်ဆင်ရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}

/**
 * 💡 Bulletproof Delete: Deletes by uniqueid OR D1 Row ID
 */
export async function deleteUniformEntry(db, userSession, body) {
  try {
    const uniqueid = body.uniqueId || body.uniqueid;
    const rowId = body.id;

    if (!uniqueid && !rowId) {
      return { success: false, message: "Unique ID သို့မဟုတ် Row ID မပါဝင်ပါ။" };
    }

    if (uniqueid) {
      await db.prepare("DELETE FROM uniform_ledger WHERE uniqueid = ?").bind(uniqueid).run();
    } else if (rowId) {
      await db.prepare("DELETE FROM uniform_ledger WHERE id = ?").bind(rowId).run();
    }

    return { success: true, message: "ယူနီဖောင်း ကုန်ပစ္စည်း မှတ်တမ်း အောင်မြင်စွာ ဖျက်သိမ်းပြီးပါပြီ။" };
  } catch (err) {
    console.error("Error in deleteUniformEntry handler:", err);
    return { success: false, message: "ကုန်ပစ္စည်း ဖျက်သိမ်းရာတွင် အမှားအယွင်း ဖြစ်ပေါ်ပါသည်: " + err.message };
  }
}
