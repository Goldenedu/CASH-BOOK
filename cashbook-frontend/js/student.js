/**
 * GOLDEN ERP SYSTEM - STUDENT LIST & DEMOGRAPHICS MODULE (D1 DATABASE COMPATIBLE)
 * File: js/student.js 
 * 💡 Features: All-FY Table List Rendering, Active FY KPI Cards Analytics, FYID Sanitizer (2627-STU-0002), Integer NO, Gender Auto-Detect & Old Student Lookup
 */

window.StudentState = {
  page: 1,
  limit: 30,
  totalRows: 0,
  activeData: [],
  searchVal: '',
  fyFilter: '', // Default "" = All FY for Table List
  stats: { totalActive: 0, totalInactive: 0, total: 0 }
};

var searchTimeoutStudent = null;
var lookupTimeoutStudent = null;
var isStudentSubmitting = false; // 💡 Double Submit Protection Flag

/**
 * 💡 Class Promotion Mapping Engine
 */
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
 * 💡 Safe Native DOM HTML Escaper
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
 * 💡 Gender Auto-Detection by Myanmar Name Prefix
 */
function autoDetectGender(nameStr) {
  if (!nameStr) return 'Male';
  const clean = String(nameStr).trim();

  if (clean.startsWith('မောင်') || clean.startsWith('ကို') || clean.startsWith('ဦး') ||
      /^(Mg|Ko|U)\b/i.test(clean) || /^(မောင်|ကို|ဦး)/.test(clean)) {
    return 'Male';
  }

  if (clean.startsWith('မေ') || clean.startsWith('ဒေါ်') || clean.startsWith('Daw') || clean.startsWith('May') ||
      /^(May|Daw)\b/i.test(clean)) {
    return 'Female';
  }

  if ((clean.startsWith('မ') && !clean.startsWith('မောင်')) || /^(Ma)\b/i.test(clean)) {
    return 'Female';
  }

  return 'Male';
}

function getFyShortCode(fyStr) {
  if (!fyStr) return '2627';
  const parts = String(fyStr).split(/[-/]/);
  if (parts.length >= 2) {
    const y1 = parts[0].trim().slice(-2);
    const y2 = parts[1].trim().slice(-2);
    return `${y1}${y2}`;
  }
  return '2627';
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

      return nameMatch || fyidMatch || idMatch;
    });
  }

  return filtered;
}

async function loadStudentData(isSilent = false) {
  if (!isSilent && typeof toggleLoading === 'function') toggleLoading(true);

  const state = window.StudentState;

  try {
    const response = await callApi('getStudentData', {
      page: state.page,
      limit: state.limit,
      searchVal: state.searchVal
    }, 'GET');

    if (response && response.data) {
      state.activeData = response.data;
      state.totalRows = response.totalRows || response.data.length || 0;

      populateMainFYFilterStudent();
      updateStatsStudent();
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
  fySet.add('2026-2027');

  rawData.forEach(r => {
    if (r.fy) fySet.add(r.fy.trim());
  });

  const currentSelected = select.value !== undefined ? select.value : (window.StudentState.fyFilter || '');
  let html = '<option value="" selected>-- All FY --</option>';
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
    updateStatsStudent();
    renderStudentTable();
  }
}

function updateStatsStudent() {
  const rawData = window.StudentState.activeData || [];
  const selectedFy = document.getElementById('student-filter-fy')?.value;
  const targetFyForKpi = selectedFy || '2026-2027';

  let fyList = rawData;
  if (targetFyForKpi && targetFyForKpi.trim()) {
    fyList = rawData.filter(r => String(r.fy || '').trim().toLowerCase() === targetFyForKpi.trim().toLowerCase());
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

  const rawData = window.StudentState.activeData || [];
  const searchInput = document.getElementById('student-search');
  const searchVal = searchInput ? searchInput.value.trim() : (window.StudentState.searchVal || '');
  const fyFilter = document.getElementById('student-filter-fy')?.value || window.StudentState.fyFilter || '';

  const filteredData = filterStudentData(rawData, searchVal, fyFilter);

  updatePaginationStudent(filteredData.length);

  if (!filteredData || filteredData.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="16" class="text-center py-8 text-slate-500 font-bold">ရှာဖွေမှုနှင့် ကိုက်ညီသော ကျောင်းသား စာရင်း မရှိပါ။</td></tr>`;
    return;
  }

  const isViewer = (window.AppState ? window.AppState.currentUserRole : '') === "Viewer";

  tableBody.innerHTML = filteredData.map((row, idx) => {
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

    // 💡 FYID Display Sanitizer
    let displayFyid = row.fyid || '-';
    if (displayFyid.includes('.0')) {
      displayFyid = displayFyid.replace(/\.0/g, '');
      const parts = displayFyid.split('-STU-');
      if (parts.length === 2) {
        const numPart = parseInt(parts[1], 10) || 1;
        displayFyid = `${parts[0]}-STU-${String(numPart).padStart(4, '0')}`;
      }
    }

    const rawNo = row.no !== undefined && row.no !== null && row.no !== "" ? row.no : (idx + 1);
    const displayNo = parseInt(rawNo, 10) || (idx + 1);

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
            <button onclick="editStudentEntry('${uniqueIdVal}')" class="text-indigo-400 hover:text-indigo-300 transition" title="Edit Profile">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button onclick="deleteStudentEntry('${uniqueIdVal}')" class="text-rose-400 hover:text-rose-300 transition" title="Delete Profile">
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
}

function changePageStudent(dir) {
  const state = window.StudentState;
  if (dir === -1 && state.page > 1) {
    state.page--;
    loadStudentData(false);
  } else if (dir === 1 && (state.page * state.limit) < state.totalRows) {
    state.page++;
    loadStudentData(false);
  }
}

function onSearchInputStudent() {
  clearTimeout(searchTimeoutStudent);
  searchTimeoutStudent = setTimeout(() => {
    const searchInput = document.getElementById('student-search');
    window.StudentState.searchVal = searchInput ? searchInput.value.trim() : '';
    renderStudentTable();
  }, 200);
}

function populateDynamicFYDropdownStudent(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  let currentStartYear = (month < 4) ? year - 1 : year;

  const currentFY = `${currentStartYear}-${currentStartYear + 1}`;
  const prevFY = `${currentStartYear - 1}-${currentStartYear}`;
  const nextFY = `${currentStartYear + 1}-${currentStartYear + 2}`;

  select.innerHTML = `
    <option value="${prevFY}">${prevFY}</option>
    <option value="${currentFY}" selected>${currentFY}</option>
    <option value="${nextFY}">${nextFY}</option>
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

/**
 * 💡 Save / Update Student Form with Double Submit Lock
 */
async function saveStudentForm(e) {
  if (e && e.preventDefault) e.preventDefault();

  if (isStudentSubmitting) return;
  isStudentSubmitting = true;

  const uniqueId = document.getElementById('stu-uniqueId')?.value || '';
  const isAdd = (!uniqueId);

  const transferDateVal = document.getElementById('stu-transferdate')?.value || "";
  const calculatedStatus = transferDateVal ? "Inactive" : "Active";

  const fyVal = document.getElementById('stu-fy')?.value || "2026-2027";
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
    createdBy: (window.AppState ? window.AppState.currentUser : '') || "System"
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
      if (typeof clearAllApiCache === 'function') clearAllApiCache();
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
        if (typeof clearAllApiCache === 'function') clearAllApiCache();
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

function exportToCSVStudent() {
  const data = window.StudentState.activeData;
  if (!data || data.length === 0) {
    if (typeof showToast === 'function') showToast("ERROR", "ထုတ်ယူရန် မည်သည့် စာရင်းမျှ မရှိပါ။");
    return;
  }

  let csv = "NO,STU STATUS,DATE,FY,ID,FYID,NAME,CLASS,CATEGORY,PROMO,STATUS,GENDER,TRANSFER DATE,PARENTS NAME,PHONE NO,ADDRESS,UNIQUEID\n";
  data.forEach((row, idx) => {
    let name = `"${(row.name || '').replace(/"/g, '""')}"`;
    let parents = `"${(row.parents_name || row.parentsName || '').replace(/"/g, '""')}"`;
    let addr = `"${(row.address || '').replace(/"/g, '""')}"`;
    let cls = `"${(row.class || '').replace(/"/g, '""')}"`;
    let cat = `"${(row.category || '').replace(/"/g, '""')}"`;
    let transDate = row.transfer_date || row.transferDate || '';
    let isTransformed = !!transDate;
    let stat = isTransformed ? 'Inactive' : (row.status || 'Active');

    const rawNo = row.no !== undefined && row.no !== null && row.no !== "" ? row.no : (idx + 1);
    const displayNo = parseInt(rawNo, 10) || (idx + 1);
    const genderVal = row.gender || autoDetectGender(row.name);

    csv += `${displayNo},${row.stu_status || row.stuStatus || ''},${row.date || ''},${row.fy || ''},${row.student_id || row.id || ''},${row.fyid || ''},${name},${cls},${cat},${row.promo || ''},${stat},${genderVal},${transDate},${parents},${row.phone_no || row.phoneNo || ''},${addr},${row.uniqueid || row.uniqueId || ''}\n`;
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
