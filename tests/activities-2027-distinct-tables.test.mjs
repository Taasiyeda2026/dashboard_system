import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const activities = await readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
const helper = await readFile(new URL('../frontend/src/screens/shared/activity-list-latest-notes.js', import.meta.url), 'utf8');

test('2027 all and active inner tabs have different column contracts', () => {
  assert.match(activities, /const is2027AllTab = is2027Tab && state\.activitiesInnerTab === ACTIVITIES_INNER_TAB_ALL/);
  assert.match(activities, /const is2027ActivitiesTab = is2027Tab && state\.activitiesInnerTab === ACTIVITIES_INNER_TAB_2027/);
  assert.match(activities, /is2027AllTab \? '<th>איש קשר<\/th>' : ''/);
  assert.match(activities, /is2027ActivitiesTab \? '<th>המפגש הבא<\/th>' : ''/);
  assert.match(activities, /is2027AllTab \? 'הערה אחרונה' : 'מידע נוסף'/);
  assert.match(activities, /is2027ActivitiesTab \? nextMeetingDate\(row\) : ''/);
});

test('latest updates come from the 2027 timeline, not additional info', () => {
  assert.match(activities, /loadLatest2027ActivityUpdates\(loadedRows\)/);
  assert.match(activities, /latestUpdateDisplay\(latest\)/);
  assert.match(activities, /: String\(row\.notes \|\| '—'\)/);
  assert.match(helper, /\.from\('activity_update_notes'\)/);
  assert.match(helper, /String\(row\?\.activity_season \|\| ''\) === 'school_2027'/);
  assert.match(helper, /selectLatestActivityUpdates\(responses\.flatMap/);
  assert.doesNotMatch(helper, /\.insert\(|\.update\(|\.delete\(/);
});

test('next meeting uses the Israel-local date and future scheduled dates', () => {
  assert.match(activities, /function nextMeetingDate\(row\) \{\s*const today = todayYmdForActivityDefaults\(\)/);
  assert.match(activities, /dates\.filter\(\(d\) => d >= today\)\.sort\(\)/);
});

test('all 2027 table orders instructor before dates and scopes alignment styling', async () => {
  assert.ok(activities.includes("'<th>איש קשר</th>' : ''}<th>מדריך</th><th>תאריך התחלה</th>"));
  assert.ok(activities.includes('ds-table--activities-2027-all'));
  const style = await readFile(new URL('../frontend/src/activities-approved-ui-fix.js', import.meta.url), 'utf8');
  assert.ok(style.includes('.ds-table--activities-2027-all thead th:nth-child(-n+5)'));
  assert.ok(style.includes('.ds-table--activities-2027-all thead th:nth-child(6)'));
  assert.ok(style.includes('.ds-table--activities-2027-all thead th:nth-child(7)'));
});

test('2027 table uses a heading-free card and sticky column headers', async () => {
  assert.ok(activities.includes('ds-activities-table-card'));
  assert.ok(activities.includes('state.activityPeriodTab === ACTIVITY_SEASON_SCHOOL_2027'));
  const css = await readFile(new URL('../frontend/src/activities-approved-ui-fix.js', import.meta.url), 'utf8');
  assert.ok(css.includes('.ds-activities-table-card .ds-table-wrap'));
  assert.ok(css.includes('.ds-table--activities-2027 thead th'));
  assert.ok(css.includes('position: sticky !important;'));
});

test('sticky 2027 table headings cover the top scroll inset with opaque paint', async () => {
  const css = await readFile(new URL('../frontend/src/activities-approved-ui-fix.js', import.meta.url), 'utf8');
  const rule = css.match(/#app \.ds-activities-screen \.ds-activities-table-card \.ds-table--activities-2027 thead th \{([\s\S]*?)\}/);
  assert.ok(rule, 'scoped sticky header rule must exist');
  assert.match(rule[1], /position: sticky !important/);
  assert.match(rule[1], /top: -16px !important/);
  assert.match(rule[1], /background: #eaf6fa !important/);
  assert.match(rule[1], /border-bottom: 1px solid/);
  assert.match(rule[1], /box-shadow:/);
});

test('the pinned 2027 headings have white separator and restore the full page header on activation', async () => {
  const css = await readFile(new URL('../frontend/src/activities-approved-ui-fix.js', import.meta.url), 'utf8');
  assert.ok(activities.includes('data-activities-restore-header'));
  assert.ok(activities.includes("root.querySelector('.ds-activities-screen')?.scrollIntoView"));
  assert.ok(activities.includes("ev.target.matches?.('[data-activities-restore-header]')"));
  assert.ok(css.includes('0 4px 0 #fff'));
  assert.ok(css.includes('[data-activities-restore-header]:focus-visible th'));
});
