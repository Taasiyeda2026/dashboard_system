import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('activity edit form blocks empty changes before submit', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/shared/bind-activity-edit-form.js', import.meta.url), 'utf8');
  assert.match(source, /if \(!Object\.keys\(changes\)\.length\) \{[\s\S]*לא זוהו שינויים לשמירה[\s\S]*return;/);
  assert.match(source, /await api\.saveActivity\(\{ source_sheet: sourceSheet, source_row_id: sourceRowId, changes \}\);/);
});

test('approving removes request immediately from pending filter', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/edit-requests.js', import.meta.url), 'utf8');
  assert.match(source, /const status = action === 'approve' \? 'approved' : 'rejected';/);
  assert.match(source, /if \(activeFilter === 'pending'\) \{\s*groupEl\.remove\(\);\s*\}/);
});

test('rejecting removes request immediately from pending filter', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/edit-requests.js', import.meta.url), 'utf8');
  assert.match(source, /const status = action === 'approve' \? 'approved' : 'rejected';/);
  assert.match(source, /if \(activeFilter === 'pending'\) \{\s*groupEl\.remove\(\);\s*\}/);
});

test('backend applies original row changes only for approved requests', async () => {
  const source = await fs.readFile(new URL('../backend/actions.gs', import.meta.url), 'utf8');
  assert.match(source, /if \(status === 'approved'\) \{[\s\S]*updateRowByKey_\(sourceSheet, 'RowID', sourceRowId, changes\);/);
});

test('activity rows expose requester-facing edit status labels', async () => {
  const source = await fs.readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
  assert.match(source, /if \(status === 'pending'\) return 'בקשת עריכה ממתינה';/);
  assert.match(source, /if \(status === 'approved'\) return 'בקשת העריכה אושרה';/);
  assert.match(source, /if \(status === 'rejected'\) return 'בקשת העריכה נדחתה';/);
});
