import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const moduleText = await readFile(new URL('../frontend/src/annual-reviews-manager-question-set.js', import.meta.url), 'utf8');

const expectedKeys = [
  'professional_quality',
  'task_management',
  'collaboration_communication',
  'initiative_problem_solving',
  'learning_feedback',
  'achievements_strengths',
  'improvement_lessons',
  'managerial_support'
];

test('focused manager question set is loaded after the annual review extensions', () => {
  assert.match(entry, /import '\.\/annual-reviews-manager-question-set\.js';/);
  assert.ok(entry.indexOf('annual-reviews-manager-question-set.js') > entry.indexOf('annual-reviews-role-lessons-safe.js'));
});

test('manager form contains exactly eight approved questions', () => {
  for (const key of expectedKeys) assert.match(moduleText, new RegExp(`key: '${key}'`));
  const keyMatches = [...moduleText.matchAll(/\n\s+key: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(keyMatches, expectedKeys);
});

test('five questions are rated and three are open', () => {
  assert.equal((moduleText.match(/rating: true/g) || []).length, 5);
  assert.equal((moduleText.match(/rating: false/g) || []).length, 3);
});

test('legacy manager additions and role metrics are removed from the screen', () => {
  assert.match(moduleText, /form\[data-ar2-form="manager"\]/);
  assert.match(moduleText, /section\.querySelector\('\.ar2-metrics'\)/);
  assert.match(moduleText, /next-year-manager/);
  assert.match(moduleText, /role-lessons-manager/);
});

test('the replacement is bounded and does not use global DOM observers or click blocking', () => {
  assert.doesNotMatch(moduleText, /MutationObserver|EventTarget\.prototype|stopImmediatePropagation|stopPropagation|preventDefault/);
});
