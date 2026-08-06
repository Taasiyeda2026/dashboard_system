import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { buildIsraaWorkbook, MAIN_HEADERS, ITEM_HEADERS } from '../frontend/src/israa-excel-export.js';

const tracking = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
const proposalItems = fs.readFileSync(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');

const external = ['מסד','מספר הצעה','בית ספר','סמל מוסד','רשות','סכום ההצעה','הערכת סגירה','תחזית כספית','סטטוס','פעולה להמשך','תאריך מעקב'];

test('external table has exactly the requested 11 overview columns and readable fixed layout', () => {
  const block = tracking.match(/const EXTERNAL_COLUMNS = \[([\s\S]*?)\];/)?.[1] || '';
  assert.equal([...block.matchAll(/'([^']+)'/g)].map((match) => match[1]).length, 11);
  for (const label of external) assert.match(block, new RegExp(label));
  assert.doesNotMatch(block, /סוג פעילות|שם הפעילות|מספר גפ״ן|בעלות|איש קשר|הערה/);
  assert.match(tracking, /table-layout:fixed/);
  assert.match(tracking, /font-size:12px/);
  assert.match(tracking, /font-size:11\.5px/);
  assert.match(tracking, /const widths = \[3\.5,6\.5,14,6\.5,9,9,7,9,8,19,8\.5\]/);
  assert.doesNotMatch(tracking, /overflow-x:auto/);
});

test('view drawer contains only complementary groups and intact proposal item rows', () => {
  const view = tracking.match(/function viewDrawerFields[\s\S]*?\n}\n\nfunction editDrawerFields/)?.[0] || '';
  for (const title of ['איש קשר והתקשרות','תאריך ההצעה','הפעילויות הכלולות בהצעה','בחירה והיקף צפויים']) assert.match(view, new RegExp(title));
  for (const duplicate of ['שם בית הספר','סמל מוסד','רשות','מס׳ הצעה','סכום ההצעה הכולל','הערכת סגירה','סטטוס','פעולה להמשך','תאריך מעקב']) assert.doesNotMatch(view, new RegExp(duplicate));
  assert.match(view, /clean\(draft\.notes\) \? section\('הערה'/);
  assert.match(proposalItems, /draft\.proposal_items\.map/);
  assert.match(proposalItems, /draft\?\.program_name/);
  assert.doesNotMatch(proposalItems, /split\(/);
  assert.match(tracking, /\.israa-drawer__activities\{width:65%;max-width:650px;min-width:500px/);
});

test('edit drawer only submits tracking fields and recalculates forecast', () => {
  for (const key of ['proposal_nature','grade','participants_groups','probability','status','next_action','follow_up_date','notes']) assert.match(tracking, new RegExp(`'${key}'`));
  assert.match(tracking, /data-v2-field="expected_program"/);
  assert.match(tracking, /data-v2-expected-option/);
  assert.doesNotMatch(tracking, /data-v2-field="(?:quote_number|school_name|proposal_items|total_amount)"/);
  assert.match(tracking, /data-v2-field="probability"/);
  assert.match(tracking, /numberValue\(row\?\.total_amount\)[\s\S]*Number\(probability\.value\) \/ 100/);
});

test('real XLSX export contains the 23-field sheet and item-per-row sheet with native types', () => {
  assert.equal(MAIN_HEADERS.length, 23);
  assert.deepEqual(ITEM_HEADERS, ['מספר הצעה','בית ספר','שם הפעילות','מספר גפ״ן','מספר קבוצות']);
  const workbook = buildIsraaWorkbook([{ id: '1', quote_number: 'Q1', proposal_date: '2026-07-30', school_name: 'בית ספר', semel_mosad: '00123', phone: '0501234567', total_amount: 1000, probability: 50, proposal_items: [{ program_name: 'פעילות א', gefen_number: '06089', quantity: 2, item_type: 'קורס' }] }]);
  assert.deepEqual(workbook.SheetNames, ['מעקב הצעות איסראא', 'פירוט פעילויות']);
  const main = workbook.Sheets[workbook.SheetNames[0]];
  const items = workbook.Sheets[workbook.SheetNames[1]];
  assert.equal(XLSX.utils.sheet_to_json(main, { header: 1 })[0].length, 23);
  assert.equal(XLSX.utils.sheet_to_json(items, { header: 1 }).length, 2);
  assert.equal(main.P2.t, 'n');
  assert.equal(main.R2.v, 0.5);
  assert.equal(main.S2.v, 500);
  assert.equal(main.F2.v, '00123');
  assert.equal(main.I2.v, '0501234567');
  assert.equal(main.B2.t, 'd');
  assert.deepEqual(main['!autofilter'], { ref: 'A1:W2' });
  assert.equal(workbook.Workbook.Views[0].RTL, true);
});
