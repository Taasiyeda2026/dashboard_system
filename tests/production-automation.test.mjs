import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CODE_GS = new URL('../backend/Code.gs', import.meta.url);

test('production automation entrypoints exist', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /function\s+installProductionAutomation\s*\(/);
  assert.match(source, /function\s+getProductionAutomationStatus\s*\(/);
});

test('installProductionAutomation installs keepWarm, maintenance, and read models triggers', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /newTrigger\('keepWarm'\)[\s\S]*everyMinutes\(5\)/);
  assert.match(source, /newTrigger\('runDataMaintenanceTrigger'\)[\s\S]*everyHours\(1\)/);
  assert.match(source, /newTrigger\('refreshAllReadModelsTrigger'\)[\s\S]*everyHours\(1\)/);
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
