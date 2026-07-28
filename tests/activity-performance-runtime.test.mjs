import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entrySource = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../frontend/src/activity-performance-runtime.js', import.meta.url), 'utf8');
const completionRuntimeSource = await readFile(new URL('../frontend/src/completion-approval-performance-runtime.js', import.meta.url), 'utf8');
const dedupeSource = await readFile(new URL('../frontend/src/network-request-dedupe.js', import.meta.url), 'utf8');

test('performance guards load before the application bootstrap', () => {
  const dedupeIndex = entrySource.indexOf("import './network-request-dedupe.js';");
  const runtimeIndex = entrySource.indexOf("import './activity-performance-runtime.js';");
  const completionRuntimeIndex = entrySource.indexOf("import './completion-approval-performance-runtime.js';");
  const mainIndex = entrySource.indexOf("import './main.js';");
  assert.ok(dedupeIndex >= 0, 'network request dedupe must be imported');
  assert.ok(runtimeIndex > dedupeIndex, 'activity performance runtime must load after fetch dedupe');
  assert.ok(completionRuntimeIndex > runtimeIndex, 'completion approval guard must load after activity guard');
  assert.ok(mainIndex > completionRuntimeIndex, 'all performance guards must load before main.js');
});

test('dashboard speculative activity screens are blocked from heavy API reads', () => {
  assert.match(runtimeSource, /DASHBOARD_PREFETCH_METHODS\s*=\s*\['week',\s*'month',\s*'endDates',\s*'archiveActivities'\]/);
  assert.match(runtimeSource, /dashboard_background_prefetch_skipped/);
  assert.match(runtimeSource, /isDashboardPrefetchContext\(\)/);
});

test('post-save activity refresh uses the patched in-memory snapshot', () => {
  assert.match(runtimeSource, /suppressFullRefreshUntil\s*=\s*Date\.now\(\)\s*\+\s*12_000/);
  assert.match(runtimeSource, /patchAllActivitySnapshots\(savedRow\)/);
  assert.match(runtimeSource, /Date\.now\(\)\s*<\s*suppressFullRefreshUntil\s*&&\s*snapshot/);
  assert.match(runtimeSource, /wrapMutation\('saveActivity'/);
});

test('completion approval list reads metadata without signing every storage object', () => {
  assert.match(completionRuntimeSource, /activity_completion_approval_uploads/);
  assert.match(completionRuntimeSource, /optimizedCompletionApprovalUploads/);
  assert.doesNotMatch(completionRuntimeSource, /createSignedUrl/);
  assert.match(completionRuntimeSource, /query\.in\('instructor_emp_id', identityValues\)/);
});

test('identical Supabase reads are deduplicated only while in flight', () => {
  assert.match(dedupeSource, /\['activities', 'activities'\]/);
  assert.match(dedupeSource, /\['contacts_schools', 'contacts'\]/);
  assert.match(dedupeSource, /\['activity_completion_approval_uploads', 'completion_approvals'\]/);
  assert.match(dedupeSource, /\['activity_school_contact_responsibles', 'school_contacts'\]/);
  assert.match(dedupeSource, /const inflight = new Map\(\)/);
  assert.match(dedupeSource, /cache:\s*'no-store'/);
  assert.doesNotMatch(dedupeSource, /responseCache/);
  assert.doesNotMatch(dedupeSource, /ttlMs/);
});
