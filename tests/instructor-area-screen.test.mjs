import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { instructorCalendarScreen } from '../frontend/src/screens/instructor-calendar.js';
import { myDataScreen } from '../frontend/src/screens/my-data.js';
import { instructorCompletionApprovalsScreen } from '../frontend/src/screens/instructor-completion-approvals.js';
import { resolveInstructorApprovalForRow, openInstructorApprovalForActivity } from '../frontend/src/screens/instructor-utils.js';

const row = {
  RowID: 'r1', start_date: '2026-06-21', activity_date: '2026-06-21', start_time: '08:00', end_time: '08:45',
  authority: 'קריית שמונה', school: 'מגנים', grade: 'כיתה ג׳', activity_name: 'נשכן מפרקים', activity_type: 'workshop', participants_count: 25,
  emp_id: '1525', instructor_name: 'אייל יוחאי', emp_id_2: '1502', instructor_name_2: 'הילה רוזן'
};
const state = { user: { role: 'instructor', emp_id: '1525', full_name: 'אייל יוחאי' }, clientSettings: {} };
const teamGroups = [{ activity_date: '2026-06-21', school: 'מגנים', responsibleEmpId: '1525', responsibleName: 'אייל יוחאי', instructors: [{ name: 'אייל יוחאי' }, { name: 'הילה רוזן' }] }];

test('instructor route source defaults to calendar and keeps admin routes separate', () => {
  const main = readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(main, /'instructor-calendar': 'לוח שנה'/);
  assert.match(main, /return \['instructor-calendar', 'my-data', 'instructor-completion-approvals'\]/);
  assert.match(api, /instructor: \['instructor-calendar', 'my-data', 'instructor-completion-approvals'\]/);
  assert.match(api, /admin: \['dashboard', 'activities'/);
});

test('calendar renders activity days and opens day then activity detail drawers', () => {
  const html = instructorCalendarScreen.render({ rows: [row], teamGroups, uploads: [] }, { state });
  assert.match(html, /לוח השנה שלי/);
  assert.match(html, /חסר אישור/);
  const dom = new JSDOM(`<main id="root">${html}</main><aside id="drawer"></aside>`);
  const root = dom.window.document.querySelector('#root');
  const drawer = dom.window.document.querySelector('#drawer');
  const opened = [];
  const ui = { openDrawer(payload) { opened.push(payload); drawer.innerHTML = payload.content; payload.onOpen?.(drawer); } };
  instructorCalendarScreen.bind({ root, data: { rows: [row], teamGroups, uploads: [] }, ui, state, rerender() {} });
  root.querySelector('[data-calendar-day="2026-06-21"]').click();
  assert.equal(opened.at(-1).title, 'פעילויות בתאריך 21/06/2026');
  assert.match(drawer.innerHTML, /אתה אחראי קשר ביום זה/);
  drawer.querySelector('[data-activity-detail="r1"]').click();
  assert.equal(opened.at(-1).title, 'פירוט פעילות');
  assert.match(opened.at(-1).content, /מי איתי היום/);
});

test('my activities table has instructor filters and real column labels', () => {
  const html = myDataScreen.render({ rows: [row], teamGroups }, { state });
  assert.match(html, /הפעילויות שלי/);
  assert.match(html, /חיפוש לפי בית ספר \/ פעילות \/ רשות/);
  assert.match(html, /תאריך/);
  assert.doesNotMatch(html, />שדה</);
});

test('completion approvals page keeps upload controls compact and status chips visible', () => {
  const html = instructorCompletionApprovalsScreen.render({ rows: [row], uploads: [] }, { state });
  assert.match(html, /ממתינים להעלאה/);
  assert.match(html, /title="בחרו קובץ PDF \/ JPG \/ PNG להעלאה"/);
  assert.match(html, /instr-status--missing/);
});


test('activity detail print resolves the full instructor approval group instead of a single row', () => {
  const first = { ...row, RowID: 'r1', activity_name: 'פעילות בוקר', start_time: '08:00', end_time: '09:00' };
  const second = { ...row, RowID: 'r2', activity_name: 'פעילות המשך', start_time: '09:15', end_time: '10:15' };
  const otherSchool = { ...row, RowID: 'r3', school: 'תל חי', activity_name: 'בית ספר אחר' };

  const approval = resolveInstructorApprovalForRow(first, [first, second, otherSchool], 'אייל יוחאי');

  assert.equal(approval?.instructorName, 'אייל יוחאי');
  assert.equal(approval?.date, '2026-06-21');
  assert.equal(approval?.school, 'מגנים');
  assert.deepEqual(approval.activities.map((activity) => activity.name), ['פעילות בוקר', 'פעילות המשך']);
});


test('my activities detail print uses the shared approval resolver with all instructor rows', () => {
  const source = readFileSync(new URL('../frontend/src/screens/my-data.js', import.meta.url), 'utf8');
  assert.match(source, /bindActivityDetailActions\(contentNode, \{ ui, row: hit, rows, allInstructorRows: rows, teamMap, state \}\)/);
});

test('shared approval resolver falls back from profile name to activity instructor name', () => {
  const first = { ...row, RowID: 'r1', activity_name: 'פעילות בוקר', start_time: '08:00', end_time: '09:00' };
  const second = { ...row, RowID: 'r2', activity_name: 'פעילות המשך', start_time: '09:15', end_time: '10:15' };

  const approval = resolveInstructorApprovalForRow(first, [first, second], 'שם משתמש שונה');

  assert.equal(approval?.instructorName, 'אייל יוחאי');
  assert.deepEqual(approval.activities.map((activity) => activity.name), ['פעילות בוקר', 'פעילות המשך']);
});

test('shared activity print helper returns the same grouped approval calendar and my activities use', () => {
  const first = { ...row, RowID: 'r1', activity_name: 'פעילות בוקר', start_time: '08:00', end_time: '09:00' };
  const second = { ...row, RowID: 'r2', activity_name: 'פעילות המשך', start_time: '09:15', end_time: '10:15' };
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/' });
  const alerts = [];
  globalThis.window = { open: () => null };
  globalThis.alert = (message) => alerts.push(message);
  globalThis.document = dom.window.document;
  try {
    const approval = openInstructorApprovalForActivity(first, { state: { user: { emp_id: '1525', full_name: 'שם משתמש שונה' } }, allInstructorRows: [first, second] });
    assert.equal(approval?.school, 'מגנים');
    assert.deepEqual(approval.activities.map((activity) => activity.name), ['פעילות בוקר', 'פעילות המשך']);
    assert.deepEqual(alerts, ['לא ניתן לפתוח חלון הדפסה. יש לאפשר חלונות קופצים בדפדפן.']);
  } finally {
    delete globalThis.window;
    delete globalThis.alert;
    delete globalThis.document;
  }
});

test('my activities uses status-first columns and daily date filtering controls', () => {
  const html = myDataScreen.render({ rows: [row], teamGroups }, { state });
  assert.match(html, /<th class="instr-col-completion-approval-status">סטטוס<\/th><th class="instr-col-start-date">תאריך<\/th>/);
  assert.match(html, /type="date" data-instr-date/);
  assert.doesNotMatch(html, /type="month" data-instr-month/);
  assert.match(html, /data-instr-today/);
  assert.match(html, /data-instr-clear/);
  assert.match(html, /data-row-print/);
  assert.match(html, /data-row-upload/);
});

test('my activities daily filter, today, and clear buttons update visible rows', () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayRow = { ...row, RowID: 'today-row', start_date: todayIso, activity_date: todayIso, school: 'היום' };
  const otherRow = { ...row, RowID: 'other-row', start_date: '2026-06-22', activity_date: '2026-06-22', school: 'מחר' };
  const html = myDataScreen.render({ rows: [todayRow, otherRow], teamGroups }, { state });
  const dom = new JSDOM(`<main id="root">${html}</main>`, { url: 'https://example.test/' });
  const root = dom.window.document.querySelector('#root');
  globalThis.document = dom.window.document;
  globalThis.sessionStorage = dom.window.sessionStorage;
  try {
    myDataScreen.bind({ root, data: { rows: [todayRow, otherRow], teamGroups }, ui: { openDrawer() {} }, state });
    const rows = [...root.querySelectorAll('[data-list-item]')];
    root.querySelector('[data-instr-date]').value = '2026-06-22';
    root.querySelector('[data-instr-date]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(rows.find((tr) => tr.dataset.rowId === 'today-row').hidden, true);
    assert.equal(rows.find((tr) => tr.dataset.rowId === 'other-row').hidden, false);
    root.querySelector('[data-instr-today]').click();
    assert.equal(root.querySelector('[data-instr-date]').value, todayIso);
    assert.equal(rows.find((tr) => tr.dataset.rowId === 'today-row').hidden, false);
    assert.equal(rows.find((tr) => tr.dataset.rowId === 'other-row').hidden, true);
    root.querySelector('[data-instr-clear]').click();
    assert.equal(root.querySelector('[data-instr-date]').value, '');
    assert.equal(rows.every((tr) => tr.hidden === false), true);
  } finally {
    delete globalThis.document;
    delete globalThis.sessionStorage;
  }
});
