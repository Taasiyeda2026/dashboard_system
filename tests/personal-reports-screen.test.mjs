import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

const originalFetch = global.fetch;
global.fetch = async () => new Response(JSON.stringify([]), {
  status: 200,
  headers: { 'content-type': 'application/json' }
});

const { personalReportsScreen } = await import('../frontend/src/screens/personal-reports.js');

const EMPLOYEE_UUID = '123e4567-e89b-42d3-a456-426614174000';
const ADMIN_UUID = '123e4567-e89b-42d3-a456-426614174001';

function userWithPersonalReportsAccess(overrides = {}) {
  return { can_access_personal_reports: true, ...overrides };
}

function mountWithUser(user) {
  const dom = new JSDOM('<main id="screenRoot"></main>', { url: 'https://example.test/' });
  global.document = dom.window.document;
  global.window = dom.window;
  global.CustomEvent = dom.window.CustomEvent;
  global.AbortController = dom.window.AbortController;
  global.AbortSignal = dom.window.AbortSignal;
  const root = dom.window.document.getElementById('screenRoot');
  root.innerHTML = personalReportsScreen.render({}, { state: { user } });
  personalReportsScreen.bind({ root, state: { user } });
  return { dom, root };
}

test.after(() => {
  global.fetch = originalFetch;
});

test('personal reports always opens locked with only the internal verification card', () => {
  const { root } = mountWithUser(userWithPersonalReportsAccess({ full_name: 'עובד רגיל', display_role: 'instructor', user_id: '8000', auth_user_id: EMPLOYEE_UUID }));

  assert.ok(root.querySelector('#pr-internal-login-form'));
  assert.ok(root.querySelector('#pr-internal-access-code'));
  assert.equal(root.querySelector('#pr-employee-code'), null);
  assert.equal(root.querySelector('#pr-login-form'), null);
  assert.equal(root.querySelector('#pr-email'), null);
  assert.equal(root.querySelector('#pr-pass'), null);
  assert.equal(root.querySelector('.pr-card.pr-month-selector-card'), null);
  assert.match(root.textContent, /אימות נוסף לדוחות אישיים/);
  assert.match(root.textContent, /אזור זה כולל מידע רגיש/);
  assert.match(root.textContent, /קוד התחברות/);
  assert.match(root.textContent, /הצגת הדוחות שלי/);
});

test('admin also starts locked and does not render personal or management report content before verification', () => {
  const { root } = mountWithUser(userWithPersonalReportsAccess({ full_name: 'מנהלת מערכת', display_role: 'admin', user_id: 'admin', auth_user_id: ADMIN_UUID }));

  assert.ok(root.querySelector('#pr-internal-login-form'));
  assert.equal(root.querySelector('.pr-screen-mode-switch'), null);
  assert.equal(root.querySelector('.pr-quick-tabs'), null);
  assert.doesNotMatch(root.textContent, /ניהול דוחות עובדים/);
});

test('leaving personal reports resets the unlocked module state so the next bind is locked again', () => {
  const user = userWithPersonalReportsAccess({ full_name: 'עובד רגיל', display_role: 'instructor', user_id: '8000', auth_user_id: EMPLOYEE_UUID });
  const { root } = mountWithUser(user);

  document.dispatchEvent(new CustomEvent('app:navigate', { detail: { route: 'dashboard' } }));
  root.innerHTML = personalReportsScreen.render({}, { state: { user } });
  personalReportsScreen.bind({ root, state: { user } });

  assert.ok(root.querySelector('#pr-internal-login-form'));
  assert.equal(root.querySelector('.pr-card.pr-month-selector-card'), null);
});

test('source keeps personal reports auth temporary and maps verified login to auth UUID before report queries', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /let isPersonalReportsUnlocked = false/);
  assert.match(source, /function resetPersonalReportsAuth/);
  assert.match(source, /isPersonalReportsUnlocked = false/);
  assert.match(source, /function authenticateInternalEmployee/);
  assert.match(source, /auth\.signInWithPassword/);
  assert.match(source, /authUserId = authData\.user\.id/);
  assert.match(source, /sameDashboardUser\(userRow, dashboardUser\)/);
  assert.match(source, /assertEmployeeUuid\(employeeId\)/);
  assert.doesNotMatch(source, /localStorage|sessionStorage/);
  assert.match(source, /אימות נוסף לדוחות אישיים/);
  assert.match(source, /הקוד שהוזן אינו תקין\. יש לבדוק ולנסות שוב\./);
  assert.doesNotMatch(source, /id="pr-email"|id="pr-pass"|מייל עבודה|שכחתי סיסמה/);
});


test('source uses only existing personal report tables for monthly report data', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, new RegExp(['work', 'hour', 'entries'].join('_')));
  assert.match(source, /from\('declared_travel_entries'\)/);
  assert.match(source, /from\('public_transport_entries'\)/);
  assert.match(source, /from\('expense_entries'\)/);
  assert.match(source, /from\('report_attachments'\)/);
  assert.match(source, /from\('absence_entries'\)/);
  assert.match(source, /countWorkdaysInclusive/);
  assert.match(source, /calculatedAbsenceDays/);
  assert.match(source, /absence_entry_id/);
  assert.match(source, /expense_entry_id/);
});

test('source keeps absence days automatic and weekday-only', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /function isWorkday/);
  assert.match(source, /day >= 0 && day <= 4/);
  assert.match(source, /countWorkdaysInclusive\(entry\.start_date, entry\.end_date\)/);
  assert.match(source, /name="calculated_days" readonly/);
  assert.doesNotMatch(source, /name="total_days"/);
  assert.doesNotMatch(source, /סה[״"]?כ ימים ידני/);
});

test('monthly report detail keeps the compact five-tab employee workflow', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  for (const tab of ['status', 'travel', 'expenses', 'absences', 'details']) {
    assert.match(source, new RegExp(`data-tab="${tab}"`));
  }
  assert.doesNotMatch(source, /data-tab="attachments"|data-tab="approval"|data-tab="salary"/);
  assert.doesNotMatch(source, /<span>אסמכתאות<\/span>|<span>סיכום ואישור<\/span>/);
  assert.equal(source.match(/הוספת נסיעה/g)?.length, 1);
  assert.equal(source.match(/הוספת הוצאה/g)?.length, 1);
  assert.doesNotMatch(source, /summaryPillHtml\('סה"כ להחזר'/);
  assert.match(source, /compactEmptyRowHtml\('אין נסיעות מדווחות לחודש זה\.'\)/);
  assert.match(source, /compactEmptyRowHtml\('לא נוספו הוצאות לחודש זה\.'\)/);
  assert.match(source, /compactEmptyRowHtml\('לא דווחו ימי חופש, מחלה או הצהרה לחודש זה\.'\)/);
  assert.match(source, /initialTab: currentReportTab\(root\)/);
  assert.match(source, /<span>אישור דיווח<\/span>/);
  assert.match(source, /יש להשלים ולשלוח את הדיווח עד ה־26 בכל חודש\. הדיווח מתייחס לתקופת הדיווח עד ה־25 בכל חודש\./);
});

test('monthly report detail UX: status accordion, travel fields, tables, icons, details period, signature name', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /statusPanelHtml\(/);
  assert.match(source, /<details class="pr-status-accordion">/);
  assert.doesNotMatch(source, /reportInfoRowHtml\('סטטוס נוכחי'/);
  assert.match(source, /pr-travel-km-field/);
  assert.match(source, /pr-travel-public-field/);
  assert.doesNotMatch(source, /pr-travel-amount-field/);
  assert.doesNotMatch(source, /name="amount_preview"/);
  assert.match(source, /סכום ההחזר יחושב לאחר השמירה\./);
  assert.match(source, /updateTravelTypeFields/);
  assert.match(source, /kmInput\.required = !isPublicTransport/);
  assert.match(source, /publicAmountInput\.required = isPublicTransport/);
  assert.match(source, /pr-travel-km-field'\)\.forEach\(\(field\) => \{ field\.hidden = isPublicTransport/);
  assert.match(source, /pr-travel-public-field'\)\.forEach\(\(field\) => \{ field\.hidden = !isPublicTransport/);
  assert.match(source, /pr-entries-table-wrap/);
  assert.match(source, /pr-entries-table/);
  assert.match(source, /pr-col-date/);
  assert.match(source, /pr-col-detail/);
  assert.match(source, /prIconBtnHtml/);
  assert.match(source, /prIconUploadHtml/);
  assert.doesNotMatch(source, /data-pr-action="edit-expense"[^>]*>עריכה</);
  assert.doesNotMatch(source, /data-pr-action="delete-entry"[^>]*>מחיקה</);
  assert.match(source, /pr-details-period/);
  assert.doesNotMatch(source, /summaryPillHtml\('תקופת דיווח'/);
  assert.doesNotMatch(source, /summaryPillHtml\('חודש דיווח'/);
  assert.match(source, /שם מלא לחתימה/);
  assert.match(source, /signatureDisplayName/);
  assert.match(source, /function loadEmployeeProfile/);
  assert.match(source, /\.from\('profiles'\)[\s\S]*\.select\('full_name, email'\)/);
  assert.doesNotMatch(source, new RegExp(['work', 'hour', 'entries'].join('_')));
});

test('personal reports entry tables use compact fit-content layout', async () => {
  const css = await readFile(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.pr-entries-table-wrap\s*\{[^}]*width:\s*fit-content/);
  assert.match(css, /\.pr-entries-table-wrap \.pr-entries-table\s*\{[^}]*width:\s*fit-content/);
  assert.match(css, /\.pr-entries-table \.pr-col-date[^}]*max-width:\s*110px/);
  assert.match(css, /\.pr-report-detail-body \.pr-entries-table-wrap\.pr-table-scroll\s*\{[^}]*overflow:\s*visible/);
  assert.match(css, /\.pr-entries-table-wrap \.pr-data-table th[^}]*border:\s*1px solid/);
  assert.match(css, /\.pr-report-detail-body \.pr-field\[hidden\]\s*\{[^}]*display:\s*none !important/);
  assert.match(css, /\.pr-th-num, \.pr-td-num\s*\{[^}]*text-align:\s*center/);
  assert.match(css, /\.pr-entries-table-wrap\s*\{[^}]*border:\s*1px solid/);
});

test('service worker cache version bumped for personal reports deploy', async () => {
  const frontendSw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const rootSw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

  assert.match(frontendSw, /const CACHE_VERSION = 595;/);
  assert.match(rootSw, /const SW_ENTRY_VERSION = 595;/);
});

test('source guards personal reports loads with requestKey and abortable listeners', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /function buildPersonalReportsRequestKey/);
  assert.match(source, /function buildAdminReportsRequestKey/);
  assert.match(source, /function buildReportRowRequestKey/);
  assert.match(source, /function buildProfileRequestKey/);
  assert.match(source, /function runGuardedPersonalReportsLoad/);
  assert.match(source, /const _prCompletedKeys = new Set\(\)/);
  assert.match(source, /function loadReportRow/);
  assert.match(source, /function loadEmployeeProfile/);
  assert.match(source, /function loadReportBundle/);
  assert.match(source, /function loadEmployeeReportsManagementList/);
  assert.match(source, /function restorePersonalReportsShellView/);
  assert.match(source, /personalReportsReportAlreadyRendered/);
  assert.match(source, /let _prActiveView = null/);
  assert.match(source, /load skipped duplicate/);
  assert.match(source, /personalReports load start/);
  assert.match(source, /tables loaded/);
  assert.match(source, /load finished/);
  assert.match(source, /pr_debug/);
  assert.match(source, /root\.__prAdminAbort\?\.abort\(\)/);
  assert.match(source, /root\.__prEmployeeAbort\?\.abort\(\)/);
  assert.match(source, /preserveSession/);
  assert.match(source, /preserveLoginScreen/);
  assert.match(source, /dashboardUserForAuth/);
  assert.match(source, /normalizeAccessCode/);
  assert.match(source, /forceReload: true/);
});

test('internal login keeps access code as trimmed string and uses current dashboard user', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /normalizeAccessCode\(fd\.get\('access_code'\)\)/);
  assert.match(source, /const dashboardUser = dashboardUserForAuth\(\)/);
  assert.match(source, /authenticateInternalEmployee\(dashboardUser, accessCode\)/);
  assert.match(source, /firstUuid\([\s\S]*user\?\.auth_user_id[\s\S]*user\?\.personal_reports_user_id[\s\S]*user\?\.supabase_user_id[\s\S]*user\?\.id/);
  assert.doesNotMatch(source, /Number\(fd\.get\('access_code'\)/);
});

test('bindReportDetail uses bindScreenListeners, AbortController, and savingForms', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /function bindScreenListeners/);
  assert.match(source, /const savingForms = new WeakSet\(\)/);
  assert.match(source, /root\.__prDetailAbort\?\.abort\(\)/);
  assert.match(source, /new AbortController\(\)/);
  assert.match(source, /bindScreenListeners\(root, detailAbort\.signal\)/);
  assert.match(source, /savingForms\.has\(form\)/);
  assert.match(source, /savingForms\.add\(form\)/);
  assert.match(source, /savingForms\.delete\(form\)/);
});

test('add-entry actions use explicit show/hide panels and absence type only reveals form', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /data-pr-action="show-add-expense"/);
  assert.match(source, /data-pr-action="hide-add-expense"/);
  assert.match(source, /data-pr-action="show-add-travel"/);
  assert.match(source, /data-pr-action="hide-add-travel"/);
  assert.doesNotMatch(source, /toggle-add-expense/);
  assert.doesNotMatch(source, /toggle-add-travel/);
  assert.match(source, /if \(action === 'choose-absence-type'\)/);
  assert.match(source, /revealAbsenceFields\(form, btn\.dataset\.absenceType/);
  assert.doesNotMatch(source, /choose-absence-type[\s\S]{0,200}upsertAbsence/);
});

test('source computes km reimbursement server-side without exposing travel rates', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /\* 1\.6/);
  assert.doesNotMatch(source, /updateTravelAmount/);
  assert.doesNotMatch(source, /rate_per_km/);
  assert.doesNotMatch(source, /employee_travel_rates/);
  assert.match(source, /\.rpc\('upsert_declared_travel_entry'/);
  assert.match(source, /missing_travel_rate/);
  assert.match(source, /setReportTab\(root, 'expenses'\)/);
});

test('submit success back button returns to employee dashboard with a single refreshed load', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /function showReportSubmittedSuccess/);
  assert.match(source, /kind: 'submit-success'/);
  assert.match(source, /function returnToEmployeeDashboard/);
  assert.match(source, /await returnToEmployeeDashboard\(root, \{ isSimulation \}\)/);
  assert.match(source, /showReportSubmittedSuccess\(root, prSelectedReport\.id/);
  assert.match(source, /pr-submit-success-screen/);
  assert.doesNotMatch(source, /pr-submit-success-screen[\s\S]{0,120}pr-report-form/);
  assert.match(source, /function renderMyReportsDashboard/);
  assert.match(source, /await renderMyReportsDashboard\(root, \{[\s\S]{0,320}force: true/);
  assert.match(source, /prSelectedReport\.report_month/);
  assert.doesNotMatch(source, /if \(action === 'back-to-my-reports'\)[\s\S]{0,220}await rerender\(root, _dashboardUser\)/);
});

test('source separates my-reports from employee-reports-management modes', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /PR_SCREEN_MODES/);
  assert.match(source, /MY_REPORTS: 'my-reports'/);
  assert.match(source, /MANAGEMENT: 'employee-reports-management'/);
  assert.match(source, /function myReportsDashboardHtml/);
  assert.match(source, /function employeeReportsManagementHtml/);
  assert.match(source, /function bindMyReportsDashboard/);
  assert.match(source, /function bindEmployeeReportsManagement/);
  assert.match(source, /kind: 'my-reports'/);
  assert.match(source, /kind: 'employee-reports-management'/);
  assert.match(source, /prScreenMode = PR_SCREEN_MODES\.MY_REPORTS/);
  assert.doesNotMatch(source, /prAdminMode/);
  assert.doesNotMatch(source, /function employeeDashboardHtml/);
  assert.doesNotMatch(source, /function adminDashboardHtml/);
  assert.doesNotMatch(source, /id="pr-filter-employee"/);
  assert.doesNotMatch(source, /<option[^>]*>כל העובדים<\/option>/);
});

test('my-reports screen uses a single personal card without management controls', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /pr-my-report-card/);
  assert.match(source, /מילוי דוח/);
  assert.match(source, /המשך מילוי/);
  assert.match(source, /עריכת תיקונים/);
  assert.match(source, /צפייה בדוח/);
  assert.match(source, /MY_REPORT_STATUS_META/);
  assert.match(source, /לא התחיל/);
  assert.match(source, /נשלח לאישור/);
  assert.doesNotMatch(source, /pr-month-list[\s\S]{0,400}pr-admin-table/);
  assert.doesNotMatch(source, /data-pr-action="admin-approve"[\s\S]{0,80}pr-admin-report-row/);
});

test('my-reports dashboard includes month selector from January 2026 through current month', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /id="pr-my-report-month"/);
  assert.match(source, /pr-month-selector-card/);
  assert.match(source, /MY_REPORTS_EARLIEST/);
  assert.match(source, /month: 1, year: 2026/);
  assert.match(source, /function buildMyReportsMonthOptions/);
  assert.match(source, /function clampMyReportsMonthValue/);
  assert.match(source, /defaultMyReportsMonthValue/);
  assert.match(source, /לא נמצא דוח לחודש זה/);
  assert.match(source, /function myReportNoReportHtml/);
  assert.match(source, /selectedMonth: monthValue/);
  assert.match(source, /#pr-my-report-month/);
});

test('management screen lists all report-eligible employees with one row action', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /function fetchReportEligibleEmployees/);
  assert.doesNotMatch(source, /fetchReportEligibleEmployees[\s\S]{0,500}!isAdminRole\(profile\.role\)/);
  assert.match(source, /function buildEmployeeReportsManagementRows/);
  assert.match(source, /ADMIN_MANAGE_STATUS_META/);
  assert.match(source, /בטיפול העובד/);
  assert.match(source, /data-pr-action="admin-manage-report"/);
  assert.match(source, /צפייה וניהול/);
  assert.match(source, /id="pr-filter-month"/);
  assert.match(source, /id="pr-filter-status"/);
  assert.doesNotMatch(source, /pr-admin-status-select/);
  assert.doesNotMatch(source, /data-pr-action="admin-view-report"/);
  assert.doesNotMatch(source, /data-pr-action="admin-approve"[^>]*>אשר</);
});

test('admin management screen exports the visible table to CSV for the selected month', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /data-pr-action="export-admin-table"/);
  assert.match(source, /function downloadAdminReportsCsv/);
  assert.match(source, /function getAdminExportRows/);
  assert.match(source, /personal-reports-\$\{monthValue\}\.csv/);
  assert.match(source, /שם עובד/);
  assert.match(source, /תאריך שליחה/);
  assert.match(source, /תאריך אישור/);
  assert.match(source, /הערות \/ החזרה לתיקון/);
  assert.match(source, /adminManageStatusLabel/);
  assert.match(source, /הורדת כל העובדים לחודש זה/);
  assert.doesNotMatch(source, /export-admin-table[\s\S]{0,500}myReportsDashboardHtml/);
  assert.doesNotMatch(source, /data-pr-action="export-admin-table"[\s\S]{0,400}pr-my-report-card/);
});

test('admin defaults to my-reports and can switch to management via tabs', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /prScreenMode = PR_SCREEN_MODES\.MY_REPORTS/);
  assert.match(source, /data-pr-action="screen-mode-management"/);
  assert.match(source, /data-pr-action="screen-mode-my-reports"/);
  assert.match(source, /personalReportsModeTabsHtml/);
  assert.match(source, /showModeTabs: true/);
  assert.match(source, /prScreenMode === PR_SCREEN_MODES\.MY_REPORTS/);
});

test('management actions stay inside admin report detail view', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /pr-admin-detail-actions/);
  assert.match(source, /data-pr-action="admin-approve"/);
  assert.match(source, /data-pr-action="admin-return"/);
  assert.match(source, /data-pr-action="download-report-pdf"/);
  assert.match(source, /function adminReportViewHtml/);
  assert.match(source, /function safeOpenAdminManageReport/);
  assert.match(source, /function adminNotStartedReportHtml/);
});

test('migration keeps travel rates private and exposes only RPC entry points', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20260607_personal_reports_employee_travel_rates.sql', import.meta.url), 'utf8');

  assert.match(sql, /CREATE SCHEMA IF NOT EXISTS private/);
  assert.match(sql, /private\.employee_travel_rates/);
  assert.match(sql, /private\.declared_travel_rate_audit/);
  assert.match(sql, /private\.get_employee_km_rate/);
  assert.match(sql, /private\.personal_report_is_editable/);
  assert.match(sql, /private\.personal_reports_can_manage_travel_rates/);
  assert.match(sql, /public\.upsert_declared_travel_entry/);
  assert.match(sql, /public\.manage_employee_travel_rate/);
  assert.match(sql, /REVOKE ALL ON SCHEMA private/);
});
