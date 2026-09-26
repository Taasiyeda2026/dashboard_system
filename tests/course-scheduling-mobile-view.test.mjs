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

test('scheduling instructor overview becomes mobile work cards without desktop operational columns', () => {
  assert.match(planning, /course-planning-completion-cell is-instructor/);
  assert.match(planning, /course-planning-completion-cell is-load/);
  assert.match(planning, /course-planning-completion-cell is-weekly/);
  assert.doesNotMatch(planning, /course-planning-completion-cell is-travel/);
  assert.match(mobileCss, /course-planning-completion-table thead\s*\{\s*display:\s*none/);
  assert.match(mobileCss, /course-planning-completion-table tbody > tr\s*\{[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobileCss, /course-planning-completion-cell\.is-load,[\s\S]*course-planning-completion-cell\.is-weekly\s*\{[\s\S]*grid-column:\s*span 2/);
  assert.match(mobileCss, /course-planning-completion-programs\s*\{\s*display:\s*none/);
  assert.match(mobileCss, /course-planning-completion-courses\s*\{[\s\S]*min-width:\s*0/);
});

test('scheduling mobile cache version points at the full work plan stylesheet', () => {
  assert.match(indexHtml, /mobile-responsive\.css\?v=20260926-full-work-plan-v1/);
});
