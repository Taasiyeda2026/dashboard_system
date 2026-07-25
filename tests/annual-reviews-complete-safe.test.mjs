import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../frontend/src/annual-reviews-safe-runtime.js', import.meta.url), 'utf8');
const nextYear = await readFile(new URL('../frontend/src/annual-reviews-next-school-year-safe.js', import.meta.url), 'utf8');
const roleLessons = await readFile(new URL('../frontend/src/annual-reviews-role-lessons-safe.js', import.meta.url), 'utf8');
const sharedStage = await readFile(new URL('../frontend/src/annual-reviews-shared-stage-safe.js', import.meta.url), 'utf8');
const combined = [runtime, nextYear, roleLessons, sharedStage].join('\n');

test('only the safe annual review extensions are loaded', () => {
  for (const file of [
    'annual-reviews-next-school-year-safe.js',
    'annual-reviews-role-lessons-safe.js',
    'annual-reviews-shared-stage-safe.js'
  ]) assert.match(entry, new RegExp(`import '\\.\\/${file.replaceAll('.', '\\.')}'`));

  assert.doesNotMatch(entry, /annual-reviews-next-school-year\.js/);
  assert.doesNotMatch(entry, /annual-reviews-role-lessons\.js/);
  assert.doesNotMatch(entry, /annual-reviews-shared-stage\.js/);
});

test('safe extensions do not observe or block the global DOM event flow', () => {
  assert.doesNotMatch(combined, /MutationObserver/);
  assert.doesNotMatch(combined, /stopImmediatePropagation|stopPropagation|preventDefault/);
  assert.doesNotMatch(combined, /window\.confirm\s*=/);
  assert.doesNotMatch(combined, /EventTarget\.prototype/);
});

test('extension scheduling is finite and resolves each rendered review once', () => {
  assert.match(runtime, /\[0, 80, 200, 500, 1000, 2000, 4000, 8000\]/);
  assert.match(runtime, /safeExtensionsResolved/);
  assert.doesNotMatch(runtime, /setInterval/);
});

test('next school year and role-specific data use the migrated tables', () => {
  for (const table of [
    'employee_review_next_school_year',
    'manager_review_next_school_year',
    'employee_review_interface_feedback',
    'manager_review_role_lessons'
  ]) assert.match(combined, new RegExp(table));
});

test('shared stage saves outcomes and uses the two participant approvals', () => {
  assert.match(sharedStage, /review_conversation_summary/);
  assert.match(sharedStage, /review_goals/);
  assert.match(sharedStage, /approve_conversation_as_employee/);
  assert.match(sharedStage, /approve_conversation_as_manager/);
  assert.match(sharedStage, /finish_review_conversation/);
  assert.match(sharedStage, /obsoleteFinish\.hidden = true/);
});

test('existing ratings remain visible and compact comments remain loaded', () => {
  assert.doesNotMatch(roleLessons, /roleMetricsReplaced|\.ar2-metrics.*hidden/);
  assert.match(entry, /annual-reviews-rating-comment-compact\.js/);
});
