import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../frontend/public/summer-feedback/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/public/summer-feedback/questionnaire.css', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260725193000_expand_summer_feedback_questionnaire.sql', import.meta.url), 'utf8');

test('questionnaire covers the full instructor support envelope in compact groups', () => {
  assert.match(app, /const GENERAL_GROUPS/);
  for (const title of ['תוכן והכשרה','תיאום ושיבוץ','ניהול הפעילות והמענה השוטף','לוגיסטיקה וציוד','תחושת ביטחון ומעטפת']) {
    assert.match(app, new RegExp(title));
  }
  assert.match(app, /daily_readiness_check/);
  assert.match(app, /post_activity_followup/);
  assert.match(app, /management_communication/);
  assert.match(app, /feedback-group/);
  assert.match(css, /\.feedback-groups/);
  assert.match(html, /questionnaire\.css/);
});

test('each activity has eight ratings and one free-text note', () => {
  for (const key of ['age_fit','time_fit','content_clarity','delivery_ease','equipment_quality','student_engagement','student_success','overall_rating']) {
    assert.match(app, new RegExp(key));
  }
  assert.match(app, /הערה או המלצה לפעילות זו/);
  assert.match(app, /data-note="additional"/);
  assert.match(app, /additional_note:/);
  assert.match(app, /0\/\$\{METRICS\.length\}/);
});

test('database migration expands metrics and treats current report rows as completed', () => {
  for (const column of ['content_clarity','delivery_ease','student_engagement','overall_rating']) {
    assert.match(migration, new RegExp(`add column if not exists ${column}`));
  }
  assert.match(migration, /coalesce\(trim\(a\.status\), ''\) not in \('נמחק', 'בוטל'\)/);
  assert.match(migration, /question_version = 2/);
  assert.match(migration, /status = 'draft'/);
  assert.match(migration, /הילה רוזן', 'אפרת אוחיון', 'כרמית סמנדרוב/);
  assert.match(migration, /v_assignment_total <> v_source_total/);
});

test('admin analysis and CSV export include the expanded questionnaire', () => {
  assert.match(app, /METRICS\.map\(\(\[,label\]\)=>`<th>/);
  assert.match(app, /GENERAL\.map\(\(\[,label\]\)=>label\)/);
  assert.match(app, /summary\.management_interface/);
  assert.match(app, /rating\.additional_note/);
});
