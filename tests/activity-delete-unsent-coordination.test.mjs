import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ROOT = new URL('../', import.meta.url);
const migrationUrl = new URL('supabase/migrations/20260914121500_allow_delete_with_unsent_coordination.sql', ROOT);

test('unsent coordination does not block permanent deletion but sent coordination does', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  assert.match(migration, /join public\.activity_coordination_dispatches d on d\.id = i\.dispatch_id/i);
  assert.match(migration, /d\.sent_at is not null/i);
  assert.match(migration, /d\.sent_verified_at is not null/i);
  assert.match(migration, /activity_has_operational_records:coordination_sent/i);
  assert.match(migration, /delete from public\.activity_coordination_dispatch_items[\s\S]*where activity_row_id = new\.row_id/i);

  assert.doesNotMatch(
    migration,
    /activity_has_operational_records:coordination'\s*;/i,
    'plain unsent coordination item existence must not block deletion'
  );
});

test('execution and finance evidence remain protected from permanent deletion', async () => {
  const migration = await readFile(migrationUrl, 'utf8');

  for (const marker of [
    'attendance_records',
    'completion_approval',
    'finance_collection',
    'finance_lines',
    'finance_meetings',
    'activity_meetings',
    'meeting_cancellations',
    'instructor_history'
  ]) {
    assert.match(migration, new RegExp(`activity_has_operational_records:${marker}`, 'i'));
  }
});
