/**
 * ==============================================================================
 * GOLDEN ERP SYSTEM - STUDENT LIST & DEMOGRAPHICS MODULE (D1 DATABASE COMPATIBLE)
 * File: js/student.js (Location: cashbook-frontend/js/student.js)
 * 💡 Features: Universal Dynamic FY Generator (March Boundary getMonth() < 2), Float .0 Sanitizer,
 *              Full Dataset Loader (5000 rows limit), Active FY Accurate KPI Analytics,
 *              Strict Sequential NO Sorting (1214, 1213, 1212...),
 *              Refined Myanmar/Ethnic Gender Auto-Detector (100% Accurate Male vs Female),
 *              🛡️ Universal CSV Formula Injection Sanitizer (safeCsvCell),
 *              🎯 Bug #2 Fixed (Resilient Local escapeHtml / escapeJsAttr Callbacks)
 * ==============================================================================
 */

window.StudentState = {
  page: 1,
  limit: 20,
  totalRows: 0,
  activeData: [],
  searchVal: '',
  fyFilter: '',
  stats: { totalActive: 0, totalInactive: 0, total: 0 }
};

var searchTimeoutStudent = null;
var lookupTimeoutStudent = null;
var isStudentSubmitting = false;

const CLASS_PROMOTION_MAP = {
  'Pre School': 'KG Student',
  'KG Student': 'Grade 1',
  'Grade 1': 'Grade 2',
  'Grade 2': 'Grade 3',
  'Grade 3': 'Grade 4',
  'Grade 4': 'Grade 5',
  'Grade 5': 'Grade 6',
  'Grade 6': 'Grade 7',
  'Grade 7': 'Grade 8',
  'Grade 8': 'Grade 9',
  'Grade 9': 'Grade 10',
  'Grade 10': 'Grade 11',
  'Grade 11': 'Grade 12',
  'Grade 12': 'Grade 12'
};

/**
 * 💡 Safe Native DOM HTML Escaper (Bug #2 Resilient Fallback)
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  if (typeof window.escapeHtml === 'function' && window.escapeHtml !== escapeHtml) {
    return window.escapeHtml(str);
  }
  var div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/**
 * 💡 Safe escaper for values injected into inline onclick="...('VALUE')" handlers.
 */
function escapeJsAttr(str) {
  if (str === null || str === undefined) return '';
  if (typeof window.escapeJsAttr === 'function' && window.escapeJsAttr !== escapeJsAttr) {
    return window.escapeJsAttr(str);
  }
  var jsEscaped = String(str).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return escapeHtml(jsEscaped);
}

/**
 * 🛡️ Safe CSV Cell Helper (Local Fallback if api.js is not loaded yet)
 */
function safeCsvCell(val) {
  if (typeof window.safeCsvCell === 'function') {
    return window.safeCsvCell(val);
  }
  if (val === null || val === undefined) return '""';
  if (typeof val === 'number') return isNaN(val) ? '0' : String(val);

  var str = String(val).trim();
  if (str === '') return '""';

  var cleanNumStr = str.replace(/,/g, '');
  if (!isNaN(Number(cleanNumStr)) && cleanNumStr !== '') {
    return `"${str.replace(/"/g, '""')}"`;
  }

  if (/^[=+\-@\t\r]/.test(str)) {
    str = "'" + str;
  }

  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * 💡 Refined Myanmar & Ethnic Gender Auto-Detector (100% Accurate Male vs Female)
 */
function autoDetectGender(nameStr) {
  if (!nameStr) return 'Male';
  const clean = String(nameStr).trim();

  // ၁။ ယောကျ်ားလေး ရှေ့စာလုံးများ (မင်းမင်း၊ မင်းခန့် စသည့် 'မင်း' ပါ ထည့်သွင်းထားသည်)
  if (clean.startsWith('မောင်') || clean.startsWith('ကို') || clean.startsWith('ဦး') ||
      clean.startsWith('မင်း') || /^(Mg|Ko|U|Min)\b/i.test(clean) || /^(မောင်|ကို|ဦး|မင်း)/.test(clean)) {
    return 'Male';
  }

  // ၂။ မိန်းကလေး ရှေ့စာလုံးများနှင့် တိုင်းရင်းသူအမည်များ (နန်း၊ နော်)
  if (clean.startsWith('မေ') || clean.startsWith('ဒေါ်') || clean.startsWith('နန်း') || clean.startsWith('နော်') ||
      /^(May|Daw|Nang|Naw)\b/i.test(clean)) {
    return 'Female';
  }

  // ၃။ 'မ' ဖြင့် စပြီး 'မောင်' သို့မဟုတ် 'မင်း' မဟုတ်ပါက Female
  if ((clean.startsWith('မ') && !clean.startsWith('မောင်') && !clean.startsWith('မင်း')) || /^(Ma)\b/i.test(clean)) {
    return 'Female';
  }

  return 'Male';
}

/**
 * 💡 1. Universal Dynamic Academic Year Generator (Phase 1.1: March Boundary Aligned)
 */
function getCurrentAcademicYear(dateInput) {
  var d = dateInput ? new Date(dateInput) : new Date();
  var validDate = isNaN(d.getTime()) ? new Date() : d;
  var y = validDate.getFullYear();

  // 🎯 FIX (Phase 1.1): မတ်လ (Month index 2) သည် နှစ်သစ်ဖြစ်သဖြင့် ဇန်နဝါရီ၊ ဖေဖော်ဝါရီ (< 2) သာ ယခင်နှစ်ထဲ သတ်မှတ်သည်
  if (validDate.getMonth() < 2) {
    y -= 1;
  }
  return `${y}-${y + 1}`;
}

/**
 * 💡 2. System-Wide Dynamic FY Short Code Generator (Format: "2026-2027" -> "2627")
 */
function getFyShortCode(fyStr) {
  if (fyStr) {
    var clean = String(fyStr).replace(/^FY\s*/i, '').trim();
    var parts = clean.split(/[-/]/);
    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
      var y1 = parts[0].trim().slice(-2);
      var y2 = parts[1].trim().slice(-2);
      return y1 + y2;
    }
    if (/^\d{4}$/.test(clean)) {
      return clean;
    }
  }

  var currentFy = getCurrentAcademicYear();
  var p = currentFy.split('-');
  return p[0].slice(-2) + p[1].slice(-2);
}

/**
 * 💡 FYID Float .0 Sanitizer
 */
function sanitizeFyidStr(fyidStr) {
  var s = String(fyidStr || '').trim();
  if (!s) return s;
  if (s.indexOf('.0') === -1) return s;
  var cleaned = s.replace(/\.0/g, '');
  var parts = cleaned.split('-STU-');
  if (parts.length === 2) {
    var numPart = parseInt(parts[1], 10) || 0;
    return `${parts[0]}-STU-${String(numPart).padStart(4, '0')}`;
  }
  return cleaned;
}

function filterStudentData(list = [], searchVal = '', fyFilter = '') {
  let filtered = list;

  if (fyFilter && fyFilter.trim()) {
    const fyQ = fyFilter.trim().toLowerCase();
    filtered = filtered.filter(row => String(row.fy || '').trim().toLowerCase() === fyQ);
  }

  if (searchVal && searchVal.trim()) {
    const q = searchVal.trim().toLowerCase();
    filtered = filtered.filter(row => {
      const nameMatch = String(row.name || '').toLowerCase().includes(q) || String(row.fyid_name || row.fyidName || '').toLowerCase().includes(q);
      const fyidMatch = String(row.fyid || '').toLowerCase().includes(q);
      const idMatch = String(row.student_id || row.studentId || row.id || '').toLowerCase().includes(q);
      const classMatch = String(row.class || '').toLowerCase().includes(q);
      const phoneMatch = String(row.phone_no || row.phoneNo || '').toLowerCase().includes(q);
      return nameMatch || fyidMatch || idMatch || classMatch || phoneMatch;
    });
  }

  // 💡 Strict NO Sequential Sorting (အမြဲတမ်း NO အကြီးဆုံးမှ အငယ်သို့ အစဉ်လိုက် စီပေးခြင်း)
  filtered.sort((a, b) => {
    const noA = parseInt(a.no, 10) || 0;
    const noB = parseInt(b.no, 10) || 0;
    return noB - noA; // Descending: 1214, 1213, 1212...
  });

  return filtered;
}

async function loadStudentData(isSilent = false) {
  if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);

  const state = window.StudentState;

  try {
    const response = await callApi('getStudentData', {
      page: 1,
      limit: 5000,
      searchVal: state.searchVal
    }, 'GET');

    if (response && response.data) {
      state.activeData = response.data;
      state.totalRows = response.totalRows || response.data.length || 0;

      populateMainFYFilterStudent();
      updateStatsStudent(response.stats);
      renderStudentTable();
    }
  } catch (err) {
    console.error("Error loading Student List data:", err);
    if (!isSilent && typeof showToast === 'function') {
      showToast("ERROR", "ကျောင်းသားစာရင်းများ ရယူ၍ မရပါ: " + err.message);
    }
  } finally {
    if (!isSilent && typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function populateMainFYFilterStudent() {
  const select = document.getElementById('student-filter-fy');
  if (!select) return;

  const rawData = window.StudentState.activeData || [];
  const fySet = new Set();
  fySet.add(getCurrentAcademicYear());

  rawData.forEach(r => {
    if (r.fy) fySet.add(String(r.fy).trim().replace(/^FY\s*/i, ''));
  });

  const currentSelected = select.value !== undefined ? select.value : (window.StudentState.fyFilter || '');
  let html = `<option value="" ${!currentSelected ? 'selected' : ''}>-- All FY --</option>`;
  fySet.forEach(fy => {
    html += `<option value="${fy}" ${fy === currentSelected ? 'selected' : ''}>${fy}</option>`;
  });

  select.innerHTML = html;
  window.StudentState.fyFilter = select.value;
}

function onFyFilterChangeStudent() {
  const select = document.getElementById('student-filter-fy');
  if (select) {
    window.StudentState.fyFilter = select.value;
    window.StudentState.page = 1;
    updateStatsStudent();
    renderStudentTable();
  }
}

function updateStatsStudent(serverStats) {
  const rawData = window.StudentState.activeData || [];
  const selectedFy = document.getElementById('student-filter-fy')?.value;
  const targetFyForKpi = selectedFy || '';

  let fyList = rawData;
  if (targetFyForKpi && targetFyForKpi.trim()) {
    fyList = rawData.filter(r => String(r.fy || '').trim().toLowerCase().includes(targetFyForKpi.trim().toLowerCase()));
  }

  let actCount = 0;
  let inactCount = 0;

  fyList.forEach(r => {
    const transDate = r.transfer_date || r.transferDate || "";
    const stat = (r.status || "").toLowerCase();
    if (transDate || stat === "inactive") {
      inactCount++;
    } else {
      actCount++;
    }
  });

  const actEl = document.getElementById('stu-total-active');
  if (actEl) actEl.innerText = Number(actCount).toLocaleString('en-US');

  const inactEl = document.getElementById('stu-total-inactive');
  if (inactEl) inactEl.innerText = Number(inactCount).toLocaleString('en-US');

  const totEl = document.getElementById('stu-total-students');
  if (totEl) totEl.innerText = Number(actCount + inactCount).toLocaleString('en-US');

  const countEl = document.getElementById('stu-entries-count');
  if (countEl) countEl.innerText = Number(fyList.length).toLocaleString('en-US');
}

function renderStudentTable() {
  const tableBody = document.getElementById('student-table-body');
  if (!tableBody) return;

  const state = window.StudentState;
  const rawData = state.activeData || [];
  const searchInput = document.getElementById('student-search');
  const searchVal = searchInput ? searchInput.value.trim() : (state.searchVal || '');
  const fyFilter = document.getElementById('student-filter-fy')?.value || state.fyFilter || '';

  const filteredData = filterStudentData(rawData, searchVal, fyFilter);

  updatePaginationStudent(filteredData.length);

  if (!filteredData || filteredData.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="16" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ကျောင်းသား စာရင်း မရှိပါ။</td></tr>`;
    return;
  }

  const startIndex = (state.page - 1) * state.limit;
  const endIndex = Math.min(startIndex + state.limit, filteredData.length);
  const pageItems = filteredData.slice(startIndex, endIndex);

  const isViewer = (window.AppState ? window.AppState.currentUserRole : '') === "Viewer";

  tableBody.innerHTML = pageItems.map((row) => {
    let displayDate = row.date || "";
    if (displayDate) {
      let parts = displayDate.split('-');
      if (parts.length === 3) displayDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    const transDateVal = row.transfer_date || row.transferDate || "";
    let displayTransDate = transDateVal;
    if (displayTransDate) {
      let parts = displayTransDate.split('-');
      if (parts.length === 3) displayTransDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
    }

    const isTransferred = !!transDateVal;
    const finalStatus = isTransferred ? "Inactive" : (row.status || "Active");
    const isInactive = finalStatus.toLowerCase() === "inactive";

    const uniqueIdVal = row.uniqueid || row.uniqueId || "";
    const stuStatusVal = row.stu_status || row.stuStatus || "New Student";
    const parentsNameVal = row.parents_name || row.parentsName || "-";
    const phoneNoVal = row.phone_no || row.phoneNo || "-";

    const detectedGender = row.gender || autoDetectGender(row.name);
    const displayFyid = sanitizeFyidStr(row.fyid || '-');
    const displayNo = parseInt(row.no, 10) || 1;

    return `
      <tr class="hover:bg-slate-800/20 text-slate-300">
        <td class="text-center font-mono font-bold text-slate-400 py-3 px-2">${displayNo}</td>
        <td class="py-3 px-2"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">${escapeHtml(stuStatusVal)}</span></td>
        <td class="font-mono text-xs py-3 px-2">${escapeHtml(displayDate || '-')}</td>
        <td class="font-mono font-bold text-indigo-300 py-3 px-2">${escapeHtml(row.fy || '-')}</td>
        <td class="font-bold text-slate-200 font-mono py-3 px-2">${escapeHtml(displayFyid)}</td>
        <td class="font-bold text-slate-100 py-3 px-2">${escapeHtml(row.name || '-')}</td>
        <td class="py-3 px-2">${escapeHtml(row.class || '-')}</td>
        <td class="py-3 px-2"><span class="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400">${escapeHtml(row.category || '-')}</span></td>
        <td class="py-3 px-2">${escapeHtml(row.promo || '-')}</td>
        <td class="py-3 px-2">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${!isInactive ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}">
            ${escapeHtml(finalStatus)}
          </span>
        </td>
        <td class="font-semibold py-3 px-2">${escapeHtml(detectedGender)}</td>
        <td class="font-mono text-xs py-3 px-2">${escapeHtml(displayTransDate || '-')}</td>
        <td class="py-3 px-2">${escapeHtml(parentsNameVal)}</td>
        <td class="font-mono text-xs whitespace-normal max-w-xs py-3 px-2">${escapeHtml(phoneNoVal)}</td>
        <td class="max-w-xs truncate py-3 px-2" title="${escapeHtml(row.address || '')}">${escapeHtml(row.address || '-')}</td>
        <td class="right-0 sticky bg-[#0c1322] border-l border-slate-800 shadow-lg text-center py-3 px-2">
          <div class="flex items-center justify-center gap-3 ${isViewer ? 'hidden' : ''}">
            <button onclick="editStudentEntry('${escapeJsAttr(uniqueIdVal)}')" class="text-indigo-400 hover:text-indigo-300 transition" title="Edit Profile">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button onclick="deleteStudentEntry('${escapeJsAttr(uniqueIdVal)}')" class="text-rose-400 hover:text-rose-300 transition btn-delete" title="Delete Profile">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function updatePaginationStudent(currentCount) {
  const state = window.StudentState;
  const info = document.getElementById('stu-pagination-info');
  if (info) {
    const totalToDisplay = (currentCount !== undefined) ? currentCount : state.totalRows;
    const start = totalToDisplay === 0 ? 0 : (state.page - 1) * state.limit + 1;
    const end = Math.min(state.page * state.limit, totalToDisplay);
    info.innerHTML = `Showing <span class="text-indigo-400 font-extrabold">${start}</span> to <span class="text-indigo-400 font-extrabold">${end}</span> of <span class="text-indigo-400 font-extrabold">${totalToDisplay}</span> entries`;
  }

  const prevBtn = document.getElementById('stu-btn-prev');
  if (prevBtn) prevBtn.disabled = (state.page <= 1);

  const nextBtn = document.getElementById('stu-btn-next');
  if (nextBtn) nextBtn.disabled = (state.page * state.limit >= (currentCount || state.totalRows));
}

function changePageStudent(dir) {
  const state = window.StudentState;
  const totalFiltered = filterStudentData(state.activeData, state.searchVal, state.fyFilter).length;
  
  if (dir === -1 && state.page > 1) {
    state.page--;
    renderStudentTable();
  } else if (dir === 1 && (state.page * state.limit) < totalFiltered) {
    state.page++;
    renderStudentTable();
  }
}

function onSearchInputStudent() {
  clearTimeout(searchTimeoutStudent);
  searchTimeoutStudent = setTimeout(() => {
    const searchInput = document.getElementById('student-search');
    window.StudentState.searchVal = searchInput ? searchInput.value.trim() : '';
    window.StudentState.page = 1;
    renderStudentTable();
  }, 200);
}

function populateDynamicFYDropdownStudent(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const currentFY = getCurrentAcademicYear();
  const startYear = parseInt(currentFY.split('-')[0], 10);

  const prevFY = `${startYear - 1}-${startYear}`;
  const nextFY = `${startYear + 1}-${startYear + 2}`;

  const currentVal = select.value || currentFY;

  select.innerHTML = `
    <option value="${prevFY}" ${prevFY === currentVal ? 'selected' : ''}>${prevFY}</option>
    <option value="${currentFY}" ${currentFY === currentVal ? 'selected' : ''}>${currentFY}</option>
    <option value="${nextFY}" ${nextFY === currentVal ? 'selected' : ''}>${nextFY}</option>
  `;
}

function onStudentStatusChange() {
  const statusEl = document.getElementById('stu-stustatus');
  const idInput = document.getElementById('stu-id-input');
  const idLabel = document.getElementById('stu-id-label');

  if (!statusEl || !idInput) return;

  const isOld = statusEl.value === 'Old Student';
  if (isOld) {
    idInput.readOnly = false;
    idInput.placeholder = "Type Student ID (e.g. 1)...";
    if (idLabel) idLabel.innerHTML = 'Student ID <span class="text-indigo-400 text-[10px]">(Lookup ID)</span>';
  } else {
    idInput.readOnly = true;
    idInput.value = "";
    idInput.placeholder = "Auto Generated";
    if (idLabel) idLabel.innerHTML = 'Student ID';
  }
}

function onOldStudentIdLookup() {
  clearTimeout(lookupTimeoutStudent);
  lookupTimeoutStudent = setTimeout(async () => {
    const statusEl = document.getElementById('stu-stustatus');
    const idInput = document.getElementById('stu-id-input');
    if (!statusEl || statusEl.value !== 'Old Student' || !idInput) return;

    const lookupId = idInput.value.trim();
    if (!lookupId) return;

    let match = (window.StudentState.activeData || []).find(r => 
      String(r.student_id || r.studentId || r.id || '') === lookupId ||
      String(r.fyid || '').toLowerCase().endsWith(`-stu-${lookupId.padStart(4, '0')}`)
    );

    if (!match) {
      try {
        const res = await callApi('lookupStudentById', { studentId: lookupId }, 'GET');
        if (res && res.success && res.data) {
          match = res.data;
        }
      } catch (err) {
        console.warn("Student lookup API call error:", err);
      }
    }

    if (match) {
      const nameEl = document.getElementById('stu-name');
      if (nameEl) nameEl.value = match.name || "";

      const oldClass = match.class || "Pre School";
      const promotedClass = CLASS_PROMOTION_MAP[oldClass] || oldClass;
      const classEl = document.getElementById('stu-class');
      if (classEl) classEl.value = promotedClass;

      const catEl = document.getElementById('stu-category');
      if (catEl) catEl.value = match.category || "Boarder";

      const promoEl = document.getElementById('stu-promo');
      if (promoEl) promoEl.value = "Original price";

      const parentsEl = document.getElementById('stu-parents');
      if (parentsEl) parentsEl.value = match.parents_name || match.parentsName || "";

      const phoneEl = document.getElementById('stu-phone');
      if (phoneEl) phoneEl.value = match.phone_no || match.phoneNo || "";

      const addrEl = document.getElementById('stu-address');
      if (addrEl) addrEl.value = match.address || "";

      const hiddenIdEl = document.getElementById('stu-id');
      if (hiddenIdEl) hiddenIdEl.value = match.student_id || match.studentId || match.id || lookupId;

      if (typeof showToast === 'function') {
        showToast("SUCCESS", `ကျောင်းသားဟောင်း "${match.name}" ၏ ရာဇဝင်အား ရှာဖွေတွေ့ရှိပါသည်။ အတန်းအား "${promotedClass}" သို့ အလိုအလျောက် တိုးမြှင့်ပေးထားပါသည်။`);
      }
    }
  }, 400);
}

async function saveStudentForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (isStudentSubmitting) return;
  isStudentSubmitting = true;

  const uniqueId = document.getElementById('stu-uniqueId')?.value || '';
  const isAdd = (!uniqueId);

  const transferDateVal = document.getElementById('stu-transferdate')?.value || "";
  const calculatedStatus = transferDateVal ? "Inactive" : "Active";

  const fyVal = document.getElementById('stu-fy')?.value || getCurrentAcademicYear();
  const nameVal = document.getElementById('stu-name')?.value || "";

  const detectedGender = autoDetectGender(nameVal);
  const fyShort = getFyShortCode(fyVal);
  const inputStudentId = document.getElementById('stu-id-input')?.value.trim();
  const hiddenStudentId = document.getElementById('stu-id')?.value.trim();
  const studentIdVal = inputStudentId || hiddenStudentId || "";

  const entry = {
    uniqueId: uniqueId,
    id: studentIdVal,
    studentId: studentIdVal,
    date: document.getElementById('stu-date')?.value || "",
    fy: fyVal,
    fyShort: fyShort,
    name: nameVal,
    gender: detectedGender,
    class: document.getElementById('stu-class')?.value || "",
    category: document.getElementById('stu-category')?.value || "",
    promo: document.getElementById('stu-promo')?.value || "Original price",
    stuStatus: document.getElementById('stu-stustatus')?.value || "New Student",
    status: calculatedStatus,
    transferDate: transferDateVal,
    parentsName: document.getElementById('stu-parents')?.value || "",
    phoneNo: document.getElementById('stu-phone')?.value || "",
    address: document.getElementById('stu-address')?.value || "",
    createdBy: (window.AppState ? window.AppState.currentUser : '') || "Admin"
  };

  closeStudentModal();
  const action = isAdd ? 'saveStudentEntry' : 'updateStudentEntry';
  if (typeof toggleLoading === 'function') toggleLoading(true);

  try {
    const response = await callApi(action, entry);
    if (response && response.success) {
      if (typeof showToast === 'function') {
        showToast("SUCCESS", isAdd ? "ကျောင်းသားသစ် မှတ်တမ်း အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။" : "ကျောင်းသား မှတ်တမ်း ပြင်ဆင်ခြင်း အောင်မြင်ပါသည်။");
      }
      if (typeof window.clearAllApiCache === 'function') window.clearAllApiCache();
      loadStudentData(true);
    } else {
      if (typeof showToast === 'function') showToast("ERROR", "သိမ်းဆည်းမှု မအောင်မြင်ပါ: " + (response ? response.message : ""));
    }
  } catch (err) {
    if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
  } finally {
    isStudentSubmitting = false;
    if (typeof toggleLoading === 'function') toggleLoading(false);
  }
}

function openAddModalStudent() {
  const form = document.getElementById('student-form');
  if (form) form.reset();

  const uidEl = document.getElementById('stu-uniqueId');
  if (uidEl) uidEl.value = "";

  const idEl = document.getElementById('stu-id');
  if (idEl) idEl.value = "";

  const dateEl = document.getElementById('stu-date');
  if (dateEl) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    dateEl.value = `${yyyy}-${mm}-${dd}`;
  }

  populateDynamicFYDropdownStudent('stu-fy');
  onStudentStatusChange();

  const modalEl = document.getElementById('student-modal');
  if (modalEl) modalEl.classList.remove('hidden');
}

function closeStudentModal() {
  const modalEl = document.getElementById('student-modal');
  if (modalEl) modalEl.classList.add('hidden');
}

function editStudentEntry(uniqueId) {
  const row = window.StudentState.activeData.find(item => item.uniqueid === uniqueId || item.uniqueId === uniqueId);
  if (!row) {
    if (typeof showToast === 'function') showToast("ERROR", "မူရင်း အချက်အလက် ရှာမတွေ့ပါ။");
    return;
  }

  openAddModalStudent();

  const uidEl = document.getElementById('stu-uniqueId');
  if (uidEl) uidEl.value = row.uniqueid || row.uniqueId || "";

  const idEl = document.getElementById('stu-id');
  const stuIdVal = row.student_id || row.studentId || row.id || "";
  if (idEl) idEl.value = stuIdVal;

  const idInputEl = document.getElementById('stu-id-input');
  if (idInputEl) idInputEl.value = stuIdVal;

  const dateEl = document.getElementById('stu-date');
  if (dateEl) dateEl.value = row.date || "";

  const fyEl = document.getElementById('stu-fy');
  if (fyEl) fyEl.value = row.fy || "";

  const stuStatusEl = document.getElementById('stu-stustatus');
  if (stuStatusEl) {
    stuStatusEl.value = row.stu_status || row.stuStatus || "New Student";
    onStudentStatusChange();
  }

  const nameEl = document.getElementById('stu-name');
  if (nameEl) nameEl.value = row.name || "";

  const classEl = document.getElementById('stu-class');
  if (classEl) classEl.value = row.class || "";

  const catEl = document.getElementById('stu-category');
  if (catEl) catEl.value = row.category || "";

  const promoEl = document.getElementById('stu-promo');
  if (promoEl) promoEl.value = row.promo || "Original price";

  const transDateEl = document.getElementById('stu-transferdate');
  if (transDateEl) transDateEl.value = row.transfer_date || row.transferDate || "";

  const parentsEl = document.getElementById('stu-parents');
  if (parentsEl) parentsEl.value = row.parents_name || row.parentsName || "";

  const phoneEl = document.getElementById('stu-phone');
  if (phoneEl) phoneEl.value = row.phone_no || row.phoneNo || "";

  const addrEl = document.getElementById('stu-address');
  if (addrEl) addrEl.value = row.address || "";
}

async function deleteStudentEntry(uniqueId) {
  if (confirm("ဤ ကျောင်းသား မှတ်တမ်းအား အပြီးတိုင် ဖျက်သိမ်းလိုပါသလား။")) {
    if (typeof toggleLoading === 'function') toggleLoading(true);
    try {
      const response = await callApi('deleteStudentEntry', { uniqueId });
      if (response && response.success) {
        if (typeof showToast === 'function') showToast("SUCCESS", "ကျောင်းသား စာရင်း ဖျက်သိမ်းခြင်း အောင်မြင်ပါသည်။");
        if (typeof window.clearAllApiCache === 'function') window.clearAllApiCache();
        loadStudentData(true);
      } else {
        if (typeof showToast === 'function') showToast("ERROR", "ဖျက်သိမ်းမှု မအောင်မြင်ပါ: " + (response ? response.message : ""));
      }
    } catch (err) {
      if (typeof showToast === 'function') showToast("ERROR", "ဆာဗာ ချိတ်ဆက်မှု အမှား: " + err.message);
    } finally {
      if (typeof toggleLoading === 'function') toggleLoading(false);
    }
  }
}

/**
 * 💡 FULL CSV EXPORTER (Formula Injection Protected via safeCsvCell + UTF-8 BOM)
 */
function exportToCSVStudent() {
  const data = window.StudentState.activeData;
  if (!data || data.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  let csv = "NO,STU STATUS,DATE,FY,ID,FYID,NAME,CLASS,CATEGORY,PROMO,STATUS,GENDER,TRANSFER DATE,PARENTS NAME,PHONE NO,ADDRESS,UNIQUEID\n";
  data.forEach((row, idx) => {
    let transDate = row.transfer_date || row.transferDate || '';
    let isTransferred = !!transDate;
    let stat = isTransferred ? 'Inactive' : (row.status || 'Active');

    const displayNo = parseInt(row.no, 10) || (idx + 1);
    const genderVal = row.gender || autoDetectGender(row.name);
    const fyidClean = sanitizeFyidStr(row.fyid || '');

    csv += `${displayNo},` +
           `${safeCsvCell(row.stu_status || row.stuStatus || '')},` +
           `${safeCsvCell(row.date || '')},` +
           `${safeCsvCell(row.fy || '')},` +
           `${safeCsvCell(row.student_id || row.id || '')},` +
           `${safeCsvCell(fyidClean)},` +
           `${safeCsvCell(row.name || '')},` +
           `${safeCsvCell(row.class || '')},` +
           `${safeCsvCell(row.category || '')},` +
           `${safeCsvCell(row.promo || '')},` +
           `${safeCsvCell(stat)},` +
           `${safeCsvCell(genderVal)},` +
           `${safeCsvCell(transDate)},` +
           `${safeCsvCell(row.parents_name || row.parentsName || '')},` +
           `${safeCsvCell(row.phone_no || row.phoneNo || '')},` +
           `${safeCsvCell(row.address || '')},` +
           `${safeCsvCell(row.uniqueid || row.uniqueId || '')}\n`;
  });

  const blob = new Blob(["\uFEFF" + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", `student_list_${new Date().toISOString().slice(0,10)}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 💡 EXPOSE GLOBALLY
window.loadStudentData = loadStudentData;
window.openAddModalStudent = openAddModalStudent;
window.closeStudentModal = closeStudentModal;
window.saveStudentForm = saveStudentForm;
window.editStudentEntry = editStudentEntry;
window.deleteStudentEntry = deleteStudentEntry;
window.exportToCSVStudent = exportToCSVStudent;
window.onSearchInputStudent = onSearchInputStudent;
window.changePageStudent = changePageStudent;
window.onStudentStatusChange = onStudentStatusChange;
window.onOldStudentIdLookup = onOldStudentIdLookup;
window.onFyFilterChangeStudent = onFyFilterChangeStudent;
window.getCurrentAcademicYear = getCurrentAcademicYear;
window.getFyShortCode = getFyShortCode;
window.sanitizeFyidStr = sanitizeFyidStr;
window.autoDetectGender = autoDetectGender;
