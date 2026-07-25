import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../frontend/public/summer-feedback/questionnaire-refinements.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/public/summer-feedback/questionnaire-refinements.css', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260725211000_refine_feedback_hierarchy_and_scope.sql', import.meta.url), 'utf8');

test('questionnaire distinguishes sections, questions and answers', () => {
  assert.match(html, /questionnaire-refinements\.css/);
  assert.match(html, /questionnaire-refinements\.js/);
  assert.match(css, /--section-accent/);
  assert.match(css, /\.answer-row/);
  assert.match(css, /font-weight: 450/);
  assert.match(script, /textContent = 'דירוג'/);
});

test('management section is reduced to six focused visible statements', () => {
  assert.match(script, /MANAGEMENT_VISIBLE_KEYS/);
  assert.match(script, /management_contact_clarity/);
  assert.match(script, /daily_readiness_check/);
  assert.match(script, /ongoing_contact/);
  assert.match(script, /6 היגדים/);
  assert.match(css, /\.merged-question-hidden/);
});

test('activity cards contain one free note without duplicate expanding prompts', () => {
  assert.match(script, /removeDuplicateActivityPrompts/);
  assert.match(script, /\.highlights, \.detail-box/);
  assert.match(css, /\.highlights\[hidden\]/);
  assert.match(css, /\.detail-box\[hidden\]/);
});

test('Tamir activities are excluded from the summer feedback scope', () => {
  assert.match(migration, /תמיר - חדר בריחה קווסט/);
  assert.match(migration, /תמיר - המחזור מתחיל בבית/);
  assert.match(migration, /delete from public\.summer_feedback_assignments/);
  assert.match(migration, /question_version = 3/);
  assert.match(migration, /status = 'draft'/);
});
