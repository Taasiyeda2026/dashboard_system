import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('dashboard summary wording is correct Hebrew phrasing', () => {
  const src = read('frontend/src/screens/dashboard.js');
  assert.match(src, /יש \(<strong>\$\{activeCurrent\}<\/strong>\) קורסים פעילים/);
  assert.match(src, /להסתיים \(<strong>\$\{endingCurrent\}<\/strong>\) קורסים\./);
});

test('exceptions month title uses Hebrew month label helper', () => {
  const src = read('frontend/src/screens/exceptions.js');
  assert.match(src, /function hebrewMonthLabel\(ym\)/);
  assert.match(src, /hebrewMonthLabel\(data\.month\)/);
});

test('activities include activity_type filter and clear hook resets drill state', () => {
  const src = read('frontend/src/screens/activities.js');
  assert.match(src, /key: 'activity_type', label: 'סוג הפעילות'/);
  assert.match(src, /onClear:\s*\(\)\s*=>\s*\{[\s\S]*activityQuickFamily\s*=\s*'';[\s\S]*activityQuickManager\s*=\s*'';[\s\S]*activityEndingCurrentMonth\s*=\s*false;/);
});


test('activity drawer keeps export action grouped next to close action', () => {
  const htmlSrc = read('frontend/src/screens/shared/activity-detail-html.js');
  const css = read('frontend/src/styles/main.css');
  assert.match(htmlSrc, /function headerActionsHtml\(exportAction\)/);
  assert.match(htmlSrc, /activity-drawer__header-actions/);
  assert.match(css, /\.activity-drawer__header-actions \{[\s\S]*display: inline-flex;[\s\S]*align-items: center;/);
});

test('edit request user-facing wording is neutral save wording', () => {
  const htmlSrc = read('frontend/src/screens/shared/activity-detail-html.js');
  const bindSrc = read('frontend/src/screens/shared/bind-activity-edit-form.js');
  assert.doesNotMatch(htmlSrc, /שליחה לאישור/);
  assert.doesNotMatch(bindSrc, /שולח לאישור|בקשת העריכה נשלחה לאישור/);
  assert.match(htmlSrc, /data-action="save-edit">שמור<\/button>/);
  assert.match(bindSrc, /העדכון התקבל/);
});

test('exceptions source is filtered to course activities before exception checks', () => {
  const apiSrc = read('frontend/src/api.js');
  assert.match(apiSrc, /function rowActivityType\(row = \{\}\)/);
  assert.match(apiSrc, /if \(rowActivityType\(row\) !== 'course'\) continue;[\s\S]*const types = \[\];/);
  assert.match(apiSrc, /selectActivitiesByDateRangeFromSupabase\(\{[\s\S]*activityType: 'course',[\s\S]*includeEndDate: true[\s\S]*\}\)\)\.filter\(\(row\) => \{\s*if \(rowActivityType\(row\) !== 'course'\) return false;/);
});

test('instructors screen counts normalized activity_type keys', () => {
  const screenSrc = read('frontend/src/screens/instructors.js');
  const apiSrc = read('frontend/src/api.js');
  assert.match(apiSrc, /contacts_instructors/);
  assert.match(apiSrc, /activity_type_counts: stats\.activity_type_counts/);
  assert.match(screenSrc, /\[\['course', 'קורס', 'קורסים'\], 'קורסים'\]/);
  assert.match(screenSrc, /typeStats = TYPE_LABELS\.map/);
  assert.match(screenSrc, /keys\.reduce\(\(sum, key\) => sum \+ Number\(typeCounts\[key\] \|\| 0\), 0\)/);
});

test('activity drawer edit details use compact three-column field wrappers', () => {
  const htmlSrc = read('frontend/src/screens/shared/activity-detail-html.js');
  const css = read('frontend/src/styles/main.css');
  assert.match(htmlSrc, /function fieldEditOnly\(label, editHtml, extraClass = ''\)[\s\S]*<label class="activity-drawer__label">\$\{escapeHtml\(label\)\}<\/label>[\s\S]*\$\{editHtml\}/);
  assert.match(htmlSrc, /activity-drawer__details-edit-grid/);
  assert.match(htmlSrc, /name: 'activity_manager'/);
  assert.match(htmlSrc, /name: 'instructor_name'/);
  assert.match(htmlSrc, /name: 'activity_type'/);
  assert.match(htmlSrc, /'סטטוס'[\s\S]*name: 'status'[\s\S]*'רשות'[\s\S]*name: 'authority'[\s\S]*'כיתה'[\s\S]*name: 'grade'[\s\S]*name: 'class_group'[\s\S]*'שעות'[\s\S]*name: 'start_time'[\s\S]*name: 'end_time'/);
  assert.match(css, /\.activity-drawer__details-edit-grid \{[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.activity-drawer__details-edit-grid \.ds-input,[\s\S]*width: 100%;[\s\S]*height: 34px;/);
});
