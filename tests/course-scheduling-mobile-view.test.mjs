import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mobileCss = await readFile(new URL('../frontend/src/styles/mobile-responsive.css', import.meta.url), 'utf8');
const planning = await readFile(new URL('../frontend/src/screens/course-scheduling-planning.js', import.meta.url), 'utf8');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('scheduling mobile view shows the complete work plan balance without duplicate reporting chips', () => {
  assert.match(planning, /course-planning-workplan-balance/);
  assert.match(planning, /מתוכננות לצוות הקיים/);
  assert.match(planning, /תכנון לגיוס ולהכשרה/);
  assert.match(mobileCss, /course-planning-workplan-balance\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
});

test('mobile workload cards use one full-width total planned row', () => {
  assert.match(mobileCss, /is-load\s*\{[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(mobileCss, /is-load::before \{ content: "סה״כ מתוכנן"; \}/);
  assert.doesNotMatch(planning, /course-planning-completion-cell is-weekly/);
});

test('scheduling instructor overview becomes mobile work cards with expandable activity details', () => {
  assert.match(planning, /course-planning-completion-cell is-instructor/);
  assert.match(planning, /course-planning-completion-cell is-load/);
  assert.match(planning, /course-planning-completion-detail-row/);
  assert.match(planning, /פעילויות וקורסים/);
  assert.doesNotMatch(planning, /course-planning-completion-cell is-weekly/);
  assert.doesNotMatch(planning, /course-planning-completion-cell is-details/);
  assert.doesNotMatch(planning, /course-planning-completion-cell is-travel/);
  assert.match(mobileCss, /course-planning-completion-table thead\s*\{\s*display:\s*none/);
  assert.match(mobileCss, /course-planning-completion-table tbody > tr\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobileCss, /course-planning-completion-detail-row\[hidden\][\s\S]*display:\s*none !important/);
  assert.match(mobileCss, /course-planning-completion-activity-row[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});

test('scheduling mobile cache version points at the instructor detail stylesheet', () => {
  assert.match(indexHtml, /mobile-responsive\.css\?v=20260926-instructor-activity-details-v1/);
});
