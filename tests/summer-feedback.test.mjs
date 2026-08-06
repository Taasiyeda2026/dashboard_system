import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const app = readFileSync(new URL('../frontend/public/summer-feedback/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../frontend/public/summer-feedback/styles.css', import.meta.url), 'utf8');
const dashboardEnhancer = readFileSync(new URL('../frontend/src/dashboard-kpi-corrections.js', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase/migrations/20260725090000_create_summer_feedback_schema.sql', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../supabase/migrations/20260725090001_seed_summer_feedback_assignments.sql', import.meta.url), 'utf8');
const ratingWindow = readFileSync(new URL('../supabase/migrations/20260725090003_enforce_summer_feedback_rating_window.sql', import.meta.url), 'utf8');
const previewHold = readFileSync(new URL('../supabase/migrations/20260725170000_hold_summer_feedback_for_admin_preview.sql', import.meta.url), 'utf8');
const draftAdmin = readFileSync(new URL('../supabase/migrations/20260725170100_restrict_summer_feedback_draft_to_admin.sql', import.meta.url), 'utf8');

test('standalone page uses separate static assets and is mobile ready', () => {
  assert.match(html, /<html lang="he" dir="rtl">/);
  assert.match(html, /width=device-width/);
  assert.match(html, /href="\.\/styles\.css"/);
  assert.match(html, /src="\.\/app\.js"/);
  assert.doesNotMatch(html, /GZIP_BASE64|DecompressionStream/);
  assert.match(css, /@media \(max-width:/);
});

test('feedback layout stays compact and proportional on desktop', () => {
  assert.match(css, /width: min\(1080px, calc\(100% - 32px\)\)/);
  assert.match(css, /font-size: 15px/);
  assert.match(css, /\.hero h1 \{ font-size: clamp\(27px, 3vw, 34px\); \}/);
  assert.match(css, /max-width: 112px/);
  assert.match(css, /width: fit-content/);
  assert.match(css, /\.table-wrap \.button/);
  assert.match(css, /min-height: 36px/);
  assert.doesNotMatch(css, /clamp\(27px,4vw,42px\)/);
});

test('client uses the existing Supabase Auth session and production tables', () => {
  assert.match(app, /@supabase\/supabase-js@2\.105\.3/);
  assert.match(app, /supabase\.auth\.getUser\(\)/);
  assert.match(app, /summer_feedback_cycles/);
  assert.match(app, /summer_feedback_assignments/);
  assert.match(app, /summer_feedback_responses/);
  assert.match(app, /summer_feedback_activity_ratings/);
  assert.doesNotMatch(app, /service[_-]?role/i);
});

test('autosave queues a follow-up save and submission waits for the newest revision', () => {
  assert.match(app, /revision:/);
  assert.match(app, /savedRevision:/);
  assert.match(app, /if \(state\.savePromise\)/);
  assert.match(app, /state\.savedRevision < state\.revision \? saveDraft/);
  assert.match(app, /clearTimeout\(state\.saveTimer\); markDirty\(\)/);
  assert.match(app, /status:'submitted'/);
});

test('manager instructors can fill their own feedback and switch to management after opening', () => {
  assert.match(app, /const ownAssignments/);
  assert.match(app, /requestedAdmin/);
  assert.match(app, /!cycleOpen/);
  assert.match(app, /\.\/\?view=admin/);
  assert.match(app, /המשוב שלי/);
});

test('admin-only preview can be tested without creating or saving a response', () => {
  assert.match(app, /previewMode:/);
  assert.match(app, /data-preview/);
  assert.match(app, /function previewInstructor/);
  assert.match(app, /תצוגה מקדימה לאדמין בלבד/);
  assert.match(app, /מצב תצוגה מקדימה — ללא שמירה וללא הגשה/);
  assert.match(app, /if \(state\.previewMode\) return true/);
  assert.match(app, /if \(state\.previewMode\) return;/);
  assert.match(app, /state\.response = \{ id:'preview'/);
  assert.match(app, /state\.ratings = \[\]/);
});

test('client blocks editing outside the cycle window and excludes unanswered means', () => {
  assert.match(app, /const cycleIsOpen/);
  assert.match(app, /if \(!cycleOpen\)/);
  assert.match(app, /value !== null && value !== undefined && value !== ''/);
  assert.match(app, /value >= 1 && value <= 5/);
  assert.match(app, /const rated=ratings\.filter/);
  assert.match(app, /count:rated\.length/);
});

test('highlighted activities require details before submission', () => {
  assert.match(app, /rating\.success_highlight && !rating\.success_reasons\.length && !rating\.success_note/);
  assert.match(app, /rating\.needs_improvement && !rating\.improvement_categories\.length && !rating\.improvement_note/);
});

test('CSV includes activity notes and all summary free text', () => {
  assert.match(app, /הערת הצלחה/);
  assert.match(app, /summary\.preserve/);
  assert.match(app, /summary\.improve/);
  assert.match(app, /summary\.training_needed/);
  assert.match(app, /summary\.additional_notes/);
});

test('feedback supports locking, manager reopen, selection limits and CSV export', () => {
  assert.match(app, /state\.submitted/);
  assert.match(app, /async function reopen/);
  assert.match(app, /function exportCsv/);
  assert.match(app, /עד שלוש פעילויות/);
});

test('dashboard does not expose the summer feedback button before final approval', () => {
  assert.doesNotMatch(dashboardEnhancer, /data-summer-feedback-link/);
  assert.doesNotMatch(dashboardEnhancer, /משוב פעילות הקיץ/);
  assert.doesNotMatch(dashboardEnhancer, /\.\/summer-feedback\//);
  assert.doesNotMatch(dashboardEnhancer, /\.instr-my-data-actions/);
});

test('migrations protect data, hold the cycle in draft and restrict draft access to admin', () => {
  assert.equal((schema.match(/enable row level security/g) || []).length, 4);
  assert.match(schema, /private\.is_summer_feedback_manager/);
  assert.match(ratingWindow, /c\.status = 'open'/);
  assert.match(ratingWindow, /c\.closes_at is null or c\.closes_at >= now\(\)/);
  assert.match(previewHold, /status='draft'/);
  assert.match(previewHold, /opens_at=null/);
  assert.match(previewHold, /closes_at=null/);
  assert.match(draftAdmin, /private\.is_summer_feedback_admin/);
  assert.match(draftAdmin, /u\.role='admin'/);
  assert.match(draftAdmin, /c\.status in \('open','closed'\)/);
  assert.match(seed, /md5\(activity\)/);
  assert.match(seed, /assignment_rows<>59/);
  assert.match(seed, /activity_total<>291/);
  assert.match(seed, /instructor_total<>10/);
});
