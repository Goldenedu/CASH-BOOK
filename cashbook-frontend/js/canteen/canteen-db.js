/**
 * ==============================================================================
 * GOLDEN ERP - CANTEEN INDEXED-DB OFFLINE ENGINE
 * File: js/canteen/canteen-db.js
 * 
 * 💡 Features:
 *   1. 📦 Local Catalog Store (Offline Barcode Scanning)
 *   2. 🎓 Student Wallet Snapshot (Offline Balance Deduction)
 *   3. ⏳ Pending Sync Queue (Zero Double-Deduction Idempotency)
 *   4. ⚙️ POS Settings Cache (Offline Daily Cap Enforcement)
 * ==============================================================================
 */

const DB_NAME = 'GoldenCanteenOfflineDB';
const DB_VERSION = 1;
let gIndexedDB = null;

// 🎯 Initialize IndexedDB
function initCanteenDB() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      console.warn("[IndexedDB] Browser does not support IndexedDB.");
      return resolve(null);
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      // 1. Products Store
      if (!db.objectStoreNames.contains('items_store')) {
        db.createObjectStore('items_store', { keyPath: 'barcode' });
      }

      // 2. Student Pocket Money Store
      if (!db.objectStoreNames.contains('students_store')) {
        const stuStore = db.createObjectStore('students_store', { keyPath: 'studentId' });
        stuStore.createIndex('fyid', 'fyid', { unique: false });
      }

      // 3. Pending Orders Queue (Sync Queue)
      if (!db.objectStoreNames.contains('pending_orders_store')) {
        db.createObjectStore('pending_orders_store', { keyPath: 'uniqueId' });
      }

      // 4. POS Settings Store
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
      reject(e.target.error);
    };
  });
}

// ------------------------------------------------------------------------------
// 📦 Items Store Helpers
// ------------------------------------------------------------------------------
async function dbSaveItems(items = []) {
  if (!gIndexedDB || !items.length) return;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('items_store', 'readwrite');
    const store = tx.objectStore('items_store');
    items.forEach(it => {
      if (it.barcode) store.put(it);
    });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function dbGetItem(barcode) {
  if (!gIndexedDB || !barcode) return null;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('items_store', 'readonly');
    const req = tx.objectStore('items_store').get(barcode);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => resolve(null);
  });
}

async function dbGetAllItems() {
  if (!gIndexedDB) return [];
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('items_store', 'readonly');
    const req = tx.objectStore('items_store').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function dbUpdateItemStock(barcode, deltaQty) {
  if (!gIndexedDB || !barcode) return;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('items_store', 'readwrite');
    const store = tx.objectStore('items_store');
    const req = store.get(barcode);
    req.onsuccess = () => {
      const item = req.result;
      if (item) {
        item.currentStock = Math.max(0, Number(item.currentStock || 0) - deltaQty);
        store.put(item);
      }
      resolve(true);
    };
    req.onerror = () => resolve(false);
  });
}

// ------------------------------------------------------------------------------
// 🎓 Students Store Helpers
// ------------------------------------------------------------------------------
async function dbSaveStudents(students = []) {
  if (!gIndexedDB || !students.length) return;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('students_store', 'readwrite');
    const store = tx.objectStore('students_store');
    students.forEach(s => {
      const sid = parseInt(s.studentId || s.student_id || s.id, 10);
      if (sid) {
        store.put({
          studentId: sid,
          fyid: String(s.fyid || ''),
          name: s.name || s.fyidName || '',
          studentClass: s.class || s.studentClass || '',
          currentBalance: parseFloat(s.currentBalance || s.netBalance || s.balances || 0),
          todaySpent: parseFloat(s.todaySpent || 0)
        });
      }
    });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function dbGetStudent(query) {
  if (!gIndexedDB || !query) return null;
  const qStr = String(query).trim().toLowerCase();
  const qNum = parseInt(qStr, 10);

  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('students_store', 'readonly');
    const store = tx.objectStore('students_store');

    if (!isNaN(qNum)) {
      const req = store.get(qNum);
      req.onsuccess = () => {
        if (req.result) return resolve(req.result);
        searchByFyid();
      };
      req.onerror = () => searchByFyid();
    } else {
      searchByFyid();
    }

    function searchByFyid() {
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor) {
          const s = cursor.value;
          if (String(s.fyid).toLowerCase() === qStr || String(s.name).toLowerCase().includes(qStr)) {
            return resolve(s);
          }
          cursor.continue();
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    }
  });
}

async function dbDeductStudentWallet(studentId, amount) {
  if (!gIndexedDB || !studentId) return;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('students_store', 'readwrite');
    const store = tx.objectStore('students_store');
    const req = store.get(parseInt(studentId, 10));
    req.onsuccess = () => {
      const s = req.result;
      if (s) {
        s.currentBalance = Math.max(0, s.currentBalance - amount);
        s.todaySpent = (s.todaySpent || 0) + amount;
        store.put(s);
      }
      resolve(true);
    };
    req.onerror = () => resolve(false);
  });
}

// ------------------------------------------------------------------------------
// ⏳ Pending Orders Queue Helpers
// ------------------------------------------------------------------------------
async function dbSavePendingOrder(order) {
  if (!gIndexedDB || !order || !order.uniqueId) return false;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('pending_orders_store', 'readwrite');
    const store = tx.objectStore('pending_orders_store');
    store.put(order);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function dbGetPendingOrders() {
  if (!gIndexedDB) return [];
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('pending_orders_store', 'readonly');
    const req = tx.objectStore('pending_orders_store').getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => resolve([]);
  });
}

async function dbDeletePendingOrder(uniqueId) {
  if (!gIndexedDB || !uniqueId) return;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('pending_orders_store', 'readwrite');
    tx.objectStore('pending_orders_store').delete(uniqueId);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function dbClearPendingOrders() {
  if (!gIndexedDB) return;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('pending_orders_store', 'readwrite');
    tx.objectStore('pending_orders_store').clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

// ------------------------------------------------------------------------------
// ⚙️ Settings Store Helpers
// ------------------------------------------------------------------------------
async function dbSaveSetting(key, val) {
  if (!gIndexedDB || !key) return;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('settings_store', 'readwrite');
    tx.objectStore('settings_store').put({ settingKey: key, settingValue: String(val) });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
}

async function dbGetSetting(key) {
  if (!gIndexedDB || !key) return null;
  return new Promise((resolve) => {
    const tx = gIndexedDB.transaction('settings_store', 'readonly');
    const req = tx.objectStore('settings_store').get(key);
    req.onsuccess = () => resolve(req.result ? req.result.settingValue : null);
    req.onerror = () => resolve(null);
  });
}

// Expose DB module globally
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
window.dbDeletePendingOrder = dbDeletePendingOrder;
window.dbClearPendingOrders = dbClearPendingOrders;
window.dbSaveSetting = dbSaveSetting;
window.dbGetSetting = dbGetSetting;