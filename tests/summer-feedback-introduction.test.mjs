import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/public/summer-feedback/feedback-introduction.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/public/summer-feedback/feedback-introduction.js', import.meta.url), 'utf8');

test('summer feedback loads the personalized introduction assets', () => {
  assert.match(html, /feedback-introduction\.css/);
  assert.match(html, /feedback-introduction\.js/);
});

test('introduction includes the requested purpose, reassurance and closing', () => {
  assert.match(js, /תודה רבה על הדרכת סדנאות הקיץ/);
  assert.match(js, /מה עבד היטב, מה היה חסר ומה לדעתך ניתן לשפר/);
  assert.match(js, /המשוב אינו מהווה הערכה של עבודתך או של תפקודך/);
  assert.match(js, /אין תשובות נכונות או לא נכונות/);
  assert.match(js, /ללמוד מהניסיון בשטח/);
  assert.match(js, /תודה על ההשקעה, על הכנות ועל שיתוף הפעולה/);
});

test('the greeting uses the instructor name and is placed before the questionnaire', () => {
  assert.match(js, /currentInstructorName/);
  assert.match(js, /שלום \$\{currentInstructorName\(\)\},/);
  assert.match(js, /hero\.insertAdjacentElement\('afterend', section\)/);
  assert.match(js, /document\.querySelector\('#feedbackForm'\)/);
});

test('introduction remains readable on mobile', () => {
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /font-size: 12\.5px/);
  assert.match(css, /line-height: 1\.55/);
});
