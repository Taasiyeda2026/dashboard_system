import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tracking = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
const hierarchy = fs.readFileSync(new URL('../frontend/src/israa-tracking-hierarchy-runtime.js', import.meta.url), 'utf8');
const catalog = fs.readFileSync(new URL('../frontend/src/israa-new-row-catalog-runtime.js', import.meta.url), 'utf8');
const filters = fs.readFileSync(new URL('../frontend/src/israa-tracking-filters-runtime.js', import.meta.url), 'utf8');

test('tracking table has the eight stable summary columns', () => {
  for (const label of ['בית ספר','רשות','מס׳ הצעה','תוכניות','נתונים כספיים','סטטוס','מעקב','פעולות']) assert.match(tracking, new RegExp(label));
  assert.match(tracking, /table-layout:fixed/);
  assert.match(tracking, /<col style=\"width:15%\">[\s\S]*<col style=\"width:6%\">/);
  assert.doesNotMatch(tracking, /min-width:1510px/);
});

test('one shared drawer contains full proposal sections and proposal items', () => {
  assert.match(tracking, /createSharedInteractionLayer/);
  assert.match(tracking, /ui\.openDrawer/);
  for (const text of ['תמונת מצב','פירוט התוכניות','מעקב והתקדמות','פרטי איש קשר','הערות','חסמים','תוקף ההצעה','אופן הפנייה']) assert.match(tracking, new RegExp(text));
  for (const key of ['program_name','gefen_number','quantity','total_price','meetings_count','hours_count']) assert.match(tracking, new RegExp(key));
  assert.match(hierarchy, /one source of truth/);
  assert.doesNotMatch(hierarchy, /\.from\('israa_program_tracking'\)/);
});

test('drawer owns edit, create, cancel, save and delete actions', () => {
  for (const action of ['data-v2-drawer-edit','data-v2-drawer-cancel','data-v2-drawer-save','data-v2-drawer-delete']) assert.match(tracking, new RegExp(action));
  assert.match(tracking, /mode === 'create'/);
  assert.match(tracking, /proposal_nature: 'ממוקדת', probability: 50, status: 'טיוטה'/);
  assert.match(tracking, /rows = creating \? \[data, \.\.\.rows\]/);
});

test('all proposal programs participate in filtering and search', () => {
  assert.match(tracking, /data-v2-programs/);
  assert.match(filters, /row\.dataset\.v2Programs/);
  assert.match(tracking, /row\.next_action/);
  assert.match(tracking, /row\.notes/);
  assert.match(tracking, /row\.barriers/);
});

test('course catalog remains available for gefen autofill', () => {
  assert.match(catalog, /\.from\('proposal_gefen_courses'\)/);
  assert.match(tracking, /data-v2-program-input/);
  assert.match(tracking, /gefen\.value = clean\(course\.gefen_number\)/);
});
