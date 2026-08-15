
# 🎓 GOLDEN CASH BOOK - ERP SYSTEM
> **Golden Education Private High School**  
> Comprehensive Serverless Financial, Payroll & Student Management ERP System.

---

### 🌐 Live Production Application
* 📱 **Web Application (Frontend):** [https://cash-book-c4o.pages.dev](https://cash-book-c4o.pages.dev)
* ⚡ **Backend API Endpoint:** `https://cashbook-app-api.goldeneduprivateschool.workers.dev`

---

## 🛠️ Technology Stack

| Layer | Technology Used |
| :--- | :--- |
| **Frontend** | Single Page Application (SPA), Tailwind CSS, Font Awesome Free 6.4, SheetJS (.xlsx Export) |
| **Backend API** | Cloudflare Workers (Serverless Edge Router), Web Crypto API (PBKDF2 Password Hashing & HMAC-SHA256 JWT) |
| **Database** | Cloudflare D1 Database (Serverless SQLite with High-Performance Composite Indexing) |
| **Email Service** | Resend Email API (Automated Multi-Tab Excel Backup Delivery) |
| **Deployment** | Git-Driven CI/CD via GitHub & Cloudflare Pages/Workers |

---

## 🚀 Core Modules & Features

1. **Main Ledgers:**
   * 🏦 **Main Bank Book & Main Cash Book:** Strict 4-field search, auto-transfer descriptions, and running balance recalculation.
   * 💰 **Main Income Book:** Cash + Bank split payments, student lookup, and A4 dual-copy receipt printer.
2. **Expense & Operations:**
   * 🏢 **Office Exp Book & Kitchen Exp Book:** Uniform inventory stock synchronization, liabilities toggling.
   * 💵 **HR Payroll Exp Book:** Auto bonus & fund accrual, payslip dual-copy printing.
3. **Directory & Inventory:**
   * 🎓 **Student Directory:** Auto-generates 4-digit FYID (`2627-STU-0001`), Myanmar name gender auto-detection, old student lookup.
   * 👨‍🏫 **Staff Directory:** Salary Grade Matrix integration, 3-Year Fund date auto-calculation.
   * 👕 **Uniform Inventory Ledger:** Auto-PID sequence generation (`PID 001`), real-time profit computation.
   * 🏷️ **Promotion Rate Matrix:** Fee structure reference table per Fiscal Year.
4. **Reporting & Analytics:**
   * 📊 **Financial Statement Report:** 20 accounting expense subheads breakdown.
   * 📈 **InDetail Matrix Report:** 1 Student = 1 Row format, 13 fiscal months fee tracking.
   * 📅 **Monthly Income (InRep):** Accrual vs Cash Flow dual perspective.
   * 👥 **Student & Staff Demographics:** Real-time male/female counts.
5. **Internal Controls & Backups:**
   * ⚖️ **Balances Control:** Real-time cross-verification between Accountant and Cashier books.
   * 📁 **13-Tab Multi-Tab Excel (.xlsx) Export & Email Backup:** Direct download and automated Gmail delivery with a 20MB file size safety guard.

---


## 🔐 Login Access Information
* **Authentication:** Role-Based Access Control (RBAC)
* **Access Credentials:** Provided by Golden Education Administration Office only.
* *(Default passwords must be set privately by authorized administrators).*
*(Note: Default passwords automatically upgrade to PBKDF2 cryptographic hashes upon first login).*

---

## 📂 Repository Structure

```text
CASH-BOOK/
├── cashbook-frontend/     # Cloudflare Pages (HTML, CSS, JS Controllers, Views)
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── views/
├── cashbook-api/          # Cloudflare Workers Backend & D1 Database
│   ├── worker.js          # Master Serverless Router
│   ├── handlers-*.js      # Modular Route Handlers
│   ├── validation.js      # Input Validation & Sanitization Engine
│   ├── schema.sql         # 20 D1 SQL Tables & Seed Data
│   └── wrangler.toml      # Worker Configuration
└── README.md
