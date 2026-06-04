import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import { personalReportsScreen } from '../frontend/src/screens/personal-reports.js';

function mountWithUser(user) {
  const dom = new JSDOM('<main id="screenRoot"></main>', { url: 'https://example.test/' });
  global.document = dom.window.document;
  global.CustomEvent = dom.window.CustomEvent;
  const root = dom.window.document.getElementById('screenRoot');
  root.innerHTML = personalReportsScreen.render({}, { state: { user } });
  personalReportsScreen.bind({ root, state: { user } });
  return { dom, root };
}

test('personal reports uses dashboard user and never renders an internal login form', () => {
  const { root } = mountWithUser({ full_name: 'עובד רגיל', display_role: 'instructor', user_id: '' });

  assert.equal(root.querySelector('#pr-login-form'), null);
  assert.equal(root.querySelector('#pr-email'), null);
  assert.equal(root.querySelector('#pr-pass'), null);
  assert.match(root.textContent, /דוחות אישיים/);
  assert.match(root.textContent, /הוצאות, נסיעות ודיווח שכר חודשי/);
});

test('regular employee sees the three compact report tabs inside a card', () => {
  const { root } = mountWithUser({ full_name: 'עובד רגיל', display_role: 'instructor', user_id: '' });

  const card = root.querySelector('.pr-card.pr-month-selector-card');
  assert.ok(card, 'employee content should be wrapped in the personal reports card');

  const tabs = [...card.querySelectorAll('.pr-quick-tabs .pr-report-tab')].map((btn) => btn.textContent.trim());
  assert.deepEqual(tabs, ['הוצאות', 'נסיעות', 'דיווח שכר']);
});

test('admin starts in my reports mode with mode tabs and employee report tabs', () => {
  const { root } = mountWithUser({ full_name: 'מנהלת מערכת', display_role: 'admin', user_id: '' });

  const modes = [...root.querySelectorAll('.pr-admin-mode-switch .pr-report-tab')].map((btn) => btn.textContent.trim());
  assert.deepEqual(modes, ['הדוחות שלי', 'ניהול דוחות עובדים']);

  const quickTabs = [...root.querySelectorAll('.pr-quick-tabs .pr-report-tab')].map((btn) => btn.textContent.trim());
  assert.deepEqual(quickTabs, ['הוצאות', 'נסיעות', 'דיווח שכר']);
});

test('management mode has a styled placeholder and source contains no login inputs', async () => {
  const source = await readFile(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');

  assert.match(source, /function adminManagePlaceholderHtml/);
  assert.match(source, /ניהול דוחות עובדים/);
  assert.doesNotMatch(source, /id="pr-email"|id="pr-pass"|id="pr-login-form"|מייל עבודה|שכחתי סיסמה/);
});
