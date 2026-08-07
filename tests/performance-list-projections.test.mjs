import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const apiSource = readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const approvalRuntimeSource = readFileSync(new URL('../frontend/src/completion-approval-performance-runtime.js', import.meta.url), 'utf8');
const opsSource = readFileSync(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');
const instructorsSource = readFileSync(new URL('../frontend/src/screens/instructors.js', import.meta.url), 'utf8');
const proposalsSource = readFileSync(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8');
const archiveSource = readFileSync(new URL('../frontend/src/screens/archive.js', import.meta.url), 'utf8');
const summerExtSource = readFileSync(new URL('../frontend/src/screens/operations-summer-training-extension.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../frontend/src/main.js', import.meta.url), 'utf8');

test('dedicated activity projections exist and are distinct', () => {
  for (const name of [
    'ACTIVITY_TABLE_COLUMNS',
    'ACTIVITY_CALENDAR_COLUMNS',
    'ACTIVITY_END_DATES_COLUMNS',
    'ACTIVITY_EXCEPTIONS_COLUMNS',
    'ACTIVITY_OPERATIONS_COLUMNS',
    'ACTIVITY_ARCHIVE_COLUMNS',
    'ACTIVITY_INSTRUCTOR_STATS_COLUMNS',
    'ACTIVITY_INSTRUCTOR_HISTORY_COLUMNS'
  ]) {
    assert.match(apiSource, new RegExp(`const ${name} =`));
  }
  assert.match(apiSource, /select\(ACTIVITY_TABLE_COLUMNS\)|select = filters\?\.select \|\| ACTIVITY_TABLE_COLUMNS/);
  assert.match(apiSource, /select: ACTIVITY_CALENDAR_COLUMNS/);
  assert.match(apiSource, /select\(ACTIVITY_END_DATES_COLUMNS\)/);
  assert.match(apiSource, /select\(ACTIVITY_EXCEPTIONS_COLUMNS\)/);
  assert.match(apiSource, /select\(ACTIVITY_ARCHIVE_COLUMNS\)/);
  assert.match(apiSource, /ACTIVITY_INSTRUCTOR_STATS_COLUMNS/);
});

test('end-dates projection excludes meeting-date payload', () => {
  const block = apiSource.match(/const ACTIVITY_END_DATES_COLUMNS = \[([\s\S]*?)\]\.join/)?.[1] || '';
  assert.match(block, /end_date/);
  assert.doesNotMatch(block, /ACTIVITY_MEETING_DATE_COLUMNS/);
  assert.doesNotMatch(block, /date_1/);
});

test('week and month load by date range with calendar projection', () => {
  assert.match(apiSource, /selectActivitiesByDateRangeFromSupabase\(\{ startDate, endDate, select: ACTIVITY_CALENDAR_COLUMNS \}\)/);
  assert.match(apiSource, /selectActivitiesByDateRangeFromSupabase\(\{[\s\S]*?select: ACTIVITY_CALENDAR_COLUMNS/);
});

test('archive uses server pagination', () => {
  assert.match(apiSource, /\.range\(pageOffset, pageOffset \+ pageSize - 1\)/);
  assert.match(archiveSource, /limit: ARCHIVE_DEFAULT_VISIBLE_LIMIT/);
  assert.match(archiveSource, /offset: rowsRef\(\)\.length/);
});

test('exceptions skip 2026 completion uploads outside summer_2026', () => {
  assert.match(apiSource, /needsSummerCompletionUploads = activityPeriod === 'summer_2026'/);
  assert.match(apiSource, /needsSummerCompletionUploads\s*\n\s*\? supabase\.from\('activity_completion_approval_uploads'\)/);
});

test('completion approval list reads metadata without creating signed URLs', () => {
  assert.match(approvalRuntimeSource, /select\(UPLOAD_METADATA_COLUMNS\)/);
  assert.doesNotMatch(approvalRuntimeSource, /createSignedUrl/);
  assert.match(approvalRuntimeSource, /fromDate/);
  assert.match(approvalRuntimeSource, /limit != null/);
});

test('operations completion tab scopes uploads to summer window and defers schedule directories', () => {
  assert.match(opsSource, /key === 'schedule'/);
  assert.match(opsSource, /schoolsDirectorySource: 'deferred'/);
  assert.match(opsSource, /fromDate: SUMMER_2026_FROM/);
  assert.match(opsSource, /toDate: SUMMER_2026_TO/);
  assert.match(opsSource, /limit: null/);
});

test('proposals list uses metadata projection, paging, and on-demand detail/deps', () => {
  assert.match(apiSource, /PROPOSALS_AGREEMENTS_LIST_COLUMNS/);
  assert.doesNotMatch(apiSource.match(/const PROPOSALS_AGREEMENTS_LIST_COLUMNS = '([^']+)'/)?.[1] || '', /document_snapshot/);
  assert.match(apiSource, /proposalsAgreementsEditorDeps/);
  assert.match(apiSource, /readProposalAgreementDetailFromSupabase/);
  assert.match(proposalsSource, /limit: 50, offset: 0, includeLinkedDocuments: true/);
  assert.match(proposalsSource, /ensureEditorDeps/);
  assert.match(proposalsSource, /ensureProposalDetailRow/);
  assert.match(proposalsSource, /loadNextProposalPage/);
  assert.doesNotMatch(proposalsSource, /while\s*\(\s*data\._hasMore\s*\)/);
  assert.doesNotMatch(proposalsSource, /appendRemainingProposalPages\s*\(\s*\)\s*;/);
});

test('pending proposals badge uses count API, not full list loader', () => {
  assert.match(mainSource, /proposalsPendingApprovedCount/);
  assert.match(apiSource, /readProposalsPendingApprovedCountFromSupabase/);
});

test('instructors defer scheduling and load per-instructor history on open', () => {
  assert.match(instructorsSource, /_schedulingLoaded: false/);
  assert.match(instructorsSource, /instructorActivityHistory/);
  assert.match(apiSource, /readInstructorActivityHistoryFromSupabase/);
});

test('summer training extension no longer select(*) activities', () => {
  assert.doesNotMatch(summerExtSource, /\.select\('\*'\)\.eq\('activity_season', 'summer_2026'\)/);
  assert.match(summerExtSource, /summerColumns/);
});

test('screen cache keys include activity period / projection stamp', () => {
  assert.match(mainSource, /proj:\$\{projection\}|proj:\$\{projection\}|proj:/);
  assert.match(mainSource, /withActivityPeriod\(`week:/);
  assert.match(mainSource, /proposals-agreements:list:proj:/);
});
