import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const filters = fs.readFileSync(new URL('../frontend/src/israa-tracking-filters-runtime.js', import.meta.url), 'utf8');
const scroll = fs.readFileSync(new URL('../frontend/src/israa-tracking-horizontal-scroll.js', import.meta.url), 'utf8');
const newRow = fs.readFileSync(new URL('../frontend/src/israa-new-row-catalog-runtime.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260729181500_israa_tracking_new_rows_start_as_sent.sql', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('Israa tracking exposes a general search alongside the four filters', () => {
  for (const key of ['authority', 'school', 'program', 'status']) {
    assert.match(filters, new RegExp(`data-israa-v2-filter-${key}`));
  }
  assert.doesNotMatch(filters, /data-israa-v2-filter-probability/);
  assert.doesNotMatch(filters, /data-israa-v2-filter-nature/);
  assert.match(filters, /data-israa-v2-filter-query/);
  assert.match(filters, /filterState\.query/);
  assert.match(filters, /נקה סינון/);
});

test('Israa content is bounded to the shell and only the table scrolls horizontally', () => {
  const tracking = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
  assert.match(tracking, /\.israa-v2\{[\s\S]*width:92%[\s\S]*max-width:1360px[\s\S]*margin:12px auto/);
  assert.match(tracking, /\.israa-v2__wrap[\s\S]*overflow-x:auto/);
  assert.match(tracking, /\.israa-v2__wrap[\s\S]*direction:rtl/);
  assert.doesNotMatch(tracking, /width:\s*100vw/);
});

test('general search index includes visible and drawer tracking fields', () => {
  const tracking = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
  for (const field of ['authority', 'school_name', 'semel_mosad', 'program_name', 'quote_number', 'contact_person', 'phone', 'email', 'status', 'notes']) {
    assert.match(tracking, new RegExp(`row\\.${field}`));
  }
  for (const field of ['next_action', 'barriers', 'outreach_method']) assert.match(tracking, new RegExp(`row\\.${field}`));
});

test('summary cards use four equal columns inside the bounded content', () => {
  const tracking = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
  assert.match(tracking, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(tracking, /min-height:68px/);
  assert.doesNotMatch(filters, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)\s*!important/);
});

test('table wrapper is the sole horizontal scroller and resets to RTL start', () => {
  assert.match(scroll, /tableWrap\.scrollLeft\s*=\s*0/);
  assert.match(scroll, /window\.addEventListener\('resize',[\s\S]*schedule\(true\)/);
  assert.match(scroll, /window\.addEventListener\('hashchange',[\s\S]*schedule\(true\)/);
  assert.doesNotMatch(scroll, /position:\s*fixed|document\.body\.appendChild|overflow-x:\s*auto/);
});

test('new row uses school, contact and course catalogs', () => {
  assert.match(newRow, /\.from\('schools'\)/);
  assert.match(newRow, /\.from\('contacts_schools'\)/);
  assert.match(newRow, /\.from\('proposal_gefen_courses'\)/);
  assert.match(newRow, /dataset\.israaNewSchool/);
  assert.match(newRow, /dataset\.israaNewContact/);
  assert.match(newRow, /dataset\.israaNewCourse/);
  assert.match(newRow, /hiddenField\(row, 'school_id'\)/);
  assert.match(newRow, /semelInput\.readOnly = true/);
  assert.match(newRow, /gefenInput\.readOnly = true/);
  assert.match(newRow, /phoneInput\.value/);
  assert.match(newRow, /emailInput\.value/);
});

test('proposal transfer starts in sent status and does not auto-promote to approved', () => {
  assert.match(migration, /v_tracking_status := 'נשלחה'/);
  assert.match(migration, /\$new_upsert\$[\s\S]*else current_row\.status[\s\S]*\$new_upsert\$/);
  assert.match(migration, /approved status logic still exists/);
});

test('application entry loads the Israa tracking enhancements', () => {
  assert.match(entry, /israa-tracking-horizontal-scroll\.js/);
  assert.match(entry, /israa-tracking-filters-runtime\.js/);
  assert.match(entry, /israa-new-row-catalog-runtime\.js/);
});
