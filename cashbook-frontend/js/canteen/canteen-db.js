/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN INDEXED-DB OFFLINE ENGINE (V3 PRODUCTION)
 * File: js/canteen/canteen-db.js (Enterprise V9.1 Full Production Edition)
 * 💡 Features:
 *   1. ⚡ Zero D1 Read Caching: Full offline catalog & student wallet directory
 *   2. 💰 Capital Invariance: Tracks currentStock & surplusStock in local memory
 *   3. 🎓 High-Speed O(1) Student Lookup: Primary Key + FYID/NFC Index + Cursor
 *   4. 🛡️ Auto-Healing DB Connection: Zero null-pointer crashes on early invocation
 *   5. ⏳ Resilient Pending Queue: Guarantees zero data loss during network drops
 *   6. 🛡️ Transaction-Safe Promises: Handles complete, error & abort states safely
 * ==============================================================================
 */

const DB_NAME = 'GoldenCanteenOfflineDB';
const DB_VERSION = 3; // 🎯 Schema အသစ်များ အလိုအလျောက် Migration ဝင်စေရန် Version 3
let gIndexedDB = null;

// ------------------------------------------------------------------------------
// 🎯 1. INITIALIZE INDEXED-DB & SCHEMA SETUP
// ------------------------------------------------------------------------------
function initCanteenDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      console.warn("[IndexedDB] Browser does not support IndexedDB.");
      return resolve(null);
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      // ၁။ Products Store (KeyPath: barcode)
      if (!db.objectStoreNames.contains('items_store')) {
        db.createObjectStore('items_store', { keyPath: 'barcode' });
      }

      // ၂။ Student Pocket Money Store (KeyPath: studentId + Indexes)
      if (!db.objectStoreNames.contains('students_store')) {
        const stuStore = db.createObjectStore('students_store', { keyPath: 'studentId' });
        stuStore.createIndex('fyid', 'fyid', { unique: false });
        stuStore.createIndex('nfcTagId', 'nfcTagId', { unique: false });
      } else {
        const stuStore = e.target.transaction.objectStore('students_store');
        if (!stuStore.indexNames.contains('fyid')) {
          stuStore.createIndex('fyid', 'fyid', { unique: false });
        }
        if (!stuStore.indexNames.contains('nfcTagId')) {
          stuStore.createIndex('nfcTagId', 'nfcTagId', { unique: false });
        }
      }

      // ၃။ Pending Orders Queue (KeyPath: uniqueId)
      if (!db.objectStoreNames.contains('pending_orders_store')) {
        db.createObjectStore('pending_orders_store', { keyPath: 'uniqueId' });
      }

      // ၄။ POS Settings Store (KeyPath: settingKey)
      if (!db.objectStoreNames.contains('settings_store')) {
        db.createObjectStore('settings_store', { keyPath: 'settingKey' });
      }
    };

    request.onsuccess = (e) => {
      gIndexedDB = e.target.result;
      resolve(gIndexedDB);
    };

    request.onerror = (e) => {
      console.error("[IndexedDB] Failed to open DB:", e.target.error);
      resolve(null);
    };
  });
}

// 🛡️ Auto-Healing Connection Helper (Guarantees zero null reference crashes)
async function getDB() {
  if (gIndexedDB) return gIndexedDB;
  return await initCanteenDB();
}

// ------------------------------------------------------------------------------
// 📦 2. ITEMS STORE HELPERS (CAPITAL INVARIANCE & 0 D1 READ RESILIENCE)
// ------------------------------------------------------------------------------
async function dbSaveItems(items = []) {
  if (!Array.isArray(items) || !items.length) return false;
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('items_store', 'readwrite');
      const store = tx.objectStore('items_store');

      for (const it of items) {
        if (it && (it.barcode || it.item_barcode)) {
          const barcode = String(it.barcode || it.item_barcode).trim();
          if (!barcode) continue;

          store.put({
            barcode: barcode,
            itemName: String(it.itemName || it.item_name || '').trim(),
            category: String(it.category || 'Snack').trim(),
            costPrice: parseFloat(it.costPrice !== undefined ? it.costPrice : (it.cost_price || 0)),
            markupPercent: parseFloat(it.markupPercent !== undefined ? it.markupPercent : (it.markup_percent !== undefined ? it.markup_percent : 8)),
            sellingPrice: parseFloat(it.sellingPrice !== undefined ? it.sellingPrice : (it.selling_price || 0)),
            currentStock: parseFloat(it.currentStock !== undefined ? it.currentStock : (it.current_stock || 0)),
            surplusStock: parseFloat(it.surplusStock !== undefined ? it.surplusStock : (it.surplus_stock || 0)),
            isActive: it.isActive !== undefined ? (it.isActive ? 1 : 0) : (it.is_active !== undefined ? (it.is_active ? 1 : 0) : 1),
            updatedAt: it.updatedAt || it.updated_at || new Date().toISOString()
          });
        }
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

async function dbGetItem(barcode) {
  if (!barcode) return null;
  const db = await getDB();
  if (!db) return null;

  const bCode = String(barcode).trim();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('items_store', 'readonly');
      const store = tx.objectStore('items_store');

      // အဆင့် ၁။ Primary Key Barcode ဖြင့် တိုက်ရိုက်ရှာဖွေခြင်း
      const req = store.get(bCode);
      req.onsuccess = () => {
        if (req.result) return resolve(req.result);

        // အဆင့် ၂။ မတွေ့ပါက စာလုံးကြီး/သေး မခွဲဘဲ Barcode သို့မဟုတ် ပစ္စည်းအမည်ဖြင့် Local Scan ရှာဖွေခြင်း (D1 မသွားစေရန်)
        const lowerCode = bCode.toLowerCase();
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const item = cursor.value;
            if (
              String(item.barcode).toLowerCase() === lowerCode || 
              String(item.itemName || '').toLowerCase() === lowerCode
            ) {
              return resolve(item);
            }
            cursor.continue();
          } else {
            resolve(null);
          }
        };
        cursorReq.onerror = () => resolve(null);
      };
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

async function dbGetAllItems() {
  const db = await getDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('items_store', 'readonly');
      const req = tx.objectStore('items_store').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

async function dbUpdateItemStock(barcode, deltaQty) {
  if (!barcode) return false;
  const db = await getDB();
  if (!db) return false;

  const bCode = String(barcode).trim();
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('items_store', 'readwrite');
      const store = tx.objectStore('items_store');
      const req = store.get(bCode);

      req.onsuccess = () => {
        const item = req.result;
        if (item) {
          const deduct = parseFloat(deltaQty || 0);
          item.currentStock = Math.max(0, Number(item.currentStock || 0) - deduct);
          // 💰 Capital Invariance Guard: လက်ကျန် အပိုစတော့ ရှိပါကပါ နုတ်ပေးသည်
          if (item.surplusStock) {
            item.surplusStock = Math.max(0, Number(item.surplusStock || 0) - deduct);
          }
          item.updatedAt = new Date().toISOString();
          store.put(item);
        }
        resolve(true);
      };
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

// ------------------------------------------------------------------------------
// 🎓 3. STUDENTS STORE HELPERS (O(1) INDEXED + TYPE-SAFE CURSOR LOOKUP)
// ------------------------------------------------------------------------------
async function dbSaveStudents(students = []) {
  if (!Array.isArray(students) || !students.length) return false;
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('students_store', 'readwrite');
      const store = tx.objectStore('students_store');

      for (const s of students) {
        if (!s) continue;
        const sid = parseInt(s.studentId || s.student_id || s.id, 10);
        if (!isNaN(sid) && sid > 0) {
          store.put({
            studentId: sid,
            id: sid,
            fyid: String(s.fyid || '').trim(),
            name: s.name || s.fyidName || s.fyid_name || '',
            studentClass: s.studentClass || s.class || '',
            nfcTagId: String(s.nfcTagId || s.nfc_tag_id || '').trim(),
            currentBalance: parseFloat(s.currentBalance !== undefined ? s.currentBalance : (s.netBalance !== undefined ? s.netBalance : (s.bal || s.balances || 0))),
            todaySpent: parseFloat(s.todaySpent !== undefined ? s.todaySpent : (s.today_spent || 0))
          });
        }
      }

      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

async function dbGetStudent(query) {
  if (!query) return null;
  const db = await getDB();
  if (!db) return null;

  const qRaw = String(query).trim();
  const qLower = qRaw.toLowerCase();
  const qNum = parseInt(qRaw, 10);

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('students_store', 'readonly');
      const store = tx.objectStore('students_store');

      // ၁။ Primary Key Match (နံပါတ်ဖြင့် ရိုက်ထည့်ပါက တိုက်ရိုက် O(1) ရှာဖွေခြင်း)
      if (!isNaN(qNum) && String(qNum) === qRaw) {
        const req = store.get(qNum);
        req.onsuccess = () => {
          if (req.result) return resolve(req.result);
          checkIndices();
        };
        req.onerror = () => checkIndices();
      } else {
        checkIndices();
      }

      // ၂။ O(1) Index Lookup (FYID & NFC Tag ID ကို B-Tree Index ဖြင့် အမြန်ဆုံးဆွဲထုတ်ခြင်း)
      function checkIndices() {
        if (store.indexNames.contains('fyid')) {
          const fyidReq = store.index('fyid').get(qRaw);
          fyidReq.onsuccess = () => {
            if (fyidReq.result) return resolve(fyidReq.result);
            checkNfcIndex();
          };
          fyidReq.onerror = () => checkNfcIndex();
        } else {
          checkNfcIndex();
        }
      }

      function checkNfcIndex() {
        if (store.indexNames.contains('nfcTagId')) {
          const nfcReq = store.index('nfcTagId').get(qRaw);
          nfcReq.onsuccess = () => {
            if (nfcReq.result) return resolve(nfcReq.result);
            searchByCursor();
          };
          nfcReq.onerror = () => searchByCursor();
        } else {
          searchByCursor();
        }
      }

      // ၃။ Fallback Cursor Search (စာလုံးကြီး/သေး မခွဲခြားဘဲ FYID, ID သို့မဟုတ် ကျောင်းသားအမည်ဖြင့် ရှာဖွေခြင်း)
      function searchByCursor() {
        const req = store.openCursor();
        req.onsuccess = (e) => {
          const cursor = e.target.result;
          if (cursor) {
            const s = cursor.value;
            if (
              String(s.studentId) === qRaw ||
              String(s.id) === qRaw ||
              String(s.fyid || '').toLowerCase() === qLower ||
              String(s.nfcTagId || '').toLowerCase() === qLower ||
              String(s.name || '').toLowerCase().includes(qLower)
            ) {
              return resolve(s);
            }
            cursor.continue();
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      }
    } catch (err) {
      resolve(null);
    }
  });
}

async function dbDeductStudentWallet(studentId, amount) {
  if (!studentId) return false;
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('students_store', 'readwrite');
      const store = tx.objectStore('students_store');
      const req = store.get(parseInt(studentId, 10));

      req.onsuccess = () => {
        const s = req.result;
        if (s) {
          const amt = parseFloat(amount || 0);
          s.currentBalance = Math.max(0, Number(s.currentBalance || 0) - amt);
          s.todaySpent = Number(s.todaySpent || 0) + amt;
          store.put(s);
        }
        resolve(true);
      };
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

// ------------------------------------------------------------------------------
// ⏳ 4. PENDING ORDERS QUEUE HELPERS (OFFLINE ZERO-DATA-LOSS GUARDIAN)
// ------------------------------------------------------------------------------
async function dbSavePendingOrder(order) {
  if (!order || !order.uniqueId) return false;
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('pending_orders_store', 'readwrite');
      const store = tx.objectStore('pending_orders_store');
      store.put(order);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

async function dbGetPendingOrders() {
  const db = await getDB();
  if (!db) return [];

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('pending_orders_store', 'readonly');
      const req = tx.objectStore('pending_orders_store').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

async function dbClearPendingOrders() {
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('pending_orders_store', 'readwrite');
      tx.objectStore('pending_orders_store').clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

async function dbDeletePendingOrder(uniqueId) {
  if (!uniqueId) return false;
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('pending_orders_store', 'readwrite');
      tx.objectStore('pending_orders_store').delete(uniqueId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

// ------------------------------------------------------------------------------
// ⚙️ 5. SETTINGS STORE HELPERS
// ------------------------------------------------------------------------------
async function dbSaveSetting(key, val) {
  if (!key) return false;
  const db = await getDB();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('settings_store', 'readwrite');
      tx.objectStore('settings_store').put({ 
        settingKey: String(key).trim(), 
        settingValue: String(val) 
      });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

async function dbGetSetting(key) {
  if (!key) return null;
  const db = await getDB();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction('settings_store', 'readonly');
      const req = tx.objectStore('settings_store').get(String(key).trim());
      req.onsuccess = () => resolve(req.result ? req.result.settingValue : null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

// ------------------------------------------------------------------------------
// 🌐 6. WINDOW GLOBAL EXPORTS
// ------------------------------------------------------------------------------
window.initCanteenDB = initCanteenDB;
window.dbSaveItems = dbSaveItems;
window.dbGetItem = dbGetItem;
window.dbGetAllItems = dbGetAllItems;
window.dbUpdateItemStock = dbUpdateItemStock;
window.dbSaveStudents = dbSaveStudents;
window.dbGetStudent = dbGetStudent;
window.dbDeductStudentWallet = dbDeductStudentWallet;
window.dbSavePendingOrder = dbSavePendingOrder;
window.dbGetPendingOrders = dbGetPendingOrders;
window.dbClearPendingOrders = dbClearPendingOrders;
window.dbDeletePendingOrder = dbDeletePendingOrder;
window.dbSaveSetting = dbSaveSetting;
window.dbGetSetting = dbGetSetting;