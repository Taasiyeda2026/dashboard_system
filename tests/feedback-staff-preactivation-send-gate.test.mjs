import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../supabase/migrations/20261018220000_feedback_staff_pre_backfill_begin_send_guard.sql',import.meta.url),'utf8'
);
const sendSource = readFileSync(
  new URL('../supabase/migrations/20261012230000_feedback_staff_delivery_disabled.sql',import.meta.url),'utf8'
);
const preBackfill = readFileSync(
  new URL('../supabase/migrations/20261014224000_feedback_pre_activation_backfill.sql',import.meta.url),'utf8'
);
const claimBackfill = readFileSync(
  new URL('../supabase/migrations/20261014235500_feedback_missing_data_daily_retry.sql',import.meta.url),'utf8'
);

test('PRE opening may pass pre-activation revalidation at every guard; FINAL remains restricted', () => {
  assert.match(preBackfill,/or stage=\\'pre\\'/);
  assert.match(claimBackfill,/o\.stage<>'pre'/);
  assert.match(migration,/after_guard constant text := 'or \(c\.eligibility_at<ctl\.activation_at and o\.stage<>''pre''\)'/);
  assert.match(migration,/before_guard constant text := 'or c\.eligibility_at<ctl\.activation_at'/);
  assert.match(sendSource,/if not found or not ctl\.enabled or ctl\.activation_at is null or c\.eligibility_at<ctl\.activation_at/);
});

test('migration changes only the final send guard and asserts remaining delivery fences', () => {
  assert.match(migration,/p\.proname='feedback_staff_auto_begin_send'/);
  assert.match(migration,/matches<>1/);
  assert.match(migration,/position\(after_guard in definition\)=0/);
  assert.match(migration,/o\.graph_started_at is not null/);
  assert.match(migration,/snapshot\(to_jsonb\(c\)\)<>o\.snapshot/);
  assert.match(migration,/fc\.status=''active''/);
  assert.match(migration,/r\.status=''pending''/);
  assert.doesNotMatch(migration,/update public\.feedback_staff_auto_outbox\s+set status/);
  assert.doesNotMatch(migration,/update public\.feedback_staff_auto_control/);
});
