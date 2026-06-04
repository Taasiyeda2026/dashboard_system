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

test('personal reports renders only the internal employee login when no employee UUID exists', () => {
  const { root } = mountWithUser({ full_name: 'עובד רגיל', display_role: 'instructor', user_id: '8000' });

  assert.ok(root.querySelector('#pr-internal-login-form'));
  assert.ok(root.querySelector('#pr-employee-code'));
  assert.ok(root.querySelector('#pr-internal-access-code'));
  assert.equal(root.querySelector('#pr-login-form'), null);
  assert.equal(root.querySelector('#pr-email'), null);
  assert.equal(root.querySelector('#pr-pass'), null);
  assert.match(root.textContent, /התחברות פנימית לעובדים/);
  assert.match(root.textContent, /כניסה מאובטחת לצפייה בדוחות האישיים שלך/);
});

test('regular employee with a resolved UUID sees the three compact report tabs inside a card', () => {
  const { root } = mountWithUser({ full_name: 'עובד רגיל', display_role: 'instructor', user_id: '8000', auth_user_id: EMPLOYEE_UUID });

  const card = root.querySelector('.pr-card.pr-month-selector-card');
  assert.ok(card, 'employee content should be wrapped in the personal reports card');

  const tabs = [...card.querySelectorAll('.pr-quick-tabs .pr-report-tab')].map((btn) => btn.textContent.trim());
  assert.deepEqual(tabs, ['הוצאות', 'נסיעות', 'דיווח שכר']);
});

test('admin with a resolved UUID starts in my reports mode with mode tabs and employee report tabs', () => {
  const { root } = mountWithUser({ full_name: 'מנהלת מערכת', display_role: 'admin', user_id: 'admin', auth_user_id: ADMIN_UUID });

  const modes = [...root.querySelectorAll('.pr-admin-mode-switch .pr-report-tab')].map((btn) => btn.textContent.trim());
  assert.deepEqual(modes, ['הדוחות שלי', 'ניהול דוחות עובדים']);

  const quickTabs = [...root.querySelectorAll('.pr-quick-tabs .pr-report-tab')].map((btn) => btn.textContent.trim());
  assert.deepEqual(quickTabs, ['הוצאות', 'נסיעות', 'דיווח שכר']);
});

test('source keeps internal auth scoped to personal reports and maps code to auth UUID before report queries', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /function internalEmployeeLoginHtml/);
  assert.match(source, /function authenticateInternalEmployee/);
  assert.match(source, /auth\.signInWithPassword/);
  assert.match(source, /authUserId = authData\.user\.id/);
  assert.match(source, /assertEmployeeUuid\(employeeId\)/);
  assert.match(source, /התחברות פנימית לעובדים/);
  assert.doesNotMatch(source, /id="pr-email"|id="pr-pass"|מייל עבודה|שכחתי סיסמה/);
});
