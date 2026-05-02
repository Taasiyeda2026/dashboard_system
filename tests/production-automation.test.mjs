import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CODE_GS = new URL('../backend/Code.gs', import.meta.url);

test('production automation entrypoints exist', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /function\s+installProductionAutomation\s*\(/);
  assert.match(source, /function\s+getProductionAutomationStatus\s*\(/);
});

test('manual workbook and refresh wrappers are publicly exposed', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /function\s+repairSystemWorkbookStructure\s*\(/);
  assert.match(source, /function\s+ensureSystemWorkbookScaffold\s*\(/);
  assert.match(source, /function\s+refreshActivitiesSnapshot\s*\(/);
  assert.match(source, /function\s+refreshDataViews\s*\(/);
});

test('installProductionAutomation installs required production automation triggers including end-dates', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /newTrigger\('keepWarm'\)[\s\S]*everyMinutes\(5\)/);
  assert.match(source, /newTrigger\('runDataMaintenanceTrigger'\)[\s\S]*everyHours\(1\)/);
  assert.match(source, /newTrigger\('refreshAllReadModelsTrigger'\)[\s\S]*everyHours\(1\)/);
  assert.match(source, /newTrigger\('refreshDataViewsTrigger'\)[\s\S]*everyHours\(1\)/);
  assert.match(source, /newTrigger\('refreshActivitiesSnapshotTrigger'\)[\s\S]*everyMinutes\(10\)/);
  assert.match(source, /newTrigger\('refreshDashboardSnapshotsTrigger'\)[\s\S]*everyMinutes\(10\)/);
  assert.match(source, /newTrigger\('syncEndDatesTrigger'\)[\s\S]*everyHours\(1\)/);
});

test('installProductionAutomation avoids duplicate triggers by replacing existing ones', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /ScriptApp\.deleteTrigger\(t\)/);
  assert.match(source, /result\.replaced\.push/);
});

test('read models trigger can be normalized to hourly via installReadModelsTriggers', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /function\s+installReadModelsTriggers\s*\(/);
  assert.match(source, /function\s+ensureReadModelsRefreshTrigger_\s*\(/);
  assert.match(source, /newTrigger\('refreshAllReadModelsTrigger'\)[\s\S]*everyHours\(1\)/);
});

test('production automation status includes end-dates trigger health', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /var endDates = summarize\('syncEndDatesTrigger', 'hourly'\)/);
  assert.match(source, /syncEndDatesTrigger: endDates/);
  assert.match(source, /if \(!endDates\.exists\) missing\.push\('syncEndDatesTrigger'\)/);
});

test('trigger wrappers use lock service', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /function\s+refreshDataViewsTrigger\s*\(/);
  assert.match(source, /function\s+refreshActivitiesSnapshotTrigger\s*\(/);
  assert.match(source, /function\s+refreshDashboardSnapshotsTrigger\s*\([\s\S]*LockService\.getScriptLock/);
});

test('installProductionAutomation includes scaffold repair and initial refresh report', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /result\.scaffold/);
  assert.match(source, /result\.repair/);
  assert.match(source, /result\.initialRefresh/);
  assert.match(source, /ensureSystemWorkbookScaffold_/);
  assert.match(source, /repairSystemWorkbookStructure_/);
});
