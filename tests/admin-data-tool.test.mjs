import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/admin-data-tool.js', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');

test('admin data tool is loaded and appends the ninth management tile', () => {
  assert.match(bootstrap, /admin-data-tool\.js\?v=20260823-v2/);
  assert.match(source, /grid\.appendChild\(buildTile\(\)\)/);
  assert.match(source, /<strong>נתונים<\/strong>/);
});

test('data is fetched only for school 2027 open or closed activities after explicit display action', () => {
  assert.match(source, /\.eq\('activity_season', 'school_2027'\)/);
  assert.match(source, /\.in\('status', \['פתוח', 'סגור'\]\)/);
  assert.match(source, /data-admin-data-show-all/);
  assert.match(source, /data-admin-data-show/);
});

test('show all includes every eligible school 2027 course even when dates are missing', () => {
  assert.match(source, /const filtered = showAll \? eligible : eligible\.filter/);
  assert.match(source, /כולל פעילויות ללא תאריך/);
  assert.doesNotMatch(source, /showAll \? eligible\.filter/);
});

test('date range remains a focused overlap filter and counts a course once as a whole course', () => {
  assert.match(source, /return start <= to && end >= from/);
  assert.match(source, /row\.quantity \+= 1/);
  assert.match(source, /row\.amount \+= validMoney\(activity\?\.price\)/);
  assert.match(source, /סנן לפי תאריכים/);
});

test('district output is limited to north center south and uses compact separated sections', () => {
  assert.match(source, /const DISTRICTS = \['צפון', 'מרכז', 'דרום'\]/);
  assert.match(source, /admin-data-district-grid/);
  assert.match(source, /admin-data-section--funding/);
  assert.match(source, /border-top:2px solid/);
  assert.match(source, /admin-data-district\+ \.admin-data-district/);
  assert.match(source, /admin-data-table-wrap--funding\{width:min\(100%,690px\)\}/);
  assert.match(source, /text-align:right/);
  assert.match(source, /text-align:center/);
});

test('mixed funding splits quantity so one course always totals one', () => {
  assert.match(source, /const qty = 1 \/ count/);
  assert.match(source, /quantity: qty/);
  assert.match(source, /activity_funding_sources/);
  assert.match(source, /funding_sources/);
});

test('funding drawer groups Gefen by school and authority funding by authority', () => {
  assert.match(source, /normalized === 'גפן' \? 'school'/);
  assert.match(source, /normalized === 'רשות' \? 'authority'/);
  assert.match(source, /בתי ספר שנכללו בספירה/);
  assert.match(source, /רשויות שנכללו בספירה/);
});

test('cross-period alert uses the agreed dates', () => {
  assert.match(source, /ALERT_START_FROM = '2026-09-01'/);
  assert.match(source, /ALERT_START_TO = '2026-12-20'/);
  assert.match(source, /ALERT_END_AFTER = '2027-01-31'/);
  assert.match(source, /קורסים חוצי תקופה/);
});
