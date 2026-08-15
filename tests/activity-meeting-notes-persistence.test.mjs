import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260815063500_activity_meetings_write_permissions.sql', import.meta.url), 'utf8');

test('meeting-note save propagates persistence errors before activity success is returned', () => {
  const upsert = api.slice(api.indexOf('async function upsertMeetingNotesToSupabase'), api.indexOf('function extractMeetingNotes'));
  assert.match(upsert, /const \{ error \} = await supabase[\s\S]*\.from\('activity_meetings'\)[\s\S]*\.upsert\(rows, \{ onConflict: 'source_row_id,meeting_no' \}\)/);
  assert.match(upsert, /if \(error\)[\s\S]*throw buildSupabaseMutationError\('saveActivityMeetingNotes'/);
  assert.doesNotMatch(upsert, /console\.warn|catch\s*\(/);
  const save = api.slice(api.indexOf('async function updateActivityInSupabase'), api.indexOf('async function readActivityDetailFromSupabase'));
  assert.ok(save.indexOf('await upsertMeetingNotesToSupabase(rowId, meetingNotes);') < save.lastIndexOf('return { ok: true'));
});

test('meeting-note RLS grants only direct editors the required insert/update and sequence access', () => {
  assert.match(migration, /grant insert, update on table public\.activity_meetings to authenticated/);
  assert.match(migration, /grant usage, select on sequence public\.activity_meetings_id_seq to authenticated/);
  assert.match(migration, /for insert[\s\S]*with check \(public\.app_can_edit_direct\(\)\)/);
  assert.match(migration, /for update[\s\S]*using \(public\.app_can_edit_direct\(\)\)[\s\S]*with check \(public\.app_can_edit_direct\(\)\)/);
  assert.doesNotMatch(migration, /using \(true\)|with check \(true\)|disable row level security|grant delete/);
});

test('cleared and multiple meeting notes are independently upserted and returned on refresh', () => {
  const upsert = api.slice(api.indexOf('async function upsertMeetingNotesToSupabase'), api.indexOf('function extractMeetingNotes'));
  assert.match(upsert, /Object\.entries\(notesMap\)/);
  assert.match(upsert, /meeting_no: String\(Number\(idx0\) \+ 1\)/);
  assert.match(upsert, /notes: String\(note \|\| ''\)/);
  const read = api.slice(api.indexOf('async function readActivityDatesFromSupabase'), api.indexOf('async function readSchoolContactResponsiblesRows'));
  assert.match(read, /\.from\('activity_meetings'\)[\s\S]*\.select\('meeting_no,notes'\)[\s\S]*\.eq\('source_row_id', rowId\)/);
  assert.match(read, /notesMap\[idx\] = String\(m\.notes \|\| ''\)/);
  assert.match(read, /meeting_schedule = meeting_dates\.map\(\(d, i\) => \(\{ date: d, performed: 'no', note: notesMap\[i\] \|\| '' \}\)\)/);
});
