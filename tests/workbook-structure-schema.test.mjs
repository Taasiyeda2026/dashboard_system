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

test('backend and json schema include required snapshot/system keys', async () => {
  const backend = await read('backend/sheet-schema.gs');
  const json = await read('scripts/sheet-schema.json');
  for (const key of ['activities_snapshot', 'dashboard_summary_snapshot', 'dashboard_by_manager_snapshot', 'read_models']) {
    assert.match(backend, new RegExp(`${key}:\\s*\\{`));
    assert.match(json, new RegExp(`\"sheetName\"\\s*:\\s*\"${key}\"`));
  }
});

test('workbook json source sheets have non-empty headers', async () => {
  const schema = JSON.parse(await read('scripts/sheet-schema.json'));
  const required = ['data_long','data_short','activity_meetings','settings','lists','permissions','contacts_instructors','contacts_schools','operations_private_notes','edit_requests'];
  required.forEach((name) => {
    const spec = schema.sheets.find((s) => s.sheetName === name);
    assert.ok(spec, `missing spec ${name}`);
    assert.ok(Array.isArray(spec.headers) && spec.headers.length > 0, `empty headers ${name}`);
  });
});

test('workbook builder script exists and outputs template xlsx', async () => {
  const script = await read('scripts/build_system_dashboard_workbook.mjs');
  assert.match(script, /generated\/system-dashboard-template\.xlsx/);
  assert.match(script, /--with-sample-data/);
});

test('backend avoids top-level schema reads via getSystemSheetSpec_', async () => {
  const files = ['backend/dashboard-snapshot.gs', 'backend/activities-snapshot.gs', 'backend/read-models.gs'];
  for (const file of files) {
    const source = await read(file);
    assert.doesNotMatch(source, /var\s+\w+\s*=\s*getSystemSheetSpec_\(/);
  }
});
