import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { buildReport, safeOutputPath } from '../scripts/write-local-baseline-report.mjs';

test('report produces JSON CSV markdown and N/A sizes', () => {
  const report = buildReport({ records: [{ id: '1', source: 'resource', service: 'static', path: '/app.js', started_at_ms: 0, duration_ms: 2, transfer_size: null, scenario: { name: 'cold', temperature: 'cold' }, context: {} }] });
  assert.match(report.csv, /cold/); assert.match(report.markdown, /N\/A/); assert.equal(report.normalized.records.length, 1);
});

test('report output rejects traversal and protected directory names', () => {
  const root = path.join(os.tmpdir(), 'ds-stage-2-test');
  assert.throws(() => safeOutputPath('../frontend/leak.json', root));
  for (const name of ['frontend/x', 'dist/x', 'public/x', 'sw/x', 'service-worker/x', 'precache/x']) assert.throws(() => safeOutputPath(name, root));
});
