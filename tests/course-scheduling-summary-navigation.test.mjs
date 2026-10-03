import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
const baseCss = readFileSync(new URL('../frontend/src/screens/course-scheduling.css', import.meta.url), 'utf8');
const densityCss = readFileSync(new URL('../frontend/src/screens/course-scheduling-density-polish.css', import.meta.url), 'utf8');

test('summary totals are accessible status filters for the activity table', () => {
  assert.match(screen, /data-business-summary-filter="\$\{key\}"/);
  assert.match(screen, /aria-pressed="\$\{active \? 'true' : 'false'\}"/);
  for (const key of ['all', 'open', 'draft', 'assigned']) {
    assert.match(screen, new RegExp("\\['" + key + "'"));
  }
  assert.match(screen, /state\.courseSchedulingBusinessStatus = requested !== 'all' && requested === current \? 'all' : requested/);
  assert.match(screen, /state\.courseSchedulingScrollToFilteredList = true/);
  assert.match(screen, /data-course-list tabindex="-1"/);
  assert.match(screen, /scrollIntoView\?\.\(\{ block: 'start', behavior: 'auto' \}\)/);
});

test('status-card filtering keeps the filtered table context visible', () => {
  assert.match(screen, /data-course-list-context/);
  assert.match(screen, /פעילויות \$\{escapeHtml\(selectedGroup\?\.label \|\| ''\)\}/);
  assert.match(screen, /state\.courseSchedulingBusinessStatus = event\.target\.value \|\| 'all'/);
});

test('workboard row actions explain single-course workflows clearly', () => {
  assert.match(screen, />פתח \/ שינוי שיבוץ<\/button>/);
  assert.match(screen, />בדוק ושבץ<\/button>/);
  assert.doesNotMatch(screen, />בדיקה ידנית<\/button>/);
  assert.match(screen, /'בחר מדריך אחר'/);
});

test('stale planning explains where the instructor summary table went', () => {
  assert.match(screen, /data-planning-overview-pending/);
  assert.match(screen, /טבלת תכנון המדריכים תוצג לאחר חישוב התכנון המעודכן/);
  assert.match(screen, /עומס, פעילויות, מפגשים, שבוע שיא ותאריכי עבודה לכל מדריך/);
});

test('active summary filter has pointer, focus and selected styling', () => {
  assert.match(baseCss, /course-scheduling-summary-card--button:focus-visible/);
  assert.match(baseCss, /course-scheduling-summary-card--button\.is-active/);
  assert.match(densityCss, /course-scheduling-summary-card--button\.is-active/);
  assert.match(densityCss, /box-shadow:\s*inset 0 -3px 0 var\(--cs-accent\)/);
});
