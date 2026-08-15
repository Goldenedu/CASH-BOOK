/**
 * GOLDEN ERP SYSTEM - GLOBAL CONFIGURATION & CONSTANTS 
 * File: js/config.js  
 * 💡 Central System Configuration, API Endpoints, Sheet Schemas & Dropdown Master Lists
 */

window.BOOK_MAP = {
  // Main Master Books
  "Bank Book": "bank",
  "Cash Book": "cash",
  "Office Exp Book": "office",
  "Kitchen Exp Book": "kitchen",
  "HR Payroll Exp Book": "payroll",
  "Office Book": "office",
  "Kitchen Book": "kitchen",
  "Salary Book": "payroll",
  "Student Money Book": "studentMoney",
  "Student Money": "studentMoney",
  "studentMoney": "studentMoney",
  "student-money": "studentMoney",
  "bank": "bank",
  "cash": "cash",
  "kitchen": "kitchen",
  "office": "office",
  "payroll": "payroll",
  "hr": "payroll",

  // 💡 Cashier Sub-Ledger Books
  "CABank": "caBank",
  "CACash": "caCash",
  "CAOffice": "caOffice",
  "CAKitchen": "caKitchen",
  "CAPayroll": "caPayroll",
  "caBank": "caBank",
  "caCash": "caCash",
  "caOffice": "caOffice",
  "caKitchen": "caKitchen",
  "caPayroll": "caPayroll",
  "cashier": "caCash"
};

window.MAGIC_NUMBERS = {
  TRANSACTION_LOCK_DAYS: 7,
  SESSION_EXPIRY_HOURS: 8,
  DASHBOARD_CACHE_TTL_SECONDS: 180,
  LOGIN_LOCK_TTL_SECONDS: 300,
  AUDIT_LOG_MAX_ROWS: 5000,
  PASSWORD_HASH_ITERATIONS: 1000,
  LOCK_TIMEOUT_MS: 15000,
  PROMO_CACHE_TTL_SECONDS: 600
};

// 💡 Environment Detection for API URL Configuration
function getApiUrl() {
  const hostname = window.location.hostname;
  
  // Development environment (localhost)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return localStorage.getItem('dev_api_url') || 'http://localhost:8787';
  }
  
  // Production environment
  return localStorage.getItem('prod_api_url') || 'https://cashbook-app-api.goldeneduprivateschool.workers.dev';
}

window.CONFIG = {
  API_URL: getApiUrl(),
  API_BASE_URL: getApiUrl(),
  STORAGE_KEY_TOKEN: "golden_auth_token",
  STORAGE_KEY_USER: "golden_user",

  TITLE_MAP: {
    'dashboard': 'Home Dashboard',
    'bank': 'Main Bank Book',
    'cash': 'Main Cash Book',
    'income': 'Main Income Book',
    'office': 'Office Exp Book',
    'kitchen': 'Kitchen Exp Book',
    'payroll': 'HR Payroll Exp Book',
    'hr': 'HR Payroll Exp Book',
    'cashier': 'Cashier Cash Book',
    'fulltime': 'Full Time Staff List (FID)',
    'parttime': 'Part Time Staff List (PID)',
    'student': 'Student Master Directory',
    'student-money': 'Student Money Ledger',
    'uniform': 'Uniform Inventory Ledger',
    'promotion': 'Promotion Reference Matrix',
    'report-financial': 'Financial Statement Report',
    'report-in-detail': 'Income Detail Report (InDetail)',
    'report-in-rep': 'Monthly Income Report (InRep)',
    'report-staff-fund': 'Staff Bonus & Fund Report',
    'report-student': 'Student Demographics Report',
    'settings': 'System Controls Center'
  },

  sheets: {
    // 💡 Main Master Sheets
    bank: {
      bookName: "Bank Book", prefix: "BNK", sheetName: "Bank",
      requiredHeaders: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    cash: {
      bookName: "Cash Book", prefix: "CAH", sheetName: "Cash",
      requiredHeaders: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    kitchen: {
      bookName: "Kitchen Exp Book", prefix: "KIT", sheetName: "Kitchen",
      requiredHeaders: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    office: {
      bookName: "Office Exp Book", prefix: "OFF", sheetName: "Office",
      requiredHeaders: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "UNIT", "UNIT PRICE", "METHOD", "DEBIT", "CREDIT", "BALANCES", "LIABILITIES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    payroll: {
      bookName: "HR Payroll Exp Book", prefix: "SAL", sheetName: "Payroll",
      requiredHeaders: ["NO", "DATE", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "UNPAID BONUS", "UNPAID FUND", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },

    // 💡 Cashier Sub-Ledger Sheets (17 Columns Schema)
    caBank: {
      bookName: "Cashier Bank Book", prefix: "CAB", sheetName: "CABank",
      requiredHeaders: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    caCash: {
      bookName: "Cashier Cash Book", prefix: "CAC", sheetName: "CACash",
      requiredHeaders: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    caOffice: {
      bookName: "Cashier Office Book", prefix: "CAO", sheetName: "CAOffice",
      requiredHeaders: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    caKitchen: {
      bookName: "Cashier Kitchen Book", prefix: "CAK", sheetName: "CAKitchen",
      requiredHeaders: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    caPayroll: {
      bookName: "Cashier Payroll Book", prefix: "CAP", sheetName: "CAPayroll",
      requiredHeaders: ["NO", "DATE", "RESPONSIBILITY PERSON", "CATEGORY", "DESCRIPTION", "METHOD", "DEBIT", "CREDIT", "BALANCES", "TRANSFER", "VR NO", "MY", "FY", "BOOK NAME", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },

    // 💡 Directories & Directories Masters
    staffFullTime: {
      bookName: "Full Time Staff List", prefix: "FID", sheetName: "FullTime",
      requiredHeaders: ["NO", "JOIN DATE", "CATEGORY", "STAFF ID", "NAME", "STAFF IDNAME", "EDUCATION", "POSITION", "SALARY GRADE", "WORKING DAYS", "BASIC AMT", "EXTRA AMT", "TOTAL SALARY", "BONUS", "FUND", "TOTAL NET AMT", "RESIGNED DATE", "STATUS", "GENDER", "NRC NO", "BANK ACCOUNT", "PHONE NO", "EMAIL", "FUND DATE", "UNPAID BONUS", "UNPAID FUND", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    staffPartTime: {
      bookName: "Part Time Staff List", prefix: "PID", sheetName: "PartTime",
      requiredHeaders: ["NO", "JOIN DATE", "CATEGORY", "STAFF ID", "NAME", "STAFF IDNAME", "EDUCATION", "POSITION", "TOTAL SALARY", "TOTAL NET AMT", "RESIGNED DATE", "STATUS", "GENDER", "NRC NO", "BANK ACCOUNT", "PHONE NO", "EMAIL", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    income: {
      bookName: "Income Book", prefix: "INC", sheetName: "Income",
      requiredHeaders: ["NO", "EFFECT DATE", "DATE", "FY", "ID", "FYID", "FYID NAME", "CLASS", "CATEGORY", "ACCOUNT NAME", "METHOD", "DEBIT", "CREDIT", "AUT AMOUNT", "PROMO", "MY", "VR NO", "REMARK", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    student: {
      bookName: "Student List", prefix: "STU", sheetName: "Student",
      requiredHeaders: ["NO","STU STATUS", "Date", "FY", "ID", "FYID", "NAME", "FYID NAME", "CLASS", "CATEGORY", "PROMO",  "TRNANSFER DATE", "STATUS", "GENDER", "PARENTS NAME", "PHONE NO", "ADDRESS", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    studentMoney: {
      bookName: "Student Money Ledger", prefix: "STM", sheetName: "StudentMoney",
      requiredHeaders: ["NO", "DATE", "FY", "ID", "FYID", "FYID NAME", "CLASS", "METHOD", "DEBIT", "CREDIT", "BALANCES", "REMARK", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    promotion: {
      bookName: "Promotion List", prefix: "PRO", sheetName: "Promo",
      requiredHeaders: ["NO", "FY", "CLASS", "CATEGORY", "Registration", "Original price", "Pro A", "Pro B", "Pro C", "Pro D", "Pro E", "Half scholar", "Full scholar", "Remark", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    uniformLedger: {
      bookName: "Uniform Ledger", prefix: "UNI", sheetName: "Uniform",
      requiredHeaders: ["NO", "PRODUCT ID", "PRODUCT NAME", "TYPE", "SIZE", "OPENING STOCK", "UNIT PRICE", "TOTAL AMOUNT", "SELLING PRICE", "PROFIT AMOUNT", "SELLING UNIT", "CURRENT QTY", "TOTAL STOCK VALUE", "CREATED BY", "CREATED AT", "UNIQUEID"]
    },
    fundReport: {
      bookName: "Staff Fund Report", prefix: "FND", sheetName: "FundReport",
      requiredHeaders: ["NO", "FUND DATE", "STAFF ID", "NAME", "BONUS BALANCE", "FUND BALANCE", "TOTAL BALANCES", "STATUS"]
    }
  }
};

// 💡 Compatibility Aliases Across Modules
window.CONFIG.books = window.CONFIG.sheets;
window.APP_CONFIG = window.CONFIG;
var CONFIG = window.CONFIG;
var APP_CONFIG = window.APP_CONFIG;

window.DROPDOWNS = {
  // 💡 Master Books Dropdowns (Uniform Profit Added)
  bankBook: {
    category: ["Non", "Opening", "Transfer", "Bank Loan", "Bank Fees", "Other Income", "Student Income", "Uniform Profit", "Closing"],
    method: ["Bank"],
    transfer: ["Cash Book", "Office Exp Book", "Kitchen Exp Book", "HR Payroll Exp Book"]
  },
  cashBook: {
    category: ["Non", "Opening", "Transfer", "Cash Loan", "Other Income", "Student Income", "Uniform Profit", "Closing"],
    method: ["Cash"],
    transfer: ["Bank Book", "Office Exp Book", "Kitchen Exp Book", "HR Payroll Exp Book"]
  },
  officeExpBook: {
    category: ["Non", "Adv / Ref", "Liabilities", "Admin Exp", "Vehicle Related Exp", "Assets Materials", "Donation & Social", "HR Staff Benefit", "Construction", "Student Refund", "Drawing Account 1", "Drawing Account 2", "Adv Capital Snack Shop", "Ferry Payment", "Advance Uniform", "Opening", "Income", "Closing", "Transfer"],
    method: ["Cash", "Bank"],
    transfer: ["Bank Book", "Cash Book"]
  },
  kitchenExpBook: {
    category: ["Non", "Rice & Oil", "Fish & meat/Eggs", "Beans/Vegetables", "Others", "HOME: 1 Exp", "HOME: 2 Exp", "Income", "Opening", "Closing", "Transfer"],
    method: ["Cash", "Bank"],
    transfer: ["Bank Book", "Cash Book"]
  },
  hrPayrollExpBook: {
    category: ["Non", "Full Time Salary", "Part Time Salary", "Full Time Bonus", "Full Time Fund", "Income", "Opening", "Closing", "Transfer"],
    method: ["Cash", "Bank"],
    transfer: ["Bank Book", "Cash Book"]
  },

  // 💡 Cashier Sub-Ledger Dropdowns (Uniform Profit Added)
  caBankBook: {
    category: ["Non", "Opening", "Transfer", "Bank Loan", "Bank Fees", "Other Income", "Income", "Uniform Profit", "Closing"],
    method: ["Bank"],
    transfer: ["CACash", "CAOffice", "CAKitchen", "CAPayroll"]
  },
  caCashBook: {
    category: ["Non", "Opening", "Transfer", "Cash Loan", "Other Income", "Income", "Uniform Profit", "Closing"],
    method: ["Cash"],
    transfer: ["CABank", "CAOffice", "CAKitchen", "CAPayroll"]
  },
  caOfficeBook: {
    category: ["Non", "Adv / Ref", "Liabilities", "Admin Exp", "Vehicle Related Exp", "Assets Materials", "Donation & Social", "HR Staff Benefit", "Construction", "Student Refund", "Drawing Account 1", "Drawing Account 2", "Adv Capital Snack Shop", "Ferry Payment", "Advance Uniform", "Opening", "Income", "Closing", "Transfer"],
    method: ["Cash", "Bank"],
    transfer: ["CABank", "CACash"]
  },
  caKitchenBook: {
    category: ["Non", "Rice & Oil", "Fish & meat/Eggs", "Beans/Vegetables", "Others", "HOME: 1 Exp", "HOME: 2 Exp", "Income", "Opening", "Closing", "Transfer"],
    method: ["Cash", "Bank"],
    transfer: ["CABank", "CACash"]
  },
  caPayrollBook: {
    category: ["Non", "Full Time Salary", "Part Time Salary", "Full Time Bonus", "Full Time Fund", "Income", "Opening", "Closing", "Transfer"],
    method: ["Cash", "Bank"],
    transfer: ["CABank", "CACash"]
  },

  // 💡 Directory Masters
  student: {
    class: ["Non", "Pre School", "KG Student", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6", "Grade 7", "Grade 8", "Grade 9", "Grade 10", "Grade 11", "Grade 12"],
    category: ["Boarder", "Semi Boarder", "Day Student"],
    promo: ["Original price", "Pro A", "Pro B", "Pro C", "Pro D", "Pro E", "Half scholar", "Full scholar"]
  },
  studentMoney: {
    method: ["Cash", "Bank"]
  },
  incomeBook: {
    category: ["Non", "Boarder", "Semi Boarder", "Day Student", "Others"],
    accountName: ["Registration", "Services", "Ferry", "Night Study Fees", "Others"],
    method: ["Cash", "Bank"]
  },
  staffCommon: {
    education: ["Non", "Phd", "Master", "Degree", "High Graduate", "Middle", "Primary", "High School"],
    fullTimePositions: ["Non", "Admin", "Teacher", "Finance", "Computer", "Log & Support", "Assistant Teacher", "Office", "Chef", "Assistant Chef", "Home Chef", "General"],
    partTimePositions: ["Non", "သင်ကြားရေး", "အခြား နည်းပြဆရာ", "Zumba Instructor", "တိုက်ကွမ်ဒိုနည်းပြ", "ဓမ္မစကူးလ်နည်းပြ", "ပန်းချီဆရာ", "အားကစားနည်းပြ", "အလုပ်သင်"],
    salaryGrades: ["Non", "Grade A", "Grade B", "Grade C", "Grade D", "Grade E", "Grade F", "Grade G", "Grade H", "Grade I", "Grade J", "Grade K"]
  }
};

var DROPDOWNS = window.DROPDOWNS;
