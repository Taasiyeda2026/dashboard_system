import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CODE_GS = new URL('../backend/Code.gs', import.meta.url);
const API_JS = new URL('../frontend/src/api.js', import.meta.url);

test('production automation entrypoints exist', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /function\s+installProductionAutomation\s*\(/);
  assert.match(source, /function\s+getProductionAutomationStatus\s*\(/);
});

test('installProductionAutomation installs keepWarm and runDataMaintenanceTrigger', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /newTrigger\('keepWarm'\)[\s\S]*everyMinutes\(10\)/);
  assert.match(source, /newTrigger\('runDataMaintenanceTrigger'\)[\s\S]*everyHours\(1\)/);
});

test('installProductionAutomation avoids duplicate triggers by replacing existing ones', async () => {
  const source = await readFile(CODE_GS, 'utf8');
  assert.match(source, /ScriptApp\.deleteTrigger\(t\)/);
  assert.match(source, /result\.replaced\.push/);
});

test('installProductionAutomation does not install read models trigger by default', async () => {
  const codeSource = await readFile(CODE_GS, 'utf8');
  const apiSource = await readFile(API_JS, 'utf8');
  assert.match(apiSource, /const READ_MODELS_ENABLED = false/);
  assert.doesNotMatch(codeSource, /newTrigger\('refreshAllReadModelsTrigger'\)/);
  assert.match(codeSource, /refreshAllReadModelsTrigger/);
});
