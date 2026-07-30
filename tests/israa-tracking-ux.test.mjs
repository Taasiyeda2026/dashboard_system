import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tracking = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
const filters = fs.readFileSync(new URL('../frontend/src/israa-tracking-filters-runtime.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

const exactFields = ['quote_number','school_name','semel_mosad','authority','ownership','manager_name','manager_phone','manager_email','additional_contact','program_name','gefen_numbers','proposal_nature','expected_program','grade','participants_groups','proposal_date','total_amount','probability','status','next_action','follow_up_date','notes'];

test('Israa tracking exposes only the four required filters', () => {
  for (const key of ['authority', 'school', 'program', 'status']) assert.match(filters, new RegExp(`data-israa-v2-filter-${key}`));
  assert.doesNotMatch(filters, /data-israa-v2-filter-query/);
  assert.doesNotMatch(filters, /filterState\.query/);
  assert.doesNotMatch(filters, /data-israa-v2-filter-probability|data-israa-v2-filter-nature/);
  assert.match(filters, /נקה סינון/);
});

test('Israa content is bounded and the table fits without horizontal scrolling', () => {
  assert.match(tracking, /\.israa-v2\{[\s\S]*width:94%[\s\S]*max-width:1540px[\s\S]*margin:12px auto/);
  assert.match(tracking, /\.israa-v2__wrap[\s\S]*overflow:hidden/);
  assert.match(tracking, /\.israa-v2__wrap[\s\S]*direction:rtl/);
  assert.doesNotMatch(tracking, /min-width:1510px|overflow-x:auto/);
  assert.doesNotMatch(tracking, /width:\s*100vw/);
});

test('search metadata uses only approved Israa data fields', () => {
  for (const field of exactFields) assert.match(tracking, new RegExp(`row\.${field}`));
  for (const field of ['activity_type','activity_type_group','valid_until','outreach_method','barriers','meetings_count','hours_count']) assert.doesNotMatch(tracking, new RegExp(`row\.${field}`));
});

test('summary cards remain four equal columns', () => {
  assert.match(tracking, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(tracking, /min-height:68px/);
});

test('application entry cache-busts the exact Israa modules', () => {
  assert.match(entry, /israa-tracking-v2-runtime\.js\?v=20260730-israa-approved-fields-v5/);
  assert.match(entry, /israa-tracking-filters-runtime\.js\?v=20260730-israa-approved-fields-v5/);
  assert.doesNotMatch(entry, /israa-tracking-horizontal-scroll\.js/);
});
