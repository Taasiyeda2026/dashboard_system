import { state } from './state.js';
import { api } from './api.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { normalizeGlobalActivityPeriod } from './screens/shared/summer-activity.js';
import { escapeHtml } from './screens/shared/html.js';
import { attendanceMonthDateRange } from './screens/attendance-control.js';

const MANAGER_WORKSPACE_TAB_KEY = 'manager_board_workspace_tab';
const TEAM_ROSTER_TTL_MS = 90 * 1000;
const ATTENDANCE_SUMMARY_TTL_MS = 60 * 1000;
const SYNTHETIC_TEAM_ID = '__manager_workspace__';
const SYNTHETIC_MANAGER_ID = '__manager_workspace_user__';
const SHAREPOINT_EMPLOYEE_FILES_ROOT_2027 = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/%D7%AA%D7%99%D7%A7%D7%99%D7%9D%20%D7%90%D7%99%D7%A9%D7%99%D7%99%D7%9D';
const HEBREW_MONTHS = new Map([
  ['ינואר', '01'], ['פברואר', '02'], ['מרץ', '03'], ['אפריל', '04'], ['מאי', '05'], ['יוני', '06'],
  ['יולי', '07'], ['אוגוסט', '08'], ['ספטמבר', '09'], ['אוקטובר', '10'], ['נובמבר', '11'], ['דצמבר', '12']
]);
const FOLLOWUP_FIELDS = [
  ['contract_confirmed', 'הסכם חתום'],
  ['police_clearance_file_completed', 'אישור משטרה'],
  ['intro_feedback_completed', 'משוב היכרות'],
  ['mid_feedback_completed', 'משוב אמצע'],
  ['end_feedback_completed', 'משוב סוף'],
  ['observation1_completed', 'תצפית 1'],
  ['observation2_completed', 'תצפית 2']
];

let activeTab = restoreTab();
let observer = null;
let observerTimer = null;
let currentRenderToken = 0;
let lastContextSignature = '';
let embeddedAttendanceSignature = '';
let resetMonthOnNextBoard = true;
let attendanceYm = '';
const rosterCache = new Map();
const attendanceSummaryCache = new Map();

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function currentMonthKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftAttendanceMonth(ym, delta) {
  const match = text(ym).match(/^(20\d{2})-(\d{2})$/);
  if (!match) return currentMonthKey();
  const date = new Date(Number(match[1]), Number(match[2]) - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function attendanceMonthLabel(ym) {
  const match = text(ym).match(/^(20\d{2})-(\d{2})$/);
  if (!match) return ym;
  return new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' }).format(new Date(Number(match[1]), Number(match[2]) - 1, 1));
}

function attendanceMonthMode(ym) {
  const current = currentMonthKey();
  if (ym === current) return { key: 'current', label: 'בקרה שוטפת' };
  if (ym < current) return { key: 'closed', label: 'בקרה ואישור' };
  return { key: 'future', label: 'חודש עתידי' };
}

function attendanceMinMonth(period = periodKey()) {
  const periodMin = period === 'school_2027' ? '2026-09' : '2025-09';
  const current = currentMonthKey();
  return current < periodMin ? current : periodMin;
}

function role() {
  return text(state?.user?.role);
}

function canUseWorkspace() {
  return role() === 'admin';
}

function canUsePayrollAttendanceAdminTab() {
  return role() === 'admin';
}

function workspaceTabs() {
  // Tab id `payroll-attendance` is kept for backward compatibility (localStorage).
  // The UI label is "בקרת נוכחות אדמין".
  return canUsePayrollAttendanceAdminTab()
    ? ['management', 'attendance', 'tracking', 'payroll-attendance']
    : ['management', 'attendance', 'tracking'];
}

function restoreTab() {
  try {
    const stored = localStorage.getItem(MANAGER_WORKSPACE_TAB_KEY);
    return workspaceTabs().includes(stored) ? stored : 'management';
  } catch {
    return 'management';
  }
}

function setActiveTab(tab) {
  activeTab = workspaceTabs().includes(tab) ? tab : 'management';
  try { localStorage.setItem(MANAGER_WORKSPACE_TAB_KEY, activeTab); } catch { /* ignore */ }
}

function periodKey() {
  return normalizeGlobalActivityPeriod(state?.activityPeriodTab);
}

function schoolYearForPeriod(period = periodKey()) {
  return period === 'school_2027' ? '2027' : '2026';
}

function currentManagerName(boardRoot) {
  const select = boardRoot?.querySelector('[data-manager-board-manager]');
  if (select?.value) return text(select.value);
  const fixed = boardRoot?.querySelector('.manager-board-manager-fixed strong');
  if (fixed?.textContent) return text(fixed.textContent);
  const user = state?.user || {};
  return text(user.full_name || user.name || user.username || '');
}

function parseMonthLabel(label) {
  const value = text(label);
  const match = value.match(/^([^\d]+?)\s+(20\d{2})$/);
  if (!match) return '';
  const month = HEBREW_MONTHS.get(text(match[1]));
  return month ? `${match[2]}-${month}` : '';
}

function defaultMonth(period = periodKey()) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const minYm = period === 'school_2027' ? '2026-09' : '2025-09';
  const maxYm = period === 'school_2027' ? '2027-08' : '2026-08';
  if (ym < minYm) return minYm;
  if (ym > maxYm) return maxYm;
  return ym;
}

function currentMonth(boardRoot, period = periodKey()) {
  const label = boardRoot?.querySelector('.manager-board-month-nav strong')?.textContent;
  return parseMonthLabel(label) || defaultMonth(period);
}

function contextFromBoard(boardRoot) {
  const period = periodKey();
  const manager = currentManagerName(boardRoot);
  const ym = activeTab === 'attendance' ? (attendanceYm || currentMonthKey()) : currentMonth(boardRoot, period);
  const schoolYear = schoolYearForPeriod(period);
  return { period, manager, ym, schoolYear };
}

function validBoardRoot() {
  const root = document.querySelector('.manager-board-screen[data-manager-board-root]');
  if (!root || !canUseWorkspace()) return null;
  return root;
}

function resetBoardMonthIfNeeded(boardRoot) {
  if (activeTab === 'attendance') {
    resetMonthOnNextBoard = false;
    return false;
  }
  if (!resetMonthOnNextBoard) return false;
  const period = periodKey();
  const shown = currentMonth(boardRoot, period);
  const target = defaultMonth(period);
  if (!shown || shown === target) {
    resetMonthOnNextBoard = false;
    return false;
  }
  const direction = shown < target ? '1' : '-1';
  const button = boardRoot.querySelector(`[data-manager-board-month="${direction}"]`);
  if (!button || button.disabled) {
    resetMonthOnNextBoard = false;
    return false;
  }
  button.click();
  return true;
}

async function ensureAuthSession() {
  await waitForSupabaseAuthSession({ timeoutMs: 7000 }).catch(() => null);
}

async function loadRoster(manager, schoolYear, force = false) {
  if (!supabase) throw new Error('חיבור הנתונים אינו זמין.');
  const key = `${manager}|${schoolYear}`;
  const cached = rosterCache.get(key);
  if (!force && cached && Date.now() - cached.loadedAt < TEAM_ROSTER_TTL_MS) return cached.rows;
  await ensureAuthSession();
  const { data, error } = await supabase.rpc('get_manager_team_roster', {
    p_manager_name: manager,
    p_school_year: schoolYear
  });
  if (error) throw new Error(error.message || 'טעינת צוות המנהל נכשלה.');
  const rows = Array.isArray(data) ? data : [];
  rosterCache.set(key, { rows, loadedAt: Date.now() });
  return rows;
}

async function distinctDirectManagerNames() {
  await ensureAuthSession();
  const { data, error } = await supabase
    .from('contacts_instructors')
    .select('direct_manager,active');
  if (error) throw new Error(error.message || 'טעינת רשימת המנהלים נכשלה.');
  const names = new Set();
  for (const row of Array.isArray(data) ? data : []) {
    const active = text(row?.active).toLowerCase();
    if (['no', 'false', '0', 'לא'].includes(active)) continue;
    const name = text(row?.direct_manager);
    if (name) names.add(name);
  }
  return [...names];
}

async function loadAllTeamRosters(schoolYear, force = false) {
  const managers = await distinctDirectManagerNames();
  const lists = await Promise.all(managers.map((name) => loadRoster(name, schoolYear, force).catch(() => [])));
  const byId = new Map();
  for (const rows of lists) {
    for (const row of rows) {
      const id = text(row.emp_id);
      if (id && !byId.has(id)) byId.set(id, row);
    }
  }
  return [...byId.values()].sort((a, b) => {
    const managerCmp = text(a.direct_manager).localeCompare(text(b.direct_manager), 'he');
    if (managerCmp) return managerCmp;
    return text(a.full_name).localeCompare(text(b.full_name), 'he') || String(a.emp_id).localeCompare(String(b.emp_id));
  });
}

function rawEmployeeId(row) {
  return text(row?.employeeId || row?.EmployeeId || row?.empNum || row?.emp_id || row?.ID || row?.id);
}

function rawRecordMonth(row) {
  const raw = row?.attendanceDate || row?.AttendanceDate || row?.date;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, '0')}`;
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const parsed = (globalThis.XLSX?.SSF || null)?.parse_date_code?.(raw);
    if (parsed?.y && parsed?.m) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}`;
    const date = new Date((raw - (raw >= 61 ? 25569 : 25568)) * 86400000);
    if (!Number.isNaN(date.getTime())) return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }
  const value = text(raw);
  const iso = value.match(/^(20\d{2})-(\d{2})-/);
  if (iso) return `${iso[1]}-${iso[2]}`;
  const dmy = value.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})$/);
  if (dmy) return `${dmy[3]}-${String(dmy[2]).padStart(2, '0')}`;
  return '';
}

async function loadAttendanceSummary(roster, ym, force = false) {
  const ids = roster.map((row) => text(row.emp_id)).filter(Boolean).sort();
  const key = `${ym}|${ids.join(',')}`;
  const cached = attendanceSummaryCache.get(key);
  if (!force && cached && Date.now() - cached.loadedAt < ATTENDANCE_SUMMARY_TTL_MS) return cached.value;

  const recordCounts = new Map(ids.map((id) => [id, 0]));
  let recordsError = '';
  const { fromDate, toDate } = attendanceMonthDateRange(ym);
  try {
    const records = ids.length
      ? await api.attendanceControlRecords({ employeeIds: ids, fromDate, toDate })
      : [];
    for (const row of Array.isArray(records) ? records : []) {
      const empId = rawEmployeeId(row);
      if (!recordCounts.has(empId) || rawRecordMonth(row) !== ym) continue;
      recordCounts.set(empId, (recordCounts.get(empId) || 0) + 1);
    }
  } catch (error) {
    recordsError = error?.message || 'טעינת דיווחי הנוכחות נכשלה.';
  }

  const approvals = new Map();
  let approvalsError = '';
  try {
    if (typeof api.listPayrollControlApprovals === 'function') {
      const rows = await api.listPayrollControlApprovals({ monthKey: ym });
      for (const row of Array.isArray(rows) ? rows : []) {
        const empId = text(row?.employee_id || row?.employeeId);
        if (recordCounts.has(empId)) approvals.set(empId, row);
      }
    }
  } catch (error) {
    approvalsError = error?.message || 'טעינת אישורי הבקרה נכשלה.';
  }

  const value = { recordCounts, approvals, recordsError, approvalsError };
  attendanceSummaryCache.set(key, { value, loadedAt: Date.now() });
  return value;
}

function syncAttendanceMonthNav(boardRoot) {
  if (!boardRoot || activeTab !== 'attendance') return;
  const nav = boardRoot.querySelector('.manager-board-month-nav');
  const label = nav?.querySelector('strong');
  const previous = nav?.querySelector('[data-manager-board-month="-1"]');
  const next = nav?.querySelector('[data-manager-board-month="1"]');
  if (!nav || !label || !previous || !next) return;
  if (nav.dataset.attendanceMonthPatched !== 'true') {
    nav.dataset.attendanceMonthPatched = 'true';
    nav.dataset.attendanceOriginalLabel = label.textContent || '';
    nav.dataset.attendanceOriginalPreviousDisabled = previous.disabled ? 'true' : 'false';
    nav.dataset.attendanceOriginalNextDisabled = next.disabled ? 'true' : 'false';
  }
  if (!attendanceYm) attendanceYm = currentMonthKey();
  label.textContent = attendanceMonthLabel(attendanceYm);
  previous.disabled = shiftAttendanceMonth(attendanceYm, -1) < attendanceMinMonth();
  next.disabled = shiftAttendanceMonth(attendanceYm, 1) > currentMonthKey();
}

function restoreAttendanceMonthNav(boardRoot) {
  const nav = boardRoot?.querySelector('.manager-board-month-nav');
  if (!nav || nav.dataset.attendanceMonthPatched !== 'true') return;
  const label = nav.querySelector('strong');
  const previous = nav.querySelector('[data-manager-board-month="-1"]');
  const next = nav.querySelector('[data-manager-board-month="1"]');
  if (label) label.textContent = nav.dataset.attendanceOriginalLabel || label.textContent;
  if (previous) previous.disabled = nav.dataset.attendanceOriginalPreviousDisabled === 'true';
  if (next) next.disabled = nav.dataset.attendanceOriginalNextDisabled === 'true';
  delete nav.dataset.attendanceMonthPatched;
  delete nav.dataset.attendanceOriginalLabel;
  delete nav.dataset.attendanceOriginalPreviousDisabled;
  delete nav.dataset.attendanceOriginalNextDisabled;
}

function applyTabVisibility(boardRoot) {
  const isManagement = activeTab === 'management';
  boardRoot.classList.toggle('is-manager-workspace-subtab', !isManagement);
  const alerts = boardRoot.querySelector('[data-manager-workspace-management-alerts]');
  const view = boardRoot.querySelector('[data-manager-workspace-view]');
  if (alerts) alerts.hidden = !isManagement;
  if (view) view.hidden = isManagement;
  boardRoot.querySelectorAll('[data-manager-workspace-tab]').forEach((button) => {
    const selected = button.dataset.managerWorkspaceTab === activeTab;
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
}

function handleWorkspaceClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;

  if (activeTab === 'attendance') {
    const monthButton = target.closest('[data-manager-board-month]');
    const monthBoardRoot = monthButton?.closest('[data-manager-board-root]');
    if (monthButton && monthBoardRoot) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const delta = Number(monthButton.dataset.managerBoardMonth || 0);
      if (!delta) return;
      const nextMonth = shiftAttendanceMonth(attendanceYm || currentMonthKey(), delta);
      if (nextMonth < attendanceMinMonth() || nextMonth > currentMonthKey()) return;
      attendanceYm = nextMonth;
      syncAttendanceMonthNav(monthBoardRoot);
      embeddedAttendanceSignature = '';
      lastContextSignature = '';
      void renderWorkspace(true);
      return;
    }
  }

  if (target.closest('[data-manager-board-open]')) {
    resetMonthOnNextBoard = true;
    return;
  }

  const button = target.closest('[data-manager-workspace-tab]');
  if (!button || !canUseWorkspace()) return;
  const boardRoot = button.closest('[data-manager-board-root]');
  if (!boardRoot) return;
  const next = button.dataset.managerWorkspaceTab;
  if (!workspaceTabs().includes(next)) return;

  event.preventDefault();
  if (activeTab === 'attendance' && next !== 'attendance') restoreAttendanceMonthNav(boardRoot);
  setActiveTab(next);
  if (next === 'attendance') {
    attendanceYm = currentMonthKey();
    syncAttendanceMonthNav(boardRoot);
  }
  embeddedAttendanceSignature = '';
  lastContextSignature = '';
  applyTabVisibility(boardRoot);
  void renderWorkspace(true);
}

function managementAlertsHtml(roster, summary) {
  const reportMissing = roster.filter((row) => (summary.recordCounts.get(text(row.emp_id)) || 0) === 0).length;
  const awaitingApproval = roster.filter((row) => {
    const empId = text(row.emp_id);
    return (summary.recordCounts.get(empId) || 0) > 0 && !summary.approvals.has(empId);
  }).length;
  const approved = roster.filter((row) => summary.approvals.has(text(row.emp_id))).length;
  const error = summary.recordsError || summary.approvalsError;
  return `<div class="manager-workspace-alert-strip" dir="rtl">
    <div class="manager-workspace-alert-strip__title"><strong>דיווחים חשובים</strong><span>לפי צוות המנהל והחודש הנבחר</span></div>
    <article><span>צוות פעיל</span><strong>${roster.length}</strong></article>
    <article class="${reportMissing ? 'is-warning' : ''}"><span>ללא דיווח נוכחות</span><strong>${reportMissing}</strong></article>
    <article class="${awaitingApproval ? 'is-warning' : ''}"><span>טרם אושר</span><strong>${awaitingApproval}</strong></article>
    <article class="is-ok"><span>אושרו</span><strong>${approved}</strong></article>
    ${error ? `<p class="manager-workspace-inline-error">${escapeHtml(error)}</p>` : ''}
  </div>`;
}

function attendanceStatusBadge(count, approval, ym) {
  if (!count) return '<span class="manager-workspace-status is-muted">אין דיווח</span>';
  if (approval) return '<span class="manager-workspace-status is-ok">✓ אושר</span>';
  if (attendanceMonthMode(ym).key === 'current') return '<span class="manager-workspace-status is-pending">בקרה שוטפת</span>';
  return '<span class="manager-workspace-status is-pending">בתהליך</span>';
}

function attendanceSummaryTableHtml(roster, summary, ym) {
  if (!roster.length) return '<div class="manager-workspace-empty">אין מדריכים פעילים המשויכים למנהל.</div>';
  const rows = roster.map((row) => {
    const empId = text(row.emp_id);
    const count = summary.recordCounts.get(empId) || 0;
    const approval = summary.approvals.get(empId);
    const approvedAt = approval?.approved_at ? new Date(approval.approved_at).toLocaleDateString('he-IL') : '';
    return `<tr>
      <td><strong>${escapeHtml(text(row.full_name) || empId)}</strong><small>${escapeHtml(empId)}</small></td>
      <td>${count ? `<span class="manager-workspace-report-count">קיים · ${count} רשומות</span>` : '<span class="manager-workspace-report-count is-missing">לא נמצא דיווח</span>'}</td>
      <td>${attendanceStatusBadge(count, approval, ym)}${approvedAt ? `<small>${escapeHtml(approvedAt)}</small>` : ''}</td>
      <td><button type="button" class="manager-workspace-link-button" data-manager-attendance-open-employee="${escapeHtml(empId)}"${count ? '' : ' disabled'}>צפייה ובקרת דוח</button></td>
    </tr>`;
  }).join('');
  return `<div class="manager-workspace-table-wrap"><table class="manager-workspace-table manager-workspace-attendance-table">
    <thead><tr><th>מדריך</th><th>דיווח ${escapeHtml(ym)}</th><th>סטטוס אישור</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

/** Gender is canonical in instructor_scheduling_profiles.gender ('female'/'male'), passed through get_manager_team_roster. */
function isFemaleInstructor(row) {
  return text(row?.gender).toLowerCase() === 'female';
}

/** Read-only followup cell: ✓ when done, otherwise empty — police clearance is blocked (no mark, no text) for FEMALE. */
function followupCellHtml(row, field) {
  if (field === 'police_clearance_file_completed' && isFemaleInstructor(row)) {
    return '<td class="manager-workspace-followup-cell manager-workspace-followup-cell--blocked" aria-label="לא רלוונטי"></td>';
  }
  return `<td class="manager-workspace-followup-cell${row[field] ? ' is-done' : ''}">${row[field] ? '<span aria-hidden="true">✓</span>' : ''}</td>`;
}

function trackingTableHtml(roster, schoolYear) {
  if (!roster.length) return '<div class="manager-workspace-empty">אין מדריכים פעילים המשויכים למנהל.</div>';
  const rows = roster.map((row) => {
    const empId = text(row.emp_id);
    const cells = FOLLOWUP_FIELDS.map(([field]) => followupCellHtml(row, field)).join('');
    const folder = text(row.folder_web_url);
    return `<tr>
      <td class="manager-workspace-person"><strong>${escapeHtml(text(row.full_name) || empId)}</strong><small>${escapeHtml(text(row.employment_type))}</small></td>
      ${cells}
      <td data-label="תיק עובד">${folder ? `<a class="manager-workspace-folder-link" href="${escapeHtml(folder)}" target="_blank" rel="noopener">פתח תיק</a>` : '<span class="manager-workspace-status is-muted">טרם קושר</span>'}</td>
    </tr>`;
  }).join('');
  return `<div class="manager-workspace-table-wrap"><table class="manager-workspace-table manager-workspace-tracking-table">
    <thead><tr><th>מדריך</th>${FOLLOWUP_FIELDS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}<th>תיק עובד</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div><p class="manager-workspace-source-note">תצוגה לקריאה בלבד ממאגר המדריכים המרכזי לשנת ${escapeHtml(schoolYear)}. עדכון הנתונים מתבצע בלשונית מדריכים.</p>`;
}

function sharePointRootButton(schoolYear) {
  if (schoolYear !== '2027') return '';
  return `<a class="manager-workspace-sharepoint-root" href="${SHAREPOINT_EMPLOYEE_FILES_ROOT_2027}" target="_blank" rel="noopener">פתיחת תיקי עובדים ב־SharePoint</a>`;
}

function buildScopedAttendanceApi(roster) {
  const rosterIds = new Set(roster.map((row) => text(row.emp_id)).filter(Boolean));
  const syntheticEmployees = roster.map((row) => ({
    employeeId: text(row.emp_id),
    EmployeeId: text(row.emp_id),
    empNum: text(row.emp_id),
    employeeName: text(row.full_name),
    EmployeeName: text(row.full_name),
    employmentType: text(row.employment_type),
    EmploymentType: text(row.employment_type),
    team: SYNTHETIC_TEAM_ID,
    Team: SYNTHETIC_TEAM_ID,
    role: 'instructor',
    Role: 'instructor'
  }));
  syntheticEmployees.unshift({
    employeeId: SYNTHETIC_MANAGER_ID,
    EmployeeId: SYNTHETIC_MANAGER_ID,
    employeeName: 'צוות המנהל',
    EmployeeName: 'צוות המנהל',
    team: SYNTHETIC_TEAM_ID,
    Team: SYNTHETIC_TEAM_ID,
    role: 'manager',
    Role: 'manager'
  });

  return new Proxy(api, {
    get(target, prop) {
      if (prop === 'attendanceControlTeams') return async () => syntheticEmployees;
      if (prop === 'attendanceControlRecords') {
        return async (opts = {}) => {
          const employeeIds = [...rosterIds];
          if (!employeeIds.length) return [];
          const records = await target.attendanceControlRecords({
            ...opts,
            employeeIds
          });
          return (Array.isArray(records) ? records : [])
            .filter((row) => rosterIds.has(rawEmployeeId(row)))
            .map((row) => ({ ...row, team: SYNTHETIC_TEAM_ID, Team: SYNTHETIC_TEAM_ID }));
        };
      }
      const value = target[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
}

function scopedAttendanceState() {
  return {
    ...state,
    user: {
      ...(state?.user || {}),
      role: 'manager',
      emp_id: SYNTHETIC_MANAGER_ID,
      employee_id: SYNTHETIC_MANAGER_ID,
      user_id: SYNTHETIC_MANAGER_ID
    }
  };
}

async function waitForEnabledButton(button, timeoutMs = 10000) {
  const started = Date.now();
  while (button?.disabled && Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return Boolean(button && !button.disabled);
}

async function openEmployeeAttendance(empId) {
  const host = document.querySelector('[data-manager-attendance-host]');
  if (!host) return;
  const panel = host.querySelector('[data-attendance-control]');
  const run = host.querySelector('[data-attendance-run]');
  const results = host.querySelector('[data-attendance-results]');
  if (!results?.querySelector('[data-payroll-employee]')) {
    if (await waitForEnabledButton(run)) run.click();
  }
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const detail = host.querySelector(`[data-payroll-employee="${CSS.escape(String(empId))}"]`);
    if (detail) {
      host.querySelectorAll('[data-payroll-employee]').forEach((item) => {
        item.hidden = item !== detail;
        if (item !== detail) item.open = false;
      });
      host.hidden = false;
      if (panel) panel.hidden = false;
      detail.hidden = false;
      detail.open = true;
      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
}

async function bindEmbeddedAttendance(host, roster, context) {
  if (!host) return;
  const signature = `${context.manager}|${context.ym}|${context.schoolYear}|${roster.map((row) => row.emp_id).join(',')}`;
  if (embeddedAttendanceSignature === signature && host.dataset.managerAttendanceBound === 'true') return;
  embeddedAttendanceSignature = signature;
  host.dataset.managerAttendanceBound = 'true';

  const attendance = await import('./screens/attendance-control.js');
  const monthMode = attendanceMonthMode(context.ym);
  host.dataset.managerAttendanceMonthMode = monthMode.key;
  host.innerHTML = `<style>
    [data-manager-attendance-host][data-manager-attendance-month-mode="current"] .attendance-control__employee > .attendance-control__employee-actions,
    [data-manager-attendance-host][data-manager-attendance-month-mode="future"] .attendance-control__employee > .attendance-control__employee-actions { display:none !important; }
  </style>${attendance.attendanceControlStylesHtml()}${attendance.attendanceControlHtml()}`;
  if (host.dataset.managerAttendanceApprovalGuard !== 'true') {
    host.dataset.managerAttendanceApprovalGuard = 'true';
    host.addEventListener('click', (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest('[data-payroll-finish]')) return;
      if (host.dataset.managerAttendanceMonthMode === 'closed') return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
  const panel = host.querySelector('[data-attendance-control]');
  if (panel) panel.hidden = false;
  attendance.bindAttendanceControl(host, {
    api: buildScopedAttendanceApi(roster),
    state: scopedAttendanceState(),
    standalone: true
  });

  const monthInput = host.querySelector('[data-attendance-month]');
  const dashboardMonthInput = host.querySelector('[data-dashboard-month]');
  if (monthInput) {
    monthInput.value = context.ym;
    monthInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (dashboardMonthInput) {
    dashboardMonthInput.value = context.ym;
    dashboardMonthInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const controls = host.querySelector('.attendance-control__uploads');
  if (controls) controls.hidden = true;
  host.hidden = true;
  host.querySelector('[data-attendance-close]')?.remove();
}


async function renderAttendance(boardRoot, context, roster, renderToken) {
  const view = boardRoot.querySelector('[data-manager-workspace-view]');
  if (!view) return;
  view.innerHTML = '<div class="manager-workspace-loading">טוען בקרת נוכחות לצוות…</div>';
  const summary = await loadAttendanceSummary(roster, context.ym);
  if (renderToken !== currentRenderToken || activeTab !== 'attendance' || !boardRoot.isConnected) return;

  view.innerHTML = `${managementAlertsHtml(roster, summary)}
    <section class="manager-workspace-panel manager-workspace-attendance" dir="rtl">
    <header class="manager-workspace-panel__head"><div><h2>בקרת נוכחות</h2><p>${escapeHtml(context.manager)} · ${escapeHtml(context.ym)} · ${escapeHtml(attendanceMonthMode(context.ym).label)}</p></div></header>
    ${attendanceSummaryTableHtml(roster, summary, context.ym)}
    ${(summary.recordsError || summary.approvalsError) ? `<p class="manager-workspace-inline-error">${escapeHtml(summary.recordsError || summary.approvalsError)}</p>` : ''}
    <div class="manager-workspace-attendance-host" data-manager-attendance-host hidden></div>
  </section>`;

  const host = view.querySelector('[data-manager-attendance-host]');
  await bindEmbeddedAttendance(host, roster, context);
  if (renderToken !== currentRenderToken || activeTab !== 'attendance') return;

  view.querySelectorAll('[data-manager-attendance-open-employee]').forEach((button) => {
    button.addEventListener('click', () => void openEmployeeAttendance(button.dataset.managerAttendanceOpenEmployee));
  });
}

function renderTracking(boardRoot, context, roster) {
  const view = boardRoot.querySelector('[data-manager-workspace-view]');
  if (!view) return;
  view.innerHTML = `<section class="manager-workspace-panel manager-workspace-tracking" dir="rtl">
    <header class="manager-workspace-panel__head"><div><h2>מעקב צוות</h2><p>${escapeHtml(context.manager)} · שנת ${escapeHtml(context.schoolYear)}</p></div>${sharePointRootButton(context.schoolYear)}</header>
    ${trackingTableHtml(roster, context.schoolYear)}
  </section>`;
}

function approvalCell(name, at, missingLabel) {
  const who = text(name);
  const when = at ? new Date(at).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' }) : '';
  if (!who && !when) return `<span class="manager-workspace-status is-muted">${escapeHtml(missingLabel)}</span>`;
  return `<div class="manager-workspace-approval-cell"><strong>${escapeHtml(who || '—')}</strong><small>${escapeHtml(when || '—')}</small></div>`;
}

async function renderPayrollAttendanceAdmin(boardRoot, context, roster, renderToken) {
  const view = boardRoot.querySelector('[data-manager-workspace-view]');
  if (!view) return;
  view.innerHTML = '<div class="manager-workspace-loading">טוען בקרת נוכחות אדמין…</div>';

  const employeeIds = roster.map((row) => text(row.emp_id)).filter(Boolean);
  const monthKey = context.ym;
  const [workflowRows, finalRows] = await Promise.all([
    api.attendanceControlMonthWorkflowStatuses({ monthKey, employeeIds }),
    api.listPayrollControlApprovals({ monthKey, employeeIds, statuses: ['approved_for_payroll'] })
  ]);
  if (renderToken !== currentRenderToken || activeTab !== 'payroll-attendance' || !boardRoot.isConnected) return;

  const workflowByEmployee = new Map((workflowRows || []).map((row) => [text(row.employee_id || row.employeeId), row]));
  const finalByEmployee = new Map((finalRows || []).map((row) => [text(row.employee_id || row.employeeId), row]));

  const rowsHtml = roster.map((row) => {
    const empId = text(row.emp_id);
    const workflowRow = workflowByEmployee.get(empId) || {};
    const workflow = {
      status: text(workflowRow.workflow_status || 'not_submitted'),
      label: text(workflowRow.workflow_status || 'not_submitted') === 'approved'
        ? 'אושר סופית'
        : text(workflowRow.workflow_status || '') === 'manager_approved'
          ? 'אושר על ידי המנהל'
          : text(workflowRow.workflow_status || '') === 'submitted'
            ? 'אושר על ידי העובד / בבקרת מנהל'
            : 'פתוח לדיווח'
    };
    const finalApproval = finalByEmployee.get(empId) || null;
    const finalApproveBtn = workflow.status === 'manager_approved' && !finalApproval
      ? `<button type="button" class="ds-btn ds-btn--sm ds-btn--primary" data-admin-payroll-final="${escapeHtml(empId)}">אישור סופי</button>`
      : '';
    const lockReleaseBtn = (workflow.status === 'submitted' || workflow.status === 'manager_approved' || workflow.status === 'approved')
      ? `<button type="button" class="ds-btn ds-btn--sm" data-admin-payroll-release="${escapeHtml(empId)}">שחרור נעילה</button>`
      : '';
    const managerPdfUrl = text(workflowRow.manager_pdf_sharepoint_url);
    const finalPdfPath = text(finalApproval?.pdf_path);
    const openPdfBtn = (managerPdfUrl || finalPdfPath)
      ? `<button type="button" class="ds-btn ds-btn--sm" data-admin-payroll-open-pdf="${escapeHtml(empId)}">צפייה ב-PDF</button>`
      : '';
    return `<tr data-admin-payroll-row="${escapeHtml(empId)}">
      <td><strong>${escapeHtml(text(row.full_name) || empId)}</strong><small>${escapeHtml(empId)}</small></td>
      <td>${escapeHtml(text(row.direct_manager) || '—')}</td>
      <td>${escapeHtml(monthKey)}</td>
      <td>${approvalCell(workflowRow.submitted_by_name, workflowRow.submitted_at, 'טרם אושר עובד')}</td>
      <td>${approvalCell(workflowRow.manager_approved_by_name, workflowRow.manager_approved_at, 'טרם אושר מנהל')}</td>
      <td>${approvalCell(finalApproval?.approved_by_name, finalApproval?.approved_at, 'טרם אושר סופית')}</td>
      <td><span class="manager-workspace-status ${workflow.status === 'approved' ? 'is-ok' : (workflow.status === 'not_submitted' ? 'is-muted' : 'is-pending')}">${escapeHtml(workflow.label)}</span></td>
      <td><div class="manager-workspace-actions">${finalApproveBtn}${openPdfBtn}${lockReleaseBtn}</div></td>
    </tr>`;
  }).join('');

  view.innerHTML = `<section class="manager-workspace-panel manager-workspace-payroll-attendance" dir="rtl">
    <header class="manager-workspace-panel__head">
      <div>
        <h2>בקרת נוכחות אדמין</h2>
        <p>${escapeHtml(context.ym)} · כלל העובדים לפי שיוך צוות למנהל</p>
      </div>
      <button type="button" class="manager-workspace-run-team" data-admin-payroll-refresh>רענון</button>
    </header>
    <p class="manager-workspace-source-note">האישור הסופי הופך את החודש ל״מוכן לביצוע שכר״. שחרור נעילה מבטל אישורים נדרשים עד לאישור מחדש.</p>
    <div class="manager-workspace-table-wrap">
      <table class="manager-workspace-table">
        <thead>
          <tr><th>עובד</th><th>מנהל</th><th>חודש</th><th>אישור עובד</th><th>אישור מנהל</th><th>אישור מנהל סופי</th><th>סטטוס</th><th>פעולות</th></tr>
        </thead>
        <tbody>${rowsHtml || '<tr><td colspan="8">לא נמצאו עובדים.</td></tr>'}</tbody>
      </table>
    </div>
    <p class="manager-workspace-inline-error" data-admin-payroll-status hidden></p>
  </section>`;

  const statusEl = view.querySelector('[data-admin-payroll-status]');
  const setStatus = (message = '', isError = false) => {
    if (!statusEl) return;
    statusEl.hidden = !message;
    statusEl.textContent = message;
    statusEl.style.color = isError ? '#b91c1c' : '#166534';
  };

  view.querySelector('[data-admin-payroll-refresh]')?.addEventListener('click', () => {
    lastContextSignature = '';
    void renderWorkspace(true);
  });

  view.querySelectorAll('[data-admin-payroll-open-pdf]').forEach((button) => {
    button.addEventListener('click', async () => {
      const empId = text(button.dataset.adminPayrollOpenPdf);
      const workflowRow = workflowByEmployee.get(empId) || {};
      const finalApproval = finalByEmployee.get(empId) || null;
      const managerPdfUrl = text(workflowRow.manager_pdf_sharepoint_url);
      if (managerPdfUrl) {
        window.open(managerPdfUrl, '_blank', 'noopener');
        return;
      }
      const finalPdfPath = text(finalApproval?.pdf_path);
      if (!finalPdfPath) return;
      if (finalPdfPath.startsWith('http://') || finalPdfPath.startsWith('https://')) {
        window.open(finalPdfPath, '_blank', 'noopener');
        return;
      }
      try {
        const signed = await api.payrollControlApprovalSignedUrl(finalPdfPath);
        if (signed?.signedUrl) window.open(signed.signedUrl, '_blank', 'noopener');
      } catch (error) {
        setStatus(error?.message || 'פתיחת PDF נכשלה.', true);
      }
    });
  });

  view.querySelectorAll('[data-admin-payroll-final]').forEach((button) => {
    button.addEventListener('click', async () => {
      const empId = text(button.dataset.adminPayrollFinal);
      if (!empId) return;
      button.disabled = true;
      try {
        setStatus('שומר אישור סופי…');
        await api.adminFinalizeAttendanceMonthPayroll({
          employee_id: empId,
          month_key: monthKey,
          final_approved_by_name: text(state?.user?.full_name || state?.user?.name || state?.user?.username)
        });
        setStatus('האישור הסופי נשמר בהצלחה.');
        lastContextSignature = '';
        await renderWorkspace(true);
      } catch (error) {
        setStatus(error?.message || 'שמירת אישור סופי נכשלה.', true);
      } finally {
        button.disabled = false;
      }
    });
  });

  view.querySelectorAll('[data-admin-payroll-release]').forEach((button) => {
    button.addEventListener('click', async () => {
      const empId = text(button.dataset.adminPayrollRelease);
      if (!empId) return;
      const reason = window.prompt('סיבת שחרור נעילה (אופציונלי):', '') || '';
      button.disabled = true;
      try {
        setStatus('משחרר נעילה…');
        await api.adminReopenAttendanceMonthForCorrection({
          employee_id: empId,
          month_key: monthKey,
          reason
        });
        setStatus('החודש שוחרר בהצלחה ונפתח לתיקון.');
        lastContextSignature = '';
        await renderWorkspace(true);
      } catch (error) {
        setStatus(error?.message || 'שחרור נעילה נכשל.', true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function renderWorkspace(force = false) {
  const boardRoot = validBoardRoot();
  if (!boardRoot) return;
  if (!boardRoot.querySelector('[data-manager-workspace-tabs]')) return;
  applyTabVisibility(boardRoot);

  // Management content is rendered synchronously by manager-board-runtime.js.
  // Do not load or rewrite workspace content on that tab, which prevents the return-trip layout shift.
  if (activeTab === 'management') return;

  const context = contextFromBoard(boardRoot);
  const signature = activeTab === 'payroll-attendance'
    ? `${context.period}|all-teams|${context.ym}|${context.schoolYear}|${activeTab}`
    : `${context.period}|${context.manager}|${context.ym}|${context.schoolYear}|${activeTab}`;
  if (!force && signature === lastContextSignature && boardRoot.dataset.managerWorkspaceReady === 'true') return;
  lastContextSignature = signature;
  boardRoot.dataset.managerWorkspaceReady = 'true';
  const renderToken = ++currentRenderToken;

  const view = boardRoot.querySelector('[data-manager-workspace-view]');
  if (view) view.innerHTML = '<div class="manager-workspace-loading">טוען נתוני צוות…</div>';

  try {
    const roster = activeTab === 'payroll-attendance'
      ? await loadAllTeamRosters(context.schoolYear)
      : await loadRoster(context.manager, context.schoolYear);
    if (renderToken !== currentRenderToken || !boardRoot.isConnected) return;
    if (activeTab === 'attendance') await renderAttendance(boardRoot, context, roster, renderToken);
    else if (activeTab === 'payroll-attendance') await renderPayrollAttendanceAdmin(boardRoot, context, roster, renderToken);
    else renderTracking(boardRoot, context, roster);
  } catch (error) {
    if (renderToken !== currentRenderToken || !boardRoot.isConnected) return;
    if (view) view.innerHTML = `<div class="manager-workspace-error"><strong>לא ניתן לטעון את צוות המנהל</strong><span>${escapeHtml(error?.message || 'אירעה תקלה זמנית.')}</span><button type="button" data-manager-workspace-retry>נסה שוב</button></div>`;
    view?.querySelector('[data-manager-workspace-retry]')?.addEventListener('click', () => {
      rosterCache.delete(`${context.manager}|${context.schoolYear}`);
      attendanceSummaryCache.clear();
      lastContextSignature = '';
      void renderWorkspace(true);
    });
  }
}

function syncWorkspace() {
  const boardRoot = validBoardRoot();
  if (!boardRoot) {
    lastContextSignature = '';
    embeddedAttendanceSignature = '';
    return;
  }
  if (!boardRoot.querySelector('[data-manager-workspace-tabs]')) {
    lastContextSignature = '';
    embeddedAttendanceSignature = '';
    return;
  }
  if (activeTab === 'attendance') syncAttendanceMonthNav(boardRoot);
  if (resetBoardMonthIfNeeded(boardRoot)) return;
  void renderWorkspace(false);
}

function scheduleSync() {
  window.clearTimeout(observerTimer);
  observerTimer = window.setTimeout(syncWorkspace, 50);
}

function startWorkspaceRuntime() {
  if (observer) return;
  const app = document.getElementById('app');
  if (!app) return;
  window.addEventListener('click', handleWorkspaceClick, true);
  observer = new MutationObserver(scheduleSync);
  observer.observe(app, { childList: true, subtree: true });
  window.addEventListener('storage', (event) => {
    if (event.key === MANAGER_WORKSPACE_TAB_KEY || event.key?.startsWith('manager_board_manager:')) scheduleSync();
  });
  scheduleSync();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startWorkspaceRuntime, { once: true });
else startWorkspaceRuntime();
