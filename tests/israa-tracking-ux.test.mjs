import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tracking = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
const filters = fs.readFileSync(new URL('../frontend/src/israa-tracking-filters-runtime.js', import.meta.url), 'utf8');
const entry = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

const exactFields = ['quote_number','school_name','semel_mosad','authority','ownership','manager_name','manager_phone','manager_email','additional_contact','program_name','gefen_numbers','proposal_nature','expected_program','grade','participants_groups','proposal_date','total_amount','probability','status','next_action','follow_up_date','notes'];

test('Israa tracking exposes compact search and the four required filters', () => {
  for (const key of ['authority', 'school', 'program', 'status']) assert.match(filters, new RegExp(`data-israa-v2-filter-${key}`));
  assert.match(filters, /data-israa-v2-filter-query/);
  assert.match(filters, /filterState\.query/);
  assert.match(filters, /placeholder="חיפוש בעמוד"/);
  assert.doesNotMatch(filters, /filter-count|מתוך/);
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
  assert.match(tracking, /row\.activity_type/);
  for (const field of ['activity_type_group','valid_until','outreach_method','barriers','meetings_count','hours_count']) assert.doesNotMatch(tracking, new RegExp(`row\.${field}`));
});

test('summary cards remain four equal columns', () => {
  assert.match(tracking, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(tracking, /min-height:68px/);
});

test('application entry cache-busts the exact Israa modules', () => {
  assert.match(entry, /israa-tracking-v2-runtime\.js\?v=20260730-israa-program-menu-visible-v1/);
  assert.match(entry, /israa-tracking-filters-runtime\.js\?v=20260730-israa-toolbar-filters-v6/);
  assert.doesNotMatch(entry, /israa-tracking-horizontal-scroll\.js/);
  assert.doesNotMatch(tracking, /data-v2-refresh|>רענון</);
  assert.match(tracking, /israa-v2__date[^}]*white-space:nowrap/);
});

test('Israa drawer is compact and expected programs are constrained to proposal items', () => {
  assert.match(tracking, /\.israa-drawer__grid\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(tracking, /\.israa-drawer__grid\{[^}]*repeat\(3/);
  assert.match(tracking, /\.israa-drawer__activities\{width:480px;max-width:100%;min-width:0/);
  assert.match(tracking, /margin-inline-start:0;margin-inline-end:auto/);
  assert.match(tracking, /const NATURE_OPTIONS = \['תוכנית מוגדרת', 'חלופות לבחירה'\]/);
  assert.match(tracking, /draft\?\.proposal_items/);
  assert.match(tracking, /data-v2-expected-option/);
  assert.match(tracking, /data-v2-remove-expected/);
  assert.match(tracking, /expected\.join\('\s*\|\s*'\)/);
  assert.match(tracking, /לא נמצאו פעילויות לבחירה/);
});


test('expected-program multi-select keeps tags outside its toggle and scopes interactions to its wrapper', () => {
  assert.match(tracking, /class="israa-v2__multi-control"/);
  assert.match(tracking, /class="israa-drawer__tags" data-v2-expected-tags/);
  assert.match(tracking, /class="israa-v2__multi-toggle" data-v2-multi-toggle/);
  const toggleMarkup = tracking.match(/<button[^>]*data-v2-multi-toggle[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
  assert.ok(toggleMarkup);
  assert.doesNotMatch(toggleMarkup, /data-v2-remove-expected/);
  assert.match(tracking, /toggle\.closest\('\.israa-v2__multi'\)/);
  assert.match(tracking, /event\.preventDefault\(\);[\s\S]*event\.stopPropagation\(\);/);
  assert.match(tracking, /multiSelectOutsideClickBound/);
  assert.match(tracking, /selected\.join\(' \| '\)/);
});

test('expected-program menu expands in drawer flow and scrolls into view', () => {
  const menuRule = tracking.match(/\.israa-v2__multi-menu\{([^}]*)\}/)?.[1] || '';
  assert.match(menuRule, /position:static/);
  assert.match(menuRule, /width:100%/);
  assert.match(menuRule, /max-width:520px/);
  assert.match(menuRule, /max-height:220px/);
  assert.match(menuRule, /margin-top:7px/);
  assert.match(menuRule, /overflow-y:auto/);
  assert.doesNotMatch(menuRule, /position:(?:absolute|fixed)/);
  assert.match(tracking, /\.israa-v2__multi-menu\[hidden\]\{display:none!important\}/);
  assert.match(tracking, /const willOpen = menu\.hidden;[\s\S]*menu\.hidden = !willOpen;[\s\S]*requestAnimationFrame\(\(\) => \{[\s\S]*menu\.scrollIntoView\(\{ block: 'nearest', behavior: 'smooth' \}\)/);
});
