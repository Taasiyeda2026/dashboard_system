import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/public/summer-feedback/questionnaire-refinements.css', import.meta.url), 'utf8');
const js = readFileSync(new URL('../frontend/public/summer-feedback/questionnaire-refinements.js', import.meta.url), 'utf8');

test('summer feedback uses a professional dark-blue, gray and white visual system', () => {
  assert.match(html, /theme-color" content="#183153"/);
  assert.match(css, /--primary: #183153/);
  assert.match(css, /background: linear-gradient\(135deg, #1b3557, #10243d\)/);
  assert.doesNotMatch(css, /#0f766e|#115e59|#2f7d4d|#eefaf8|#f0faf3/i);
});

test('the real Taasiyeda logo replaces the text-only brand', () => {
  assert.match(js, /BRAND_LOGO_SRC = '\.\.\/catalog\/summercatalog\/logo\.png'/);
  assert.match(js, /brand\.replaceChildren\(logo, subtitle\)/);
  assert.match(css, /\.brand-logo/);
});

test('questions are visually stronger than answer labels and statement captions are removed', () => {
  assert.match(css, /\.question > span:not\(\.answer-label\)[\s\S]*font-weight: 600/);
  assert.match(css, /\.answer-label[\s\S]*font-weight: 450/);
  assert.match(css, /\.feedback-group > summary small \{ display: none !important; \}/);
  assert.doesNotMatch(js, /6 היגדים/);
});

test('drafts can be saved and the last position is restored before final submission', () => {
  assert.match(js, /שמירה והמשך מאוחר יותר/);
  assert.match(js, /סיום והגשת המשוב/);
  assert.match(js, /localStorage\.setItem/);
  assert.match(js, /restoreResumeState/);
  assert.match(js, /window\.scrollTo/);
  assert.match(js, /visibilitychange/);
});

test('mobile layout has explicit touch and narrow-screen handling', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-height: 40px/);
  assert.match(css, /\.metric-grid \{ grid-template-columns: 1fr; \}/);
});
