import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { instructorCalendarScreen } from '../frontend/src/screens/instructor-calendar.js';
import { myDataScreen } from '../frontend/src/screens/my-data.js';
import { instructorGuidelinesScreen } from '../frontend/src/screens/instructor-guidelines.js';
import { instructorCompletionApprovalsScreen } from '../frontend/src/screens/instructor-completion-approvals.js';
import { resolveInstructorApprovalForRow, openInstructorApprovalForActivity, activityDetailHtml, contactGroupsByDateSchool, findCompletionUploadForRow } from '../frontend/src/screens/instructor-utils.js';

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
  assert.match(main, /return \['instructor-calendar', 'my-data', 'instructor-completion-approvals', 'instructor-guidelines'\]/);
  assert.match(api, /instructor: \['instructor-calendar', 'my-data', 'instructor-completion-approvals', 'instructor-guidelines'\]/);
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
  assert.match(opened.at(-1).content, /מי נמצא איתי/g);
});

test('my activities table has instructor filters and detail-only row action', () => {
  const html = myDataScreen.render({ rows: [row], teamGroups }, { state });
  assert.match(html, /הפעילויות שלי/);
  assert.match(html, /חיפוש לפי בית ספר \/ פעילות \/ רשות/);
  assert.match(html, /תאריך/);
  assert.match(html, /instr-table-row/);
  assert.match(html, /data-row-detail/);
  assert.match(html, /<th class="instr-col-action">פעולה<\/th>/);
  assert.doesNotMatch(html, /data-row-print/);
  assert.doesNotMatch(html, /data-row-upload/);
  assert.doesNotMatch(html, />שדה</);
});



test('completion approvals load requests rows with closed activities included', async () => {
  const calls = [];
  const data = await instructorCompletionApprovalsScreen.load({
    api: {
      myData: async (params) => {
        calls.push(params);
        return { rows: [row] };
      },
      completionApprovalUploads: async () => ({ rows: [] })
    }
  });

  assert.deepEqual(calls, [{ includeClosedForApprovals: true }]);
  assert.deepEqual(data.rows, [row]);
});

test('calendar and my activities also request rows with closed activities included', async () => {
  const calendarCalls = [];
  const myDataCalls = [];
  const calendarData = await instructorCalendarScreen.load({
    api: {
      myData: async (params) => { calendarCalls.push(params); return { rows: [row], teamGroups }; },
      completionApprovalUploads: async () => ({ rows: [] }),
      photoApprovalUploads: async () => ({ rows: [] })
    }
  });
  const myDataData = await myDataScreen.load({
    api: {
      myData: async (params) => { myDataCalls.push(params); return { rows: [row], teamGroups }; },
      completionApprovalUploads: async () => ({ rows: [] }),
      photoApprovalUploads: async () => ({ rows: [] })
    }
  });

  assert.deepEqual(calendarCalls, [{ includeClosedForApprovals: true }]);
  assert.deepEqual(myDataCalls, [{ includeClosedForApprovals: true }]);
  assert.deepEqual(calendarData.rows, [row]);
  assert.deepEqual(myDataData.rows, [row]);
});

test('a closed activity assigned to the instructor still renders on calendar and my activities', () => {
  const todayIso = new Date().toISOString().slice(0, 10);
  const closedRow = { ...row, RowID: 'closed-r1', status: 'סגור', start_date: todayIso, activity_date: todayIso };

  const calendarHtml = instructorCalendarScreen.render({ rows: [closedRow], teamGroups, uploads: [] }, { state });
  const calendarDom = new JSDOM(`<main id="root">${calendarHtml}</main>`);
  const dayBtn = calendarDom.window.document.querySelector(`[data-calendar-day="${todayIso}"]`);
  assert.ok(dayBtn, 'closed activity day should render as an active calendar cell');
  assert.match(dayBtn.className, /has-activity/);
  assert.equal(dayBtn.hasAttribute('disabled'), false);

  const myDataHtml = myDataScreen.render({ rows: [closedRow], teamGroups }, { state });
  assert.match(myDataHtml, /data-row-id="closed-r1"/);
});

test('signed URL storage failure does not override approved status on instructor screens', () => {
  const missingStorageUpload = {
    activity_row_id: 'r1',
    instructor_emp_id: '1525',
    activity_date: '2026-06-21',
    authority: 'קריית שמונה',
    school: 'מגנים',
    status: 'approved',
    file_path: 'completion-approvals/1525/r1/file.pdf',
    file_name: 'signed-approval.pdf',
    storage_exists: false,
    storage_status: 'missing'
  };

  const approvalsHtml = instructorCompletionApprovalsScreen.render({ rows: [row], uploads: [missingStorageUpload] }, { state });
  assert.match(approvalsHtml, />אושר/);
  assert.match(approvalsHtml, /instr-status--approved/);
  assert.doesNotMatch(approvalsHtml, /הקובץ חסר באחסון/);

  const todayIso = new Date().toISOString().slice(0, 10);
  const todayRow = { ...row, start_date: todayIso, activity_date: todayIso };
  const todayUpload = { ...missingStorageUpload, activity_date: todayIso };
  const calendarHtml = instructorCalendarScreen.render({ rows: [todayRow], teamGroups, uploads: [todayUpload] }, { state });
  assert.match(calendarHtml, /אושר/);
  assert.match(calendarHtml, /instr-status--approved/);

  const myDataHtml = myDataScreen.render({ rows: [row], teamGroups, uploads: [missingStorageUpload] }, { state });
  assert.match(myDataHtml, />אושר/);
  assert.match(myDataHtml, /instr-status--approved/);
  assert.doesNotMatch(myDataHtml, /הקובץ חסר באחסון/);
});

test('completion upload matching prefers activity_row_id and never mixes same-day/school activities', () => {
  const rowA = { ...row, RowID: 'r1' };
  const rowB = { ...row, RowID: 'r2', activity_name: 'פעילות שנייה' };
  const uploadForB = {
    activity_row_id: 'r2',
    instructor_emp_id: '1525',
    activity_date: '2026-06-21',
    authority: 'קריית שמונה',
    school: 'מגנים',
    status: 'uploaded',
    file_path: 'completion-approvals/1525/r2/file.pdf'
  };

  assert.equal(findCompletionUploadForRow(rowA, [uploadForB]), null);
  assert.deepEqual(findCompletionUploadForRow(rowB, [uploadForB]), uploadForB);
});

test('completion upload matching falls back to date+authority+school only for legacy uploads without activity_row_id', () => {
  const legacyUpload = {
    activity_date: '2026-06-21',
    authority: 'קריית שמונה',
    school: 'מגנים',
    status: 'uploaded',
    file_path: 'completion-approvals/legacy/file.pdf'
  };
  assert.deepEqual(findCompletionUploadForRow(row, [legacyUpload]), legacyUpload);
});

test('completion approvals keeps closed summer workshop printable and shows existing upload', () => {
  const closedRow = { ...row, status: 'סגור' };
  const upload = {
    activity_date: '2026-06-21',
    authority: 'קריית שמונה',
    school: 'מגנים',
    status: 'uploaded',
    file_path: 'completion-approvals/1525/r1/file.pdf',
    file_name: 'signed-approval.pdf'
  };

  const html = instructorCompletionApprovalsScreen.render({ rows: [closedRow], uploads: [upload] }, { state });

  assert.match(html, /signed-approval\.pdf/);
  assert.match(html, /instr-status--uploaded/);
  assert.match(html, /data-approval-key=/);
  assert.match(html, />הדפסה</);
  assert.doesNotMatch(html, /לא נמצאו אישורי ביצוע/);
});

test('completion approvals page keeps upload controls compact with pick and plus buttons', () => {
  const html = instructorCompletionApprovalsScreen.render({ rows: [row], uploads: [] }, { state });
  assert.match(html, /ממתינים להעלאה/);
  assert.match(html, /instr-btn-pick/);
  assert.match(html, /instr-btn-plus/);
  assert.match(html, /instr-file-input-hidden/);
  assert.match(html, /title="העלאת אישור ביצוע"/);
  assert.match(html, /instr-status--missing/);
  assert.doesNotMatch(html, /לא נבחר קובץ/);
  assert.doesNotMatch(html, /בחירת קובץ/);
  assert.doesNotMatch(html, /data-upload-key/);
  assert.doesNotMatch(html, />העלאה</);
});


test('completion approvals shows and opens view button for existing instructor upload', async () => {
  const upload = {
    activity_date: '2026-06-21',
    authority: 'קריית שמונה',
    school: 'מגנים',
    status: 'uploaded',
    file_path: 'completion-approvals/1525/r1/file.pdf',
    file_name: 'signed-approval.pdf'
  };
  const html = instructorCompletionApprovalsScreen.render({ rows: [row], uploads: [upload] }, { state });
  assert.match(html, /signed-approval\.pdf/);
  assert.match(html, /data-view-file-path="completion-approvals\/1525\/r1\/file\.pdf"/);
  assert.match(html, />👁 צפייה<\/button>/);

  const dom = new JSDOM(`<main id="root">${html}</main>`, { url: 'https://example.test/' });
  const root = dom.window.document.querySelector('#root');
  const calls = [];
  const opened = [];
  const previousWindow = globalThis.window;
  const previousAlert = globalThis.alert;
  globalThis.window = dom.window;
  globalThis.alert = () => {};
  dom.window.open = (...args) => opened.push(args);
  try {
    instructorCompletionApprovalsScreen.bind({
      root,
      api: {
        completionApprovalSignedUrl: async (params) => {
          calls.push(params);
          return { signedUrl: 'https://files.example.test/signed.pdf' };
        }
      },
      state,
      rerender() {},
      clearScreenDataCache() {}
    });
    root.querySelector('[data-view-file-path]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.window = previousWindow;
    globalThis.alert = previousAlert;
  }

  assert.deepEqual(calls, [{ filePath: 'completion-approvals/1525/r1/file.pdf' }]);
  assert.deepEqual(opened, [['https://files.example.test/signed.pdf', '_blank', 'noopener']]);
});

test('completion approvals hides view button without file path and keeps rejected upload controls', () => {
  const uploadWithoutPath = {
    activity_date: '2026-06-21',
    authority: 'קריית שמונה',
    school: 'מגנים',
    status: 'uploaded',
    file_name: 'manager-upload.pdf'
  };
  const htmlWithoutPath = instructorCompletionApprovalsScreen.render({ rows: [row], uploads: [uploadWithoutPath] }, { state });
  assert.match(htmlWithoutPath, /manager-upload\.pdf/);
  assert.doesNotMatch(htmlWithoutPath, /data-view-file-path/);

  const rejectedUpload = { ...uploadWithoutPath, status: 'rejected', file_path: 'completion-approvals/1525/r1/rejected.pdf' };
  const rejectedHtml = instructorCompletionApprovalsScreen.render({ rows: [row], uploads: [rejectedUpload] }, { state });
  assert.match(rejectedHtml, /instr-btn-pick/);
  assert.match(rejectedHtml, /instr-btn-plus/);
  assert.doesNotMatch(rejectedHtml, /data-view-file-path/);
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


test('my activities detail drawer uses shared bind hook', () => {
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

test('my activities uses status-first columns and detail-only actions', () => {
  const html = myDataScreen.render({ rows: [row], teamGroups }, { state });
  assert.match(html, /<th class="instr-col-completion-approval-status">סטטוס<\/th><th class="instr-col-start-date">תאריך<\/th>/);
  assert.match(html, /type="date" data-instr-date/);
  assert.doesNotMatch(html, /type="month" data-instr-month/);
  assert.match(html, /data-instr-today/);
  assert.match(html, /data-instr-clear/);
  assert.doesNotMatch(html, /data-row-print/);
  assert.doesNotMatch(html, /data-row-upload/);
});


test('activity detail shows compact solo message when current instructor is assigned alone', () => {
  const soloRow = { ...row, emp_id_2: '', instructor_name_2: '' };
  const soloGroups = [{
    activity_date: '2026-06-21',
    school: 'מגנים',
    responsibleEmpId: '1525',
    responsibleName: 'אייל יוחאי',
    instructors: [{ name: 'אייל יוחאי', empId: '1525' }]
  }];

  const html = activityDetailHtml(soloRow, { ids: ['1525'], teamMap: contactGroupsByDateSchool(soloGroups) });

  assert.match(html, /מי נמצא איתי/);
  assert.match(html, /את\/ה משובץ\/ת לבד בפעילות זו/);
  assert.doesNotMatch(html, /אין מדריך נוסף/);
});

test('activity detail lists only additional instructors with available contact details', () => {
  const detailedGroups = [{
    activity_date: '2026-06-21',
    school: 'מגנים',
    responsibleEmpId: '1525',
    responsibleName: 'אייל יוחאי',
    instructors: [
      { name: 'אייל יוחאי', empId: '1525', phone: '050-1111111', role: 'מדריך' },
      { name: 'הילה רוזן', empId: '1502', phone: '050-2222222', role: 'מדריכה מובילה' }
    ]
  }];

  const html = activityDetailHtml(row, { ids: ['1525'], teamMap: contactGroupsByDateSchool(detailedGroups) });

  assert.match(html, /מי נמצא איתי/);
  assert.match(html, /הילה רוזן[\s\S]*050-2222222 · מדריכה מובילה/);
  assert.doesNotMatch(html, /אייל יוחאי[\s\S]*050-1111111 · מדריך/);
});

test('activity detail drawer is info-only without upload or print actions', () => {
  const html = activityDetailHtml(row, { ids: ['1525'], teamMap: contactGroupsByDateSchool(teamGroups) });
  assert.match(html, /סטטוס אישור ביצוע/);
  assert.match(html, /data-ui-close-drawer/);
  assert.doesNotMatch(html, /data-instr-print-current/);
  assert.doesNotMatch(html, /data-instr-nav-approvals/);
  assert.doesNotMatch(html, /העלאת אישור ביצוע/);
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

test('instructor guidelines screen renders summer 2026 title, intro grid, and eight topic cards', () => {
  const html = instructorGuidelinesScreen.render({}, { state });
  assert.match(html, /נהלי עבודה חשובים – קיץ 2026/);
  assert.match(html, /instr-guidelines__strip/);
  assert.match(html, /procedures-intro-grid/);
  assert.match(html, /procedures-intro-item/);
  assert.doesNotMatch(html, /instr-guidelines__checklist/);
  assert.match(html, /לוודא איש קשר/);
  assert.match(html, /להחתים ולהעלות אישור ביצוע/);
  assert.equal((html.match(/class="procedures-intro-item(?:"| )/g) || []).length, 9);
  assert.match(html, /instr-guidelines__grid/);
  assert.match(html, /data-guideline-id="before-day"/);
  assert.match(html, /data-guideline-id="conduct"/);
  assert.match(html, /לפני יום הפעילות/);
  assert.match(html, /הגעה, התארגנות ואיחורים/);
  assert.match(html, /אירועים חריגים ואישורים/);
  assert.match(html, /data-guideline-id="approval"/);
  assert.equal((html.match(/data-guideline-id="/g) || []).length, 8);
  assert.doesNotMatch(html, /data-guideline-detail/);
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /נהלים למדריכי הקיץ/);
});

test('guidelines modal uses compact centered width scoped to ds-modal--guidelines', () => {
  const css = readFileSync(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8');
  assert.match(css, /\.ds-modal\.ds-modal--guidelines\{[^}]*width:min\(84vw,520px\)/);
  assert.match(css, /\.ds-modal\.ds-modal--guidelines\{[^}]*max-width:520px/);
  assert.match(css, /\.ds-modal\.ds-modal--guidelines\{[^}]*transform:translate\(-50%,calc\(-50% \+ 16px\)\)/);
  assert.match(css, /\.ds-ui-layer\.is-modal-open \.ds-modal\.ds-modal--guidelines\{[^}]*width:min\(84vw,520px\)!important/);
  assert.match(css, /\.ds-ui-layer\.is-modal-open \.ds-modal\.ds-modal--guidelines\{[^}]*max-width:520px!important/);
  assert.match(css, /\.ds-ui-layer\.is-modal-open \.ds-modal\.ds-modal--guidelines\{[^}]*transform:translate\(-50%,-50%\)!important/);
  assert.match(css, /@media \(max-width:600px\)\{[^}]*\.ds-modal\.ds-modal--guidelines[^}]*width:calc\(100vw - 24px\)!important/);
  assert.doesNotMatch(css, /ds-modal--guidelines[^}]*max-width:680px/);
  assert.doesNotMatch(css, /ds-modal--guidelines[^}]*max-width:720px/);
});

test('instructor guidelines cards open modal with close and approval navigation', async () => {
  const html = instructorGuidelinesScreen.render({}, { state });
  const dom = new JSDOM(`<main id="root">${html}</main><nav><button class="shell-nav__btn" data-route="instructor-completion-approvals"></button></nav><div id="ds-shared-ui-layer" class="ds-ui-layer" dir="rtl">
    <div class="ds-ui-backdrop" data-ui-close-all hidden></div>
    <section class="ds-modal" aria-hidden="true" role="dialog" aria-modal="true">
      <header class="ds-modal__header"><h2 class="ds-modal__title"></h2><button type="button" data-ui-close-modal>✕</button></header>
      <div class="ds-modal__content"></div>
      <footer class="ds-modal__footer" hidden></footer>
    </section>
  </div>`, { url: 'https://example.test/' });
  const root = dom.window.document.querySelector('#root');
  const navBtn = dom.window.document.querySelector('[data-route="instructor-completion-approvals"]');
  let clicked = false;
  navBtn.addEventListener('click', () => { clicked = true; });
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.Element = dom.window.Element;
  try {
    const { createSharedInteractionLayer } = await import('../frontend/src/screens/shared/interactions.js');
    const ui = createSharedInteractionLayer();
    instructorGuidelinesScreen.bind({ root, ui });
    root.querySelector('[data-guideline-id="during"]').click();
    const modal = dom.window.document.querySelector('.ds-modal');
    const modalContent = dom.window.document.querySelector('.ds-modal__content');
    assert.equal(modal.classList.contains('ds-modal--guidelines'), true);
    assert.match(modalContent.innerHTML, /יש לשמור על יחס מכבד, סבלני ומקצועי\./);
    assert.match(dom.window.document.querySelector('.ds-modal__title').textContent, /3\. 🎯 במהלך הפעילות/);
    assert.equal(dom.window.document.querySelector('.ds-ui-layer').classList.contains('is-modal-open'), true);
    dom.window.document.querySelector('[data-ui-close-modal]').click();
    assert.equal(dom.window.document.querySelector('.ds-ui-layer').classList.contains('is-modal-open'), false);
    root.querySelector('[data-guideline-id="approval"]').click();
    dom.window.document.querySelector('[data-guidelines-go-approvals]').click();
    assert.equal(clicked, true);
    assert.equal(dom.window.document.querySelector('.ds-ui-layer').classList.contains('is-modal-open'), false);
  } finally {
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.Element;
  }
});

test('instructor shell includes bottom navigation for mobile', () => {
  const main = readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  assert.match(main, /instructorBottomNavHtml/);
  assert.match(main, /instructor-bottom-nav/);
  assert.match(main, /app-shell--instructor/);
  assert.match(main, /is-instructor-user/);
});

test('calendar renders mobile day list alongside desktop grid', () => {
  const html = instructorCalendarScreen.render({ rows: [row], teamGroups, uploads: [] }, { state });
  assert.match(html, /instr-calendar-desktop/);
  assert.match(html, /instr-calendar-mobile/);
  assert.match(html, /instr-cal-mobile-list/);
  assert.match(html, /data-calendar-day="2026-06-21"/);
});

test('my activities includes mobile card list alongside desktop table', () => {
  const html = myDataScreen.render({ rows: [row], teamGroups }, { state });
  assert.match(html, /instr-list-desktop/);
  assert.match(html, /instr-list-mobile/);
  assert.match(html, /instr-activity-list-card/);
  assert.match(html, /instr-table-row/);
});

test('completion approvals includes mobile card list alongside desktop table', () => {
  const html = instructorCompletionApprovalsScreen.render({ rows: [row], uploads: [] }, { state });
  assert.match(html, /instr-approvals-desktop/);
  assert.match(html, /instr-approvals-mobile/);
  assert.match(html, /execution-approvals-table-wrapper/);
  assert.match(html, /execution-approvals-mobile-cards/);
  assert.match(html, /instr-approval-card/);
  assert.match(html, /ds-table--instr-approvals2/);
});

test('completion approval mobile cards are hidden on desktop CSS', () => {
  const css = readFileSync(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8');
  assert.match(css, /\.execution-approvals-table-wrapper,\.approvals-table-wrapper\{display:block\}/);
  assert.match(css, /\.execution-approvals-mobile-cards,\.approvals-mobile-cards\{display:none\}/);
  assert.match(css, /\.instr-approvals-mobile\.instr-approval-cards\{display:none\}/);
  assert.match(css, /@media \(max-width:768px\)\{[\s\S]*\.execution-approvals-table-wrapper,\.approvals-table-wrapper\{display:none!important\}[\s\S]*\.execution-approvals-mobile-cards,\.approvals-mobile-cards\{display:block!important\}/);
});
