import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canShareAssignedActivityFeedback } from '../frontend/src/impact-feedback/feedback-access.js';

const root = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const sql = root('supabase/migrations/20261028183000_feedback_manager_staff_expiry_weekly_digest.sql');
const cron = root('supabase/migrations/20261028184000_feedback_expiry_weekly_cron.sql');
const edge = root('supabase/functions/feedback-expiry-weekly/index.ts');
const screen = root('frontend/src/screens/impact-feedback.js');
const api = root('frontend/src/impact-feedback/feedback-api.js');

test('staff manager ownership checks use the assigned activity manager', () => {
  const group = { activity_manager: 'הילה רוזן' };
  assert.equal(canShareAssignedActivityFeedback(
    { role: 'activities_manager', full_name: 'הילה רוזן', is_active: true }, group), true);
  assert.equal(canShareAssignedActivityFeedback(
    { role: 'activities_manager', full_name: 'גיל נאמן', is_active: true }, group), false);
  assert.equal(canShareAssignedActivityFeedback(
    { role: 'activities_manager', full_name: 'הילה רוזן', is_active: false }, group), false);
});

test('staff expiry extension cannot alter completed, not-expired or unowned feedback', () => {
  assert.match(api, /rpc\('feedback_manager_extend_staff_expiry'/);
  assert.match(screen, /data-ifb-manager-staff-extend/);
  assert.match(screen, /canManagerExtendStaff/);
  assert.match(screen, /campaign\.responses \|\| 0/);
  assert.match(sql, /v\.audience <> 'educational_staff'/);
  assert.match(sql, /v\.expires_at > now\(\)/);
  assert.match(sql, /private\.feedback_can_share_staff_activity\(v\.activity_row_id\)/);
  assert.match(sql, /public\.feedback_responses/);
  assert.match(sql, /p_expires_at<=now\(\)/);
  assert.doesNotMatch(sql, /update public\.feedback_recipients set.*token/s);
});

test('weekly manager digest uses source data and records one send per manager per week', () => {
  assert.match(sql, /unique\(manager_user_id,week_start\)/);
  assert.match(sql, /status='active' and c\.expires_at is not null and c\.expires_at<=p_now/);
  assert.match(sql, /not exists\(select 1 from public\.feedback_responses/);
  assert.match(sql, /role='activities_manager' and u\.is_active is true/);
  assert.match(sql, /u\.role='admin' and u\.is_active is true/);
  assert.match(sql, /status='unknown',graph_started_at=now\(\)/);
  assert.match(edge, /ccRecipients:/);
  assert.match(edge, /Graph|graph/);
  assert.match(edge, /clock\.weekday!=='Sun'/);
  assert.match(edge, /clock\.hour!=='08' \|\| clock\.minute!=='30'/);
  assert.match(cron, /30 5,6 \* \* 0/);
  assert.match(cron, /Asia\/Jerusalem/);
  assert.doesNotMatch(sql, /update public\.feedback_campaigns set expires_at.*where.*week/s);
});
