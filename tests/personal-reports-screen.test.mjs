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

function mountWithUser(user) {
  const dom = new JSDOM('<main id="screenRoot"></main>', { url: 'https://example.test/' });
  global.document = dom.window.document;
  global.CustomEvent = dom.window.CustomEvent;
  const root = dom.window.document.getElementById('screenRoot');
  root.innerHTML = personalReportsScreen.render({}, { state: { user } });
  personalReportsScreen.bind({ root, state: { user } });
  return { dom, root };
}

test.after(() => {
  global.fetch = originalFetch;
});

test('personal reports always opens locked with only the internal verification card', () => {
  const { root } = mountWithUser({ full_name: 'עובד רגיל', display_role: 'instructor', user_id: '8000', auth_user_id: EMPLOYEE_UUID });

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
  const { root } = mountWithUser({ full_name: 'מנהלת מערכת', display_role: 'admin', user_id: 'admin', auth_user_id: ADMIN_UUID });

  assert.ok(root.querySelector('#pr-internal-login-form'));
  assert.equal(root.querySelector('.pr-admin-mode-switch'), null);
  assert.equal(root.querySelector('.pr-quick-tabs'), null);
  assert.doesNotMatch(root.textContent, /ניהול דוחות עובדים/);
});

test('leaving personal reports resets the unlocked module state so the next bind is locked again', () => {
  const user = { full_name: 'עובד רגיל', display_role: 'instructor', user_id: '8000', auth_user_id: EMPLOYEE_UUID };
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
});

test('monthly report detail UX: status accordion, travel fields, tables, icons, details period, signature name', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /statusPanelHtml\(/);
  assert.match(source, /<details class="pr-status-accordion">/);
  assert.doesNotMatch(source, /reportInfoRowHtml\('סטטוס נוכחי'/);
  assert.match(source, /pr-travel-km-field/);
  assert.match(source, /pr-travel-public-field/);
  assert.match(source, /pr-travel-amount-field/);
  assert.match(source, /pr-travel-amount-field'\)\.forEach\(\(field\) => \{ field\.hidden = isPublicTransport/);
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
  assert.match(source, /from\('profiles'\)\.select\('full_name, email'\)/);
  assert.doesNotMatch(source, new RegExp(['work', 'hour', 'entries'].join('_')));
});

test('personal reports entry tables use compact fit-content layout', async () => {
  const css = await readFile(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8');

  assert.match(css, /\.pr-entries-table-wrap\s*\{[^}]*width:\s*fit-content/);
  assert.match(css, /\.pr-entries-table-wrap \.pr-entries-table\s*\{[^}]*width:\s*fit-content/);
  assert.match(css, /\.pr-entries-table \.pr-col-date[^}]*max-width:\s*110px/);
  assert.match(css, /\.pr-entries-table-wrap\.pr-table-scroll\s*\{[^}]*overflow-x:\s*hidden/);
  assert.match(css, /\.pr-report-detail-body \.pr-field\[hidden\]\s*\{[^}]*display:\s*none !important/);
});

test('service worker cache version bumped for personal reports deploy', async () => {
  const frontendSw = await readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8');
  const rootSw = await readFile(new URL('../sw.js', import.meta.url), 'utf8');

  assert.match(frontendSw, /const CACHE_VERSION = 583;/);
  assert.match(rootSw, /const SW_ENTRY_VERSION = 583;/);
});
