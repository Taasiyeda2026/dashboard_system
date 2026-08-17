import { state } from './state.js';
import { api } from './api.js';
import { supabase, waitForSupabaseAuthSession } from './supabase-client.js';
import { normalizeGlobalActivityPeriod } from './screens/shared/summer-activity.js';
import { escapeHtml } from './screens/shared/html.js';

const MANAGER_WORKSPACE_ROLES = new Set(['admin', 'operation_manager', 'activities_manager', 'finance']);
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
  ['intro_call_completed', 'שיחת היכרות'],
  ['contract_confirmed', 'חוזה'],
  ['observation_completed', 'תצפית'],
  ['feedback_completed', 'משוב'],
  ['police_clearance_confirmed', 'אישור משטרה']
];

let activeTab = restoreTab();
let observer = null;
let observerTimer = null;
let currentRenderToken = 0;
let lastContextSignature = '';
let embeddedAttendanceSignature = '';
let resetMonthOnNextBoard = true;
const rosterCache = new Map();
const attendanceSummaryCache = new Map();

function text(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function role() {
  return text(state?.user?.role);
}

function canUseWorkspace() {
  return MANAGER_WORKSPACE_ROLES.has(role());
}

function restoreTab() {
  try {
    const stored = localStorage.getItem(MANAGER_WORKSPACE_TAB_KEY);
    return ['management', 'attendance', 'tracking'].includes(stored) ? stored : 'management';
  } catch {
    return 'management';
  }
}

function setActiveTab(tab) {
  activeTab = ['management', 'attendance', 'tracking'].includes(tab) ? tab : 'management';
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
  const ym = currentMonth(boardRoot, period);
  const schoolYear = schoolYearForPeriod(period);
  return { period, manager, ym, schoolYear };
}

function validBoardRoot() {
  const root = document.querySelector('.manager-board-screen[data-manager-board-root]');
  if (!root || !canUseWorkspace()) return null;
  return root;
}

function resetBoardMonthIfNeeded(boardRoot) {
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
  try {
    const records = await api.attendanceControlRecords();
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

  if (target.closest('[data-manager-board-open]')) {
    resetMonthOnNextBoard = true;
    return;
  }

  const button = target.closest('[data-manager-workspace-tab]');
  if (!button || !canUseWorkspace()) return;
  const boardRoot = button.closest('[data-manager-board-root]');
  if (!boardRoot) return;
  const next = button.dataset.managerWorkspaceTab;
  if (!['management', 'attendance', 'tracking'].includes(next)) return;

  event.preventDefault();
  setActiveTab(next);
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

function attendanceStatusBadge(count, approval) {
  if (!count) return '<span class="manager-workspace-status is-muted">אין דיווח</span>';
  if (approval) return '<span class="manager-workspace-status is-ok">✓ אושר</span>';
  return '<span class="manager-workspace-status is-pending">טרם אושר</span>';
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
      <td>${attendanceStatusBadge(count, approval)}${approvedAt ? `<small>${escapeHtml(approvedAt)}</small>` : ''}</td>
      <td><button type="button" class="manager-workspace-link-button" data-manager-attendance-open-employee="${escapeHtml(empId)}"${count ? '' : ' disabled'}>פתח בקרה</button></td>
    </tr>`;
  }).join('');
  return `<div class="manager-workspace-table-wrap"><table class="manager-workspace-table manager-workspace-attendance-table">
    <thead><tr><th>מדריך</th><th>דיווח ${escapeHtml(ym)}</th><th>סטטוס אישור</th><th></th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div>`;
}

function trackingTableHtml(roster, schoolYear) {
  if (!roster.length) return '<div class="manager-workspace-empty">אין מדריכים פעילים המשויכים למנהל.</div>';
  const rows = roster.map((row) => {
    const empId = text(row.emp_id);
    const checks = FOLLOWUP_FIELDS.map(([field, label]) => `<td data-label="${escapeHtml(label)}"><label class="manager-workspace-check"><input type="checkbox" data-manager-followup-field="${field}" data-manager-followup-emp="${escapeHtml(empId)}" ${row[field] ? 'checked' : ''}><span aria-hidden="true"></span></label></td>`).join('');
    const folder = text(row.folder_web_url);
    return `<tr data-manager-followup-row="${escapeHtml(empId)}">
      <td class="manager-workspace-person"><strong>${escapeHtml(text(row.full_name) || empId)}</strong><small>${escapeHtml(text(row.employment_type))}</small></td>
      ${checks}
      <td data-label="תיק עובד">${folder ? `<a class="manager-workspace-folder-link" href="${escapeHtml(folder)}" target="_blank" rel="noopener">פתח תיק</a>` : '<span class="manager-workspace-status is-muted">טרם קושר</span>'}</td>
    </tr>`;
  }).join('');
  return `<div class="manager-workspace-table-wrap"><table class="manager-workspace-table manager-workspace-tracking-table">
    <thead><tr><th>מדריך</th>${FOLLOWUP_FIELDS.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('')}<th>תיק עובד</th></tr></thead>
    <tbody>${rows}</tbody>
  </table></div><p class="manager-workspace-source-note">רשימת המדריכים מגיעה ממאגר המדריכים המרכזי. בעמוד זה נשמרים רק סימוני המעקב לשנת ${escapeHtml(schoolYear)}.</p>`;
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
        return async () => {
          const records = await target.attendanceControlRecords();
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
  const run = host.querySelector('[data-attendance-run]');
  const results = host.querySelector('[data-attendance-results]');
  if (!results?.querySelector('[data-payroll-employee]')) {
    if (await waitForEnabledButton(run)) run.click();
  }
  const started = Date.now();
  while (Date.now() - started < 20000) {
    const detail = host.querySelector(`[data-payroll-employee="${CSS.escape(String(empId))}"]`);
    if (detail) {
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
  host.innerHTML = `${attendance.attendanceControlStylesHtml()}${attendance.attendanceControlHtml()}`;
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

  host.querySelector('[data-attendance-close]')?.remove();
}

async function renderManagement(boardRoot, context, roster, renderToken) {
  const alerts = boardRoot.querySelector('[data-manager-workspace-management-alerts]');
  if (!alerts) return;
  alerts.innerHTML = '<div class="manager-workspace-loading">טוען סטטוסי דיווח…</div>';
  const summary = await loadAttendanceSummary(roster, context.ym);
  if (renderToken !== currentRenderToken || activeTab !== 'management' || !boardRoot.isConnected) return;
  alerts.innerHTML = managementAlertsHtml(roster, summary);
}

async function renderAttendance(boardRoot, context, roster, renderToken) {
  const view = boardRoot.querySelector('[data-manager-workspace-view]');
  if (!view) return;
  view.innerHTML = '<div class="manager-workspace-loading">טוען בקרת נוכחות לצוות…</div>';
  const summary = await loadAttendanceSummary(roster, context.ym);
  if (renderToken !== currentRenderToken || activeTab !== 'attendance' || !boardRoot.isConnected) return;

  view.innerHTML = `<section class="manager-workspace-panel manager-workspace-attendance" dir="rtl">
    <header class="manager-workspace-panel__head"><div><h2>בקרת נוכחות</h2><p>${escapeHtml(context.manager)} · ${escapeHtml(context.ym)} · צוות אחד ממקור הנתונים המרכזי</p></div><button type="button" class="manager-workspace-run-team" data-manager-attendance-run-team>פתח את בקרת כל הצוות</button></header>
    ${attendanceSummaryTableHtml(roster, summary, context.ym)}
    ${(summary.recordsError || summary.approvalsError) ? `<p class="manager-workspace-inline-error">${escapeHtml(summary.recordsError || summary.approvalsError)}</p>` : ''}
    <div class="manager-workspace-attendance-host" data-manager-attendance-host></div>
  </section>`;

  const host = view.querySelector('[data-manager-attendance-host]');
  await bindEmbeddedAttendance(host, roster, context);
  if (renderToken !== currentRenderToken || activeTab !== 'attendance') return;

  view.querySelector('[data-manager-attendance-run-team]')?.addEventListener('click', async () => {
    const run = host.querySelector('[data-attendance-run]');
    if (await waitForEnabledButton(run)) run.click();
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  view.querySelectorAll('[data-manager-attendance-open-employee]').forEach((button) => {
    button.addEventListener('click', () => void openEmployeeAttendance(button.dataset.managerAttendanceOpenEmployee));
  });
}

async function updateFollowupCheckbox(input, context) {
  const empId = Number(input.dataset.managerFollowupEmp);
  const field = input.dataset.managerFollowupField;
  if (!Number.isFinite(empId) || !field) return;
  const previous = !input.checked;
  input.disabled = true;
  try {
    await ensureAuthSession();
    const { data, error } = await supabase.rpc('update_manager_instructor_followup', {
      p_emp_id: empId,
      p_school_year: context.schoolYear,
      p_field: field,
      p_value: input.checked
    });
    if (error) throw error;
    const key = `${context.manager}|${context.schoolYear}`;
    const cached = rosterCache.get(key);
    if (cached) {
      cached.rows = cached.rows.map((row) => text(row.emp_id) === text(empId) ? { ...row, ...(data || {}) } : row);
      cached.loadedAt = Date.now();
    }
    const row = input.closest('tr');
    row?.classList.add('is-saved');
    window.setTimeout(() => row?.classList.remove('is-saved'), 650);
  } catch (error) {
    input.checked = previous;
    const row = input.closest('tr');
    const note = row?.querySelector('[data-manager-followup-error]') || document.createElement('small');
    note.dataset.managerFollowupError = 'true';
    note.className = 'manager-workspace-row-error';
    note.textContent = error?.message || 'שמירת הסימון נכשלה.';
    if (!note.isConnected) row?.querySelector('.manager-workspace-person')?.appendChild(note);
  } finally {
    input.disabled = false;
  }
}

function renderTracking(boardRoot, context, roster) {
  const view = boardRoot.querySelector('[data-manager-workspace-view]');
  if (!view) return;
  view.innerHTML = `<section class="manager-workspace-panel manager-workspace-tracking" dir="rtl">
    <header class="manager-workspace-panel__head"><div><h2>מעקב צוות</h2><p>${escapeHtml(context.manager)} · שנת ${escapeHtml(context.schoolYear)}</p></div>${sharePointRootButton(context.schoolYear)}</header>
    ${trackingTableHtml(roster, context.schoolYear)}
  </section>`;
  view.querySelectorAll('[data-manager-followup-field]').forEach((input) => {
    input.addEventListener('change', () => void updateFollowupCheckbox(input, context));
  });
}

async function renderWorkspace(force = false) {
  const boardRoot = validBoardRoot();
  if (!boardRoot) return;
  if (!boardRoot.querySelector('[data-manager-workspace-tabs]')) return;
  applyTabVisibility(boardRoot);

  const context = contextFromBoard(boardRoot);
  const signature = `${context.period}|${context.manager}|${context.ym}|${context.schoolYear}|${activeTab}`;
  if (!force && signature === lastContextSignature && boardRoot.dataset.managerWorkspaceReady === 'true') return;
  lastContextSignature = signature;
  boardRoot.dataset.managerWorkspaceReady = 'true';
  const renderToken = ++currentRenderToken;

  const alerts = boardRoot.querySelector('[data-manager-workspace-management-alerts]');
  const view = boardRoot.querySelector('[data-manager-workspace-view]');
  if (activeTab === 'management' && alerts) alerts.innerHTML = '<div class="manager-workspace-loading">טוען נתוני צוות…</div>';
  if (activeTab !== 'management' && view) view.innerHTML = '<div class="manager-workspace-loading">טוען נתוני צוות…</div>';

  try {
    const roster = await loadRoster(context.manager, context.schoolYear);
    if (renderToken !== currentRenderToken || !boardRoot.isConnected) return;
    if (activeTab === 'management') await renderManagement(boardRoot, context, roster, renderToken);
    else if (activeTab === 'attendance') await renderAttendance(boardRoot, context, roster, renderToken);
    else renderTracking(boardRoot, context, roster);
  } catch (error) {
    if (renderToken !== currentRenderToken || !boardRoot.isConnected) return;
    const target = activeTab === 'management' ? alerts : view;
    if (target) target.innerHTML = `<div class="manager-workspace-error"><strong>לא ניתן לטעון את צוות המנהל</strong><span>${escapeHtml(error?.message || 'אירעה תקלה זמנית.')}</span><button type="button" data-manager-workspace-retry>נסה שוב</button></div>`;
    target?.querySelector('[data-manager-workspace-retry]')?.addEventListener('click', () => {
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
