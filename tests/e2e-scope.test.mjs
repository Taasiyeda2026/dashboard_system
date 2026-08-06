import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyE2EScope } from '../scripts/select-e2e-scope.mjs';

test('documentation-only changes skip browser tests', () => {
  const result = classifyE2EScope(['README.md', 'docs/PROJECT_MAP.md']);
  assert.equal(result.mode, 'docs');
  assert.deepEqual(result.screens, []);
});

test('documentation-only changes stay lightweight during a full checkpoint event', () => {
  const result = classifyE2EScope(['README.md'], { forceFull: true });
  assert.equal(result.mode, 'docs');
});

test('proposal changes run proposal tests only on normal PR updates', () => {
  const result = classifyE2EScope([
    'frontend/src/screens/proposals-agreements.js',
    'frontend/src/proposal-pdf-single-generation-hotfix.js'
  ]);

  assert.equal(result.mode, 'targeted');
  assert.deepEqual(result.screens, ['proposals-agreements']);
  assert.match(result.grep, /proposals-agreements/);
  assert.match(result.grep, /Client file/);
});

test('activity changes cover activities, week and month', () => {
  const result = classifyE2EScope(['frontend/src/activity-drawer-inline-layout.js']);
  assert.equal(result.mode, 'targeted');
  assert.deepEqual(result.screens, ['activities', 'week', 'month']);
});

test('multiple mapped screens are combined', () => {
  const result = classifyE2EScope([
    'frontend/src/screens/dashboard.js',
    'frontend/src/instructor-calendar.js'
  ]);

  assert.equal(result.mode, 'targeted');
  assert.deepEqual(result.screens, ['dashboard', 'week', 'month', 'instructors']);
});

test('shared frontend files always require the full suite', () => {
  const result = classifyE2EScope(['frontend/src/main.js']);
  assert.equal(result.mode, 'full');
});

test('unmapped live screens fall back to the full suite', () => {
  const result = classifyE2EScope(['frontend/src/screens/finance.js']);
  assert.equal(result.mode, 'full');
});

test('workflow and E2E infrastructure changes require the full suite', () => {
  const result = classifyE2EScope([
    '.github/workflows/e2e-performance-gate.yml',
    'e2e/helpers/performance.mjs'
  ]);
  assert.equal(result.mode, 'full');
});

test('opening or ready-for-review checkpoints can force the full suite', () => {
  const result = classifyE2EScope(
    ['frontend/src/screens/contacts.js'],
    { forceFull: true }
  );
  assert.equal(result.mode, 'full');
});

test('manual runs always execute the full suite when no file list exists', () => {
  const result = classifyE2EScope([], { forceFull: true });
  assert.equal(result.mode, 'full');
  assert.match(result.reason, /manual full run/);
});

test('missing changed-file data fails safe to the full suite', () => {
  const result = classifyE2EScope([]);
  assert.equal(result.mode, 'full');
});
