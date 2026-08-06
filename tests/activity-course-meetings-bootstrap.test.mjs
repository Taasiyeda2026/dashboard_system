import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');

test('bootstrap reads active Gefen course meeting counts without schema changes', () => {
  assert.match(source, /COURSE_MEETINGS_BOOTSTRAP_COLUMNS = 'gefen_number,meetings_count'/);
  assert.match(
    source,
    /\.from\('proposal_gefen_courses'\)[\s\S]{0,240}\.select\(COURSE_MEETINGS_BOOTSTRAP_COLUMNS\)[\s\S]{0,160}\.eq\('is_active', true\)/
  );
  assert.match(source, /readCourseMeetingsRowsForBootstrap\(\)\.catch\(\(\) => \[\]\)/);
});

test('bootstrap joins meeting counts by Gefen number and exposes them to the activity catalog', () => {
  assert.match(source, /const courseMeetingsByStableId = new Map\(/);
  assert.match(source, /\[gefenNumber, activityNo\][\s\S]{0,180}courseMeetingsByStableId\.get\(stableId\)/);
  assert.match(source, /meetings_count:\s*meetingsCount/);
});
