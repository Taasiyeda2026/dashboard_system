import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const attendanceRuntime = fs.readFileSync(new URL('../attendance/src/attendance-ux-fixes-runtime.js', import.meta.url), 'utf8');
const attendanceCss = fs.readFileSync(new URL('../attendance/src/styles/attendance-ux-fixes.css', import.meta.url), 'utf8');
const attendanceIndex = fs.readFileSync(new URL('../attendance/index.html', import.meta.url), 'utf8');
const digestMigration = fs.readFileSync(new URL('../supabase/migrations/20260908030500_fix_attendance_digest_search_path.sql', import.meta.url), 'utf8');
const deadlinesMigration = fs.readFileSync(new URL('../supabase/migrations/20260908033000_manager_team_deadlines.sql', import.meta.url), 'utf8');
const trackingRuntime = fs.readFileSync(new URL('../frontend/src/manager-board-employee-file-tracking-runtime.js', import.meta.url), 'utf8');
const milestoneRuntime = fs.readFileSync(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const dialogRuntime = fs.readFileSync(new URL('../frontend/src/system-dialog-runtime.js', import.meta.url), 'utf8');
const rootIndex = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('attendance operation detail appears only for the Other option', () => {
  assert.match(attendanceRuntime, /selectedLabel === 'אחר'/);
  assert.match(attendanceRuntime, /wrap\.hidden = !show/);
  assert.match(attendanceRuntime, /wrap\.style\.display = show \? '' : 'none'/);
  assert.match(attendanceCss, /\.av2-field\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test('attendance desktop navigation removes duplicate actions and adds dashboard return', () => {
  assert.match(attendanceCss, /\.av2-home__primary\s*\{\s*display:\s*none\s*!important/);
  assert.match(attendanceCss, /\.av2-reports__toolbar \.av2-btn--primary\s*\{\s*display:\s*none\s*!important/);
  assert.match(attendanceCss, /\.av2-report__header > \.av2-btn--icon\s*\{\s*display:\s*none\s*!important/);
  assert.match(attendanceRuntime, /dataset\.av2Dashboard/);
  assert.match(attendanceRuntime, /window\.location\.assign\('\/dashboard_system\/'\)/);
  assert.match(attendanceIndex, /attendance-ux-fixes-runtime\.js\?v=64/);
});

test('attendance desktop controls stay compact and travel status is not a full-width banner', () => {
  assert.match(attendanceCss, /grid-template-columns:\s*repeat\(auto-fit, minmax\(112px, 128px\)\)/);
  assert.match(attendanceCss, /\.av2-home__month-submit[\s\S]*?width:\s*128px/);
  assert.match(attendanceCss, /\.av2-bottom-nav__dashboard[\s\S]*?flex:\s*0 0 auto/);
  assert.match(attendanceCss, /\.av2-bottom-nav__dashboard[\s\S]*?min-width:\s*92px/);
  assert.match(attendanceCss, /\.av2-report-row \.av2-rr__travel-compensation[\s\S]*?width:\s*max-content/);
});

test('only the explicit home edit action targets the report editor', () => {
  assert.match(attendanceRuntime, /openExplicitlyRequestedReportEditor/);
  assert.match(attendanceRuntime, /openExplicitlyRequestedReportEditor\(\);/);
  assert.doesNotMatch(attendanceRuntime, /openExplicitRequestedReportEditor/);
  assert.match(attendanceRuntime, /\.av2-report-row\[data-record-id=/);
  assert.match(attendanceRuntime, /button\[aria-label="עריכה"\]/);
  assert.doesNotMatch(attendanceRuntime, /handleHomeReportClick|\.av2-home \.av2-report-summary-row/);
});

test('attendance digest fix resolves pgcrypto through the extensions schema', () => {
  assert.match(digestMigration, /av2_attendance_travel_context\(uuid, uuid\)/);
  assert.match(digestMigration, /search_path\s*=\s*public, extensions/);
});

test('manager deadlines implement the three approved one-month rules', () => {
  assert.match(deadlinesMigration, /intro_feedback_due_date/);
  assert.match(deadlinesMigration, /coalesce\(usr\.employee_created_at, ef\.created_at\)::date \+ interval '1 month'/);
  assert.match(deadlinesMigration, /first_activity_date \+ interval '1 month'/);
  assert.match(deadlinesMigration, /observation_1_completed_at::date \+ interval '1 month'/);
  assert.match(trackingRuntime, /intro_feedback_due_date/);
  assert.match(trackingRuntime, /observation_1_due_date/);
  assert.match(trackingRuntime, /observation_2_due_date/);
});

test('manager milestone renderer distinguishes workshops from course checkpoints', () => {
  assert.match(milestoneRuntime, /type\.includes\('workshop'\) \|\| type\.includes\('סדנה'\)/);
  assert.match(milestoneRuntime, /return 'סדנה'/);
  assert.match(milestoneRuntime, /labels\.push\('תחילת קורס'\)/);
  assert.match(milestoneRuntime, /labels\.push\('סיום קורס'\)/);
});

test('workshop control points do not show redundant start or end milestones', () => {
  assert.match(milestoneRuntime, /function managerMilestoneLabel/);
  assert.match(milestoneRuntime, /const label = managerMilestoneLabel\(meeting\)/);
  assert.doesNotMatch(milestoneRuntime, /hideWorkshopMilestone|badge\.hidden/);
  assert.doesNotMatch(rootIndex, /manager-board-copy-fixes-runtime\.js/);
});

test('dashboard loads internal system dialogs for native confirm and alert calls', () => {
  assert.match(dialogRuntime, /window\.confirm = function systemConfirm/);
  assert.match(dialogRuntime, /window\.alert = function systemAlert/);
  assert.match(dialogRuntime, /role', kind === 'confirm' \? 'alertdialog' : 'dialog'/);
  assert.match(rootIndex, /system-dialog-runtime\.js\?v=20260910-pr1776-final-fixes-v1/);
});
