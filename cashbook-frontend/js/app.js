/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - MAIN SPA ROUTER & APPLICATION CONTROLLER (D1 DATABASE EDITION)
 * File: js/app.js (Location: cashbook-frontend/js/app.js)
 * 💡 Features: 🛡️ 404 View Crash Eliminated (Canonical Unified Reports Mapping),
 *              🎯 Sub-Report Sidebar Highlight Memory & Panel Visibility Fix,
 *              🎯 Dynamic Header Academic Year Synchronizer (Aligned with Calendar),
 *              🎯 Simplified "Staff Lists" Title Map (Consistent UI),
 *              Double-Submit Guard for Salary Grade Matrix Settings,
 *              Event-Safe Animated Refresh Controller (No premature fake toasts),
 *              🛡️ XSS-Safe Category Badge Formatter
 * ==============================================================================
 */

window.viewCache = window.viewCache || {};
var isGradeSubmitting = false;

/**
 * 💡 Universal Category Badge Formatter Across the Entire App (XSS-Safe)
 */
window.formatCategoryBadgeHtml = function (categoryStr) {
  const cat = String(categoryStr || '-').trim();
  if (!cat || cat === '-') return '<span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-slate-800 text-slate-400">-</span>';

  // 🛡️ Safe HTML Escaping
  const safeCat = (typeof window.escapeHtml === 'function') ? window.escapeHtml(cat) : cat;
  const lower = cat.toLowerCase();

  if (lower.includes('loan') || lower.includes('adv') || lower.includes('expense') || lower.includes('liability')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-rose-500/20 text-rose-300 shadow-sm shadow-rose-950/20"><i class="fa-solid fa-triangle-exclamation text-[9px] text-rose-400"></i> ${safeCat}</span>`;
  }

  if (lower.includes('income') || lower.includes('sale') || lower.includes('service') || lower.includes('fee') || lower.includes('tuition')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/20 text-emerald-300 shadow-sm shadow-emerald-950/20"><i class="fa-solid fa-circle-arrow-down text-[9px] text-emerald-400"></i> ${safeCat}</span>`;
  }

  if (lower.includes('transfer') || lower.includes('move')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-sky-500/20 text-sky-300 shadow-sm shadow-sky-950/20"><i class="fa-solid fa-right-left text-[9px] text-sky-400"></i> ${safeCat}</span>`;
  }

  if (lower.includes('open') || lower.includes('balance') || lower.includes('capital')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/20 text-amber-300 shadow-sm shadow-amber-950/20"><i class="fa-solid fa-vault text-[9px] text-amber-400"></i> ${safeCat}</span>`;
  }

  if (lower.includes('payroll') || lower.includes('salary') || lower.includes('bonus') || lower.includes('fund') || lower.includes('staff')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-purple-500/20 text-purple-300 shadow-sm shadow-purple-950/20"><i class="fa-solid fa-user-tag text-[9px] text-purple-400"></i> ${safeCat}</span>`;
  }

  if (lower.includes('boarder') || lower.includes('student') || lower.includes('uniform') || lower.includes('stock')) {
    return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-teal-500/20 text-teal-300 shadow-sm shadow-teal-950/20"><i class="fa-solid fa-tag text-[9px] text-teal-400"></i> ${safeCat}</span>`;
  }

  return `<span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300">${safeCat}</span>`;
};

document.addEventListener('DOMContentLoaded', function () {
  initNetworkStatusWatcher();
  initApp();
});

/**
 * 💡 Initialize ERP Application Shell
 */
function initApp() {
  const token = localStorage.getItem('golden_auth_token');
  const user = localStorage.getItem('golden_user_name') || 'User';
  const role = (localStorage.getItem('golden_user_role') || '').trim();

  if (!token) {
    document.documentElement.className = 'dark not-authed';
    return;
  }

  document.documentElement.className = 'dark is-authed';
  updateHeaderMetadata(user);
  initNetworkStatusWatcher(); // ⚡ Real-Time Online/Offline Status Initializer

  if (typeof window.prefetchCoreModules === 'function') {
    window.prefetchCoreModules();
  }

  // 🎯 FORCE PREFETCH MASTER DATA: Login ဝင်ချိန်တွင် Offline အတွက် ကျောင်းသားစာရင်းကို နောက်ခံတွင် အတင်းအကျပ် ဆွဲယူသိမ်းဆည်းပေးသည်
  if (navigator.onLine && typeof window.prefetchOfflineMasterData === 'function') {
    window.prefetchOfflineMasterData(true); // force = true ဖြင့် ခေါ်မည်
  }

  if (typeof window.updatePendingUI === 'function') {
    window.updatePendingUI();
  }

  let currentTab = window.AppState ? window.AppState.currentModule : null;

  if (!currentTab) {
    if (role === 'Cashier' || role === 'Main Cashier') {
      currentTab = 'cashier';
    } else if (role === 'HR' || role === 'HR Staff' || role === 'HRStaff') {
      currentTab = 'staff';
    } else {
      currentTab = 'dashboard';
    }
  }

  switchTab(currentTab || 'dashboard');
}

/**
 * 💡 Dynamic Header Academic Year & Time Indicator (Aligned with 100% Calendar Boundary)
 */
function updateHeaderMetadata(username) {
  const metaEl = document.getElementById('live-metadata');
  if (!metaEl) return;

  const activeUser = username || localStorage.getItem('golden_user_name') || localStorage.getItem('golden_user_role') || 'Admin';

  const d = new Date();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayName = days[d.getDay()];

  // 🎯 FIX: တခြားဖိုင်များနှင့် တစ်ပြေးညီဖြစ်စေရန် getCurrentAcademicYear ကို ဦးစားပေးသုံးသည်
  let currentFyStr = "";
  if (typeof window.getCurrentAcademicYear === 'function') {
    currentFyStr = `FY ${window.getCurrentAcademicYear()}`;
  } else {
    let fyYear = d.getFullYear();
    if (d.getMonth() < 3) fyYear -= 1; // ဇန်နဝါရီ၊ ဖေဖော်ဝါရီ၊ မတ်လ (0, 1, 2) သည် ယခင်ပညာသင်နှစ်ထဲတွင် ရှိဆဲဖြစ်သည်
    currentFyStr = `FY ${fyYear}-${fyYear + 1}`;
  }

  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const formattedHours = String(hours).padStart(2, '0');
  const formattedTime = `${formattedHours}:${minutes} ${ampm}`;

  metaEl.textContent = `${currentFyStr} | ${dayName} | ${formattedTime} | ${activeUser}`;
}

if (!window.headerClockInterval) {
  window.headerClockInterval = setInterval(() => {
    const activeUser = localStorage.getItem('golden_user_name') || localStorage.getItem('golden_user_role') || 'Admin';
    updateHeaderMetadata(activeUser);
  }, 10000);
}

/**
 * 💡 Central Tab & View Router Engine
 */
async function switchTab(tabId) {
  const token = localStorage.getItem('golden_auth_token');

  if (!token) {
    document.documentElement.className = 'dark not-authed';
    return;
  }

  // 🎯 လက်ရှိ Module ပေါ် ရောက်နေပြီးသားဖြစ်ပါက DOM ကို ဖျက်ချပြီး ပြန်မထည့်စေရ
  if (window.AppState && window.AppState.currentModule === tabId && document.getElementById('view-container')?.firstElementChild) {
    updateSidebarHighlight(tabId);
    return;
  }

  const viewMap = {
    'dashboard': 'dashboard',
    'bank': 'bank-cash',
    'cash': 'bank-cash',
    'income': 'income',
    'office': 'office-kit',
    'kitchen': 'office-kit',
    'hr': 'hr',
    'staff': 'staff',
    'cashier': 'cashier',
    'student': 'student',
    'student-money': 'student-money',
    'uniform': 'uniform',
    'promotion': 'promotion',
    'report-financial': 'reports',
    'report-in-detail': 'reports',
    'report-in-rep': 'reports',
    'report-student': 'reports',
    'report-staff-fund': 'reports',
    'settings': 'settings'
  };

  // 🎯 FIX: 'staff' Title ကို ရိုးရှင်းသော "Staff Lists" သို့ အဆင့်မြှင့်တင်ထားသည်
  const titleMap = {
    'dashboard': 'Home Dashboard',
    'bank': 'Main Bank Book',
    'cash': 'Main Cash Book',
    'income': 'Main Income Book',
    'office': 'Office Expense Book',
    'kitchen': 'Kitchen Expense Book',
    'hr': 'HR Payroll Expense Book',
    'staff': 'Staff Lists',
    'cashier': 'Cashier Cash Book',
    'student': 'Student Directory List',
    'student-money': 'Student Money Ledger & Wallet',
    'uniform': 'Uniform Inventory Ledger',
    'promotion': 'Promotion Fee Rate Matrix',
    'report-financial': 'Financial Statement Report',
    'report-in-detail': 'Income Detail Report (InDetail)',
    'report-in-rep': 'Monthly Income Report (InRep)',
    'report-student': 'Student Demographics Report',
    'report-staff-fund': 'Staff Bonus & Fund Report',
    'settings': 'System Settings & Controls'
  };

  const viewFileName = viewMap[tabId] || 'dashboard';

  updateSidebarHighlight(tabId);

  const titleEl = document.getElementById('page-title');
  if (titleEl) {
    titleEl.textContent = titleMap[tabId] || 'Home Dashboard';
  }

  if (window.AppState) {
    window.AppState.currentModule = tabId;
  }

  const isTemplateCached = Boolean(window.viewCache[viewFileName]);

  try {
    if (!isTemplateCached && typeof toggleLoading === 'function') {
      toggleLoading(true);
    }

    let htmlContent = window.viewCache[viewFileName];

    if (!htmlContent) {
      const response = await fetch(`views/${viewFileName}.html`);
      if (!response.ok) {
        throw new Error(`Failed to load view template: views/${viewFileName}.html (Status: ${response.status})`);
      }
      htmlContent = await response.text();
      window.viewCache[viewFileName] = htmlContent;
    }

    const container = document.getElementById('view-container');
    if (container) {
      container.innerHTML = htmlContent;
    }

    await triggerModuleInit(tabId);

  } catch (err) {
    console.error(`[SwitchTab Error] Tab '${tabId}':`, err);
    if (typeof showToast === 'function') {
      showToast("ERROR", "စာမျက်နှာ ခေါ်ယူခြင်း မအောင်မြင်ပါ: " + err.message);
    }
  } finally {
    if (typeof toggleLoading === 'function') {
      toggleLoading(false);
    }
  }
}

/**
 * 💡 Trigger Data Loading & Initialization for Specific Module
 */
async function triggerModuleInit(tabId) {
  try {
    switch (tabId) {
      case 'dashboard':
        if (typeof window.loadDashboardData === 'function') {
          await window.loadDashboardData(false, false);
        }
        break;

      case 'bank':
      case 'cash':
        if (typeof window.switchSubBook === 'function') {
          window.switchSubBook(tabId === 'bank' ? 'Bank' : 'Cash');
        } else if (typeof loadBankCashKitData === 'function') {
          await loadBankCashKitData(false, false);
        }
        break;

      case 'cashier':
        if (typeof window.initCashierView === 'function') {
          window.initCashierView('CABank', false);
        } else if (typeof loadCashierData === 'function') {
          await loadCashierData(false);
        }
        break;

      case 'income':
        if (typeof loadIncomeData === 'function') {
          await loadIncomeData(false);
        }
        break;

      case 'office':
      case 'kitchen':
        if (typeof window.switchExpenseBook === 'function') {
          window.switchExpenseBook(tabId === 'office' ? 'Office' : 'Kitchen');
        } else if (typeof loadOfficeData === 'function') {
          await loadOfficeData(false);
        }
        break;

      case 'hr':
        if (typeof loadHrPayrollData === 'function') {
          await loadHrPayrollData(true);
        }
        break;

      case 'staff':
        if (typeof switchStaffCategory === 'function') {
          await switchStaffCategory('Full Time');
        } else if (typeof loadStaffData === 'function') {
          await loadStaffData(false);
        }
        break;

      case 'student':
        if (typeof loadStudentData === 'function') {
          await loadStudentData(false);
        }
        break;

      case 'student-money':
        if (typeof window.switchStudentMoneySubTab === 'function') {
          window.switchStudentMoneySubTab('main');
        } else if (typeof loadStudentMoneyData === 'function') {
          await loadStudentMoneyData(false);
        }
        break;

      case 'uniform':
        if (typeof loadUniformData === 'function') {
          await loadUniformData(false);
        }
        break;

      case 'promotion':
        if (typeof loadPromotionData === 'function') {
          await loadPromotionData(false);
        }
        break;

      // 🎯 REPORTS: Sub-Panels Activation
      case 'report-financial':
        if (typeof showReportPanel === 'function') {
          showReportPanel('panel-report-financial');
        } else if (typeof loadReportFinancialData === 'function') {
          await loadReportFinancialData(false);
        }
        break;

      case 'report-in-detail':
        if (typeof showReportPanel === 'function') {
          showReportPanel('panel-report-income-detail');
        }
        break;

      case 'report-in-rep':
        if (typeof showReportPanel === 'function') {
          showReportPanel('panel-report-monthly-income');
        }
        break;

      case 'report-student':
        if (typeof showReportPanel === 'function') {
          showReportPanel('panel-report-student');
        }
        break;

      case 'report-staff-fund':
        if (typeof showReportPanel === 'function') {
          showReportPanel('panel-report-staff-fund');
        } else if (typeof loadReportStaffFundData === 'function') {
          await loadReportStaffFundData(false);
        }
        break;

      case 'settings':
        // 🎯 FIX: Settings သို့ ပြန်လာတိုင်း ပထမ Sub-Tab ဖြစ်သော 'balances' ကို Default ဖွင့်ပေးသည်
        if (typeof window.switchSettingsSubTab === 'function') {
          window.switchSettingsSubTab('balances');
        }
        if (typeof loadSettingsData === 'function') {
          await loadSettingsData(false);
        }
        break;

      default:
        break;
    }
  } catch (err) {
    console.error(`[ModuleInit Error] Failed to initialize '${tabId}':`, err);
  }
}

/**
 * 💡 Sidebar Active State Synchronization (100% Conflict-Free Routing)
 */
function updateSidebarHighlight(activeTabId) {
  const navBtns = document.querySelectorAll('.nav-btn');
  navBtns.forEach(btn => {
    btn.classList.remove('active');
  });

  let highlightTarget = activeTabId;

  // ၁။ Reports မော်ဂျူးခွဲများအားလုံးကို Financial Report ခလုတ်သို့ ချိတ်ဆက်ခြင်း
  if (activeTabId && activeTabId.startsWith('report-')) {
    highlightTarget = 'report-financial';
  }

  // ၂။ Student Money ၏ Sub-Tabs များဖြစ်ပါက Sidebar တွင် "btn-student-money" သို့သာ တိကျစွာ ချိတ်ဆက်ခြင်း
  // (Cashier Cash Book ၏ 'cashier' နှင့် လုံးဝ မတိုက်မိစေရန် သီးသန့် စစ်ဆေးသည်)
  const studentMoneyTabs = ['student-money', 'settlement', 'reconcile', 'stm-cashier'];
  if (studentMoneyTabs.includes(activeTabId)) {
    highlightTarget = 'student-money';
  }

  // ၃။ သက်ဆိုင်ရာ Sidebar Menu ခလုတ်အား Active Class ပေးခြင်း
  const activeBtn = document.getElementById(`btn-${highlightTarget}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
}

/**
 * 💡 OPEN SALARY GRADE MATRIX MODAL
 */
async function openGradeModal() {
  const modal = document.getElementById('grade-modal');
  if (modal) modal.classList.remove('hidden');

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    const res = await callApi('getPayrollSettings', {}, 'GET');

    if (res && res.data) {
      const d = res.data;
      const gradeKeys = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
      gradeKeys.forEach(k => {
        const input = document.getElementById(`grade-${k}`);
        if (input) {
          const val = d[`grade_${k.toLowerCase()}`] ?? d[`grade${k}`] ?? 0;
          input.value = val;
        }
      });

      const bonusInput = document.getElementById('grade-bonus');
      if (bonusInput) bonusInput.value = d.bonus_rate ?? d.bonusRate ?? 0;

      const fundInput = document.getElementById('grade-fund');
      if (fundInput) fundInput.value = d.fund_rate ?? d.fundRate ?? 0.05;
    }
  } catch (err) {
    console.error("Error opening grade modal:", err);
  } finally {
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function closeGradeModal() {
  const modal = document.getElementById('grade-modal');
  if (modal) modal.classList.add('hidden');
}

/**
 * 💡 SAVE SALARY GRADE MATRIX SETTINGS (With Double-Submit Protection)
 */
async function saveGradeForm(event) {
  if (event && event.preventDefault) event.preventDefault();

  if (isGradeSubmitting) return;
  isGradeSubmitting = true;

  const payload = {
    gradeA: parseFloat(document.getElementById('grade-A')?.value || 0),
    gradeB: parseFloat(document.getElementById('grade-B')?.value || 0),
    gradeC: parseFloat(document.getElementById('grade-C')?.value || 0),
    gradeD: parseFloat(document.getElementById('grade-D')?.value || 0),
    gradeE: parseFloat(document.getElementById('grade-E')?.value || 0),
    gradeF: parseFloat(document.getElementById('grade-F')?.value || 0),
    gradeG: parseFloat(document.getElementById('grade-G')?.value || 0),
    gradeH: parseFloat(document.getElementById('grade-H')?.value || 0),
    gradeI: parseFloat(document.getElementById('grade-I')?.value || 0),
    gradeJ: parseFloat(document.getElementById('grade-J')?.value || 0),
    gradeK: parseFloat(document.getElementById('grade-K')?.value || 0),
    gradeL: parseFloat(document.getElementById('grade-L')?.value || 0),
    bonusRate: parseFloat(document.getElementById('grade-bonus')?.value || 0),
    fundRate: parseFloat(document.getElementById('grade-fund')?.value || 0)
  };

  try {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    const res = await callApi('updatePayrollSettings', payload);

    if (res && res.success) {
      if (typeof showToast === 'function') {
        showToast("SUCCESS", "Grade Matrix နှုန်းထားများကို Cloudflare D1 Database ထဲသို့ အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။");
      }
      closeGradeModal();

      if (typeof fetchPayrollSettings === 'function') {
        await fetchPayrollSettings();
        if (typeof renderGradeDropdownOptions === 'function') renderGradeDropdownOptions();
      }
    } else {
      if (typeof showToast === 'function') {
        showToast("ERROR", res?.message || "Grade သိမ်းဆည်းမှု မအောင်မြင်ပါ။");
      }
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "Grade သိမ်းဆည်းမှု အမှား: " + err.message);
  } finally {
    isGradeSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

/**
 * 💡 Universal Animated Refresh Button Controller (Event-Safe Timing)
 * 🎯 FIX: အချိန်မတိုင်မီ Fake Toast ပြသခြင်းကို ဖယ်ရှားပြီး Animation နှင့် Cache Invalidation သာ သန့်ရှင်းစွာ ပြုလုပ်သည်
 */
document.addEventListener('click', function (e) {
  const refreshBtn = e.target.closest('button');
  if (!refreshBtn) return;

  const btnText = refreshBtn.innerText || '';
  const hasRotateIcon = refreshBtn.querySelector('.fa-rotate, .fa-arrows-rotate, .fa-sync');

  // Refresh ခလုတ်ဖြစ်ပါက လှပသော Animation လှည့်ပေးခြင်းနှင့် Cache ရှင်းပေးခြင်း
  if (btnText.includes('Refresh') || hasRotateIcon) {
    const icon = refreshBtn.querySelector('i');
    if (icon) icon.classList.add('fa-spin');

    // ⚡ Cache ရှင်းထုတ်ပြီး Server သို့ တိုက်ရိုက်ခေါ်စေခြင်း
    if (typeof window.clearAllApiCache === 'function') {
      window.clearAllApiCache();
    }

    setTimeout(() => {
      if (icon) icon.classList.remove('fa-spin');
    }, 800);
  }
});

/**
 * 💡 Real-Time Network & WiFi Status Watcher (With Auto-Sync Engine)
 */
function initNetworkStatusWatcher() {
  updateNetworkStatusIndicator(navigator.onLine);

  window.addEventListener('online', () => {
    updateNetworkStatusIndicator(true);
    showCenterSystemMessage('SUCCESS', 'အင်တာနက်လိုင်း ပြန်လည်ချိတ်ဆက်မိပါပြီ (Online)');

    // 🎯 AUTO SYNC: အင်တာနက် ပြန်လည်ချိတ်ဆက်မိသည်နှင့် Pending ရှိ/မရှိ စစ်ဆေးပြီး အလိုအလျောက် ပို့ပေးသည်
    const queue = window.OfflineSync ? window.OfflineSync.getQueue() : [];
    if (queue.length > 0 && typeof window.syncAllPendingNow === 'function') {
      showCenterSystemMessage('INFO', `Pending စာရင်း (${queue.length}) ခုကို D1 သို့ အလိုအလျောက် ပို့ဆောင်နေပါသည်...`);
      setTimeout(() => window.syncAllPendingNow(), 1000);
    }
  });

  window.addEventListener('offline', () => {
    updateNetworkStatusIndicator(false);
    showCenterSystemMessage('ERROR', 'အင်တာနက်လိုင်း ပြတ်တောက်နေပါသည် (Offline Mode)');
  });
}

function updateNetworkStatusIndicator(isOnline) {
  const statusSpan = document.getElementById('network-status');
  const capsule = document.getElementById('header-status-capsule');
  const divider = document.getElementById('capsule-divider');

  if (!statusSpan) return;

  if (isOnline) {
    statusSpan.style.color = '#34d399';
    statusSpan.title = 'Internet Connected (Online)';
    // 🎯 Online ဖြစ်နေချိန်: အစိမ်းရောင် WiFi Icon
    statusSpan.innerHTML = '<i id="network-icon" class="fa-solid fa-wifi text-[11px]"></i>';

    if (capsule) capsule.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    if (divider) divider.style.color = 'rgba(16, 185, 129, 0.4)';
  } else {
    statusSpan.style.color = '#f87171';
    statusSpan.title = 'Offline Mode (Disconnected)';
    // 🎯 Offline ဖြစ်ချိန်: WiFi Icon အား ကန့်လန့်ဖြတ် မျဉ်းနီလေးဖြင့် Cross လုပ်ထားသော ပုံစံ
    statusSpan.innerHTML = `
      <span class="relative inline-flex items-center justify-center" style="width: 14px; height: 14px;">
        <i id="network-icon" class="fa-solid fa-wifi text-[11px] text-rose-400 opacity-60"></i>
        <span style="position: absolute; width: 14px; height: 1.8px; background-color: #f43f5e; transform: rotate(45deg); border-radius: 1px;"></span>
      </span>
    `;

    if (capsule) capsule.style.borderColor = 'rgba(244, 63, 94, 0.35)';
    if (divider) divider.style.color = 'rgba(244, 63, 94, 0.4)';
  }
}

var centerMessageTimeout = null;

/**
 * 💡 Unified Dead-Center Header Message Controller (100% Borderless & Single-Line)
 */
function showCenterSystemMessage(type, message, duration = 3500) {
  const el = document.getElementById('header-system-message');
  if (!el) return;

  const t = String(type || 'INFO').toUpperCase();
  const safeMsg = (typeof window.escapeHtml === 'function') ? window.escapeHtml(message) : message;

  let theme = {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-300',
    icon: '<i class="fa-solid fa-circle-check text-emerald-400 text-xs"></i>'
  };

  if (t === 'ERROR' || t === 'DANGER') {
    theme = {
      bg: 'bg-rose-500/10',
      text: 'text-rose-300',
      icon: '<i class="fa-solid fa-circle-xmark text-rose-400 text-xs"></i>'
    };
  } else if (t === 'WARNING' || t === 'WARN') {
    theme = {
      bg: 'bg-amber-500/10',
      text: 'text-amber-300',
      icon: '<i class="fa-solid fa-triangle-exclamation text-amber-400 text-xs"></i>'
    };
  } else if (t === 'INFO') {
    theme = {
      bg: 'bg-sky-500/10',
      text: 'text-sky-300',
      icon: '<i class="fa-solid fa-circle-info text-sky-400 text-xs"></i>'
    };
  }

  // 🎯 Border လုံးဝ မပါဝင်ဘဲ လိုက်ဖက်သော အရောင်ဖြင့် Single-line သတ်မှတ်ခြင်း
  el.style.border = 'none';
  el.className = `inline-flex pointer-events-auto items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap shadow-sm transition-all duration-300 animate-in fade-in zoom-in-95 ${theme.bg} ${theme.text}`;
  el.innerHTML = `${theme.icon} <span class="truncate max-w-[320px] sm:max-w-[480px] md:max-w-[650px]">${safeMsg}</span>`;

  if (centerMessageTimeout) clearTimeout(centerMessageTimeout);
  centerMessageTimeout = setTimeout(() => {
    el.classList.add('opacity-0', 'scale-95');
    setTimeout(() => {
      el.className = 'hidden';
      el.innerHTML = '';
      el.classList.remove('opacity-0', 'scale-95');
    }, 300);
  }, duration);
}

/**
 * 💡 Universal Message Router (Redirects ALL System & Action Toasts to Dead-Center Bar)
 */
window.showToast = function (type, message) {
  if (typeof showCenterSystemMessage === 'function') {
    showCenterSystemMessage(type, message);
  }
};

/**
 * 💡 Real-Time Header Pending Button UI Synchronizer (Status Capsule နှင့် Design တူညီသည်)
 */
window.updatePendingUI = function () {
  const btn = document.getElementById('header-pending-btn');
  const label = document.getElementById('pending-count-label');
  const modalBadge = document.getElementById('pending-modal-status-badge');
  const modalTotal = document.getElementById('pending-modal-total-count');

  const queue = window.OfflineSync ? window.OfflineSync.getQueue() : [];
  const count = queue.length;

  if (modalTotal) modalTotal.textContent = count;

  if (count === 0) {
    // 🎯 Pending = 0: အစိမ်းရောင် ငြိမ်သက်သော ဒီဇိုင်း
    if (btn) {
      btn.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      btn.style.backgroundColor = 'rgba(16, 185, 129, 0.05)';
      btn.style.color = '#34d399';
      btn.classList.remove('animate-pulse');
    }
    if (label) label.textContent = 'Synced (0)';
    if (modalBadge) {
      modalBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
      modalBadge.textContent = "All Synced";
    }
  } else {
    // 🎯 Pending > 0: ရွှေဝါရောင် Pulse မီးစက်လေးဖြင့် အသိပေးသော ဒီဇိုင်း
    if (btn) {
      btn.style.borderColor = 'rgba(245, 158, 11, 0.5)';
      btn.style.backgroundColor = 'rgba(245, 158, 11, 0.12)';
      btn.style.color = '#fbbf24';
      btn.classList.add('animate-pulse');
    }
    if (label) label.textContent = `Pending (${count})`;
    if (modalBadge) {
      modalBadge.className = "px-2.5 py-0.5 rounded-full text-[10px] font-black bg-amber-500/15 text-amber-400 border border-amber-500/30 animate-pulse";
      modalBadge.textContent = `${count} Records Waiting`;
    }
  }
};

/**
 * 💡 Open / Close Pending Sync Modal
 */
window.openPendingSyncModal = function () {
  const modal = document.getElementById('pending-sync-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  renderPendingTable();
};

window.closePendingSyncModal = function () {
  const modal = document.getElementById('pending-sync-modal');
  if (modal) modal.classList.add('hidden');
};

function renderPendingTable() {
  const tbody = document.getElementById('pending-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const queue = window.OfflineSync ? window.OfflineSync.getQueue() : [];
  if (queue.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-slate-500 font-bold">Pending စာရင်း မရှိပါ။ အားလုံး D1 သို့ ရောက်ရှိပြီးဖြစ်ပါသည်။</td></tr>`;
    return;
  }

  queue.forEach((item, idx) => {
    tbody.innerHTML += `
      <tr class="hover:bg-slate-800/30 text-xs border-b border-slate-800/40">
        <td class="text-center font-mono py-2.5 px-3 text-slate-400">${idx + 1}</td>
        <td class="font-mono py-2.5 px-3 text-slate-300">${item.date}</td>
        <td class="font-bold text-sky-400 py-2.5 px-3 whitespace-nowrap">${window.escapeHtml(item.bookName || '-')}</td>
        <td class="py-2.5 px-3 font-semibold text-slate-300">${window.escapeHtml(item.category || '-')}</td>
        <td class="font-bold text-slate-100 py-2.5 px-3 truncate max-w-[220px]" title="${window.escapeHtml(item.description)}">${window.escapeHtml(item.description || '-')}</td>
        <td class="text-right font-mono font-bold text-emerald-400 py-2.5 px-3">${Number(item.amount).toLocaleString('en-US')} MMK</td>
        <td class="text-center font-mono text-amber-400 text-[11px] py-2.5 px-3 font-bold">${item.vrNo}</td>
        <td class="text-center py-2.5 px-3 right-0 sticky bg-[#0c1322]">
          <button onclick="window.OfflineSync.remove('${item.id}'); renderPendingTable();" class="p-1 text-rose-400 hover:text-rose-300 transition" title="Delete">
            <i class="fa-solid fa-trash-can"></i>
          </button>
        </td>
      </tr>
    `;
  });
}


/**
 * 💡 Sync All Pending Transactions to Cloudflare D1
 * Auto-strips temp vouchers and triggers Auto-Refresh across all modules (including HR Payroll)
 */
window.syncAllPendingNow = async function () {
  if (!navigator.onLine) {
    return showToast("ERROR", "အင်တာနက်လိုင်း ချိတ်ဆက်ထားခြင်း မရှိသေးသဖြင့် Sync မလုပ်နိုင်သေးပါ။");
  }

  const queue = window.OfflineSync ? window.OfflineSync.getQueue() : [];
  if (queue.length === 0) return showToast("INFO", "Sync လုပ်ရန် Pending စာရင်း မရှိပါ။");

  const btnSync = document.getElementById('btn-pending-sync-now');
  if (btnSync) {
    btnSync.disabled = true;
    btnSync.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin text-xs"></i> <span>Syncing to D1...</span>';
  }

  let successCount = 0;
  for (const item of queue) {
    try {
      // 🎯 FIX: အော့ဖ်လိုင်း ယာယီဘောင်ချာ (TEMP- / OFF-) ဖြစ်နေပါက Server မှ တရားဝင်ဘောင်ချာ ထုတ်ပေးနိုင်ရန် vrNo ကို ဖယ်ထုတ်၍ ပို့သည်
      const syncPayload = { ...item.payload };
      if (syncPayload.isOfflineTempVr || (syncPayload.vrNo && (syncPayload.vrNo.startsWith('TEMP-') || /^OFF-\d{6}$/.test(syncPayload.vrNo)))) {
        delete syncPayload.vrNo;
        delete syncPayload.isOfflineTempVr;
      }

      const res = await callApi(item.action, { ...syncPayload, forceRefresh: true }, item.method);
      if (res && res.success) {
        window.OfflineSync.remove(item.id);
        successCount++;
      }
    } catch (err) {
      console.warn("Failed to sync item:", item.id, err);
    }
  }

  if (btnSync) {
    btnSync.disabled = false;
    btnSync.innerHTML = '<i class="fa-solid fa-cloud-arrow-up text-xs"></i> <span>Sync All to D1 Now</span>';
  }

  renderPendingTable();
  window.updatePendingUI();

  if (successCount > 0) {
    showToast("SUCCESS", `Pending စာရင်း (${successCount}) ခုကို Cloudflare D1 သို့ တရားဝင်ဘောင်ချာနံပါတ်များဖြင့် အောင်မြင်စွာ ပို့ဆောင်ပြီးပါပြီ။`);

    // 🎯 AUTO REFRESH: စာရင်း Sync ပြီးသည်နှင့် သက်ဆိုင်ရာ စာမျက်နှာရှိ ဇယားများကို Data အသစ်ဖြင့် Auto-Refresh ပြုလုပ်ပေးခြင်း
    if (typeof loadHrPayrollData === 'function') loadHrPayrollData(true); // 🎯 HR Payroll Auto Refresh
    if (typeof loadStaffData === 'function') loadStaffData(false);
    if (typeof loadIncomeData === 'function') loadIncomeData(true, true);
    if (typeof loadOfficeData === 'function') loadOfficeData(true, true);
    if (typeof loadBankCashKitData === 'function') loadBankCashKitData(true, true);
    if (typeof loadStudentMoneyData === 'function') loadStudentMoneyData(true, true);
    if (typeof loadPmCashierBookData === 'function') loadPmCashierBookData(true, true);

    // 🎯 ၃။ CASHIER CASH BOOK (TABS အားလုံး) အလိုအလျောက် AUTO REFRESH ပြုလုပ်ခြင်း
    if (typeof loadCashierData === 'function') {
      loadCashierData(true); // forceRefresh = true ဖြင့် D1 သို့ တိုက်ရိုက်ခေါ်ယူသည်
    }

    // လက်ရှိ ဖွင့်ထားသော Cashier Sub-tab (CABank, CACash, CAOffice, CAKitchen, CAPayroll, Today Income) အား Re-render လုပ်သည်
    if (typeof window.initCashierView === 'function') {
      const activeCashierSub = window.gCurrentCashierSubBook || window.currentCashierSubBook || 'CABank';
      window.initCashierView(activeCashierSub, true);
    }
    if (typeof window.switchCashierSubBook === 'function' && (window.gCurrentCashierSubBook || window.currentCashierSubBook)) {
      window.switchCashierSubBook(window.gCurrentCashierSubBook || window.currentCashierSubBook, true);
    }

    // လက်ရှိ Active Module ပေါ်မူတည်၍ တစ်ပြေးညီ ပြန်လည် Re-render စေခြင်း
    if (window.AppState && window.AppState.currentModule && typeof triggerModuleInit === 'function') {
      triggerModuleInit(window.AppState.currentModule);
    }
  }
};

window.clearAllPendingQueue = function () {
  if (!confirm("Pending ဖြစ်နေသော စာရင်းများအားလုံးကို အပြီးတိုင် ဖျက်ပစ်မည်မှာ သေချာပါသလား?")) return;
  if (window.OfflineSync) window.OfflineSync.clearAll();
  renderPendingTable();
  showToast("SUCCESS", "Pending Queue အား ရှင်းလင်းပြီးပါပြီ။");
};

/**
 * 💡 Pre-fetch Complete Offline Master Dataset (0 D1 Quota Cost when cached)
 * Caches: 1. Students + Wallet Balances, 2. Staff Lists, 3. Salary Grade Matrix
 */
window.prefetchOfflineMasterData = async function (force = false) {
  if (!navigator.onLine) return;

  const currentFy = typeof window.getCurrentAcademicYear === 'function' ? window.getCurrentAcademicYear() : '2026-2027';
  const stuCacheKey = `golden_master_students_${currentFy}`;
  const staffCacheKey = 'golden_master_staff';
  const gradeCacheKey = 'golden_master_payroll_settings';

  try {
    // ၁။ Students Directory & Wallet Balances Pre-cache
    if (force || !localStorage.getItem(stuCacheKey)) {
      const [stuRes, sumRes] = await Promise.all([
        callApi('getStudentData', { fy: currentFy, limit: 5000 }, 'GET'),
        callApi('getStudentMoneySummary', { fy: currentFy }, 'GET')
      ]);

      const balanceMap = new Map();
      if (sumRes && sumRes.success && Array.isArray(sumRes.data)) {
        sumRes.data.forEach(r => balanceMap.set(parseInt(r.studentId, 10), parseFloat(r.netBalance || 0)));
      }

      if (stuRes && stuRes.success && Array.isArray(stuRes.data)) {
        const compactStudents = stuRes.data.map(s => {
          const sId = parseInt(s.student_id || s.studentId || s.id, 10);
          return {
            id: sId,
            studentId: sId,
            fyid: s.fyid || '',
            name: s.name || s.fyid_name || '',
            fyidName: s.fyidName || s.fyid_name || s.name || '',
            class: s.class || '',
            category: s.category || '',
            promo: s.promo || '',
            balance: balanceMap.get(sId) || 0 // 🎯 Wallet Balance ပါ တစ်ခါတည်း Cache သိမ်းဆည်းသည်
          };
        });
        localStorage.setItem(stuCacheKey, JSON.stringify(compactStudents));
        console.log(`[Offline Sync] Cached ${compactStudents.length} students with wallet balances.`);
      }
    }

    // ၂။ Staff List Pre-cache (Full Time & Part Time)
    if (force || !localStorage.getItem(staffCacheKey)) {
      const [ftRes, ptRes] = await Promise.all([
        callApi('getStaffData', { category: 'Full Time' }, 'GET'),
        callApi('getStaffData', { category: 'Part Time' }, 'GET')
      ]);

      const allStaff = [...(ftRes?.data || []), ...(ptRes?.data || [])];
      if (allStaff.length > 0) {
        const compactStaff = allStaff.map(st => {
          // 🎯 FIX: Primary Key (st.id) အစား တကယ့် Staff ID (st.staffId) ကို အဓိက သတ်မှတ်သည်
          const realStaffId = parseInt(st.staffId || st.staff_id, 10);
          return {
            id: realStaffId,
            staffId: realStaffId,
            staff_id: realStaffId,
            name: st.name || '',
            staffIdName: st.staffIdName || st.staff_idname || `[FID ${String(realStaffId).padStart(3, '0')}] ${st.name || ''}`,
            category: st.category || 'Full Time',
            position: st.position || '',
            salaryGrade: st.salaryGrade || '',
            basicAmt: st.basicAmt || 0,
            extraAmt: st.extraAmt || 0,
            totalSalary: st.totalSalary || 0,
            bonus: st.bonus || 0,
            fund: st.fund || 0,
            unpaidBonus: st.unpaidBonus || 0,
            unpaidFund: st.unpaidFund || 0
          };
        });
        localStorage.setItem(staffCacheKey, JSON.stringify(compactStaff));
        console.log(`[Offline Sync] Cached ${compactStaff.length} staff records with exact Staff IDs.`);
      }
    }

    // ၃။ Salary Grade Matrix Settings Pre-cache
    if (force || !localStorage.getItem(gradeCacheKey)) {
      const gradeRes = await callApi('getPayrollSettings', {}, 'GET');
      if (gradeRes && gradeRes.success && gradeRes.data) {
        localStorage.setItem(gradeCacheKey, JSON.stringify(gradeRes.data));
        console.log(`[Offline Sync] Cached Salary Grade Matrix.`);
      }
    }

  } catch (err) {
    console.warn("[Offline Sync Pre-fetch Warning]:", err.message);
  }
};

// 💡 EXPOSE GLOBALLY TO WINDOW
window.initApp = initApp;
window.openGradeModal = openGradeModal;
window.closeGradeModal = closeGradeModal;
window.saveGradeForm = saveGradeForm;
window.switchTab = switchTab;
window.triggerModuleInit = triggerModuleInit;
window.updateSidebarHighlight = updateSidebarHighlight;
window.updateHeaderMetadata = updateHeaderMetadata;
window.initNetworkStatusWatcher = initNetworkStatusWatcher;
window.showCenterSystemMessage = showCenterSystemMessage;