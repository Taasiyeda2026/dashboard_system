import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const read = (p) => fs.readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('config includes activities snapshot sheet key', async () => {
  const cfg = await read('backend/config.gs');
  assert.match(cfg, /ACTIVITIES_SNAPSHOT:\s*'activities_snapshot'/);
});

test('snapshot schemas are finance-free', async () => {
  const schema = await read('backend/sheet-schema.gs');
  assert.doesNotMatch(schema, /finance_open_count/);
  assert.doesNotMatch(schema, /can_view_finance/);
  assert.doesNotMatch(schema, /dashboard_by_manager_snapshot[\s\S]*finance_open/);
});

test('workbook builder script exists and outputs template xlsx', async () => {
  const script = await read('scripts/build_system_dashboard_workbook.mjs');
  assert.match(script, /generated\/system-dashboard-template\.xlsx/);
  assert.match(script, /--with-sample-data/);
});
