import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const html = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const dashboardEnhancer = readFileSync(new URL('../frontend/src/dashboard-kpi-corrections.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/migrations/20260725090000_create_summer_feedback_schema.sql', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../supabase/migrations/20260725090001_seed_summer_feedback_assignments.sql', import.meta.url), 'utf8');

function embeddedSource(variableName) {
  const match = html.match(new RegExp(`const ${variableName} = '([^']+)'`));
  assert.ok(match, `${variableName} must be embedded`);
  return gunzipSync(Buffer.from(match[1], 'base64')).toString('utf8');
}

const css = embeddedSource('CSS_GZIP_BASE64');
const app = embeddedSource('JS_GZIP_BASE64');

test('standalone page is RTL, mobile ready and has a safe loader fallback', () => {
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /width=device-width/);
  assert.match(html, /DecompressionStream/);
  assert.match(html, /חזרה לדשבורד/);
  assert.match(css, /@media \(max-width:/);
});

test('embedded client uses the existing Supabase Auth session and production tables', () => {
  assert.match(app, /@supabase\/supabase-js@2\.105\.3/);
  assert.match(app, /supabase\.auth\.getUser\(\)/);
  assert.match(app, /summer_feedback_cycles/);
  assert.match(app, /summer_feedback_assignments/);
  assert.match(app, /summer_feedback_responses/);
  assert.match(app, /summer_feedback_activity_ratings/);
  assert.doesNotMatch(app, /service[_-]?role/i);
});

test('feedback supports autosave, submit lock, manager reopen and CSV export', () => {
  assert.match(app, /savePromise/);
  assert.match(app, /status: 'submitted'/);
  assert.match(app, /state\.submitted/);
  assert.match(app, /reopenResponse/);
  assert.match(app, /exportCsv/);
  assert.match(app, /עד שלוש פעילויות/);
});

test('dashboard inserts the feedback link only in the instructor actions area', () => {
  assert.match(dashboardEnhancer, /\.instr-my-data-actions/);
  assert.match(dashboardEnhancer, /data-summer-feedback-link/);
  assert.match(dashboardEnhancer, /\.\/summer-feedback\//);
  assert.match(dashboardEnhancer, /MutationObserver/);
});

test('migrations create RLS protection and seed the exact closed summer workload', () => {
  assert.equal((schema.match(/enable row level security/g) || []).length, 4);
  assert.match(schema, /private\.is_summer_feedback_manager/);
  assert.match(schema, /instructor_auth_user_id=\(select auth\.uid\(\)\)/);
  assert.match(seed, /md5\(activity\)/);
  assert.match(seed, /assignment_rows<>59/);
  assert.match(seed, /activity_total<>291/);
  assert.match(seed, /instructor_total<>10/);
});
