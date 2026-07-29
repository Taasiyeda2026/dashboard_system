import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const filters = fs.readFileSync(new URL('../frontend/src/israa-tracking-filters-runtime.js', import.meta.url), 'utf8');
const scroll = fs.readFileSync(new URL('../frontend/src/israa-tracking-horizontal-scroll.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260729181500_israa_tracking_new_rows_start_as_sent.sql', import.meta.url), 'utf8');

test('Israa tracking exposes only the four requested filters', () => {
  for (const key of ['authority', 'school', 'program', 'status']) {
    assert.match(filters, new RegExp(`data-israa-v2-filter-${key}`));
  }
  assert.doesNotMatch(filters, /data-israa-v2-filter-probability/);
  assert.doesNotMatch(filters, /data-israa-v2-filter-nature/);
  assert.doesNotMatch(filters, /data-israa-v2-filter-query/);
});

test('summary cards use four equal columns across the content width', () => {
  assert.match(filters, /grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(filters, /\.israa-v2__kpi\s*\{[\s\S]*width:\s*100%/);
  assert.match(filters, /gap:\s*8px/);
});

test('horizontal table scrollbar is fixed at the bottom of the viewport', () => {
  assert.match(scroll, /position:\s*fixed/);
  assert.match(scroll, /bottom:\s*7px/);
  assert.match(scroll, /document\.body\.appendChild\(fixedScroller\)/);
  assert.match(scroll, /activeWrap\.scrollLeft\s*=\s*fixedScroller\.scrollLeft/);
});

test('proposal transfer starts in sent status and does not auto-promote to approved', () => {
  assert.match(migration, /v_tracking_status := 'נשלחה'/);
  assert.doesNotMatch(migration, /excluded\.status = 'אושרה'/);
  assert.match(migration, /else current_row\.status/);
});
