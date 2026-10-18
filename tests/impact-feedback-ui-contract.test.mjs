import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterGroups, hasCourseStartDate, hasCourseEndDate, studentFeedbackPeriodForGroup, studentFeedbackHasResponses, sortStudentFeedbackGroups, sortEducationalStaffFeedbackGroups, filterFeedbackFactsForHalf } from '../frontend/src/impact-feedback/feedback-domain.js';
import { COURSE_SCHEDULING_PERIODS } from '../frontend/src/screens/course-scheduling-periods.js';
import { canViewImpactFeedback, canEditImpactFeedbackWording, isFeedbackAdmin } from '../frontend/src/impact-feedback/feedback-access.js';

const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261009162000_feedback_groups_activity_manager_filter.sql', import.meta.url), 'utf8');
const templates = readFileSync(new URL('../frontend/src/impact-feedback/feedback-templates-view.js', import.meta.url), 'utf8');
const publicPage = readFileSync(new URL('../frontend/src/impact-feedback/feedback-public.js', import.meta.url), 'utf8');
const publicForm = readFileSync(new URL('../frontend/src/impact-feedback/feedback-form.js', import.meta.url), 'utf8');
const publicCss = readFileSync(new URL('../frontend/src/impact-feedback/feedback-form.css', import.meta.url), 'utf8');
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


test('student and school staff tables have matching course dates and separate opening/closing stages', () => {
  const t = screen.slice(screen.indexOf('function groupsTableHtml('), screen.indexOf('function optionBarsHtml('));
  assert.match(t, /ifb-gw-date--start/);
  assert.match(t, /ifb-gw-date--end/);
  assert.match(t, /<th scope="col" class="ifb-center ifb-col-date">תחילת קורס<\/th>/);
  assert.match(t, /<th scope="col" class="ifb-center ifb-col-date">סיום קורס<\/th>/);
  assert.match(t, /slots\.find\(\(slot\) => slot\.stage === 'pre'\)/);
  assert.match(t, /scope === 'staff' \? 'final' : 'post'/);
  assert.match(t, /fmtDate\(g\.start_date\)/);
  assert.match(t, /fmtDate\(g\.end_date\)/);
  assert.match(styles, /\.ifb-groups-table--students col\.ifb-gw-date--start,/);
  assert.match(styles, /\.ifb-groups-table--students\.ifb-groups-table--with-program col\.ifb-gw-date--start,/);
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
  assert.match(instructor, /class="ifb-center ifb-col-date" title="תאריך הסיום המאוחר ביותר/);
  assert.match(instructor, /data-label="תחילת קורס ראשון" class="ifb-center ifb-nowrap ifb-col-date">\$\{fmtDate\(row\.first_start_date\)\}/);
  assert.match(instructor, /data-label="סיום אחרון א׳" class="ifb-center ifb-nowrap ifb-col-date">\$\{row\.last_end_a \? fmtDate\(row\.last_end_a\) : ''\}/);
  assert.match(instructor, /class="ifb-center ifb-nowrap ifb-col-date">\$\{row\.last_end_a \? fmtDate\(row\.last_end_a\) : ''\}/);
  assert.match(styles, /\.ifb-admin \.ifb-table thead th\.ifb-col-date,/);
  assert.match(styles, /\.ifb-admin \.ifb-table tbody td\.ifb-col-date,/);
});

test('actual status headings and values are right-aligned without changing stage columns', () => {
  const instructor = screen.slice(screen.indexOf('function instructorAssignmentsHtml('), screen.indexOf('function instructorsHtml('));
  assert.match(instructor, /<th scope="col" class="ifb-col-status">סטטוס<\/th>/);
  assert.match(instructor, /<td data-label="סטטוס פתיחה" class="ifb-col-status">/);
  assert.match(instructor, /<td data-label="סטטוס סיום א׳" class="ifb-col-status">/);
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
  assert.match(screen, /ui\.groups = rows/);
  assert.match(screen, /ACTIVITY_SYNC_INTERVAL_MS = 60 \* 1000/);
  assert.match(screen, /const groups = await fetchGroups\(year\)/);
  assert.match(screen, /window\.addEventListener\('focus', check/);
  assert.match(screen, /document\.addEventListener\('visibilitychange'/);
  assert.match(screen, /window\.addEventListener\('israa-activities-changed'/);
  assert.match(screen, /groupsSyncFingerprint\(groups\) !== groupsSyncFingerprint\(ui\.groups\)/);
  assert.match(screen, /if \(!host\.isConnected\) \{/);
  assert.match(screen, /activitySyncController\?\.abort\(\)/);
  assert.match(screen, /installActivityDateSync\(host\)/);
  assert.match(screen, /\['students', 'staff', 'instructors'\]\.includes\(ui\.tab\)/);
  assert.match(screen, /const assignments = await fetchInstructorAssignments\(year\)/);
  assert.match(screen, /ui\.instructorAssignments = assignments/);
});

test('tab switches and group-back reuse cache; refresh and mutations force fresh reads', () => {
  assert.match(screen, /async function switchTab\([\s\S]*?tabDataReady\(key\)[\s\S]*?load\(host, \{ force: false/);
  assert.match(screen, /data-ifb-back[\s\S]*?load\(host, \{ force: false \}\)/);
  assert.match(screen, /data-ifb-retry[\s\S]*?load\(host, \{ force: true \}\)/);
  assert.match(screen, /load\(host, \{ force: true \}\);/);
  assert.match(screen, /async function refreshAggregates\(\)/);
  assert.match(screen, /await refreshAggregates\(\)/);
  assert.match(screen, /const inflight = \{/);
  assert.match(screen, /FILTER_SEARCH_DEBOUNCE_MS/);
  assert.match(screen, /resetYearScopedState\(\)/);
  assert.match(screen, /ui\.groupsYear = null/);
  assert.match(screen, /ui\.summaryHalf = null/);
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
    ['2026-12-31', 'first'], ['2027-01-01', 'second'],
    ['2027-01-20', 'second'], ['2027-01-29', 'second'], ['2027-01-30', 'second'],
    ['2027-01-31', 'second'], ['2027-06-30', 'second'],
    ['2027-07-01', null]
  ];
  for (const [start_date, expected] of cases) {
    assert.equal(studentFeedbackPeriodForGroup({ start_date }), expected, String(start_date));
  }
  assert.equal(studentFeedbackPeriodForGroup({
    start_date: '2027-01-20',
    end_date: '2027-02-22'
  }), 'second', 'a January-started course belongs to second half regardless of its end date');
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

test('one shared half-year switch controls all operational feedback tabs without changing templates', () => {
  const control = screen.slice(screen.indexOf('function feedbackSemesterTabsHtml('), screen.indexOf('function groupsTableHtml('));
  assert.match(screen, /feedbackHalf: 'first'/);
  assert.match(control, /\{ key: 'first', label: "מחצית א׳" \}/);
  assert.match(control, /\{ key: 'second', label: "מחצית ב׳" \}/);
  assert.match(control, /data-ifb-group-half="\$\{key\}"/);
  assert.match(control, /aria-pressed="\$\{ui\.feedbackHalf === key\}"/);
  assert.match(screen, /ui\.groupRowId \|\| ui\.tab === 'templates' \|\| ui\.tab === 'instructors' \? '' : feedbackSemesterTabsHtml\(\)/);
  assert.match(screen, /ui\.feedbackHalf = next;/);
  assert.match(screen, /ui\.summaryHalf = null;/);
  assert.match(screen, /await load\(host\)/);
  assert.match(styles, /\.ifb-student-semester\.is-active \{/);
  assert.doesNotMatch(screen, /תבניות השאלונים משותפות למחצית א׳ ולמחצית ב׳/);
});


test('instructor tab shows one year-wide row per instructor and program', () => {
  const list = screen.slice(screen.indexOf('function instructorAssignmentsHtml('), screen.indexOf('function instructorsHtml('));
  assert.match(list, /row\.first_start_date && \(!ui\.course \|\| row\.program_key === ui\.course\)/);
  assert.doesNotMatch(list, /studentFeedbackPeriodForGroup\(\{ start_date: row\.first_start_date \}\) === ui\.feedbackHalf/);
  assert.match(list, /\.sort\(\(a, b\) => String\(a\.first_start_date\)\.localeCompare\(String\(b\.first_start_date\)\)/);
  assert.equal((list.match(/<col class="ifb-iw-date">/g) || []).length, 3);
  assert.equal((list.match(/<col class="ifb-iw-action">/g) || []).length, 3);
  assert.equal((list.match(/<col class="ifb-iw-status">/g) || []).length, 3);
  assert.match(list, /סיום אחרון א׳/);
  assert.match(list, /סיום אחרון ב׳/);
  assert.match(list, /row\.last_end_a \? fmtDate\(row\.last_end_a\) : ''/);
  assert.match(list, /row\.last_end_b \? fmtDate\(row\.last_end_b\) : ''/);
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
  assert.match(publicPage, /function showThanks\(root, language = 'he'\)/);
  assert.match(publicPage, /if \(isStudent && local\?\.getItem\(doneKey\)\)/);
  assert.match(publicPage, /local\?\.setItem\(doneKey, new Date\(\)\.toISOString\(\)\)/);
  assert.doesNotMatch(publicPage, /data-another|allowAnother|onAnother|removeItem\(doneKey\)/);
  assert.match(publicPage, /showThanks\(root, language\)/);
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


test('staff opening is tracked from course start while closing requires a known end date', () => {
  const table = screen.slice(screen.indexOf('function groupsTableHtml('), screen.indexOf('function optionBarsHtml('));
  assert.equal(hasCourseStartDate({ start_date:'2026-11-03', end_date:null }), true);
  assert.equal(hasCourseEndDate({ start_date:'2026-11-03', end_date:null }), false);
  assert.match(table, /scope === 'staff'\s*\? courseScopedGroups\(\)\.filter\(hasCourseStartDate\)/);
  assert.match(table, /scope === 'students'\s*\? courseScopedGroups\(\)\.filter\(hasCourseStartDate\)/);
  assert.match(table, /ממתין לתאריך סיום/);
  assert.match(screen, /slot\.stage === 'final' && !hasCourseEndDate\(group\)/);
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


test('all feedback reporting uses the same cohort in facts, summaries and exports', () => {
  assert.match(screen, /const facts = semesterFacts\(\);/);
  assert.match(screen, /filterFeedbackFactsForHalf\(ui\.facts \|\| \[\], ui\.groups \|\| \[\], ui\.instructorAssignments \|\| \[\], ui\.feedbackHalf\)/);
  assert.match(screen, /fetchCourseSummary\(year, half\)/);
  assert.match(screen, /ui\.summaryHalf === ui\.feedbackHalf/);
  assert.match(screen, /const groups = courseScopedGroups\(\)\.filter\(\(g\) =>\s*studentFeedbackPeriodForGroup\(g\) === ui\.feedbackHalf/);
  assert.match(screen, /crossCourseCore\(semesterFacts\(\), \{ audience: a\.audience, stage \}\)/);
  assert.match(screen, /crossCourseCore\(semesterFacts\(\), \{ audience, stage \}\)/);
  assert.match(screen, /return courseFacts\(\);/);
  assert.match(screen, /const inHalf = all\.filter\(\(g\) => studentFeedbackPeriodForGroup\(g\) === ui\.feedbackHalf\)/);
});

test('staff opening facts without end date count in the correct semester; closing waits for end', () => {
  const groups = [
    { row_id:'first-student', start_date:'2026-10-20', end_date:'2027-02-15' },
    { row_id:'second-student', start_date:'2027-02-01', end_date:'2027-05-01' },
    { row_id:'first-staff-no-end', start_date:'2026-11-01', end_date:null }
  ];
  const assignments=[{ instructor_emp_id:'1502',program_key:'biomimicry',
    first_start_date:'2026-10-20',pre_campaign:{id:'pre-instructor'},
    final_campaign:{id:'final-instructor'} }];
  const facts=[
    {audience:'student',activity_row_id:'first-student',campaign_id:'st1'},
    {audience:'student',activity_row_id:'second-student',campaign_id:'st2'},
    {audience:'educational_staff',stage:'final',activity_row_id:'first-student',campaign_id:'staff1'},
    {audience:'educational_staff',stage:'pre',activity_row_id:'first-staff-no-end',campaign_id:'staff2-pre'},
    {audience:'educational_staff',stage:'final',activity_row_id:'first-staff-no-end',campaign_id:'staff2-final'},
    {audience:'instructor',campaign_id:'pre-instructor'},
    {audience:'instructor',campaign_id:'final-instructor'},
    {audience:'instructor',campaign_id:'unknown'}
  ];
  const first=filterFeedbackFactsForHalf(facts,groups,assignments,'first');
  const second=filterFeedbackFactsForHalf(facts,groups,assignments,'second');
  assert.deepEqual(first.map(f=>f.campaign_id),['st1','staff1','staff2-pre','pre-instructor','final-instructor']);
  assert.deepEqual(second.map(f=>f.campaign_id),['st2']);
  assert.equal(first.some(f=>second.includes(f)),false);
});

test('semester-specific collection RPC keeps per-year RPC unchanged and respects source activity dates', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20261009233000_feedback_course_summary_by_semester.sql', import.meta.url), 'utf8');
  const api = readFileSync(new URL('../frontend/src/impact-feedback/feedback-api.js', import.meta.url), 'utf8');
  assert.match(migration, /create or replace function public\.feedback_admin_course_summary_for_half\(p_academic_year text, p_half text\)/i);
  assert.match(migration, /private\.feedback_is_admin\(\)/);
  assert.match(migration, /feedback_admin_instructor_assignments\(p_academic_year\)/);
  assert.match(migration, /ia\.first_start_date/);
  assert.match(migration, /a\.start_date/);
  assert.match(migration, /c\.audience <> 'educational_staff' or a\.end_date is not null/);
  assert.match(migration, /grant execute on function public\.feedback_admin_course_summary_for_half\(text,text\) to authenticated/);
  assert.match(api, /rpc\('feedback_admin_course_summary_for_half'/);
  assert.doesNotMatch(migration, /DROP FUNCTION IF EXISTS public\.feedback_admin_course_summary\(/i);
});


test('staff table orders started courses earliest first, including those without an end date', () => {
  const rows=[
    {row_id:'latest',school:'כרמל',start_date:'2027-04-01',end_date:'2027-06-01',campaigns:[]},
    {row_id:'second',school:'דקל',start_date:'2027-01-18',end_date:null,campaigns:[]},
    {row_id:'same-date-last',school:'ברוש',start_date:'2027-01-05',campaigns:[]},
    {row_id:'earliest',school:'אלון',start_date:'2026-12-01',campaigns:[]},
    {row_id:'same-date-first',school:'אורן',start_date:'2027-01-05',campaigns:[]}
  ];
  assert.deepEqual(sortEducationalStaffFeedbackGroups(rows).map(r=>r.row_id),
    ['earliest','same-date-first','same-date-last','second','latest']);
  assert.equal(rows[0].row_id,'latest');
  const table=screen.slice(screen.indexOf('function groupsTableHtml('), screen.indexOf('function optionBarsHtml('));
  assert.match(table, /const sorted = sortEducationalStaffFeedbackGroups\(matching\)/);
  assert.match(table, /scope === 'staff'\s*\? courseScopedGroups\(\)\.filter\(hasCourseStartDate\)/);
  assert.match(table, /const inHalf = all\.filter\(\(g\) => studentFeedbackPeriodForGroup\(g\) === ui\.feedbackHalf\)/);
});

test('staff feedback displays opening and closing in separate centered stage columns', () => {
  const t=screen.slice(screen.indexOf('function groupsTableHtml('),screen.indexOf('function optionBarsHtml('));
  assert.match(t, /<th scope="col" class="ifb-center ifb-col-stage">/);
  assert.match(t, /<td class="ifb-center ifb-col-stage"/);
  assert.match(t, /scope === 'staff' \? 'final' : 'post'/);
  assert.match(t, /ממתין לתאריך סיום/);
  assert.match(styles, /\.ifb-groups-table--staff col\.ifb-gw-stage \{ width: 13%; \}/);
});

test('template cards use three desktop columns with tight language spacing and responsive layouts', () => {
  assert.match(styles, /\.ifb-admin \.ifb-template-grid \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(styles, /\.ifb-admin \.ifb-template-grid \{[\s\S]*?grid-auto-rows: 1fr;/);
  assert.match(styles, /\.ifb-admin \.ifb-template-card__language-headings,[\s\S]*?column-gap: 3px;/);
  assert.match(styles, /@media \(min-width: 681px\) and \(max-width: 999px\) \{\s*\.ifb-admin \.ifb-template-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
  assert.match(styles, /@media \(max-width: 680px\) \{\s*\.ifb-admin \.ifb-template-grid \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.ifb-admin \.ifb-template-card__slots \{[\s\S]*?width: min\(100%, 356px\);[\s\S]*?margin-inline: auto;/);
  assert.match(styles, /\.ifb-admin \.ifb-template-card__slot \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) repeat\(2, 76px\);/);
  assert.match(styles, /\.ifb-admin \.ifb-template-card__inner \{[\s\S]*?min-height: 100%;/);
});

test('each saved template PDF is visually distinct and upload/download actions retain permissions and selectors', () => {
  assert.match(templates, /const pdfState = upToDate \? 'is-ready' : outdated \? 'is-stale' : 'is-missing';/);
  assert.match(templates, /class="ifb-template-card__pdf \$\{pdfState\}" data-tpl-pdf="/);
  assert.match(templates, /\$\{upToDate \? '' : 'disabled'\}/);
  assert.match(templates, /data-tpl-upload="\$\{esc\(template\.id\)\}" data-tpl-lang="\$\{language\}" \$\{published \? '' : 'disabled'\}/);
  assert.match(templates, /data-tpl-delete="\$\{esc\(template\.id\)\}"/);
  assert.match(templates, /ifb-template-card__delete-placeholder/);
  assert.match(templates, /ifb-template-card__upload[^<]*[\s\S]*?<svg viewBox="0 0 24 24" aria-hidden="true"/);
  assert.match(templates, /ifb-template-card__delete[^<]*[\s\S]*?<svg viewBox="0 0 24 24" aria-hidden="true"/);
  assert.match(styles, /\.ifb-admin \.ifb-template-card__pdf\.is-ready \{/);
  assert.match(styles, /\.ifb-admin \.ifb-template-card__pdf:disabled \{/);
  assert.match(styles, /\.ifb-admin \.ifb-template-card__pdf\.is-stale:disabled \{/);
  assert.match(styles, /\.ifb-admin \.ifb-template-card__upload svg,/);
  assert.match(templates, /await downloadSavedPaperPdf\(record\)/);
  assert.match(templates, /await uploadSavedPaperPdf\(template, file, upload\.dataset\.tplLang\)/);
  assert.match(templates, /await deleteSavedPaperPdf\(record\)/);
});


test('feedback semester control has no extraneous scheduling explanation anywhere', () => {
  assert.doesNotMatch(screen, /לפי תאריך תחילת הקורס בממשק השיבוצים/);
  const switcher = screen.slice(screen.indexOf('function feedbackSemesterTabsHtml('), screen.indexOf('function groupsTableHtml('));
  assert.match(switcher, /מחצית א׳/);
  assert.match(switcher, /מחצית ב׳/);
  assert.doesNotMatch(switcher, /ifb-student-semesters__note/);
});

test('instructor yearly table has twelve correctly ordered headings and independent final stages', () => {
  const list = screen.slice(screen.indexOf('function instructorAssignmentsHtml('), screen.indexOf('function instructorsHtml('));
  const header = list.slice(list.indexOf('<thead><tr>'), list.indexOf('</thead>'));
  const headings = [...header.matchAll(/<th scope="col"[^>]*>([^<]+)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(headings, [
    'מדריך','קורס','קבוצות','תחילת קורס ראשון','פתיחה','סטטוס',
    'סיום אחרון א׳','סיום','סטטוס','סיום אחרון ב׳','סיום','סטטוס'
  ]);
  const body = list.slice(list.indexOf('<tbody>'), list.indexOf('</tbody>'));
  const fields = [...body.matchAll(/<td data-label="([^"]+)"[^>]*>/g)].map((m) => m[1]);
  assert.deepEqual(fields, [
    'קורס','קבוצות','תחילת קורס ראשון','פתיחה','סטטוס פתיחה',
    'סיום אחרון א׳','סיום','סטטוס סיום א׳','סיום אחרון ב׳','סיום ב׳','סטטוס סיום ב׳'
  ]);
  assert.match(screen, /return stage === 'pre' \? row\.pre_campaign : stage === 'final_b' \? row\.final_b_campaign : row\.final_campaign/);
  assert.match(screen, /if \(stage === 'final_b' && !row\.last_end_b\) return ''/);
  assert.match(screen, /for \(const campaign of \[row\.pre_campaign, row\.final_campaign, row\.final_b_campaign\]\)/);
  assert.match(list, /instructorCampaignActionsHtml\(row, 'final_b'\)/);
});

test('annual instructor table fits the desktop container and remains responsive on mobile', () => {
  assert.match(styles, /\.ifb-instructor-table col\.ifb-iw-date \{ width: 10%; \}/);
  assert.match(styles, /\.ifb-instructor-table col\.ifb-iw-action \{ width: 6%; \}/);
  assert.match(styles, /\.ifb-instructor-table col\.ifb-iw-status \{ width: 7%; \}/);
  assert.match(styles, /\.ifb-instructor-table \{\s*width: 100%;\s*min-width: 0;/);
  assert.match(styles, /@media \(max-width: 760px\) \{[\s\S]*?\.ifb-instructor-table \{ min-width: 0; \}/);
});

test('twelve instructor columns sum to exactly 100 percent and missing B dates remain blank', () => {
  const list = screen.slice(screen.indexOf('function instructorAssignmentsHtml('), screen.indexOf('function instructorsHtml('));
  const cols = [...list.matchAll(/<col class="(ifb-iw-[^"]+)">/g)].map((m) => m[1]);
  assert.deepEqual(cols, [
    'ifb-iw-instructor','ifb-iw-program','ifb-iw-groups',
    'ifb-iw-date','ifb-iw-action','ifb-iw-status',
    'ifb-iw-date','ifb-iw-action','ifb-iw-status',
    'ifb-iw-date','ifb-iw-action','ifb-iw-status'
  ]);
  const widths = { 'ifb-iw-instructor':12, 'ifb-iw-program':15, 'ifb-iw-groups':4,
    'ifb-iw-date':10, 'ifb-iw-action':6, 'ifb-iw-status':7 };
  assert.equal(cols.reduce((sum,name) => sum + widths[name], 0), 100);
  assert.match(list, /row\.last_end_b \? fmtDate\(row\.last_end_b\) : ''/);
  assert.match(list, /row\.last_end_b \? instructorStageStatusHtml\(row, 'final_b'\) : ''/);
  assert.match(styles, /\.ifb-instructor-table-wrap \{\s*width: 100%;\s*max-width: 100%;\s*min-width: 0;/);
});

test('student and staff tables interleave each feedback stage with its corresponding course date', () => {
  const t=screen.slice(screen.indexOf('function groupsTableHtml('),screen.indexOf('function optionBarsHtml('));
  const head=t.slice(t.indexOf('<thead><tr>'),t.indexOf('</thead>'));
  const start=head.indexOf('תחילת קורס');
  const pre=head.indexOf("slot.stage === 'pre'");
  const end=head.indexOf('סיום קורס');
  const final=head.indexOf("scope === 'staff' ? 'final' : 'post'");
  assert.ok(start>=0 && pre>start && end>pre && final>end);
  const tbody=t.slice(t.indexOf('<tbody>'),t.indexOf('</tbody>'));
  const bodyStart=tbody.indexOf('data-label="תחילת קורס"');
  const bodyPre=tbody.indexOf("slots.find((s) => s.stage === 'pre')");
  const bodyEnd=tbody.indexOf('data-label="סיום קורס"');
  const bodyFinal=tbody.indexOf("scope === 'staff' ? 'final' : 'post'");
  assert.ok(bodyStart>=0 && bodyPre>bodyStart && bodyEnd>bodyPre && bodyFinal>bodyEnd);
  const cols=t.slice(t.indexOf('<colgroup>'),t.indexOf('</colgroup>'));
  assert.match(cols, /ifb-gw-date--start[^']*ifb-gw-stage[^']*ifb-gw-date--end[^']*ifb-gw-stage/);
});

test('second half uses a separate campaign and the existing final questionnaire', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261010103000_feedback_instructor_second_half_final.sql', import.meta.url), 'utf8');
  assert.match(sql, /and fc\.stage = 'final_b'/);
  assert.match(sql, /max\(a2\.end_date\)/);
  assert.match(sql, /a2\.start_date >= date '2027-01-31'/);
  assert.match(sql, /a2\.start_date <= date '2027-06-30'/);
  assert.match(sql, /if p_stage = 'final_b' and a\.last_end_b is null then/);
  assert.match(sql, /case when p_stage = 'final_b' then 'final' else p_stage end/);
  assert.match(sql, /stage in \('pre','final','final_b'\)/);
  assert.match(screen, /factsFor\(facts, 'instructor', 'final_b'\)/);
  assert.match(screen, /if \(scope === 'instructor-all'\)/);
  assert.match(screen, /ui\.summary && scope !== 'instructor-all'/);
});

test('every valid public feedback token starts with equal-weight bilingual language choice', () => {
  assert.match(publicPage, /function showLanguageChoice\(root, \{ onHebrew, onArabic \}\)/);
  assert.match(publicPage, /באיזו שפה נוח לך למלא את המשוב\?/);
  assert.match(publicPage, /ما اللغة الأنسب لك لتعبئة الاستبيان\؟/);
  assert.match(publicPage, /class="ifb-language-card__question" lang="he" dir="rtl"/);
  assert.match(publicPage, /class="ifb-language-card__question" lang="ar" dir="rtl"/);
  assert.match(publicPage, /data-ifb-lang="he" lang="he">עברית/);
  assert.match(publicPage, /data-ifb-lang="ar" lang="ar">العربية/);
  assert.match(publicPage, /root\.querySelector\('\[data-ifb-lang="he"\]'\)\.addEventListener\('click', onHebrew\)/);
  assert.match(publicPage, /root\.querySelector\('\[data-ifb-lang="ar"\]'\)\.addEventListener\('click', onArabic\)/);
  assert.match(publicPage, /if \(!payload \|\| payload\.state !== 'ok'\) \{/);
  assert.match(publicPage, /if \(isStudent && local\?\.getItem\(doneKey\)\) \{\s*showThanks\(root, session\?\.getItem\(languageKey\) === 'ar' \? 'ar' : 'he'\);\s*return;/);
  assert.match(publicPage, /const renderLanguageChoice = \(\) => showLanguageChoice\(root, \{/);
  assert.match(publicPage, /renderLanguageChoice\(\);\s*\}\s*start\(\)/);
});

test('Arabic is available only when translations are supplied and selected wording is isolated', () => {
  assert.match(publicPage, /function showArabicPending\(root, onBack\)/);
  assert.match(publicPage, /payload\.questions\.every\(\(q\) => Boolean\(q\.text_ar\)\)/);
  assert.match(publicPage, /renderForm\('ar'\) : showArabicPending\(root, renderLanguageChoice\)/);
  assert.match(publicPage, /language === 'ar' \? \{ \.\.\.q, text: q\.text_ar \|\| q\.text \}/);
  assert.match(publicPage, /onHebrew: \(\) => renderForm\('he'\)/);
  assert.match(publicPage, /document\.documentElement\.lang = language/);
  assert.match(publicPage, /mountFeedbackForm\(root, displayPayload/);
  assert.doesNotMatch(publicPage, /BIOMIMICRY_ARABIC_QUESTIONS/);
});

test('survey language change preserves draft and equal bilingual styling on mobile', () => {
  assert.match(publicForm, /options\.onChooseLanguage \? `<button type="button" class="ifb-hero__change-language"/);
  assert.match(publicForm, /options\.onChange\?\.\(\{ \.\.\.answers \}\)/);
  assert.match(publicForm, /options\.onChooseLanguage\?\.\(\)/);
  assert.match(publicPage, /onChooseLanguage: renderLanguageChoice/);
  assert.match(publicPage, /session\?\.setItem\(draftKey, JSON\.stringify\(answers\)\)/);
  assert.match(publicPage, /session\?\.getItem\(draftKey\)/);
  assert.match(publicCss, /\.ifb-language-card__question \{[\s\S]*?font-size: clamp\(21px, 4vw, 26px\);[\s\S]*?font-weight: 750;/);
  assert.match(publicCss, /\.ifb-language-card__choices \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(publicCss, /@media \(max-width: 480px\) \{[\s\S]*?\.ifb-language-card__question \{ font-size: 21px; \}/);
});


test('educational staff list deduplicates only by course, named contact and school', () => {
  const section = screen.slice(screen.indexOf('function groupsTableHtml('), screen.indexOf('// Per-question results'));
  assert.match(section, /scope === 'staff'/);
  assert.match(section, /JSON\.stringify\(\[course, contact, school\]\)/);
  assert.match(section, /JSON\.stringify\(\['unidentified', group\.row_id\]\)/);
  assert.match(section, /groupHasFeedback\(group\)/);
  assert.doesNotMatch(section, /JSON\.stringify\(\[course, contact, school,.*feedbackHalf/);
});


test('template PDF actions are rendered for elementary student surveys only', () => {
  const view = readFileSync(new URL('../frontend/src/impact-feedback/feedback-templates-view.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
  assert.match(view, /const canUsePaperPdf = isElementaryPaperTemplate\(template, program\)/);
  assert.match(view, /canUsePaperPdf \? \`\$\{languageControls\('he'\)\}\$\{languageControls\('ar'\)\}\` : ''/);
  assert.match(view, /program\.education_level === 'elementary'/);
  assert.match(view, /is-digital/);
  assert.match(css, /\.ifb-template-card__slot\.is-digital/);
});

test('analysis shows explicit counts and scoring scales instead of statistical N', () => {
  const analysis = screen.slice(screen.indexOf('function questionTableHtml('), screen.indexOf('// Group view (opened from'));
  assert.match(analysis, /תשובות שהתקבלו/);
  assert.match(analysis, /תשובות למדד:/);
  assert.match(analysis, /מתוך 5/);
  // The analysis uses the question/metrics tables; the old breakdown wrapper was removed.
  assert.match(analysis, /ifb-q-table/);
  assert.doesNotMatch(analysis, /N תקפות|N=\\$\\{/);
});

test('analysis comparison hides empty audience columns and aligns numeric headings centrally', () => {
  const start = screen.indexOf('function audienceComparisonHtml(facts)');
  const end = screen.indexOf('/** Core wording embeds', start);
  const comparison = screen.slice(start, end);
  const styles = readFileSync(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
  assert.match(comparison, /const active = audiences\.filter/);
  assert.match(comparison, /const comparison = active\.length > 1/);
  assert.match(comparison, /active\.map/);
  assert.match(comparison, /תחום הערכה/);
  assert.match(comparison, /דירוגים תקפים:/);
  assert.match(styles, /\.ifb-analysis-metrics-table thead th:not\(:first-child\)/);
  assert.match(styles, /\.ifb-analysis-metrics-table thead th:first-child/);
});

test('biomimicry AI export offers separate internal and external scopes', () => {
  assert.match(screen, /function aiAnalysisExportHtml\(\)/);
  assert.match(screen, /data-ifb-ai-export="internal"/);
  assert.match(screen, /data-ifb-ai-export="external"/);
  assert.match(screen, /includeInstructor \|\| f\.audience !== 'instructor'/);
  assert.match(screen, /includeInstructor \? openAnswers\(facts\) : \[\]/);
  assert.match(screen, /function exportAiAnalysis\(mode\)/);
  assert.match(screen, /exportAiAnalysis\(aiExport\.dataset\.ifbAiExport\)/);
});

test('approved Arabic biomimicry pre/post match the supplied student questionnaires', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261011190000_biomimicry_student_arabic_approved_docx.sql', import.meta.url), 'utf8');
  const required = [
    'هل فكّرتم يومًا ماذا يمكننا أن نتعلّم من الطبيعة من حولنا؟',
    'خلال الدورة، استكشفنا الطبيعة وتعلّمنا كيف نستمدّ منها الإلهام لأفكار جديدة.',
    'يهمّني أن أكتشف أشياء جديدة عن الطبيعة.',
    'عندما أرى شيئًا مثيرًا للاهتمام في الطبيعة، أريد أن أفهم كيف يعمل.',
    'أنتبه إلى تفاصيل مميّزة في النباتات والحيوانات.',
    'أستطيع أن أشرح كيف تساعد صفة معيّنة حيوانًا على العيش في الطبيعة.',
    'أستطيع أن أفكّر في أفكار جديدة مستوحاة من الطبيعة.',
    'عندما تكون هناك مشكلة، أحاول التفكير في أكثر من حلّ واحد.',
    'أستطيع أن أعمل مع أصدقائي لإيجاد حلّ لمشكلة.',
    'أشعر بالثقة عندما أقدّم فكرة من أفكاري أمام الآخرين.',
    'كانت الأنشطة في الدورة ممتعة ومثيرة للاهتمام.',
    'خلال الدورة، أتيحت لي فرصة لاقتراح أفكار من عندي.',
    'أيّ نشاط في الدورة أحببت أكثر؟',
    'ما الذي تودّ تغييره أو إضافته في الدورة؟'
  ];
  for (const exactArabicText of required) assert.ok(sql.includes(exactArabicText), exactArabicText);
  assert.match(sql, /common_n<>8/);
  assert.match(sql, /n<>20/);
  assert.match(sql, /private\.feedback_biomimicry_approved_question_ar/);
  assert.match(sql, /private\.feedback_biomimicry_approved_intro_ar/);
  assert.match(sql, /c\.program_key=''biomimicry'' and c\.audience=''student''/);
  assert.match(sql, /private\.feedback_publish_version/);

  for (const label of [
    'لا ينطبق عليّ أبدًا', 'ينطبق عليّ قليلًا', 'ينطبق عليّ بدرجة متوسطة',
    'ينطبق عليّ إلى حدّ كبير', 'ينطبق عليّ كثيرًا جدًا'
  ]) assert.ok(publicForm.includes(label), label);
  assert.match(publicForm, /isArabicBiomimicryStudent/);
  assert.match(publicForm, /ifb-biomimicry-scale/);
  assert.match(publicForm, /ifb-biomimicry-open-intro/);
  assert.match(publicForm, /استبيان بداية دورة البيوميمكري – المحاكاة الحيوية/);
  assert.match(publicForm, /استبيان نهاية دورة البيوميمكري – المحاكاة الحيوية/);
  assert.match(publicForm, /questionHtml\(q, i, answers, young, options\.language \|\| 'he', approvedStudentScale\)/);
  assert.match(publicPage, /biomimicryStudentStageForThanks/);
  assert.match(templates, /program_key: ed\.template\.program_key/);
});

test('five student syllabi use the approved age-appropriate bilingual layout and keep comparable question IDs', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261011205000_student_syllabus_appropriate_introductions.sql', import.meta.url), 'utf8');
  for (const key of ['green_leadership', 'space_tech', 'trailblazers', 'pharma', 'ofek']) {
    assert.ok(sql.includes(key), key);
    assert.ok(publicForm.includes(key), key);
    assert.ok(publicPage.includes(key), key);
  }
  assert.match(sql, /when t\.stage='pre' then 8 else 12/);
  assert.match(sql, /when t\.stage='pre' then 10 else 14/);
  assert.match(sql, /count\(\*\) filter\(where q\.is_comparison\)/);
  assert.match(sql, /q\.question_id,q\.section,q\.sort_order,q\.required,q\.metric_key,q\.question_type,q\.is_comparison,q\.wording,q\.options,q\.scoring/);
  assert.match(sql, /private\.feedback_student_syllabus_intros/);
  assert.match(sql, /private\.feedback_publish_version/);
  assert.match(sql, /c\.audience=''student''/);

  for (const phrase of [
    'האם שמתם לב לדברים בסביבה שלכם',
    'האם תהיתם פעם איך אפשר לחיות בחלל',
    'האם חשבתן פעם איך רעיון שלכן',
    'איך מפתחים פתרון רפואי',
    'איך הופכים רעיון למוצר',
    'هل لاحظتم أشياء في بيئتكم',
    'هل تساءلتم يومًا كيف يمكن للإنسان',
    'هل فكّرتنّ يومًا',
    'كيف نطوّر حلًّا طبيًّا',
    'كيف نحوّل فكرة إلى منتج'
  ]) assert.ok(sql.includes(phrase), phrase);

  assert.match(publicForm, /const syllabusStudent = isSyllabusStudent\(payload\)/);
  assert.match(publicForm, /const approvedStudentScale = biomimicryArabic \|\| syllabusStudent/);
  assert.match(publicForm, /const femaleStudent = syllabusStudent && payload\.program_key === 'trailblazers'/);
  assert.match(publicForm, /introHtml\(arabic \? payload\.intro_text_ar : payload\.intro_text, arabic \? 'ar' : 'he', approvedStudentScale\)/);
  assert.match(publicForm, /approvedFreeTextIntroHtml\(arabic, femaleStudent, biomimicryArabic\)/);
  assert.match(publicForm, /اقرأن كل جملة/);
  assert.match(publicForm, /קראו כל משפט/);
  assert.match(publicForm, /אין חובה לענות עליהן/);
  assert.match(publicPage, /STUDENT_SYLLABUS_OUTROS/);
  assert.match(publicCss, /\.ifb-shell\.is-syllabus-student \.ifb-hero__intro--approved/);
});

test('impact-feedback preserves admin/Israa access and adds read-only operational viewers', () => {
  const allowed = { user_id: '3030', role: 'business_development_manager', is_active: true };
  assert.equal(canViewImpactFeedback({ user_id: 'a1', role: 'admin' }), true);
  assert.equal(isFeedbackAdmin(allowed), false);
  assert.equal(canViewImpactFeedback(allowed), true);
  assert.equal(canEditImpactFeedbackWording(allowed), true);
  assert.equal(canEditImpactFeedbackWording({ ...allowed, is_active: false }), false);
  assert.equal(canEditImpactFeedbackWording({ user_id: 'a1', role: 'admin' }), false);
  assert.equal(canViewImpactFeedback({ ...allowed, is_active: false }), false);
  assert.equal(canViewImpactFeedback({ ...allowed, role: 'instructor' }), false);
  assert.equal(canViewImpactFeedback({ ...allowed, user_id: '3031', full_name: 'איסראא' }), false);
  assert.equal(canViewImpactFeedback({ ...allowed, user_id: '303' }), false);
  assert.equal(canViewImpactFeedback({ role: 'business_development_manager' }), false);
  assert.equal(canViewImpactFeedback(null), false);
  for (const user_id of ['1500', '5000']) {
    const manager = { user_id, role: 'activities_manager', is_active: true };
    assert.equal(canViewImpactFeedback(manager), true);
    assert.equal(canEditImpactFeedbackWording(manager), false);
    assert.equal(canViewImpactFeedback({ ...manager, is_active: false }), false);
  }
  assert.equal(canViewImpactFeedback({ user_id: '6000', role: 'operation_manager', is_active: true }), true);
  assert.equal(canEditImpactFeedbackWording({ user_id: '6000', role: 'operation_manager' }), false);
  assert.equal(canViewImpactFeedback({ user_id: '6001', role: 'operation_manager', is_active: true }), false);
  assert.equal(canViewImpactFeedback({ role: 'finance', is_active: true }), false);
  assert.match(screen, /const LIMITED_VIEWER_TABS = new Set\(\['overview', 'students', 'instructors', 'staff'\]\)/);
  assert.match(screen, /host\.classList\.toggle\('is-feedback-limited-viewer', isLimitedFeedbackViewer\(\)\)/);
  assert.match(styles, /\.ifb-admin\.is-feedback-limited-viewer \[data-ifb-analyze\]/);

  const policy = readFileSync(new URL('../supabase/migrations/20261018154000_feedback_managers_readonly_results.sql', import.meta.url), 'utf8');
  assert.match(policy, /create or replace function private\.feedback_can_view_results\(\)/);
  assert.match(policy, /u\.role = 'activities_manager'/);
  assert.match(policy, /u\.role = 'operation_manager' and u\.user_id = '6000'/);
  assert.match(policy, /create policy feedback_metrics_results_view_select/);
  assert.match(policy, /create policy feedback_programs_results_view_select/);
  assert.match(policy, /feedback_results_template_exposure/);
  assert.match(policy, /feedback_results_write_guard_expanded/);

  const main = readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(route === 'impact-feedback'\) return canViewImpactFeedback\(user\)/);
  assert.match(main, /!state\.token \|\| !\(canViewImpactFeedback\(state\.user\) \|\| isFeedbackInstructor\(state\.user\)\)/);
  assert.match(screen, /if \(isFeedbackInstructor\(state\?\.user\)\)/);
  assert.match(screen, /if \(!canViewImpactFeedback\(state\?\.user\)\)/);
  assert.match(screen, /feedbackReadOnly = !isFeedbackAdmin\(state\?\.user\)/);
  assert.match(screen, /visibleFeedbackTabs\(\)\.map/);
  assert.match(screen, /function visibleFeedbackTabs\(\) \{\s+return isLimitedFeedbackViewer\(\) \? TABS\.filter/);
  assert.match(screen, /if \(feedbackReadOnly\) \{ event\.preventDefault\(\); return; \}/);
  assert.match(screen, /feedbackReadOnly && t\.closest/);
  assert.match(styles, /\.ifb-admin\.is-feedback-readonly :is/);
  assert.match(styles, /\[data-ifb-close\]/);
  assert.match(styles, /\[data-ifb-share\]/);
  assert.match(styles, /\[data-ifb-open-form\]/);
  assert.match(styles, /\[data-ifb-instructor-open-form\]/);

  const sql = readFileSync(new URL('../supabase/migrations/20261011210500_feedback_admin_israa_readonly_access.sql', import.meta.url), 'utf8');
  assert.match(sql, /u\.auth_user_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /coalesce\(u\.is_active, false\)/);
  assert.match(sql, /u\.user_id = '3030'/);
  assert.match(sql, /u\.role = 'business_development_manager'/);
  assert.match(sql, /feedback_metrics_authorized_view_select/);
  assert.match(sql, /feedback_programs_authorized_view_select/);
  assert.match(sql, /if changed<>5/);
  assert.match(sql, /private\.feedback_can_view\(\)/);
  assert.match(sql, /Unsafe feedback write grants detected/);
});

test('Israa can view feedback, correct bilingual draft wording and cannot manage campaigns or PDFs', () => {
  const templateView = readFileSync(new URL('../frontend/src/impact-feedback/feedback-templates-view.js', import.meta.url), 'utf8');
  const migration = readFileSync(new URL('../supabase/migrations/20261011212500_feedback_israa_published_templates_read.sql', import.meta.url), 'utf8');
  const correction = readFileSync(new URL('../supabase/migrations/20261011213000_feedback_israa_published_version_policy_fix.sql', import.meta.url), 'utf8');
  assert.match(screen, /renderTemplatesView\(ui, \{ readOnly: feedbackReadOnly, canEditWording: feedbackCanEditWording \}\)/);
  assert.match(screen, /bindTemplatesView\(host, ui, \(\) => paint\(host\), \{ readOnly: feedbackReadOnly, canEditWording: feedbackCanEditWording \}\)/);
  assert.match(templateView, /function listHtml\(ui, \{ readOnly = false, canEditWording = false \} = \{\}\)/);
  assert.match(templateView, /if \(readOnly\) return `<div class="ifb-template-card__lang-actions"/);
  assert.match(templateView, /function editorHtml\(ui, \{ readOnly = false, canEditWording = false \} = \{\}\)/);
  assert.match(templateView, /const editing = !readOnly && Boolean\(ed\.draft\)/);
  assert.match(templateView, /data-tpl-wording-edit/);
  assert.match(templateView, /wordingOnlyQuestionHtml/);
  assert.match(templateView, /data-tq-field="wording\.default"/);
  assert.match(templateView, /data-tq-field="wording\.ar"/);
  assert.match(templateView, /const draftMeta = \(readOnly && !canEditWording\) \? null : versions\.find/);
  assert.match(templateView, /readOnly \? \[\] : fetchBankQuestions\(/);
  assert.match(templateView, /!readOnly && ed\.draft \? ed\.draftQuestions : ed\.publishedQuestions/);
  assert.match(templateView, /if \(readOnly && !t\.closest\(canEditWording/);
  assert.match(templateView, /\[data-tpl-pdf\], \[data-tpl-open\], \[data-tpl-back\], \[data-tpl-preview\]/);
  assert.match(templateView, /if \(readOnly\) \{ event\.preventDefault\(\); return; \}/);
  assert.match(templateView, /if \(readOnly\) \{/);
  assert.match(templateView, /readOnly \? \(canEditWording && ed\.published/);
  for (const t of [
    'feedback_templates_pilot_view_select',
    'feedback_template_versions_pilot_published_select',
    'feedback_template_questions_pilot_published_select',
    'feedback_template_pdfs_pilot_select',
    'feedback_template_pdf_read_pilot'
  ]) assert.ok(migration.includes(t), t);
  assert.match(correction, /t\.id = feedback_template_versions\.template_id/);
  assert.match(correction, /t\.current_version_id = feedback_template_versions\.id/);
  assert.match(migration, /status = 'published'/);
  assert.doesNotMatch(migration, /grant (update|insert|delete) /i);
});
