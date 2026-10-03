-- ==============================================================================
-- GOLDEN ERP - CANTEEN POS SYSTEM SCHEMA (CLOUDFLARE D1 ENTERPRISE V9)
-- File: cashbook-api/schema-canteen-pos.sql
-- Architecture: Zero Full-Table-Scan, Atomic Concurrency, Quota-Shield
-- 💡 Key Features:
--   1. Capital Invariance: Surplus stock tracked separately without inflating capital
--   2. Default 8% Markup on Purchases & Catalog
--   3. Strict MMT UTC+06:30 Date & Voucher Synchronization
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- ၁။ ပစ္စည်းစာရင်း မာစတာဇယား (POS Items Master)
-- 💡 အဝယ်ဈေး၊ Default 8% Markup၊ Selling Price၊ စတော့နှင့် အပိုစတော့များ ထိန်းချုပ်သည်။
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_items_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT UNIQUE NOT NULL,                                       -- Barcode / QR စာသား (Primary Scan Key)
  item_name TEXT NOT NULL,                                            -- ကုန်ပစ္စည်းအမည်
  category TEXT NOT NULL DEFAULT 'Snack',                             -- အမျိုးအစား (Snack, Drink, Meal, Stationery)
  cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),         -- နောက်ဆုံး ဝယ်ဈေး (Unit Cost)
  markup_percent REAL NOT NULL DEFAULT 8 CHECK (markup_percent >= 0),  -- 🎯 သတ်မှတ်အမြတ် % (Default: 8%)
  selling_price REAL NOT NULL DEFAULT 0 CHECK (selling_price >= 0),   -- အတည်ပြုရောင်းဈေး (Smart 50/100 Rounded)
  current_stock REAL NOT NULL DEFAULT 0,                              -- စုစုပေါင်း လက်ကျန် Stock အရေအတွက်
  surplus_stock REAL NOT NULL DEFAULT 0 CHECK (surplus_stock >= 0),    -- 🎯 ရင်းနှီးငွေမတက်စေသော အပိုစတော့လက်ကျန်
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),   -- ရောင်းချမှု အဖွင့်/အပိတ် (1: Active, 0: Disabled)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ⚡ Barcode ရှာဖွေမှု O(1) အမြန်ဆုံးနှုန်း ရရှိစေရန် B-Tree Indexes
CREATE INDEX IF NOT EXISTS idx_pos_items_barcode ON pos_items_master(barcode);
CREATE INDEX IF NOT EXISTS idx_pos_items_active ON pos_items_master(is_active);

-- ------------------------------------------------------------------------------
-- ၂။ ကုန်သည် / ပစ္စည်းသွင်းသူစာရင်း (Suppliers Master)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_name TEXT UNIQUE NOT NULL,                                 -- ဆိုင်အမည် / ကုန်သည်အမည်
  contact_person TEXT,                                                -- ဆက်သွယ်ရမည့်သူ
  phone_no TEXT,                                                      -- ဖုန်းနံပါတ်
  address TEXT,                                                       -- လိပ်စာ
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------------------------
-- ၃။ အဝယ်စာရင်း (POS Purchases with Pricing Snapshot)
-- 💡 ပစ္စည်းဝယ်ယူစဉ်က သတ်မှတ်ခဲ့သော Markup % နှင့် ရောင်းဈေး Snapshot ကို သိမ်းဆည်းသည်။
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no TEXT UNIQUE NOT NULL,                                   -- e.g. PO-202610-0001
  date TEXT NOT NULL,                                                 -- YYYY-MM-DD (Strict MMT)
  supplier_id INTEGER,                                                -- pos_suppliers foreign key
  item_barcode TEXT NOT NULL,                                         -- pos_items_master foreign key
  qty REAL NOT NULL CHECK (qty > 0),                                  -- အဝယ်အရေအတွက်
  cost_price REAL NOT NULL CHECK (cost_price >= 0),                   -- ထိုစဉ်က အဝယ်ဈေး
  markup_percent REAL NOT NULL DEFAULT 8,                             -- 🎯 ထိုစဉ်က တင်ခဲ့သော အမြတ် % (Default: 8%)
  selling_price REAL NOT NULL CHECK (selling_price >= 0),             -- ထွက်ပေါ်လာသော ရောင်းဈေး
  total_cost REAL NOT NULL CHECK (total_cost >= 0),                   -- စုစုပေါင်း အဝယ်ကုန်ကျငွေ (qty * cost_price)
  remark TEXT,
  created_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES pos_suppliers(id) ON DELETE SET NULL,
  FOREIGN KEY (item_barcode) REFERENCES pos_items_master(barcode) ON DELETE RESTRICT
);

-- ⚡ အဝယ်ရက်စွဲနှင့် ကုန်သည်အလိုက် စစ်ထုတ်မှု အမြန်ဆုံးဖြစ်စေရန် Indexes
CREATE INDEX IF NOT EXISTS idx_pos_purchases_date ON pos_purchases(date);
CREATE INDEX IF NOT EXISTS idx_pos_purchases_barcode ON pos_purchases(item_barcode);
CREATE INDEX IF NOT EXISTS idx_pos_purchases_supplier ON pos_purchases(supplier_id);

-- ------------------------------------------------------------------------------
-- ၄။ အရောင်းပြေစာ ချုပ်စာရင်း (POS Sales Orders)
-- 💡 Single Row Text Summary ဖြင့် D1 Write Quota အထူးချွေတာသည့် ဇယား
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,                                    -- e.g. INV-20261001-0001
  date TEXT NOT NULL,                                                 -- YYYY-MM-DD (Strict MMT)
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Student Pocket Money')),
  student_id INTEGER,                                                 -- Cash ဖြစ်ပါက NULL၊ ကျောင်းသားဝယ်ပါက Student ID
  total_amount REAL NOT NULL CHECK (total_amount >= 0),               -- စုစုပေါင်း ကျသင့်ငွေ
  total_cost REAL NOT NULL CHECK (total_cost >= 0),                   -- ပစ္စည်းများ၏ အရင်းပေါင်း (COGS)
  net_profit REAL NOT NULL,                                           -- အသားတင်အမြတ် (total_amount - total_cost)
  items_summary TEXT NOT NULL,                                        -- e.g. "ပေါင်မုန့် x 2, ပဲနို့ x 1"
  canteen_vr_no TEXT,                                                 -- Canteen Book ချိတ်ဆက်နံပါတ် (CAN VR)
  uniqueid TEXT UNIQUE NOT NULL,                                      -- SPMMS Cross-Ledger Core Unique ID
  created_by TEXT NOT NULL DEFAULT 'Cashier',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ⚡ မုန့်ဖိုးကန့်သတ်ငွေစစ်ဆေးမှုနှင့် အရောင်းရှာဖွေမှု အမြန်ဆုံးဖြစ်စေရန် Composite Indexes
CREATE INDEX IF NOT EXISTS idx_pos_sales_stu_date ON pos_sales_orders(student_id, date);
CREATE INDEX IF NOT EXISTS idx_pos_sales_date ON pos_sales_orders(date);
CREATE INDEX IF NOT EXISTS idx_pos_sales_uniqueid ON pos_sales_orders(uniqueid);

-- ------------------------------------------------------------------------------
-- ၅။ ညနေပိုင်း Canteen ငွေရှင်းလင်းမှု သက်သေမှတ်တမ်း (Canteen Settlements)
-- 💡 Finance မှ Canteen သို့ ကျောင်းသားမုန့်ဖိုးအရောင်းတန်ဖိုးအား လက်ငင်းရှင်းပေးမှု မှတ်တမ်း
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canteen_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_no TEXT UNIQUE NOT NULL,                                 -- e.g. SETTLE-20261001-01
  date TEXT NOT NULL,                                                 -- YYYY-MM-DD (Strict MMT)
  settlement_type TEXT NOT NULL DEFAULT 'Evening Cash Out',
  total_sales_amount REAL NOT NULL CHECK (total_sales_amount >= 0),      -- ထိုနေ့ စုစုပေါင်း အရောင်း
  pocket_money_share REAL NOT NULL CHECK (pocket_money_share >= 0),      -- Finance မှ ရှင်းပေးရမည့် Pocket Money ရောင်းရငွေ
  cash_sales_share REAL NOT NULL CHECK (cash_sales_share >= 0),          -- ဆိုင်တွင် တိုက်ရိုက်ရရှိသော ငွေသား
  net_payout_amount REAL NOT NULL CHECK (net_payout_amount >= 0),        -- Finance မှ Canteen သို့ အမှန်တကယ် ပေးအပ်ငွေ
  handed_over_by TEXT NOT NULL,                                       -- Finance တာဝန်ခံ
  received_by TEXT NOT NULL,                                          -- Canteen တာဝန်ခံ
  remark TEXT,
  uniqueid TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_canteen_settle_date ON canteen_settlements(date);
CREATE INDEX IF NOT EXISTS idx_canteen_settle_uid ON canteen_settlements(uniqueid);

-- ------------------------------------------------------------------------------
-- ၆။ အပျက်/အပျောက်/သက်တမ်းလွန် ကုန်ကျစရိတ် မှတ်တမ်းဇယား (POS Waste Records)
-- 💡 ဝယ်ရင်းဈေး (Cost Price) ဖြင့် သီးခြားထိန်းချုပ်ပြီး Rollback အတွက် items_json ပါဝင်သည်။
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_waste_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  waste_no TEXT UNIQUE NOT NULL,                                      -- e.g. WST-20261001-001
  date TEXT NOT NULL,                                                 -- YYYY-MM-DD (Strict MMT)
  reason TEXT NOT NULL,                                               -- သက်တမ်းလွန် / ပျက်စီးကွဲရှ / ပျောက်ဆုံး / အခြား
  total_loss_cost REAL NOT NULL CHECK (total_loss_cost >= 0),          -- ဝယ်ရင်းဈေးဖြင့် တွက်ထားသော ဆုံးရှုံးမှုတန်ဖိုး
  total_items_qty REAL NOT NULL CHECK (total_items_qty > 0),           -- ဆုံးရှုံးသွားသော စုစုပေါင်းအရေအတွက်
  items_summary TEXT NOT NULL,                                        -- e.g. "ပေါင်မုန့် x 2, ပဲနို့ x 1"
  items_json TEXT,                                                    -- 🎯 Atomic Rollback အတွက် JSON Array
  remark TEXT,
  reported_by TEXT NOT NULL DEFAULT 'Cashier',                        -- စာရင်းသွင်းသူ ဝန်ထမ်းအမည်
  uniqueid TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pos_waste_date ON pos_waste_records(date);
CREATE INDEX IF NOT EXISTS idx_pos_waste_uid ON pos_waste_records(uniqueid);

-- ------------------------------------------------------------------------------
-- ၇။ အပိုပစ္စည်း စာရင်းဇယား (POS Surplus & Overage Records)
-- 💡 စတော့အရေအတွက်သာ တိုးစေပြီး မူလရင်းနှီးငွေ (Capital Investment) မတိုးစေပါ
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_surplus_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surplus_no TEXT UNIQUE NOT NULL,                                    -- e.g. SUR-20261001-001
  date TEXT NOT NULL,                                                 -- YYYY-MM-DD (Strict MMT)
  reason TEXT NOT NULL,                                               -- ရေတွက်မှုအပို / လက်ကျန်ပို / အခြား
  total_surplus_value REAL NOT NULL CHECK (total_surplus_value >= 0),  -- ဝယ်ရင်းဈေးဖြင့် တွက်ထားသော အပိုတန်ဖိုး
  total_items_qty REAL NOT NULL CHECK (total_items_qty > 0),           -- အပိုရရှိသော ပစ္စည်းအရေအတွက်
  items_summary TEXT NOT NULL,                                        -- e.g. "ပေါင်မုန့် x 2, ပဲနို့ x 1"
  items_json TEXT,                                                    -- 🎯 Atomic Rollback အတွက် JSON Array
  remark TEXT,
  reported_by TEXT NOT NULL DEFAULT 'Cashier',
  uniqueid TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pos_surplus_date ON pos_surplus_records(date);
CREATE INDEX IF NOT EXISTS idx_pos_surplus_uid ON pos_surplus_records(uniqueid);

-- ------------------------------------------------------------------------------
-- ၈။ ကန်တင်း နေ့စဉ် ဆိုင်ပိတ်သိမ်းမှု မှတ်တမ်းဇယား (Canteen Day Closures)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS canteen_day_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT UNIQUE NOT NULL,                                          -- YYYY-MM-DD (တစ်ရက်လျှင် ၁ ကြိမ်သာ ပိတ်ရမည်)
  closed_at TEXT NOT NULL DEFAULT (datetime('now')),                  -- ပိတ်သည့် အချိန်
  closed_by TEXT NOT NULL,                                            -- ပိတ်သိမ်းသည့် ဝန်ထမ်းအမည်
  total_sales REAL NOT NULL DEFAULT 0,                                -- ထိုနေ့ စုစုပေါင်း အရောင်း
  cash_sales REAL NOT NULL DEFAULT 0,                                 -- ငွေသား အရောင်း
  wallet_sales REAL NOT NULL DEFAULT 0,                               -- မုန့်ဖိုးကတ် အရောင်း
  total_orders INTEGER NOT NULL DEFAULT 0,                            -- စုစုပေါင်း ပြေစာစောင်ရေ
  status TEXT NOT NULL DEFAULT 'CLOSED',                              -- 'CLOSED'
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_canteen_closure_date ON canteen_day_closures(date);

-- ------------------------------------------------------------------------------
-- ၉။ စနစ်ဆက်တင် မာစတာဇယား (POS System Settings)
-- 💡 ကျောင်းသား Daily Allowance Cap အား Dynamic ထိန်းချုပ်မည့် Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 🎯 မူလစံသတ်မှတ်ချက်အဖြစ် တစ်ရက် ၁၀,၀၀၀ MMK အား ထည့်သွင်းထားခြင်း
INSERT INTO pos_settings (setting_key, setting_value, description)
VALUES 
  ('daily_spending_cap', '10000', 'ကျောင်းသားတစ်ဦး တစ်ရက် အများဆုံး မုန့်ဖိုးသုံးစွဲခွင့် ကန့်သတ်ငွေ (MMK)')
ON CONFLICT(setting_key) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 🔄 EXISTING DATABASE SAFE MIGRATION PATCH (လက်ရှိ Database အတွက် သီးသန့် Run ရန်)
-- 💡 လက်ရှိ Database ထဲတွင် surplus_stock ကော်လံ မရှိသေးပါက တိုက်ရိုက် run ပေးပါ-
-- ------------------------------------------------------------------------------
-- ALTER TABLE pos_items_master ADD COLUMN surplus_stock REAL NOT NULL DEFAULT 0;