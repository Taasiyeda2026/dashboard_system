import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationPath = new URL('../supabase/migrations/20260929143000_remove_scheduling_daily_sequence_limit.sql', import.meta.url);

test('daily capacity migration removes sequence counts from both server validators', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /scheduling_course_instructor_violations/);
  assert.match(sql, /scheduling_manual_assignment_hard_violations/);
  assert.doesNotMatch(sql, /scheduling_daily_sequence_exceeded/);
  assert.doesNotMatch(sql, /chain_count|target_duration|previous_end|session_row/);
});

test('daily capacity migration preserves explicit availability and operational hard gates', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  for (const gate of [
    'scheduling_instructor_unavailable',
    'scheduling_conflict_detected',
    'scheduling_transition_insufficient',
    'scheduling_language_mismatch',
    'scheduling_gender_mismatch'
  ]) assert.match(sql, new RegExp(gate));
  assert.match(sql, /target_end > availability\.end_time/);
});
