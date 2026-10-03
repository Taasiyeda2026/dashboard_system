import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/20261003125000_scheduling_tour_full_day_hard_gate.sql', import.meta.url);

test('server migration defines a symmetric full-day tour hard gate', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /scheduling_activity_is_full_day_tour/);
  assert.match(sql, /activity_no::text[^\n]*13990|activity_no[^\n]*13990/);
  assert.match(sql, /התנסות בתעשייה/);
  assert.match(sql, /scheduling_full_day_tour_conflict/);
  assert.match(sql, /target_is_full_day_tour[\s\S]*or public\.scheduling_activity_is_full_day_tour\(a\)/);
  assert.match(sql, /before insert on public\.activities/);
  assert.match(sql, /before update of[\s\S]*draft_proposed_meetings[\s\S]*date_35[\s\S]*on public\.activities/);
  assert.match(sql, /scheduling_effective_meetings\(new, instructor_id\)/);
  assert.match(sql, /scheduling_effective_meetings\(a, instructor_id\)/);
});

test('server full-day gate applies only to active school_2027 held assignments/drafts', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /activity_season, ''\) <> 'school_2027'/);
  assert.match(sql, /new\.emp_id/);
  assert.match(sql, /new\.emp_id_2/);
  assert.match(sql, /new\.draft_emp_id/);
  assert.match(sql, /a\.emp_id::text = instructor_id::text/);
  assert.match(sql, /a\.emp_id_2::text = instructor_id::text/);
  assert.match(sql, /a\.draft_emp_id::text = instructor_id::text/);
});
