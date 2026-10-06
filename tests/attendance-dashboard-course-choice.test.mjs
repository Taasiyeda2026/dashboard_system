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
test('all meetings resolve automatically, preserving each source metadata and paid work', () => {
  const rows = fourRows.map((row, i) => ({ ...row, meeting_no: i + 1, start_time: `${8 + i * 2}:00`, end_time: `${10 + i * 2}:00` }));
  const resolved = resolveDashboardCourseChoice(buildDashboardCourseOptions(rows)[0], rows);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.activity.row_id, null);
  assert.equal(resolved.activity.meeting_no, null);
  assert.deepEqual(resolved.activity.__dashboardCourseSources, rows);
  assert.equal(resolved.activity.__dashboardCourseWork.totalHours, 10);
  assert.equal(resolved.activity.authority_id, 5);
});
test('legacy row hints locate a whole business activity, never discard other authorized sources', () => {
  const choice = buildDashboardCourseOptions(fourRows)[0];
  assert.equal(resolveDashboardCourseChoice(choice, fourRows, { activityRowId: 'c3' }).candidateRows.length, 4);
  assert.equal(resolveDashboardCourseChoice(choice, [fourRows[0]], { activityRowId: 'c3' }).status, 'unavailable');
});
test('simultaneous classes share instructional work without losing any source link', () => {
  const resolved = resolveDashboardCourseChoice(buildDashboardCourseOptions(fourRows)[0], fourRows);
  assert.equal(resolved.status, 'resolved');
  assert.equal(resolved.candidateRows.length, 4);
  assert.equal(resolved.activity.__dashboardCourseWork.totalHours, 2);
});
test('resolution uses the fresh snapshot, including one-time substitute ownership', () => {
  const original = { ...base, resolved_emp_id: 1 };
  const substitute = { ...base, row_id: 'sub', meeting_no: 4, resolved_emp_id: 2, assignment_kind: 'single_meeting_substitution' };
  const choice = buildDashboardCourseOptions([original, substitute])[0];
  assert.equal(resolveDashboardCourseChoice(choice, [substitute]).activity.row_id, 'sub');
  assert.equal(resolveDashboardCourseChoice(choice, []).status, 'unavailable');
});
test('missing schedule data is a source-data error, rather than multi-row ambiguity', () => {
  const rows = [{ ...base, start_time: null }, ...fourRows.slice(1)];
  assert.equal(resolveDashboardCourseChoice(buildDashboardCourseOptions(rows)[0], rows).status, 'invalid_schedule');
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
let meetingSchedules = new Map();
const client = {
  async rpc(name, args) {
    rpcCalls.push({ name, args });
    if (name === 'av2_get_current_instructor_activity_choices_for_date') {
      return failDashboard ? { error: { message: 'offline' } } : { data: dateRows.get(args.p_date) || [] };
    }
    if (name === 'av2_get_activity_meeting_dates') return {data:meetingSchedules.get(args.p_activity_row_id)||[]};
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
test('real picker shows one option for four rows and saves one business report without technical fields', async () => {
  await render(fourRows);
  const buttons = options();
  assert.equal(buttons.length, 1);
  assert.match(buttons[0].textContent, /ביומימיקרי — הרצל/);
  buttons[0].click(); await flush();
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].activity_row_id, null);
  assert.deepEqual(saved[0].course_business_identity, ['ביומימיקרי', ['id', '101']]);
  assert.equal(saved[0].total_hours, 2);
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
test('duplicated legacy course selects its entire business group without exposing rows', async () => {
  await render(fourRows, { activity_type: 'קורס', report_date: today, activity_row_id: 'c3', meeting_no: 3 });
  assert.match(document.getElementById('av2-activity-name-trigger').textContent, /ביומימיקרי — הרצל/);
  document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush();
  assert.equal(saved[0]?.activity_row_id, null);
  assert.ok(saved[0]?.course_business_identity);
});

test('Alex-shaped three adjacent meetings save all work without ambiguity or padding-overlap loss', async () => {
  const rows = [8,10,12].map((start,i) => ({...base,row_id:`school_2027_0${59-i}`,id:59-i,
    single_school_id:2648,meeting_no:i+2,start_time:`${String(start).padStart(2,'0')}:00`,end_time:`${start+2}:00`}));
  await render(rows); assert.equal(options().length,1); options()[0].click(); await flush();
  assert.equal(document.querySelector('.av2-report__hours-value').textContent,'7:30');
  document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await flush();
  assert.equal(saved.length,1);
  assert.equal(saved[0].total_hours,7.5);
  assert.equal(saved[0].start_time,'07:45'); assert.equal(saved[0].end_time,'14:15');
  assert.equal(saved[0].activity_row_id,null); assert.equal(saved[0].meeting_no,null);
  assert.deepEqual(saved[0].course_business_identity,['ביומימיקרי',['id','2648']]);
});
test('editing a saved business activity restores the group by business identity', async () => {
  await render(fourRows,{activity_type:'קורס',report_date:today,course_business_identity:['ביומימיקרי',['id','101']]});
  document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await flush();
  assert.equal(saved.length,1); assert.equal(saved[0].total_hours,2);
});
test('changed source hours or added meetings require refreshing the business choice before saving', async () => {
  await render(fourRows); options()[0].click(); await flush();
  dateRows.set(today,[...fourRows,{...base,row_id:'new',start_time:'11:00',end_time:'12:30'}]);
  document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); await flush();
  assert.equal(saved.length,0);
});

test('business duplication combines all source schedules and keeps immediate substituted dates visible', async () => {
  const {loadCourseSchedule}=await import('../attendance/src/duplicate-course-runtime.js');
  meetingSchedules=new Map([
    ['c1',[{meeting_no:1,date:'2026-10-01'},{meeting_no:2,date:'2026-10-08',assigned_to_current:false},{meeting_no:3,date:'2026-10-15'}]],
    ['c2',[{meeting_no:6,date:'2026-10-01'},{meeting_no:7,date:'2026-10-08',assigned_to_current:true}]],
  ]);
  const schedule=await loadCourseSchedule({emp_id:17,report_date:'2026-10-01',
    course_business_identity:['ביומימיקרי',['id','101']],course_dashboard_sources:[{row_id:'c1',meeting_no:1},{row_id:'c2',meeting_no:6}]});
  assert.deepEqual(schedule.map(item=>item.date),['2026-10-01','2026-10-08','2026-10-15']);
  assert.equal(schedule[1].assigned_to_current,true);
  meetingSchedules.get('c2')[1].assigned_to_current=false;
  const substituted=await loadCourseSchedule({emp_id:17,report_date:'2026-10-01',
    course_business_identity:['ביומימיקרי',['id','101']],course_dashboard_sources:[{row_id:'c1'},{row_id:'c2'}]});
  assert.equal(substituted[1].date,'2026-10-08'); assert.equal(substituted[1].assigned_to_current,false);
  assert.ok(substituted.every(item=>item.meeting_no===null));
});
