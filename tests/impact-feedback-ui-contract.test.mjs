import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterGroups } from '../frontend/src/impact-feedback/feedback-domain.js';

const screen = readFileSync(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20261009162000_feedback_groups_activity_manager_filter.sql', import.meta.url), 'utf8');
const templates = readFileSync(new URL('../frontend/src/impact-feedback/feedback-templates-view.js', import.meta.url), 'utf8');

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
  assert.match(instructor, /class="ifb-center ifb-col-date" title="מועד הסיום הראשון/);
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
