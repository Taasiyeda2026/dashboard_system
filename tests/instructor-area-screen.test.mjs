import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { instructorCalendarScreen } from '../frontend/src/screens/instructor-calendar.js';
import { myDataScreen } from '../frontend/src/screens/my-data.js';
import { instructorCompletionApprovalsScreen } from '../frontend/src/screens/instructor-completion-approvals.js';

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
  const ui = { openDrawer(payload) { opened.push(payload); drawer.innerHTML = payload.content; } };
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
  assert.match(html, /בחירת קובץ \/ העלאה/);
  assert.match(html, /instr-status--missing/);
});
