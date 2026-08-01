import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const approvalRuntimeSource = readFileSync(new URL('../frontend/src/completion-approval-performance-runtime.js', import.meta.url), 'utf8');

test('activity list paths use an explicit summary projection', () => {
  assert.match(apiSource, /const ACTIVITY_LIST_COLUMNS = \[/);
  assert.match(apiSource, /readActivitiesFromSupabase[\s\S]*?select\(ACTIVITY_LIST_COLUMNS\)/);
  assert.match(apiSource, /readArchiveActivitiesFromSupabase[\s\S]*?select\(ACTIVITY_LIST_COLUMNS\)/);
  assert.match(apiSource, /select = ACTIVITY_LIST_COLUMNS/);
  assert.match(apiSource, /readAllActivitiesRowsSupabase[\s\S]*?selectActivitiesFromSupabase\(ACTIVITY_LIST_COLUMNS/);
});

test('completion approval list reads metadata without creating signed URLs', () => {
  assert.match(approvalRuntimeSource, /select\(UPLOAD_METADATA_COLUMNS\)/);
  assert.doesNotMatch(approvalRuntimeSource, /createSignedUrl/);
});
