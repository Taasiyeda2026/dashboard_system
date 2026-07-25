import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const roleLessons = await readFile(new URL('../frontend/src/annual-reviews-role-lessons-safe.js', import.meta.url), 'utf8');

function blockBetween(startToken, endToken) {
  const start = roleLessons.indexOf(startToken);
  assert.notEqual(start, -1, `${startToken} was not found`);
  const end = roleLessons.indexOf(endToken, start);
  assert.notEqual(end, -1, `${endToken} was not found after ${startToken}`);
  return roleLessons.slice(start, end);
}

const commonBlock = blockBetween('const COMMON_EMPLOYEE_QUESTIONS = [', 'const ROLE_EMPLOYEE_QUESTIONS = {');
const roleBlock = blockBetween('const ROLE_EMPLOYEE_QUESTIONS = {', 'const TABLES = {');

test('all employees receive one opening question and four common interface questions', () => {
  for (const key of [
    'period_overview',
    'direct_manager_interface',
    'managerial_support',
    'marketing_pedagogy_interface',
    'marketing_pedagogy_improvement'
  ]) assert.match(commonBlock, new RegExp(`key: '${key}'`));

  assert.equal((commonBlock.match(/key: '/g) || []).length, 5);
  assert.match(commonBlock, /כיצד את\/ה מסכם\/ת את התקופה הנבחנת מנקודת מבטך/);
  assert.match(commonBlock, /המנהל הישיר/);
  assert.match(commonBlock, /יעל אביב, מנהלת השיווק והפדגוגיה/);
});

test('the opening and common interface group is displayed before the core questions', () => {
  assert.match(roleLessons, /title: 'פתיחה וממשקי עבודה'/);
  assert.match(roleLessons, /querySelector\('\.ar2-question-list'\)\?\.prepend\(employeeGroup\)/);
});

test('Gil and Eden are described as parallel activity management and operations functions', () => {
  assert.match(roleBlock, /'גיל נאמן': \[/);
  assert.match(roleBlock, /ממשק העבודה מול תפעול הפעילויות, התיאום והשיבוץ/);
  assert.match(roleBlock, /בין ניהול הפעילויות לתפעול הפעילויות/);

  assert.match(roleBlock, /'עדן כהן': \[/);
  assert.match(roleBlock, /ממשק העבודה מול תחום ניהול הפעילויות/);
  assert.match(roleBlock, /בין תפעול הפעילויות לתחום ניהול הפעילויות/);
  assert.doesNotMatch(roleBlock, /גיל.*המנהל של עדן|עדן.*כפופה לגיל/);
});

test('Hila receives interfaces with activity management and activity operations', () => {
  assert.match(roleBlock, /'הילה רוזן': \[/);
  assert.match(roleBlock, /ממשק העבודה מול ניהול הפעילויות/);
  assert.match(roleBlock, /ממשק העבודה מול תפעול הפעילויות, התיאום והשיבוץ/);
  assert.match(roleBlock, /בין תחום ההדרכה לניהול הפעילויות/);
  assert.match(roleBlock, /בין תחום ההדרכה לתפעול הפעילויות/);
});

test('Tony keeps her existing four role-specific employee interface questions', () => {
  for (const key of [
    'coordination_admin_current_interface',
    'coordination_admin_next_year_interface',
    'activity_managers_current_interface',
    'activity_managers_next_year_interface'
  ]) assert.match(roleBlock, new RegExp(`key: '${key}'`));
});

test('the implementation remains bounded and avoids global DOM observers or click blocking', () => {
  assert.doesNotMatch(roleLessons, /MutationObserver|EventTarget\.prototype|stopImmediatePropagation|stopPropagation|preventDefault/);
});
