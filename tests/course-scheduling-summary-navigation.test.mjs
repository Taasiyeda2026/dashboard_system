import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const screen = readFileSync(new URL('../frontend/src/screens/course-scheduling.js', import.meta.url), 'utf8');
const baseCss = readFileSync(new URL('../frontend/src/screens/course-scheduling.css', import.meta.url), 'utf8');
const densityCss = readFileSync(new URL('../frontend/src/screens/course-scheduling-density-polish.css', import.meta.url), 'utf8');
const compactCss = readFileSync(new URL('../frontend/src/screens/course-scheduling-compact-layout.css', import.meta.url), 'utf8');
const compactEnhancer = readFileSync(new URL('../frontend/src/screens/course-scheduling-compact-layout.js', import.meta.url), 'utf8');

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

test('stale planning keeps the instructor summary visible with a currency notice', () => {
  assert.match(screen, /data-planning-overview-currency/);
  assert.match(screen, /הדוח משלב שיבוצים וטיוטות קיימים עם הצעות תכנון/);
  assert.doesNotMatch(screen, /טבלת תכנון המדריכים תוצג לאחר/);
  assert.match(screen, /\$\{completionCache\.html\}/);
});

test('active summary filter has pointer, focus and selected styling', () => {
  assert.match(baseCss, /course-scheduling-summary-card--button:focus-visible/);
  assert.match(baseCss, /course-scheduling-summary-card--button\.is-active/);
  assert.match(densityCss, /course-scheduling-summary-card--button\.is-active/);
  assert.match(densityCss, /box-shadow:\s*inset 0 -3px 0 var\(--cs-accent\)/);
});

test('native six-column workboard does not receive a second legacy header or hijack its first action click', () => {
  assert.match(screen, /const header = '<div class="course-scheduling-compact-table-head"/);
  assert.match(compactEnhancer, /if \(!screen\.classList\.contains\('is-simple-workboard'\)\) createTableHeader\(coursesRoot\)/);
  assert.match(compactEnhancer, /coursesRoot\.querySelector\('\.course-scheduling-compact-table-head'\)/);
  const start = compactEnhancer.indexOf('if (isNativeCompactRow(card)) {');
  const end = compactEnhancer.indexOf("if (card.closest('.course-scheduling-compact-row'))", start);
  assert.ok(start >= 0 && end > start, 'native row enhancer branch exists');
  const nativeRowBranch = compactEnhancer.slice(start, end);
  assert.match(nativeRowBranch, /return;/);
  assert.doesNotMatch(nativeRowBranch, /addEventListener|stopPropagation|\.click\(/);
});

test('four summary cards fill the width and the list uses one page scrollbar', () => {
  assert.match(compactCss, /\.course-scheduling-screen\.is-simple-workboard \.course-scheduling-summary \{\s*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(compactCss, /\.course-scheduling-screen\.is-simple-workboard\.is-compact-symmetric-layout \.course-scheduling-courses \{[^}]*max-height: none;[^}]*overflow: visible;/);
  assert.match(compactCss, /\[data-course-list-body\] > nav\.course-scheduling-detail-actions button/);
});
