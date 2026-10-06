import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  buildDashboardCourseOptions, resolveDashboardCourseChoice, attendanceTimesFromActivity,
} from '../attendance/src/services/activities-report.helpers.js';

const base = {
  row_id: 'c1', id: 1, activity_name: 'ביומימיקרי', program_name: 'ביומימיקרי', activity_type: 'course',
  single_school_id: 101, single_school_name: 'הרצל', school_link_status: 'single_school',
  authority_id: 5, authority_name: 'תל אביב', single_semel_mosad: 123,
  meeting_no: 3, start_time: '08:30', end_time: '10:00', grade: 'ה', class_group: 'ה1',
  linked_schools_json: [],
};
const fourRows = Array.from({ length: 4 }, (_, i) => ({ ...base, row_id: `c${i + 1}`, id: i + 1, class_group: `ה${i + 1}` }));

test('four dashboard rows at the same course and school_id produce one business option', () => {
  const options = buildDashboardCourseOptions(fourRows);
  assert.equal(options.length, 1);
  assert.equal(options[0].label, 'ביומימיקרי — הרצל');
  assert.deepEqual(options[0].candidateRows, fourRows);
  assert.doesNotMatch(options[0].label + options[0].meta + options[0].searchText, /ה1|ה2|ה3|ה4|08:30|c1/);
  assert.ok(!fourRows.some(row => row.row_id === options[0].value));
});
test('same course at two schools remains two options', () => {
  assert.equal(buildDashboardCourseOptions([base, { ...base, row_id: 'c2', single_school_id: 102 }]).length, 2);
});
test('two different courses at one school remain two options', () => {
  assert.equal(buildDashboardCourseOptions([base, { ...base, row_id: 'c2', activity_name: 'רובוטיקה' }]).length, 2);
});
test('identical school names with different ids never merge', () => {
  assert.equal(buildDashboardCourseOptions([{ ...base, school_id: 1 }, { ...base, row_id: 'c2', school_id: 2 }]).length, 2);
});
test('school_id takes precedence and school names are a fallback only without ids', () => {
  const rows = [{ ...base, school_id: 7 }, { ...base, row_id: 'c2', school_id: 7, single_school_id: 9, single_school_name: 'שם מעודכן' }];
  assert.equal(buildDashboardCourseOptions(rows).length, 1);
  const fallback = [{ ...base, single_school_id: null }, { ...base, row_id: 'c2', single_school_id: null }];
  assert.equal(buildDashboardCourseOptions(fallback).length, 1);
  assert.equal(buildDashboardCourseOptions([...fallback, base]).length, 2);
});
test('meeting and dashboard work times resolve the exact candidate and preserve all its metadata', () => {
  const rows = fourRows.map((row, i) => ({ ...row, meeting_no: i + 1, start_time: `${8 + i}:30`, end_time: `${10 + i}:00` }));
  const choice = buildDashboardCourseOptions(rows)[0];
  const times = attendanceTimesFromActivity(rows[2], 'קורס');
  const resolved = resolveDashboardCourseChoice(choice, rows, { meetingNo: 3, ...times });
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.activity, rows[2]);
  assert.equal(resolved.activity.class_group, 'ה3');
  assert.equal(resolved.activity.authority_id, 5);
});
test('existing row identity resolves a duplicate/edit only when still authorized on that date', () => {
  const choice = buildDashboardCourseOptions(fourRows)[0];
  assert.equal(resolveDashboardCourseChoice(choice, fourRows, { activityRowId: 'c3' }).activity, fourRows[2]);
  assert.equal(resolveDashboardCourseChoice(choice, [fourRows[0]], { activityRowId: 'c3' }).status, 'unavailable');
});
test('genuine dashboard ambiguity and contradictory hints fail without choosing an arbitrary row', () => {
  const choice = buildDashboardCourseOptions(fourRows)[0];
  const unresolved = resolveDashboardCourseChoice(choice, fourRows);
  assert.equal(unresolved.status, 'ambiguous');
  assert.equal(unresolved.activity, null);
  assert.equal(resolveDashboardCourseChoice(choice, fourRows, { meetingNo: 99 }).status, 'unavailable');
});
test('resolution uses the fresh snapshot, including one-time substitute ownership', () => {
  const original = { ...base, resolved_emp_id: 1 };
  const substitute = { ...base, row_id: 'sub', meeting_no: 4, resolved_emp_id: 2, assignment_kind: 'single_meeting_substitution' };
  const choice = buildDashboardCourseOptions([original, substitute])[0];
  assert.equal(resolveDashboardCourseChoice(choice, [substitute]).activity, substitute);
  assert.equal(resolveDashboardCourseChoice(choice, []).status, 'unavailable');
});

const dom = new JSDOM('<main id="app"></main>', { url: 'https://example.test/attendance/' });
for (const name of ['window', 'document', 'HTMLElement', 'HTMLSelectElement', 'HTMLInputElement', 'MutationObserver', 'CustomEvent', 'Event', 'sessionStorage']) {
  globalThis[name] = dom.window[name];
}
globalThis.requestAnimationFrame = callback => callback();
const today = new Date().toISOString().slice(0, 10);
let dateRows = new Map([[today, [base]]]);
let historicalRows = fourRows;
let saved = [];
let rpcCalls = [];
let failDashboard = false;
const client = {
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'av2_get_current_instructor_activity_choices_for_date') {
      return failDashboard ? { error: { message: 'offline' } } : { data: dateRows.get(args.p_date) || [] };
    }
    if (name === 'av2_get_instructor_activities') return { data: historicalRows };
    if (name === 'av2_get_all_authority_school_list') return { data: [{ authority_id: 5, authority_name: 'תל אביב', schools: [{ id: 101, name: 'הרצל' }] }] };
    return { data: [] };
  },
  from(table) {
    let payload;
    const query = {
      select() { return query; }, eq() { return query; }, or() { return query; }, order() { return query; },
      insert(rows) { payload = rows[0]; return query; },
      maybeSingle() { return Promise.resolve({ data: table === 'attendance_month_approvals' ? { status: 'reopened' } : null }); },
      single() { saved.push(payload); return Promise.resolve({ data: { ...payload, id: 'saved' } }); },
      then(resolve) { resolve({ data: [] }); },
    };
    return query;
  },
  functions: { invoke: async () => ({ data: {} }) },
};
window.supabase = { createClient: () => client };
const { createDashboardCourseChoiceState } = await import('../attendance/src/course-dashboard-choice-runtime.js');
const { renderNewReportScreen } = await import('../attendance/src/screens/new-report-screen.js');
const { invalidateAttendanceCache } = await import('../attendance/src/services/attendance.service.js');
const flush = async () => { for (let i = 0; i < 15; i++) await new Promise(resolve => setImmediate(resolve)); };
function change(id, value) {
  const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('change', { bubbles: true }));
}
async function render(rows = [base], prefillRecord = null) {
  invalidateAttendanceCache();
  dateRows = new Map([[today, rows]]); rpcCalls = []; saved = []; failDashboard = false;
  renderNewReportScreen(document.getElementById('app'), { instructor: { empId: 17 }, defaultDate: today, prefillRecord });
  await flush();
  if (!prefillRecord) { change('av2-activity-type', 'קורס'); await flush(); }
}
// The picker panel is a sibling later in the wrapper; use its wrapper for DOM assertions.
function options() {
  document.getElementById('av2-activity-name-trigger').click();
  return [...document.getElementById('av2-activity-name-trigger').closest('.av2-ssel').querySelectorAll('.av2-ssel__option')];
}

test('changing dates invalidates selection, refreshes groups, and ignores a late earlier request', async () => {
  const pending = new Map();
  const state = createDashboardCourseChoiceState(date => new Promise(resolve => pending.set(date, resolve)));
  const old = state.load('2026-10-01');
  const current = state.load('2026-10-02');
  pending.get('2026-10-02')([base]);
  await current;
  state.select(state.options[0].value);
  pending.get('2026-10-01')(fourRows);
  assert.equal(await old, null);
  assert.equal(state.date, '2026-10-02');
  assert.equal(state.rows.length, 1);
  state.invalidate();
  assert.equal(state.choice, null);
  assert.deepEqual(state.options, []);
});
test('real picker shows one option for four rows and refuses an ambiguous save without technical fields', async () => {
  await render(fourRows);
  const buttons = options();
  assert.equal(buttons.length, 1);
  assert.match(buttons[0].textContent, /ביומימיקרי — הרצל/);
  buttons[0].click(); await flush();
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(saved.length, 0);
  assert.match(document.querySelector('.av2-report__error').textContent, /שיוך חד־משמעי/);
  assert.doesNotMatch(document.querySelector('form').textContent, /כיתה|ה1|ה2|ה3|ה4|row_id/);
});
test('real grouped selection saves exact dashboard row, meeting, school, authority and paid course times', async () => {
  const actual = { ...base, row_id: 'substitute', id: 99, meeting_no: 8, start_time: '11:00', end_time: '12:30' };
  await render([actual]);
  options()[0].click(); await flush();
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].activity_row_id, 'substitute');
  assert.equal(saved[0].activity_id, 99);
  assert.equal(saved[0].meeting_no, 8);
  assert.equal(saved[0].school_id, 101);
  assert.equal(saved[0].authority_id, 5);
  assert.equal(saved[0].start_time, '10:45');
  assert.equal(saved[0].end_time, '12:45');
});
test('real date change clears old choice and course extended search never queries the global catalog', async () => {
  await render([base]); options()[0].click(); await flush();
  const previous = new Date(); previous.setDate(previous.getDate() - 1);
  const previousDate = previous.toISOString().slice(0, 10);
  dateRows.set(previousDate, [{ ...base, row_id: 'other', activity_name: 'רובוטיקה' }]);
  change('av2-report-date', previousDate); await flush();
  assert.doesNotMatch(document.getElementById('av2-activity-name-trigger').textContent, /ביומימיקרי/);
  const buttons = options(); assert.equal(buttons.length, 1); assert.match(buttons[0].textContent, /רובוטיקה/);
  const picker = document.getElementById('av2-activity-name-trigger').closest('.av2-ssel');
  assert.ok(picker.querySelector('.av2-ssel__extended'));
  picker.querySelector('.av2-ssel__extended').click(); await flush();
  assert.ok(!rpcCalls.some(call => call.name === 'av2_search_canonical_activities'));
});
test('lost assignment or failed fresh dashboard validation blocks save', async () => {
  await render([base]); options()[0].click(); await flush();
  dateRows.set(today, []);
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(saved.length, 0);
  failDashboard = true;
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(saved.length, 0);
});
test('duplicated course resolves its existing internal identity inside a group without exposing rows', async () => {
  await render(fourRows, { activity_type: 'קורס', report_date: today, activity_row_id: 'c3', meeting_no: 3 });
  assert.match(document.getElementById('av2-activity-name-trigger').textContent, /ביומימיקרי — הרצל/);
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(saved[0]?.activity_row_id, 'c3');
});
