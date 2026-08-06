import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const compactCss = readFileSync(new URL('../frontend/public/summer-feedback/compact-overrides.css', import.meta.url), 'utf8');
const variants = readFileSync(new URL('../frontend/public/summer-feedback/feedback-variants.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260725183000_split_biomimicry_feedback_variants.sql', import.meta.url), 'utf8');

test('loads the second compact layout pass after the base stylesheet', () => {
  assert.match(html, /styles\.css/);
  assert.match(html, /compact-overrides\.css/);
  assert.ok(html.indexOf('compact-overrides.css') > html.indexOf('styles.css'));
  assert.match(compactCss, /width: min\(960px/);
  assert.match(compactCss, /min-height: 31px/);
  assert.match(compactCss, /font-size: 13\.5px/);
  assert.match(compactCss, /max-width: 94px/);
});

test('loads feedback-only biomimicry presentation rules', () => {
  assert.match(html, /feedback-variants\.js/);
  assert.match(variants, /הילה רוזן/);
  assert.match(variants, /אפרת אוחיון/);
  assert.match(variants, /כרמית סמנדרוב/);
  assert.match(variants, /עולם הביומימיקרי הקסום \(פיזי\)/);
  assert.match(variants, /עולם הביומימיקרי הקסום \(דיגיטלי\)/);
  assert.match(variants, /variantCountHidden/);
});

test('migration adds both variants only to the three instructors and preserves totals', () => {
  assert.match(migration, /activity_count >= 0/);
  assert.match(migration, /activity_count,\n    grade_labels/);
  assert.match(migration, /'הילה רוזן', 'אפרת אוחיון', 'כרמית סמנדרוב'/);
  assert.match(migration, /עולם הביומימיקרי הקסום \(פיזי\)/);
  assert.match(migration, /עולם הביומימיקרי הקסום \(דיגיטלי\)/);
  assert.match(migration, /activity_count = 0/);
  assert.match(migration, /on conflict \(cycle_id, instructor_auth_user_id, activity_key\)/);
});
