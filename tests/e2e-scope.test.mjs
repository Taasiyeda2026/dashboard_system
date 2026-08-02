import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyE2EScope } from '../scripts/select-e2e-scope.mjs';

test('documentation-only changes skip browser tests', () => {
  const result = classifyE2EScope(['README.md', 'docs/PROJECT_MAP.md']);
  assert.equal(result.mode, 'docs');
  assert.deepEqual(result.screens, []);
});

test('draft proposal changes run proposal tests only', () => {
  const result = classifyE2EScope(
    ['frontend/src/screens/proposals-agreements.js', 'frontend/src/proposal-pdf-single-generation-hotfix.js'],
    { isDraft: true }
  );

  assert.equal(result.mode, 'targeted');
  assert.deepEqual(result.screens, ['proposals-agreements']);
  assert.match(result.grep, /proposals-agreements/);
  assert.match(result.grep, /Client file/);
});

test('draft activity changes cover activities, week and month', () => {
  const result = classifyE2EScope(['frontend/src/activity-drawer-inline-layout.js'], { isDraft: true });
  assert.equal(result.mode, 'targeted');
  assert.deepEqual(result.screens, ['activities', 'week', 'month']);
});

test('multiple mapped screens are combined in a draft PR', () => {
  const result = classifyE2EScope(
    ['frontend/src/screens/dashboard.js', 'frontend/src/instructor-calendar.js'],
    { isDraft: true }
  );

  assert.equal(result.mode, 'targeted');
  assert.deepEqual(result.screens, ['dashboard', 'week', 'month', 'instructors']);
});

test('shared frontend files always require the full suite', () => {
  const result = classifyE2EScope(['frontend/src/main.js'], { isDraft: true });
  assert.equal(result.mode, 'full');
});

test('unmapped live screens fall back to the full suite', () => {
  const result = classifyE2EScope(['frontend/src/screens/finance.js'], { isDraft: true });
  assert.equal(result.mode, 'full');
});

test('workflow and E2E infrastructure changes require the full suite', () => {
  const result = classifyE2EScope(
    ['.github/workflows/e2e-performance-gate.yml', 'e2e/helpers/performance.mjs'],
    { isDraft: true }
  );
  assert.equal(result.mode, 'full');
});

test('ready code PRs require the full merge gate', () => {
  const result = classifyE2EScope(['frontend/src/screens/contacts.js'], { isDraft: false });
  assert.equal(result.mode, 'full');
});

test('manual runs always execute the full suite', () => {
  const result = classifyE2EScope(['README.md'], { forceFull: true });
  assert.equal(result.mode, 'full');
});

test('missing changed-file data fails safe to the full suite', () => {
  const result = classifyE2EScope([]);
  assert.equal(result.mode, 'full');
});
