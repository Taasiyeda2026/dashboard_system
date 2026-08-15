import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const api = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

test('meeting-note save propagates persistence errors before activity success is returned', () => {
  const upsert = api.slice(api.indexOf('async function upsertMeetingNotesToSupabase'), api.indexOf('function extractMeetingNotes'));
  assert.match(upsert, /const \{ error \} = await supabase[\s\S]*\.from\('activity_meetings'\)[\s\S]*\.upsert\(rows, \{ onConflict: 'source_row_id,meeting_no' \}\)/);
  assert.match(upsert, /if \(error\)[\s\S]*throw buildSupabaseMutationError\('saveActivityMeetingNotes'/);
  assert.doesNotMatch(upsert, /console\.warn|catch\s*\(/);
  const save = api.slice(api.indexOf('async function updateActivityInSupabase'), api.indexOf('async function readActivityDetailFromSupabase'));
  assert.ok(save.indexOf('await upsertMeetingNotesToSupabase(rowId, meetingNotes);') < save.lastIndexOf('return { ok: true'));
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
