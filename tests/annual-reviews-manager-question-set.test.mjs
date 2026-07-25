import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entry = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const moduleText = await readFile(new URL('../frontend/src/annual-reviews-manager-question-set.js', import.meta.url), 'utf8');

const defaultKeys = [
  'professional_quality',
  'task_management',
  'collaboration_communication',
  'initiative_problem_solving',
  'learning_feedback',
  'achievements_strengths',
  'improvement_lessons',
  'managerial_support'
];

const tonyKeys = [
  'professional_quality',
  'financial_documentation',
  'task_management',
  'problem_solving_followup',
  'initiative_broad_view',
  'collaboration_communication',
  'achievements_strengths',
  'improvement_conversation'
];

function arrayBlock(name) {
  const start = moduleText.indexOf(`const ${name} = [`);
  assert.notEqual(start, -1, `${name} was not found`);
  const end = moduleText.indexOf('\n];', start);
  assert.notEqual(end, -1, `${name} closing token was not found`);
  return moduleText.slice(start, end + 3);
}

function keysIn(block) {
  return [...block.matchAll(/\n\s+key: '([^']+)'/g)].map((match) => match[1]);
}

const defaultBlock = arrayBlock('DEFAULT_QUESTIONS');
const tonyBlock = arrayBlock('TONY_QUESTIONS');

test('focused manager question set is loaded after the annual review extensions', () => {
  assert.match(entry, /import '\.\/annual-reviews-manager-question-set\.js';/);
  assert.ok(entry.indexOf('annual-reviews-manager-question-set.js') > entry.indexOf('annual-reviews-role-lessons-safe.js'));
});

test('the default manager form remains eight questions', () => {
  assert.deepEqual(keysIn(defaultBlock), defaultKeys);
  assert.equal((defaultBlock.match(/rating: true/g) || []).length, 5);
  assert.equal((defaultBlock.match(/rating: false/g) || []).length, 3);
});

test('Tony Naim receives exactly eight tailored manager questions', () => {
  assert.deepEqual(keysIn(tonyBlock), tonyKeys);
  assert.equal((tonyBlock.match(/rating: true/g) || []).length, 6);
  assert.equal((tonyBlock.match(/rating: false/g) || []).length, 2);
  assert.match(moduleText, /=== 'טוני נעים' \? TONY_QUESTIONS : DEFAULT_QUESTIONS/);
});

test('Tony selection is exact and all other employee names use the default set', () => {
  assert.match(moduleText, /String\(employeeName \|\| ''\)\.trim\(\) === 'טוני נעים'/);
  assert.doesNotMatch(moduleText, /includes\('טוני'\)|startsWith\('טוני'\)/);
});

test('Tony questions cover observable documentation, follow-up, initiative and conversation topics', () => {
  assert.match(tonyBlock, /תיעוד מלא, מדויק, שוטף וניתן לאיתור/);
  assert.match(tonyBlock, /במועדים הנמצאים בשליטתה/);
  assert.match(tonyBlock, /פועלת לבירורם, עוקבת אחר הטיפול/);
  assert.match(tonyBlock, /חושבת מעבר למשימה המיידית/);
  assert.match(tonyBlock, /נושאים חשוב לברר עמה במהלך שיחת המשוב/);
  assert.doesNotMatch(tonyBlock, /אחריות וליווי ניהולי|מה נדרש מהמנהל לעשות/);
});

test('legacy manager additions and role metrics are removed from the screen', () => {
  assert.match(moduleText, /form\[data-ar2-form="manager"\]/);
  assert.match(moduleText, /section\.querySelector\('\.ar2-metrics'\)/);
  assert.match(moduleText, /next-year-manager/);
  assert.match(moduleText, /lessons-manager/);
});

test('the replacement is bounded and does not use global DOM observers or click blocking', () => {
  assert.doesNotMatch(moduleText, /MutationObserver|EventTarget\.prototype|stopImmediatePropagation|stopPropagation|preventDefault/);
});
