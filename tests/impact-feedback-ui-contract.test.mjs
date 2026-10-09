import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterGroups, hasCourseStartDate, hasCourseEndDate, studentFeedbackPeriodForGroup, studentFeedbackHasResponses, sortStudentFeedbackGroups } from '../frontend/src/impact-feedback/feedback-domain.js';
import { COURSE_SCHEDULING_PERIODS } from '../frontend/src/screens/course-scheduling-periods.js';

const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261009162000_feedback_groups_activity_manager_filter.sql', import.meta.url), 'utf8');
const templates = readFileSync(new URL('../frontend/src/impact-feedback/feedback-templates-view.js', import.meta.url), 'utf8');
const publicPage = readFileSync(new URL('../frontend/src/impact-feedback/feedback-public.js', import.meta.url), 'utf8');
const shareUi = readFileSync(new URL('../frontend/src/impact-feedback/feedback-share.js', import.meta.url), 'utf8');

test('feedback year is taken from the dashboard, without an independent year selection', () => {
  assert.doesNotMatch(screen, /data-ifb-year|YEAR_OPTIONS/);
  assert.match(screen, /normalizeGlobalActivityPeriod\(state\?\.activityPeriodTab \|\| ACTIVE_ACTIVITY_SEASON\)/);
  assert.match(screen, /fetchGroups\(ui\.year\)|ensureGroups/);
});

test('all feedback tabs use one collapsed filter panel (including course), not an extra header filter', () => {
  assert.match(screen, /filterExpanded: \{ overview: false, students: false, staff: false, instructors: false, analysis: false, templates: false \}/);
  assert.match(screen, /filterDisclosureHtml\('overview'/);
  assert.match(screen, /filterDisclosureHtml\('analysis'/);
  assert.match(screen, /courseOnlyFiltersHtml\('templates'\)/);
  assert.match(screen, /\$\{courseFilterFieldHtml\(\)\}/);
  assert.doesNotMatch(screen, /filterDisclosureHtml\('global'/);
  const shell = screen.slice(screen.indexOf('function shellHtml('), screen.indexOf('function loadingHtml('));
  assert.doesNotMatch(shell, /\$\{courseFilter\}|data-ifb-course|data-ifb-filter-disclosure/);
  assert.match(screen, /ui\.filterExpanded\[scope\] \? ' open'/);
  assert.match(screen, /ui\.filterExpanded\.instructors \? ' open'/);
  assert.match(screen, /ui\.filterExpanded\[disclosure\.dataset\.ifbFilterDisclosure\] = !disclosure\.open/);
});

test('overview status is right aligned and its five audience columns are centered in heading and cells', () => {
  assert.match(screen, /<td data-label="מצב" class="ifb-col-state">/);
  assert.match(screen, /<th scope="col" class="ifb-col-state">מצב<\/th>/);
  assert.match(screen, /<th scope="col" class="ifb-col-audience ifb-center">/);
  assert.match(screen, /<td data-label="\$\{esc\(col\.label\)\}" class="ifb-col-audience ifb-center">/);
  assert.match(styles, /\.ifb-courses-table thead th\.ifb-col-state,/);
  assert.match(styles, /\.ifb-courses-table thead th\.ifb-col-audience,/);
  assert.match(styles, /\.ifb-courses-table tbody td\.ifb-col-audience \{[\s\S]*?text-align: center;/);
});

test('group manager filter applies to the actual activity manager, not the instructor', () => {
  const groups = [
    { row_id: '1', school: 'א', instructor_name: 'מורה א', activity_manager: 'מנהל צפון', campaigns: [] },
    { row_id: '2', school: 'ב', instructor_name: 'מורה א', activity_manager: 'מנהלת דרום', campaigns: [] },
    { row_id: '3', school: 'ג', instructor_name: 'מורה ב', activity_manager: 'מנהל צפון', campaigns: [] }
  ];
  assert.deepEqual(filterGroups(groups, { manager: 'מנהל צפון' }).map((r) => r.row_id), ['1', '3']);
  assert.deepEqual(filterGroups(groups, { manager: 'מנהל צפון', instructor: 'מורה ב' }).map((r) => r.row_id), ['3']);
  assert.equal(filterGroups(groups, { search: 'דרום' }).length, 1);
  assert.match(screen, /data-f="manager"/);
  assert.match(migration, /activity_manager text,/);
  assert.match(migration, /coalesce\(s\.j->>'activity_manager', ''\)/);
  assert.match(migration, /private\.feedback_is_admin\(\)/);
});

test('compact interface preserves named actions, statuses and accessibility', () => {
  assert.match(screen, /קבוצות ללא תשובות/);
  assert.match(screen, /לא הוגדר/);
  assert.match(screen, /title="העתקת קישור"/);
  assert.match(screen, /aria-label="שליחה במייל"/);
  assert.match(screen, /aria-label="ניתוח הקורס/);
  assert.match(styles, /border-inline-start: 1px solid var\(--ifb-a-divider\)/);
  assert.match(styles, /\.ifb-groups-table--staff\.ifb-groups-table--with-program/);
});

test('desktop and mobile layouts keep templates and filters usable without creating new UI flows', () => {
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.ifb-icon-actions/);
  assert.match(styles, /\.ifb-template-card__inner/);
  assert.match(screen, /data-ifb-filter-disclosure/);
});


test('students have two course dates with matching widths and centered feedback columns', () => {
  const groupTable = screen.slice(screen.indexOf('function groupsTableHtml('), screen.indexOf('function optionBarsHtml('));
  assert.match(groupTable, /scope === 'students' \? '<col class="ifb-gw-date ifb-gw-date--start">'/);
  assert.match(groupTable, /<col class="ifb-gw-date ifb-gw-date--end">/);
  assert.match(groupTable, /scope === 'students' \? '<th scope="col" class="ifb-center ifb-col-date">תחילת קורס<\/th>'/);
  assert.match(groupTable, /scope === 'students' \? 'סיום קורס' : 'סיום הקבוצה'/);
  assert.match(groupTable, /fmtDate\(g\.start_date\)/);
  assert.match(groupTable, /fmtDate\(g\.end_date\)/);
  assert.match(groupTable, /class="ifb-center ifb-col-stage">\$\{esc\(slot\.label\)\}/);
  assert.match(groupTable, /class="ifb-center ifb-col-stage" data-label="\$\{esc\(slot\.label\)\}"/);
  assert.match(styles, /\.ifb-groups-table--students col\.ifb-gw-date--start,\s*\.ifb-groups-table--students col\.ifb-gw-date--end \{ width: 11%; \}/);
  assert.match(styles, /\.ifb-groups-table--students\.ifb-groups-table--with-program col\.ifb-gw-date--start,\s*\.ifb-groups-table--students\.ifb-groups-table--with-program col\.ifb-gw-date--end \{ width: 10%; \}/);
  assert.match(styles, /\.ifb-groups-table--students thead th\.ifb-col-stage,/);
});

test('student table heading is gently colored without coloring every row or changing staff headings', () => {
  assert.match(styles, /\.ifb-groups-table--students thead th \{\s*background: color-mix\(/);
  assert.match(styles, /border-bottom: 2px solid color-mix\(/);
  assert.match(styles, /@media \(min-width: 761px\)/);
  assert.match(styles, /@media \(max-width: 760px\)/);
});


test('all feedback tables share a subtle highlighted header without losing comparison selection', () => {
  assert.match(styles, /\.ifb-admin \.ifb-table thead th \{\s*background: color-mix\(/);
  assert.match(styles, /\.ifb-admin \.ifb-table thead th \{[\s\S]*?font-weight: 700;/);
  assert.match(styles, /\.ifb-admin \.ifb-cross-table thead th\.is-selected \{/);
  for (const cls of ['ifb-courses-table', 'ifb-groups-table', 'ifb-instructor-table', 'ifb-q-table', 'ifb-prepost-table', 'ifb-cross-table']) {
    assert.match(screen, new RegExp('class="ifb-table ' + cls));
  }
});

test('every date header and date cell share the centered date class', () => {
  const groups = screen.slice(screen.indexOf('function groupsTableHtml('), screen.indexOf('function optionBarsHtml('));
  const instructor = screen.slice(screen.indexOf('function instructorAssignmentsHtml('), screen.indexOf('function instructorsHtml('));
  assert.match(groups, /<th scope="col" class="ifb-center ifb-col-date">/);
  assert.match(groups, /<td data-label="תחילת קורס" class="ifb-center ifb-nowrap ifb-col-date">/);
  assert.match(groups, /class="ifb-center ifb-nowrap ifb-col-date">\$\{fmtDate\(g\.end_date\)\}/);
  assert.match(instructor, /class="ifb-center ifb-col-date" title="תאריך ההתחלה המוקדם ביותר/);
  assert.match(instructor, /class="ifb-center ifb-col-date" title="תאריך הסיום המוקדם ביותר/);
  assert.match(instructor, /data-label="תחילת קורס ראשון" class="ifb-center ifb-nowrap ifb-col-date">\$\{fmtDate\(row\.first_start_date\)\}/);
  assert.match(instructor, /data-label="סיום קורס ראשון" class="ifb-center ifb-nowrap ifb-col-date">\$\{fmtDate\(row\.first_course_end_date\)\}/);
  assert.match(instructor, /class="ifb-center ifb-nowrap ifb-col-date">\$\{fmtDate\(row\.first_course_end_date\)\}/);
  assert.match(styles, /\.ifb-admin \.ifb-table thead th\.ifb-col-date,/);
  assert.match(styles, /\.ifb-admin \.ifb-table tbody td\.ifb-col-date,/);
});

test('actual status headings and values are right-aligned without changing stage columns', () => {
  const instructor = screen.slice(screen.indexOf('function instructorAssignmentsHtml('), screen.indexOf('function instructorsHtml('));
  assert.match(instructor, /<th scope="col" class="ifb-col-status">סטטוס<\/th>/);
  assert.match(instructor, /<td data-label="סטטוס" class="ifb-col-status">/);
  assert.match(screen, /<th scope="col" class="ifb-col-state">מצב<\/th>/);
  assert.match(styles, /\.ifb-admin \.ifb-table thead th\.ifb-col-status,/);
  assert.match(styles, /\.ifb-admin \.ifb-table tbody td\.ifb-col-status,/);
  assert.match(styles, /\.ifb-admin \.ifb-table thead th\.ifb-col-state,/);
  assert.match(styles, /\.ifb-admin \.ifb-table tbody td\.ifb-col-state \{\s*text-align: right;/);
  assert.match(screen, /class="ifb-center ifb-col-stage"/);
});

test('all five template controls remain centered and aligned with missing optional PDFs', () => {
  assert.match(styles, /\.ifb-template-card__inner \{\s*justify-items: center;/);
  assert.match(styles, /\.ifb-template-card__slots \{\s*width: min\(100%, 310px\);\s*margin-inline: auto;\s*justify-items: center;/);
  assert.match(styles, /\.ifb-template-card__slot \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 36px 27px 20px;/);
  assert.match(templates, /ifb-template-card__delete-placeholder/);
  assert.match(templates, /ifb-template-card__slots/);
  assert.match(styles, /\.ifb-template-card__delete-placeholder \{/);
});


test('student group visibility follows the canonical start date (including removal and addition)', () => {
  const course = { row_id: 'A', start_date: null };
  assert.equal(hasCourseStartDate(course), false);
  assert.equal(hasCourseStartDate({ ...course, start_date: '' }), false);
  assert.equal(hasCourseStartDate({ ...course, start_date: '2026-02-30' }), false);
  assert.equal(hasCourseStartDate({ ...course, start_date: '2026-10-19' }), true);
  assert.equal(hasCourseStartDate({ ...course, start_date: '2026-10-26' }), true);
  assert.equal(hasCourseStartDate({ ...course, start_date: null }), false);
  assert.equal(hasCourseStartDate({ row_id: 'new', start_date: '2027-01-04' }), true);
});

test('student table filters groups without start dates without hiding staff groups or erasing answers', () => {
  const table = screen.slice(screen.indexOf('function groupsTableHtml('), screen.indexOf('function optionBarsHtml('));
  assert.match(table, /scope === 'students'\s*\? courseScopedGroups\(\)\.filter\(hasCourseStartDate\)/);
  assert.match(table, /: courseScopedGroups\(\);/);
  assert.match(table, /fmtDate\(g\.start_date\)/);
  assert.match(table, /fmtDate\(g\.end_date\)/);
  assert.match(table, /בלשונית תלמידים מוצגות רק קבוצות שנקבע להן תאריך התחלה בכל הפעילויות/);
  assert.doesNotMatch(table, /updateCampaign|delete.*feedback_campaigns/);
});

test('feedback uses fresh activity data on entry and while active without a duplicate date store', () => {
  assert.match(screen, /load\(host, \{ force: true \}\)/);
  assert.match(screen, /async function ensureGroups\(force = false\)/);
  assert.match(screen, /ui\.groups = await fetchGroups\(ui\.year\)/);
  assert.match(screen, /ACTIVITY_SYNC_INTERVAL_MS = 60 \* 1000/);
  assert.match(screen, /const groups = await fetchGroups\(year\)/);
  assert.match(screen, /window\.addEventListener\('focus', check/);
  assert.match(screen, /document\.addEventListener\('visibilitychange'/);
  assert.match(screen, /window\.addEventListener\('israa-activities-changed'/);
  assert.match(screen, /if \(JSON\.stringify\(groups\) !== JSON\.stringify\(ui\.groups\)\)/);
  assert.match(screen, /if \(!host\.isConnected\) \{/);
  assert.match(screen, /activitySyncController\?\.abort\(\)/);
  assert.match(screen, /installActivityDateSync\(host\)/);
  assert.match(screen, /\['students', 'staff', 'instructors'\]\.includes\(ui\.tab\)/);
  assert.match(screen, /const assignments = await fetchInstructorAssignments\(year\)/);
  assert.match(screen, /ui\.instructorAssignments = assignments/);
});


test('group management shows activity data as read-only identity, without a course assignment UI', () => {
  const group = screen.slice(screen.indexOf('function groupViewHtml(group)'), screen.indexOf('// Export', screen.indexOf('function groupViewHtml(group)')));
  assert.match(group, /const activityTitle = group\.activity_name \|\|/);
  assert.match(group, /<h2 class="ifb-group-head__title">\$\{esc\(group\.school/);
  assert.match(group, /<p class="ifb-group-head__program">\$\{esc\(activityTitle\)\}<\/p>/);
  assert.match(group, /<dt>רשות<\/dt>/);
  assert.match(group, /<dt>מדריך\/ה<\/dt>/);
  assert.match(group, /<dt>איש\/אשת קשר<\/dt>/);
  assert.match(group, /<dt>תחילת קורס<\/dt>/);
  assert.match(group, /<dt>סיום קורס<\/dt>/);
  assert.match(group, /fmtDate\(group\.start_date\)/);
  assert.match(group, /fmtDate\(group\.end_date\)/);
  assert.doesNotMatch(group, /שנת לימודים|academicYearLabel|programCardHtml|data-ifb-set-program/);
  assert.doesNotMatch(screen, /programQuickPickHtml|programCardHtml|data-ifb-set-program|data-ifb-program-auto|data-ifb-program-exclude|setActivityProgram|programOptionsHtml/);
});

test('missing feedback templates are handled internally without exposing course selection', () => {
  assert.match(screen, /ממתין להתאמת משוב/);
  assert.match(screen, /לתוכנית זו טרם הותאמה תבנית משוב/);
  assert.match(screen, /if \(!group\.program_key\)/);
  assert.doesNotMatch(screen, /בחירת קורס ידנית|שמירת קורס|חזרה לזיהוי אוטומטי/);
  assert.match(screen, /visibleSlots\.map\(\(slot\) => slotCardHtml\(group, slot\)\)/);
  assert.match(screen, /const visibleSlots = staffView \? GROUP_SLOTS\.filter\(\(slot\) => slot\.audience === 'educational_staff'\) : GROUP_SLOTS;/);
});

test('group identity has one heading and a responsive, compact metadata grid', () => {
  assert.match(styles, /\.ifb-group-head__identity \{[\s\S]*?border-bottom: 1px solid var\(--ifb-a-divider\)/);
  assert.match(styles, /\.ifb-meta--head \{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /\.ifb-group-head__date dt,\s*\.ifb-group-head__date dd \{/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.ifb-meta--head \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});


test('student feedback reuses the scheduling-board dates and allocates each started group to one half', () => {
  assert.equal(COURSE_SCHEDULING_PERIODS.first.start, '2026-09-01');
  assert.equal(COURSE_SCHEDULING_PERIODS.first.end, '2027-01-29');
  assert.equal(COURSE_SCHEDULING_PERIODS.second.start, '2027-01-31');
  assert.equal(COURSE_SCHEDULING_PERIODS.second.end, '2027-06-30');
  const cases = [
    [null, null], ['2026-08-31', null], ['2026-09-01', 'first'],
    ['2027-01-29', 'first'], ['2027-01-30', 'first'],
    ['2027-01-31', 'second'], ['2027-06-30', 'second'],
    ['2027-07-01', null]
  ];
  for (const [start_date, expected] of cases) {
    assert.equal(studentFeedbackPeriodForGroup({ start_date }), expected, String(start_date));
  }
  assert.equal(studentFeedbackPeriodForGroup({
    start_date: '2027-01-20',
    end_date: '2027-02-22'
  }), 'first', 'a first-half course that ends in February must not move to second half');
  assert.equal(studentFeedbackPeriodForGroup({ start_date: '2027-01-31' }), 'second');
});

test('student list is sorted by course start date with groups already answered at the bottom', () => {
  const group = (row_id, start_date, responses = 0, audience = 'student') => ({
    row_id, school: row_id, start_date,
    campaigns: responses ? [{ audience, stage: 'pre', responses }] : []
  });
  const groups = [
    group('answered-early', '2026-09-02', 11),
    group('upcoming-late', '2026-12-12'),
    group('upcoming-early', '2026-10-12'),
    group('answered-later', '2026-11-01', 1),
    group('staff-responded', '2026-10-20', 1, 'educational_staff')
  ];
  assert.deepEqual(sortStudentFeedbackGroups(groups).map((g) => g.row_id), [
    'upcoming-early', 'staff-responded', 'upcoming-late',
    'answered-early', 'answered-later'
  ]);
  assert.equal(studentFeedbackHasResponses(groups[0]), true);
  assert.equal(studentFeedbackHasResponses(groups[4]), false);
  assert.equal(studentFeedbackHasResponses(group('opened-no-answers', '2026-09-02')), false);
});

test('student and staff tabs have exclusive, independent semester selectors sourced from scheduling', () => {
  const table = screen.slice(screen.indexOf('function groupSemesterTabsHtml('), screen.indexOf('function optionBarsHtml('));
  assert.match(screen, /studentHalf: 'first'/);
  assert.match(screen, /staffHalf: 'first'/);
  assert.match(table, /\{ key: 'first', label: "מחצית א׳" \}/);
  assert.match(table, /\{ key: 'second', label: "מחצית ב׳" \}/);
  assert.match(table, /data-ifb-group-half="\$\{key\}" data-ifb-group-scope="\$\{scope\}"/);
  assert.match(table, /aria-pressed="\$\{selectedHalf === key\}"/);
  assert.match(table, /studentFeedbackPeriodForGroup\(g\) === \(scope === 'staff' \? ui\.staffHalf : ui\.studentHalf\)/);
  assert.match(table, /groupSemesterTabsHtml\(all, scope\)/);
  assert.match(table, /groupFiltersHtml\(inHalf, scope\)/);
  assert.match(screen, /const groupHalf = t\.closest\('\[data-ifb-group-half\]'\)/);
  assert.match(screen, /if \(scope === 'staff'\) ui\.staffHalf = next;/);
  assert.match(screen, /else ui\.studentHalf = next;/);
  assert.match(styles, /\.ifb-student-semester\.is-active \{/);
});

test('instructor list shows only scheduled instructor-courses sorted by earliest start date', () => {
  const list = screen.slice(screen.indexOf('function instructorAssignmentsHtml('), screen.indexOf('function instructorsHtml('));
  assert.match(list, /\(ui\.instructorAssignments \|\| \[\]\)\.filter\(\(row\) => row\.first_start_date &&/);
  assert.match(list, /\.sort\(\(a, b\) => String\(a\.first_start_date\)\.localeCompare\(String\(b\.first_start_date\)\)/);
  assert.match(list, /<col class="ifb-iw-first-start"><col class="ifb-iw-first-end">/);
  assert.match(list, /תחילת קורס ראשון/);
  assert.match(list, /סיום קורס ראשון/);
  assert.match(list, /fmtDate\(row\.first_start_date\)/);
  assert.match(list, /fmtDate\(row\.first_course_end_date\)/);
  assert.match(styles, /\.ifb-instructor-table col\.ifb-iw-first-start,\s*\.ifb-instructor-table col\.ifb-iw-first-end \{ width: 11%; \}/);
});

test('SQL instructor feedback aggregates the two earliest dates independently', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261009223000_feedback_instructor_earliest_dates.sql', import.meta.url), 'utf8');
  assert.match(migration, /min\(a\.start_date\) as first_date/);
  assert.match(migration, /min\(a\.end_date\) as first_course_end_date/);
  assert.match(migration, /having min\(a\.start_date\) is not null/);
  assert.doesNotMatch(migration, /array_agg\(a\.end_date order by a\.start_date/);
  assert.match(migration, /g\.first_date asc/);
});


test('public survey thanks screen never offers another form or resets completion on this device', () => {
  assert.match(publicPage, /function showThanks\(root\)/);
  assert.match(publicPage, /if \(isStudent && local\?\.getItem\(doneKey\)\)/);
  assert.match(publicPage, /local\?\.setItem\(doneKey, new Date\(\)\.toISOString\(\)\)/);
  assert.doesNotMatch(publicPage, /data-another|allowAnother|onAnother|removeItem\(doneKey\)/);
  assert.match(publicPage, /showThanks\(root\)/);
});

test('QR share dialog fits without scroll and does not expose the long token on screen', () => {
  assert.doesNotMatch(shareUi, /class="ifb-qr__url"/);
  assert.match(shareUi, /QRCode\.toString\(url/);
  assert.match(shareUi, /copyText\(url\)/);
  assert.match(shareUi, /QRCode\.toDataURL\(url/);
  assert.match(shareUi, /requestFullscreen\?\.\(\)/);
  assert.match(styles, /QR share dialog: compact first view/);
  assert.match(styles, /\.ifb-qr \{[\s\S]*?max-height: calc\(100dvh - 32px\);\s*overflow: hidden;/);
  assert.match(styles, /\.ifb-qr__code \{[\s\S]*?39dvh/);
  assert.match(styles, /\.ifb-qr-overlay:fullscreen \.ifb-qr__code/);
});


test('staff tab displays only groups with a valid scheduled end date', () => {
  const sample = [
    [null, false], ['', false], ['2026-02-30', false],
    ['2027-01-04', true], ['2027-06-30', true]
  ];
  for (const [end_date, valid] of sample) {
    assert.equal(hasCourseEndDate({ end_date, start_date: '2026-10-20' }), valid, String(end_date));
  }
  assert.equal(hasCourseEndDate({ end_date: '2027-01-04', start_date: null }), true,
    'eligibility is determined by the end date, not inferred from the start date');
  const groupTable = screen.slice(screen.indexOf('function groupsTableHtml('), screen.indexOf('function optionBarsHtml('));
  assert.match(groupTable, /scope === 'staff'\s*\? courseScopedGroups\(\)\.filter\(hasCourseEndDate\)/);
  assert.match(groupTable, /scope === 'students'\s*\? courseScopedGroups\(\)\.filter\(hasCourseStartDate\)/);
  assert.match(groupTable, /בלשונית צוות חינוכי מוצגות רק קבוצות שנקבע להן תאריך סיום/);
  assert.match(screen, /const groups = await fetchGroups\(year\)/);
});

test('staff group detail focuses on staff questionnaires, data and open answers', () => {
  const groupView = screen.slice(screen.indexOf('function groupViewHtml('), screen.indexOf('// Export', screen.indexOf('function groupViewHtml(')));
  assert.match(groupView, /const staffView = ui\.groupReturnTab === 'staff'/);
  assert.match(groupView, /visibleSlots = staffView \? GROUP_SLOTS\.filter\(\(slot\) => slot\.audience === 'educational_staff'\)/);
  assert.match(groupView, /staffFacts = staffView && facts \? factsFor\(facts, 'educational_staff'\) : \[\]/);
  assert.match(groupView, /questionTableHtml\(staffFacts, \{ caption: 'תוצאות משוב הצוות החינוכי' \}\)/);
  assert.match(groupView, /staffOpenAnswers = staffView && facts \? openAnswers\(staffFacts\) : \[\]/);
  assert.match(groupView, /visibleSlots\.map\(\(slot\) => slotCardHtml\(group, slot\)\)/);
  assert.match(groupView, /ifb-slots--staff/);
  assert.match(groupView, /ifb-group-answers/);
  assert.match(styles, /\.ifb-slots--staff \{\s*display: grid;\s*grid-template-columns: minmax\(0, 540px\)/);
});

test('staff Excel export excludes student answers', () => {
  assert.match(screen, /exportButtonHtml\(\`group-staff:\$\{group\.row_id\}\`, 'ייצוא צוות חינוכי \(Excel\)'\)/);
  assert.match(screen, /scope\.startsWith\('group-staff:'\)\) return factsFor\(ui\.groupFacts\.get\(scope\.slice\(12\)\) \|\| \[\], 'educational_staff'\)/);
  assert.match(screen, /const isGroup = scope\.startsWith\('group:'\) \|\| scope\.startsWith\('group-staff:'\)/);
});
