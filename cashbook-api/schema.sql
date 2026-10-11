-- ==============================================================================
-- GOLDEN ERP SYSTEM - CLOUDFLARE D1 DATABASE MASTER UNIFIED SCHEMA
-- File: schema.sql (Location: cashbook-api/schema.sql)
-- Architecture: Modular Domain Grouping, Coupled Indexes & High-Performance D1 Quota-Shield
-- ==============================================================================

-- ==============================================================================
-- MODULE 1: AUTHENTICATION, SECURITY & AUDIT TRAIL
-- ==============================================================================

-- 1.1 USERS (PBKDF2 Password Secured)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Viewer',
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 1.2 LOGIN ATTEMPTS (Server-Side Brute-Force / Rate-Limiting)
CREATE TABLE IF NOT EXISTS login_attempts (
  username TEXT PRIMARY KEY,
  fail_count INTEGER DEFAULT 0,
  locked_until TEXT,
  last_attempt_at TEXT DEFAULT (datetime('now'))
);

-- 1.3 AUDIT LOGS (Financial Compliance & Tracking)
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  role TEXT,
  action TEXT NOT NULL,
  record_id TEXT,
  detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_username ON audit_logs(username);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);


-- ==============================================================================
-- MODULE 2: MAIN FINANCIAL & EXPENSE BOOKS (5 CORE LEDGERS)
-- ==============================================================================

-- 2.1 MAIN BANK BOOK
CREATE TABLE IF NOT EXISTS bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'Income',
  description TEXT,
  method TEXT DEFAULT 'Bank',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Main Bank Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bank_fy_date ON bank(fy, date);

-- 2.2 MAIN CASH BOOK
CREATE TABLE IF NOT EXISTS cash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'Income',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Main Cash Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cash_fy_date ON cash(fy, date);

-- 2.3 OFFICE EXPENSE BOOK
CREATE TABLE IF NOT EXISTS office (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  description TEXT,
  unit REAL DEFAULT 0,
  unit_price REAL DEFAULT 0,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  liabilities REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Office Exp Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_office_fy_date ON office(fy, date);

-- 2.4 KITCHEN EXPENSE BOOK
CREATE TABLE IF NOT EXISTS kitchen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'General',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Kitchen Exp Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_kitchen_fy_date ON kitchen(fy, date);

-- 2.5 HR PAYROLL EXPENSE BOOK
CREATE TABLE IF NOT EXISTS payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'Full Time Salary',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  unpaid_bonus REAL DEFAULT 0,
  unpaid_fund REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'HR Payroll Exp Book',
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_payroll_fy_date ON payroll(fy, date);


-- ==============================================================================
-- MODULE 3: CASHIER SUB-LEDGERS (REGISTER COUNTER BOOKS)
-- ==============================================================================

-- 3.1 CASHIER BANK SUB-BOOK
CREATE TABLE IF NOT EXISTS ca_bank (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Income',
  description TEXT,
  method TEXT DEFAULT 'Bank',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Bank Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ca_bank_fy_date ON ca_bank(fy, date);

-- 3.2 CASHIER CASH SUB-BOOK
CREATE TABLE IF NOT EXISTS ca_cash (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Income',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Cash Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ca_cash_fy_date ON ca_cash(fy, date);

-- 3.3 CASHIER OFFICE SUB-BOOK
CREATE TABLE IF NOT EXISTS ca_office (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Office Exp',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Office Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ca_office_fy_date ON ca_office(fy, date);

-- 3.4 CASHIER KITCHEN SUB-BOOK
CREATE TABLE IF NOT EXISTS ca_kitchen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Kitchen Exp',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Kitchen Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ca_kitchen_fy_date ON ca_kitchen(fy, date);

-- 3.5 CASHIER PAYROLL SUB-BOOK
CREATE TABLE IF NOT EXISTS ca_payroll (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '',
  category TEXT DEFAULT 'Payroll Exp',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  balances REAL DEFAULT 0,
  transfer TEXT DEFAULT '',
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  book_name TEXT DEFAULT 'Cashier Payroll Book',
  created_by TEXT DEFAULT 'Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ca_payroll_fy_date ON ca_payroll(fy, date);


-- ==============================================================================
-- MODULE 4: STUDENT MASTER & TUITION INCOME
-- ==============================================================================

-- 4.1 STUDENT DIRECTORY (Master Record with NFC Smart Card Tag)
CREATE TABLE IF NOT EXISTS student (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  stu_status TEXT DEFAULT 'New Student',
  date TEXT NOT NULL,
  fy TEXT DEFAULT '2026-2027',
  student_id INTEGER,
  fyid TEXT,
  name TEXT NOT NULL,
  fyid_name TEXT,
  class TEXT,
  category TEXT DEFAULT 'Boarder',
  promo TEXT DEFAULT 'Original price',
  transfer_date TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  gender TEXT DEFAULT 'Male',
  nfc_tag_id TEXT, -- 🎯 NFC Smart Card / RFID UID Tag for POS & Canteen
  parents_name TEXT,
  phone_no TEXT,
  address TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_student_student_id ON student(student_id);
CREATE INDEX IF NOT EXISTS idx_student_fyid ON student(fyid);
CREATE INDEX IF NOT EXISTS idx_student_nfc ON student(nfc_tag_id);
CREATE INDEX IF NOT EXISTS idx_student_fy_status ON student(fy, status);
-- Covering Index for Dashboard Active Demographics (Zero Full-Scan)
CREATE INDEX IF NOT EXISTS idx_student_dash_active ON student(fy, status, transfer_date);

-- 4.2 STUDENT TUITION & REGISTRATION INCOME
CREATE TABLE IF NOT EXISTS income (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  effect_date TEXT,
  date TEXT NOT NULL,
  fy TEXT DEFAULT 'FY 2026-2027',
  student_id INTEGER,
  fyid TEXT,
  fyid_name TEXT,
  class TEXT,
  category TEXT DEFAULT 'Boarder',
  account_name TEXT DEFAULT 'Registration',
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  aut_amount REAL DEFAULT 0,
  promo TEXT DEFAULT 'Original price',
  my TEXT,
  vr_no TEXT,
  remark TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0,
  FOREIGN KEY (student_id) REFERENCES student(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_income_date ON income(date);
CREATE INDEX IF NOT EXISTS idx_income_fy_date ON income(fy, date);
CREATE INDEX IF NOT EXISTS idx_income_student_id ON income(student_id);

-- 4.3 PROMOTION & TUITION RATE MATRIX
CREATE TABLE IF NOT EXISTS promotion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  fy TEXT DEFAULT '2026-2027',
  class TEXT,
  category TEXT,
  registration REAL DEFAULT 0,
  original_price REAL DEFAULT 0,
  pro_a REAL DEFAULT 0,
  pro_b REAL DEFAULT 0,
  pro_c REAL DEFAULT 0,
  pro_d REAL DEFAULT 0,
  pro_e REAL DEFAULT 0,
  half_scholar REAL DEFAULT 0,
  full_scholar REAL DEFAULT 0,
  remark TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_promotion_fy_class_cat ON promotion(fy, class, category);

-- 4.4 UNIFORM INVENTORY LEDGER
CREATE TABLE IF NOT EXISTS uniform_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  product_id TEXT,
  product_name TEXT NOT NULL,
  type TEXT,
  size TEXT,
  opening_stock REAL DEFAULT 0,
  unit_price REAL DEFAULT 0,
  total_amount REAL DEFAULT 0,
  selling_price REAL DEFAULT 0,
  profit_amount REAL DEFAULT 0,
  selling_unit REAL DEFAULT 0,
  current_qty REAL DEFAULT 0,
  total_stock_value REAL DEFAULT 0,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_uniform_product_id ON uniform_ledger(product_id);


-- ==============================================================================
-- MODULE 5: HR, PAYROLL & STAFF DIRECTORY
-- ==============================================================================

-- 5.1 FULL-TIME STAFF MASTER
CREATE TABLE IF NOT EXISTS staff_fulltime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  join_date TEXT NOT NULL,
  category TEXT DEFAULT 'Full Time',
  staff_id INTEGER,
  name TEXT NOT NULL,
  staff_idname TEXT,
  education TEXT,
  position TEXT,
  salary_grade TEXT DEFAULT 'Non',
  working_days REAL DEFAULT 26,
  basic_amt REAL DEFAULT 0,
  extra_amt REAL DEFAULT 0,
  total_salary REAL DEFAULT 0,
  bonus REAL DEFAULT 0,
  fund REAL DEFAULT 0,
  total_net_amt REAL DEFAULT 0,
  resigned_date TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  gender TEXT DEFAULT 'Male',
  nrc_no TEXT,
  bank_account TEXT,
  phone_no TEXT,
  email TEXT,
  fund_date TEXT,
  unpaid_bonus REAL DEFAULT 0,
  unpaid_fund REAL DEFAULT 0,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_staff_ft_staff_id ON staff_fulltime(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_ft_status ON staff_fulltime(status);
CREATE INDEX IF NOT EXISTS idx_staff_ft_active ON staff_fulltime(status, resigned_date);

-- 5.2 PART-TIME STAFF MASTER
CREATE TABLE IF NOT EXISTS staff_parttime (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  join_date TEXT NOT NULL,
  category TEXT DEFAULT 'Part Time',
  staff_id INTEGER,
  name TEXT NOT NULL,
  staff_idname TEXT,
  education TEXT,
  position TEXT,
  total_salary REAL DEFAULT 0,
  total_net_amt REAL DEFAULT 0,
  resigned_date TEXT DEFAULT '',
  status TEXT DEFAULT 'Active',
  gender TEXT DEFAULT 'Male',
  nrc_no TEXT,
  bank_account TEXT,
  phone_no TEXT,
  email TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_staff_pt_staff_id ON staff_parttime(staff_id);
CREATE INDEX IF NOT EXISTS idx_staff_pt_active ON staff_parttime(status, resigned_date);

-- 5.3 SALARY GRADE MATRIX
CREATE TABLE IF NOT EXISTS salary_grade_matrix (
  id INTEGER PRIMARY KEY,
  grade_a REAL DEFAULT 0,
  grade_b REAL DEFAULT 0,
  grade_c REAL DEFAULT 0,
  grade_d REAL DEFAULT 0,
  grade_e REAL DEFAULT 0,
  grade_f REAL DEFAULT 0,
  grade_g REAL DEFAULT 0,
  grade_h REAL DEFAULT 0,
  grade_i REAL DEFAULT 0,
  grade_j REAL DEFAULT 0,
  grade_k REAL DEFAULT 0,
  grade_l REAL DEFAULT 0,
  bonus_rate REAL DEFAULT 0,
  fund_rate REAL DEFAULT 0.05,
  updated_at TEXT DEFAULT (datetime('now'))
);


-- ==============================================================================
-- MODULE 6: SPMMS (STUDENT POCKET MONEY & CASH COUNTER LEDGERS)
-- ==============================================================================

-- 6.1 STUDENT MONEY LEDGER (Finance Vault & Student Virtual Wallets)
CREATE TABLE IF NOT EXISTS student_money (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  fy TEXT DEFAULT '2026-2027',
  student_id INTEGER, -- 0 / NULL for Internal Finance Transfers
  fyid TEXT,
  fyid_name TEXT,
  class TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,  -- Student Deposit / Inward Transfer
  credit REAL DEFAULT 0, -- Student Withdraw / Transfer to PM Cashier
  balances REAL DEFAULT 0,
  remark TEXT,
  created_by TEXT DEFAULT 'Admin',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  FOREIGN KEY (student_id) REFERENCES student(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_student_money_fy_date ON student_money(fy, date);
CREATE INDEX IF NOT EXISTS idx_student_money_student_id ON student_money(student_id, date);
CREATE INDEX IF NOT EXISTS idx_sm_fy_student ON student_money(fy, student_id);
-- Performance Indexes for Auto-Recalculate, Max No & Top KPIs
CREATE INDEX IF NOT EXISTS idx_sm_fy_cast_no ON student_money(fy, CAST(no AS INTEGER) DESC);
CREATE INDEX IF NOT EXISTS idx_sm_recalc ON student_money(student_id, fy, date DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sm_fy_kpi ON student_money(fy, student_id, debit, credit);

-- 6.2 PM CASHIER BOOK (Cash Counter with Responsibility Person)
CREATE TABLE IF NOT EXISTS pm_cashier_book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  responsibility_person TEXT DEFAULT '', -- Cashier 1 / Cashier 2
  category TEXT DEFAULT 'Float Receive',
  description TEXT,
  method TEXT DEFAULT 'Cash',
  debit REAL DEFAULT 0,  -- Float receive from Finance Vault
  credit REAL DEFAULT 0, -- Cash withdrawal disbursed to student
  balances REAL DEFAULT 0,
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  created_by TEXT DEFAULT 'PM Cashier',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pm_cashier_fy_date ON pm_cashier_book(fy, date);
CREATE INDEX IF NOT EXISTS idx_pm_cashier_resp_date ON pm_cashier_book(responsibility_person, date);


-- ==============================================================================
-- MODULE 7: CANTEEN POS CORE & INVENTORY MANAGEMENT
-- ==============================================================================

-- 7.1 POS ITEMS MASTER (Inventory, Pricing & Surplus Stock)
CREATE TABLE IF NOT EXISTS pos_items_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  barcode TEXT UNIQUE NOT NULL,                                       -- Primary Scan Barcode/QR
  item_name TEXT NOT NULL,                                            -- Item Description
  category TEXT NOT NULL DEFAULT 'Snack',                             -- Snack, Drink, Meal, Stationery
  cost_price REAL NOT NULL DEFAULT 0 CHECK (cost_price >= 0),         -- Last Unit Cost
  markup_percent REAL NOT NULL DEFAULT 8 CHECK (markup_percent >= 0),  -- Default Markup % (8%)
  selling_price REAL NOT NULL DEFAULT 0 CHECK (selling_price >= 0),   -- Rounded Retail Price
  current_stock REAL NOT NULL DEFAULT 0,                              -- Total Countable Stock
  surplus_stock REAL NOT NULL DEFAULT 0 CHECK (surplus_stock >= 0),    -- Surplus Stock (Capital-Invariant)
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),   -- 1: Active, 0: Disabled
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pos_items_barcode ON pos_items_master(barcode);
CREATE INDEX IF NOT EXISTS idx_pos_items_active ON pos_items_master(is_active);

-- 7.2 POS SUPPLIERS MASTER
CREATE TABLE IF NOT EXISTS pos_suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_name TEXT UNIQUE NOT NULL,
  contact_person TEXT,
  phone_no TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7.3 POS PURCHASES (Stock Replenishment & Historical Pricing)
CREATE TABLE IF NOT EXISTS pos_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_no TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,                                                 -- YYYY-MM-DD (Strict MMT)
  supplier_id INTEGER,
  item_barcode TEXT NOT NULL,
  qty REAL NOT NULL CHECK (qty > 0),
  cost_price REAL NOT NULL CHECK (cost_price >= 0),
  markup_percent REAL NOT NULL DEFAULT 8,
  selling_price REAL NOT NULL CHECK (selling_price >= 0),
  total_cost REAL NOT NULL CHECK (total_cost >= 0),
  remark TEXT,
  created_by TEXT NOT NULL DEFAULT 'Admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (supplier_id) REFERENCES pos_suppliers(id) ON DELETE SET NULL,
  FOREIGN KEY (item_barcode) REFERENCES pos_items_master(barcode) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_pos_purchases_date ON pos_purchases(date);
CREATE INDEX IF NOT EXISTS idx_pos_purchases_barcode ON pos_purchases(item_barcode);
CREATE INDEX IF NOT EXISTS idx_pos_purchases_supplier ON pos_purchases(supplier_id);


-- ==============================================================================
-- MODULE 8: CANTEEN SALES, INVOICING & SETTLEMENTS
-- ==============================================================================

-- 8.1 POS SALES ORDERS (Single Row High-Speed Transaction Journal)
CREATE TABLE IF NOT EXISTS pos_sales_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,                                                 -- YYYY-MM-DD (Strict MMT)
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Cash', 'Student Pocket Money')),
  student_id INTEGER,                                                 -- NULL for Cash, Student ID for Wallet
  total_amount REAL NOT NULL CHECK (total_amount >= 0),
  total_cost REAL NOT NULL CHECK (total_cost >= 0),
  net_profit REAL NOT NULL,
  items_summary TEXT NOT NULL,
  canteen_vr_no TEXT,
  uniqueid TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'Cashier',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pos_sales_date ON pos_sales_orders(date);
CREATE INDEX IF NOT EXISTS idx_pos_sales_stu_date ON pos_sales_orders(student_id, date);
CREATE INDEX IF NOT EXISTS idx_pos_sales_uniqueid ON pos_sales_orders(uniqueid);
-- Fast Snapshot Index for POS Terminal Sync
CREATE INDEX IF NOT EXISTS idx_pos_orders_snap ON pos_sales_orders(date, payment_method, student_id);

-- 8.2 CANTEEN SALES BOOK (Inter-Department Virtual Receivable Ledger)
CREATE TABLE IF NOT EXISTS canteen_book (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no INTEGER DEFAULT 1,
  date TEXT NOT NULL,
  category TEXT DEFAULT 'POS Sales',
  description TEXT,
  method TEXT DEFAULT 'Transfer',
  debit REAL DEFAULT 0,  -- Gross POS Daily Sales
  credit REAL DEFAULT 0, -- Evening Cash Settlements from Finance
  balances REAL DEFAULT 0,
  vr_no TEXT,
  my TEXT,
  fy TEXT DEFAULT 'FY 2026-2027',
  created_by TEXT DEFAULT 'System',
  created_at TEXT DEFAULT (datetime('now')),
  uniqueid TEXT UNIQUE,
  is_locked INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_canteen_book_fy_date ON canteen_book(fy, date);

-- 8.3 CANTEEN SETTLEMENTS (Finance to Canteen Inter-Department Payouts)
CREATE TABLE IF NOT EXISTS canteen_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_no TEXT UNIQUE NOT NULL,                                 -- e.g. SETTLE-20261001-01
  date TEXT NOT NULL,                                                 -- YYYY-MM-DD (Strict MMT)
  settlement_type TEXT NOT NULL DEFAULT 'Evening Cash Out',
  total_sales_amount REAL NOT NULL CHECK (total_sales_amount >= 0),
  pocket_money_share REAL NOT NULL CHECK (pocket_money_share >= 0),
  cash_sales_share REAL NOT NULL CHECK (cash_sales_share >= 0),
  net_payout_amount REAL NOT NULL CHECK (net_payout_amount >= 0),
  handed_over_by TEXT NOT NULL,
  received_by TEXT NOT NULL,
  remark TEXT,
  uniqueid TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_canteen_settle_date ON canteen_settlements(date);
CREATE INDEX IF NOT EXISTS idx_canteen_settle_uid ON canteen_settlements(uniqueid);

-- 8.4 CANTEEN DAY CLOSURES (Daily Register Interlock)
CREATE TABLE IF NOT EXISTS canteen_day_closures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT UNIQUE NOT NULL,                                          -- One closure per business day
  closed_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_by TEXT NOT NULL,
  total_sales REAL NOT NULL DEFAULT 0,
  cash_sales REAL NOT NULL DEFAULT 0,
  wallet_sales REAL NOT NULL DEFAULT 0,
  total_orders INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'CLOSED',
  remark TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_canteen_closure_date ON canteen_day_closures(date);

-- 8.5 DETAILED POS INVOICES & LINE ITEMS (Legacy & Detailed Receipt Tracking)
CREATE TABLE IF NOT EXISTS pos_invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,
  student_id INTEGER,
  total_amount REAL DEFAULT 0,
  cashier_name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pos_invoices_date ON pos_invoices(date);

CREATE TABLE IF NOT EXISTS pos_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no TEXT NOT NULL,
  item_name TEXT NOT NULL,
  qty INTEGER DEFAULT 1,
  unit_price REAL DEFAULT 0,
  subtotal REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_pos_items_inv ON pos_items(invoice_no);


-- ==============================================================================
-- MODULE 9: CANTEEN AUDIT & INVENTORY ADJUSTMENTS
-- ==============================================================================

-- 9.1 POS WASTE RECORDS (Spoilage, Expiry & Damage Tracking)
CREATE TABLE IF NOT EXISTS pos_waste_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  waste_no TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  total_loss_cost REAL NOT NULL CHECK (total_loss_cost >= 0),
  total_items_qty REAL NOT NULL CHECK (total_items_qty > 0),
  items_summary TEXT NOT NULL,
  items_json TEXT,                                                    -- Atomic Rollback Payload
  remark TEXT,
  reported_by TEXT NOT NULL DEFAULT 'Cashier',
  uniqueid TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pos_waste_date ON pos_waste_records(date);
CREATE INDEX IF NOT EXISTS idx_pos_waste_uid ON pos_waste_records(uniqueid);

-- 9.2 POS SURPLUS RECORDS (Found Stock / Stock Overage Records)
CREATE TABLE IF NOT EXISTS pos_surplus_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  surplus_no TEXT UNIQUE NOT NULL,
  date TEXT NOT NULL,
  reason TEXT NOT NULL,
  total_surplus_value REAL NOT NULL CHECK (total_surplus_value >= 0),
  total_items_qty REAL NOT NULL CHECK (total_items_qty > 0),
  items_summary TEXT NOT NULL,
  items_json TEXT,                                                    -- Atomic Rollback Payload
  remark TEXT,
  reported_by TEXT NOT NULL DEFAULT 'Cashier',
  uniqueid TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pos_surplus_date ON pos_surplus_records(date);
CREATE INDEX IF NOT EXISTS idx_pos_surplus_uid ON pos_surplus_records(uniqueid);

-- 9.3 POS SYSTEM CONFIGURATION
CREATE TABLE IF NOT EXISTS pos_settings (
  setting_key TEXT PRIMARY KEY,
  setting_value TEXT NOT NULL,
  description TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


-- ==============================================================================
-- MODULE 10: CANONICAL SEED DATA (INITIAL SYSTEM DEFAULTS)
-- ==============================================================================

-- Default Salary Grade Matrix Record
INSERT OR IGNORE INTO salary_grade_matrix (
  id, grade_a, grade_b, grade_c, grade_d, grade_e, grade_f, grade_g, grade_h, 
  grade_i, grade_j, grade_k, grade_l, bonus_rate, fund_rate, updated_at
) VALUES (
  1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.05, datetime('now')
);

-- Default Student Daily Spending Cap (10,000 MMK)
INSERT INTO pos_settings (setting_key, setting_value, description)
VALUES (
  'daily_spending_cap', '10000', 'ကျောင်းသားတစ်ဦး တစ်ရက် အများဆုံး မုန့်ဖိုးသုံးစွဲခွင့် ကန့်သတ်ငွေ (MMK)'
) ON CONFLICT(setting_key) DO NOTHING;