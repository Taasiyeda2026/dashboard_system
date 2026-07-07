import { test } from 'node:test';
import assert from 'node:assert/strict';

async function readApiSource() {
  const fs = await import('node:fs/promises');
  return fs.readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
}

async function readSource(relPath) {
  const fs = await import('node:fs/promises');
  return fs.readFile(new URL(relPath, import.meta.url), 'utf8');
}

test('addActivity supports object payload and long-source signature in Supabase path', async () => {
  const source = await readApiSource();
  assert.match(source, /addActivity: async \(target, data\) => \{/);
  assert.match(source, /typeof target === 'object' && target !== null && data === undefined/);
  assert.match(source, /\? \{ activity: target \}/);
  assert.match(source, /: \{ activity: \{ \.\.\.\(data \|\| \{\}\), source: target \} \}/);
  assert.match(source, /upsertActivityToSupabase\(payload\)/);
});

test('saveActivity keeps direct edit source identifiers and changes payload', async () => {
  const source = await readApiSource();
  assert.match(source, /saveActivity: async \(a, b\) => \{/);
  assert.match(source, /\? \{ source_row_id: a, changes: b \}/);
  assert.match(source, /return api\.submitEditRequest\(payload\);/);
  assert.match(source, /return updateActivityInSupabase\(payload\);/);
});

test('submitEditRequest and reviewEditRequest keep request payload handling', async () => {
  const source = await readApiSource();
  assert.match(source, /submitEditRequest: async \(source_row_id, changes, source_sheet = 'activities'\) => \{/);
  assert.match(source, /const rowId = String\(requestPayload\?\.source_row_id \|\| source_row_id \|\| ''\)\.trim\(\);/);
  assert.match(source, /reviewEditRequest: async \(request_id, status\) => \{/);
  assert.match(source, /const requestId = String\(request_id \|\| ''\)\.trim\(\);/);
});

test('api mutation cache invalidation map includes required keys', async () => {
  const source = await readApiSource();
  assert.match(source, /submitEditRequest:\s*\['activities:',\s*'edit-requests'/);
  assert.match(source, /reviewEditRequest:\s*\['edit-requests',\s*'activities:',\s*'activityDetail:',\s*'dashboard:',\s*'exceptions:'/);
  assert.match(source, /addActivity:\s*\['activities:',\s*'activityDetail:'/);
});

test('api myData team-group builder imports contact responsible resolver', async () => {
  const source = await readApiSource();
  const contactSource = await readSource('../frontend/src/screens/shared/contact-responsible.js');

  assert.match(contactSource, /export function findContactResponsibleGroup\(/);
  assert.match(source, /import \{[\s\S]*findContactResponsibleGroup,[\s\S]*\} from '\.\/screens\/shared\/contact-responsible\.js';/);
  assert.match(source, /function buildInstructorTeamGroups\(allRows, ownRows, overrides = \[\]\) \{[\s\S]*const group = findContactResponsibleGroup\(row, index\);/);
  assert.match(source, /myData: async \(params = \{\}\) => \{[\s\S]*teamGroups: buildInstructorTeamGroups\(openRows, rows, contactResponsibles\)/);
});

test('sanitizeActivityPayloadForSupabase normalizes bigint/time empty values to null', async () => {
  const source = await readApiSource();
  assert.match(source, /function normalizeBigintFieldForSupabase\(value\)/);
  assert.match(source, /function normalizeTimeFieldForSupabase\(value\)/);
  assert.match(source, /const bigintFields = new Set\(\['activity_no', 'sessions', 'price', 'emp_id', 'emp_id_2'\]\)/);
  assert.match(source, /const timeFields = new Set\(\['start_time', 'end_time'\]\)/);
  assert.match(source, /sanitized\[key\] = nextValue === undefined \? null : nextValue;/);
});

test('Supabase read paths keep instructor data screens and end dates registered', async () => {
  const source = await readApiSource();
  const mainSource = await readSource('../frontend/src/main.js');
  assert.match(source, /myData: async \(params = \{\}\) => \{/);
  assert.match(source, /week: async \(params\) => \{/);
  assert.match(source, /month: async \(params\) => \{/);
  assert.match(source, /endDates: \(\) => readEndDatesFromSupabase\(\)/);
  assert.match(mainSource, /const screenLoaders = \{[\s\S]*'end-dates': \(\) => import\('\.\/screens\/end-dates\.js'\)/);
});

test('perf summary helper is defined in main when window is available', async () => {
  const mainSource = await readSource('../frontend/src/main.js');
  assert.match(mainSource, /window\.__printDsPerfSummary\s*=\s*\(\)\s*=>/);
  assert.match(mainSource, /const slowestRequests = \[\.\.\.requests\]/);
  assert.match(mainSource, /const slowestScreens = \[\.\.\.renders\]/);
});
