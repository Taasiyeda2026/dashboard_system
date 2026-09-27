import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workspace = await readFile(new URL('../frontend/src/manager-board-workspace-runtime.js', import.meta.url), 'utf8');
const admin = await readFile(new URL('../frontend/src/admin-attendance-standalone.js', import.meta.url), 'utf8');
const launcher = await readFile(new URL('../frontend/src/screens/shared/payroll-control-launcher.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

const version = '20260927-training-km-field-choice-v1';

test('manager workspace imports the attendance control with the current cache-busting version', () => {
  assert.match(workspace, new RegExp(`attendance-control\\.js\\?v=${version}`));
  assert.doesNotMatch(workspace, /from '.\/screens\/attendance-control\.js';/);
  assert.doesNotMatch(workspace, /import\('\.\/screens\/attendance-control\.js'\)/);
});

test('other attendance entry points use the same attendance control module version', () => {
  assert.match(admin, new RegExp(`attendance-control\\.js\\?v=${version}`));
  assert.match(launcher, new RegExp(`attendance-control\\.js\\?v=${version}`));
});

test('direct index entrypoints are also cache-busted for the release', () => {
  assert.match(index, /manager-board-workspace-runtime\.js\?v=20260927-training-km-field-choice-v1/);
  assert.match(index, /admin-attendance-standalone\.js\?v=20260927-training-km-field-choice-v1/);
});
