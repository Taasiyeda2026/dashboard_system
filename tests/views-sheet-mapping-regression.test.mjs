import { readFile } from 'fs/promises';
import { strict as assert } from 'assert';
import { test } from 'node:test';

const SRC = 'backend/views.gs';
let source = '';

test('load views.gs', async () => {
  source = await readFile(SRC, 'utf8');
  assert.ok(source.length > 100);
});

test('view_activity_meetings writes RowID from source_row_id/meeting_no', () => {
  assert.match(source, /var effectiveRowId = meetingNo \? \(sourceRowId \+ '-' \+ meetingNo\) : sourceRowId;/);
  assert.match(source, /RowID: effectiveRowId/);
});

test('view_activities_summary writes total column', () => {
  assert.match(source, /total: byMonthType\[key\]/);
});

test('view_dashboard_monthly writes metric_key and metric_value', () => {
  assert.match(source, /metric_key: key/);
  assert.match(source, /metric_value: rawValue/);
});

test('activities_snapshot safety helper still uses 45k guard', async () => {
  const snap = await readFile('backend/activities-snapshot.gs', 'utf8');
  assert.match(snap, /maxLength = maxLength \|\| 45000/);
});
