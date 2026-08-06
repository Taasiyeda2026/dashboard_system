import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const activitiesSource = await readFile(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
const entrySource = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('activity save success callback receives the saved changes', () => {
  assert.match(
    activitiesSource,
    /onSaveSuccess:\s*async\s*\(\{\s*sourceSheet,\s*sourceRowId,\s*changes,\s*contentRoot\s*\}\)\s*=>/,
    'activities.js must receive changes from bindActivityEditForm before using them'
  );
});

test('obsolete activity save priority hotfix is not imported', () => {
  assert.doesNotMatch(entrySource, /activity-save-priority-hotfix\.js/);
});
