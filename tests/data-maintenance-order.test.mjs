/**
 * Tests for the data-maintenance pipeline ordering and correctness.
 *
 * Rules verified:
 *  1. refreshDataViews_ is called before refreshDashboardSnapshots_ in
 *     runDataMaintenance_.
 *  2. dashboard_refresh_control is NOT marked ok when refreshDataViews_
 *     fails — the function returns early with status='error'.
 *  3. bumpDataViewsCacheVersion_ is NOT called directly in
 *     runDataMaintenance_ (it is called internally by refreshDataViews_).
 *  4. month_ym is stored with the "'" text-prefix in both snapshot write
 *     functions.
 *  5. ensureSnapshotMonthYmTextColumn_ is called in both snapshot write
 *     functions so the column format is '@' (plain text).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DM_PATH  = new URL('../backend/data-maintenance.gs',  import.meta.url);
const DS_PATH  = new URL('../backend/dashboard-snapshot.gs', import.meta.url);

test('runDataMaintenance_ calls refreshDataViews_ before refreshDashboardSnapshots_', async () => {
  const src = await readFile(DM_PATH, 'utf8');
  const idxViews    = src.indexOf('refreshDataViews_()');
  const idxSnapshot = src.indexOf('refreshDashboardSnapshots_()');
  assert.ok(idxViews    >= 0, 'refreshDataViews_() must appear in data-maintenance.gs');
  assert.ok(idxSnapshot >= 0, 'refreshDashboardSnapshots_() must appear in data-maintenance.gs');
  assert.ok(
    idxViews < idxSnapshot,
    'refreshDataViews_() must appear BEFORE refreshDashboardSnapshots_() in runDataMaintenance_'
  );
});

test('runDataMaintenance_ returns early with error when refreshDataViews_ fails', async () => {
  const src = await readFile(DM_PATH, 'utf8');
  // Must have a guard checking viewsResult.ok
  assert.match(src, /viewsResult\.ok/,
    'runDataMaintenance_ must check viewsResult.ok after refreshDataViews_');
  // Must call updateDashboardRefreshControl_ with 'error' on views failure
  assert.match(src, /updateDashboardRefreshControl_\(\s*status\s*,\s*message\s*\)/,
    'updateDashboardRefreshControl_ must be called on views failure');
  // The early-return block must have snapshots: null
  assert.match(src, /snapshots\s*:\s*null/,
    'early-return on views failure must set snapshots: null');
});

test('runDataMaintenance_ does NOT call bumpDataViewsCacheVersion_ directly', async () => {
  const src = await readFile(DM_PATH, 'utf8');
  assert.doesNotMatch(src, /bumpDataViewsCacheVersion_\s*\(\)/,
    'bumpDataViewsCacheVersion_() must NOT be called directly in data-maintenance.gs; ' +
    'it is called internally by refreshDataViews_()');
});

test('runDataMaintenance_ includes views in return payload', async () => {
  const src = await readFile(DM_PATH, 'utf8');
  assert.match(src, /views\s*:\s*viewsResult/,
    'return objects must include views: viewsResult');
});

test('writeDashboardSummarySnapshotRow_ stores month_ym with apostrophe prefix', async () => {
  const src = await readFile(DS_PATH, 'utf8');
  // Extract the function body
  const start = src.indexOf('function writeDashboardSummarySnapshotRow_');
  const end   = src.indexOf('\nfunction ', start + 1);
  const body  = src.slice(start, end > start ? end : undefined);
  assert.match(body, /"'" \+ normalizeSnapshotMonthYm_/,
    'writeDashboardSummarySnapshotRow_ must use "\'"+normalizeSnapshotMonthYm_ for month_ym');
});

test('replaceDashboardByManagerSnapshotRows_ stores month_ym with apostrophe prefix', async () => {
  const src = await readFile(DS_PATH, 'utf8');
  const start = src.indexOf('function replaceDashboardByManagerSnapshotRows_');
  const end   = src.indexOf('\nfunction ', start + 1);
  const body  = src.slice(start, end > start ? end : undefined);
  assert.match(body, /"'" \+ normalizeSnapshotMonthYm_/,
    'replaceDashboardByManagerSnapshotRows_ must use "\'"+normalizeSnapshotMonthYm_ for month_ym');
});

test('both snapshot write functions call ensureSnapshotMonthYmTextColumn_', async () => {
  const src = await readFile(DS_PATH, 'utf8');

  function extractBody(funcName) {
    const start = src.indexOf('function ' + funcName);
    const end   = src.indexOf('\nfunction ', start + 1);
    return src.slice(start, end > start ? end : undefined);
  }

  const summaryBody  = extractBody('writeDashboardSummarySnapshotRow_');
  const managerBody  = extractBody('replaceDashboardByManagerSnapshotRows_');

  assert.match(summaryBody, /ensureSnapshotMonthYmTextColumn_/,
    'writeDashboardSummarySnapshotRow_ must call ensureSnapshotMonthYmTextColumn_');
  assert.match(managerBody, /ensureSnapshotMonthYmTextColumn_/,
    'replaceDashboardByManagerSnapshotRows_ must call ensureSnapshotMonthYmTextColumn_');
});

test('dashboard_refresh_control ok is only set after BOTH views and snapshots succeed', async () => {
  const src = await readFile(DM_PATH, 'utf8');
  // Verify that the 'ok' return comes AFTER the snapshot call, not before
  const idxOkReturn   = src.lastIndexOf("ok: true");
  const idxSnapshotCall = src.indexOf('refreshDashboardSnapshots_()');
  assert.ok(
    idxOkReturn > idxSnapshotCall,
    'ok: true return must come after refreshDashboardSnapshots_() call'
  );
});
