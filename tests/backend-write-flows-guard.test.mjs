import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Activity writes now go straight from frontend/src/api.js to Supabase (no
// Google Apps Script backend/*.gs layer — that stack was fully retired).
const api = fs.readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

function mustMatch(source, re, msg) {
  assert.match(source, re, msg);
}

test('upsertActivityToSupabase (addActivity) inserts into the activities table and returns row_id', () => {
  mustMatch(api, /async function upsertActivityToSupabase\(payload = \{\}\) \{/);
  mustMatch(api, /supabase\.from\('activities'\)\.insert\(row\)\.select\(\)\.single\(\)/);
  mustMatch(api, /return \{ RowID: normalized\.RowID, row_id: normalized\.row_id, source_sheet: 'activities', row: normalized \};/);
});

test('upsertActivityToSupabase writes Date1-Date35 and derives start/end dates', () => {
  mustMatch(api, /function activityDateSelectColumns\(\) \{[\s\S]*?date_\$\{idx \+ 1\}/);
  mustMatch(api, /const derivedEnd = deriveEndDateFromDates\(row\);/);
  mustMatch(api, /row\.end_date = derivedEnd \|\| existingEndDate \|\| startDate \|\| null;/);
});

test('updateActivityInSupabase (saveActivity) updates by row_id and merges meeting/date patches', () => {
  mustMatch(api, /async function updateActivityInSupabase\(payload = \{\}\) \{/);
  mustMatch(api, /const rowId = String\(payload\?\.source_row_id \|\| payload\?\.row_id \|\| payload\?\.RowID \|\| ''\)\.trim\(\);/);
  mustMatch(api, /\.from\('activities'\)[\s\S]*?\.update\(changes\)[\s\S]*?\.eq\('row_id', rowId\)/);
  mustMatch(api, /const mergedDates = \{ \.\.\.\(existingRow \|\| \{\}\), \.\.\.changes \};/);
});

test('saveActivity re-reads the row after write and guards that requested date changes were actually applied', () => {
  mustMatch(api, /function assertSupabaseActivityUpdateApplied\(operation, requestedChanges = \{\}, returnedRow = \{\}\) \{/);
  mustMatch(api, /activity_date_update_not_applied:\$\{key\}/);
  mustMatch(api, /assertSupabaseActivityUpdateApplied\('saveActivity', changes, freshDbRow \|\| \{\}\);/);
});
