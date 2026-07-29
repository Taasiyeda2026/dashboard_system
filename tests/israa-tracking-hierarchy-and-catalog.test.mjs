import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tracking = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
const filters = fs.readFileSync(new URL('../frontend/src/israa-tracking-filters-runtime.js', import.meta.url), 'utf8');
const proposalItems = fs.readFileSync(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');

const exactColumns = [
  'מסד','מס׳ הצעה','שם בית הספר','סמל מוסד','רשות','בעלות','שם מנהל/ת','נייד מנהל/ת','מייל מנהל/ת','איש/ת קשר נוסף','שם הפעילות','מספר גפ״ן','אופי ההצעה','התוכנית הצפויה','שכבה',"קבוצות / מס' משתתפים",'תאריך הוצאת ההצעה','סכום ההצעה הכולל','סבירות לסגירה','שווי צפוי ריאלי','סטטוס','הפעולה הבאה','תאריך מעקב','הערות'
];

const forbidden = ['תוקף ההצעה','אופן הפנייה','חסמים','מפגשים','שעות','תוכנית ראשית','שנת לימודים / מועד הפעלה'];

test('Israa page uses exactly the approved 24 information columns', () => {
  for (const label of exactColumns) assert.match(tracking, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const label of forbidden) assert.doesNotMatch(tracking, new RegExp(label));
  assert.match(tracking, /const EXTERNAL_COLUMNS = \[/);
  assert.match(tracking, /const INTERNAL_COLUMNS = \[/);
});

test('external table contains the twelve approved overview columns without an actions column', () => {
  for (const label of ['מסד','מס׳ הצעה','שם בית הספר','סמל מוסד','רשות','שם הפעילות','סכום ההצעה הכולל','סבירות לסגירה','שווי צפוי ריאלי','סטטוס','הפעולה הבאה','תאריך מעקב']) assert.match(tracking, new RegExp(label));
  assert.doesNotMatch(tracking, />פעולות</);
  assert.doesNotMatch(tracking, /min-width:1510px|overflow-x:auto/);
});

test('Israa uses its own scoped drawer and only approved internal fields in view mode', () => {
  assert.match(tracking, /ds-drawer--israa-exact/);
  assert.match(tracking, /viewDrawerFields/);
  for (const label of ['בעלות','שם מנהל\/ת','נייד מנהל\/ת','מייל מנהל\/ת','איש\/ת קשר נוסף','מספר גפ״ן','אופי ההצעה','התוכנית הצפויה','שכבה',"קבוצות \/ מס' משתתפים",'תאריך הוצאת ההצעה','הערות']) assert.match(tracking, new RegExp(label));
});

test('only the four requested filters are present', () => {
  for (const key of ['authority','school','program','status']) assert.match(filters, new RegExp(`data-israa-v2-filter-${key}`));
  assert.doesNotMatch(filters, /data-israa-v2-filter-query/);
  assert.doesNotMatch(filters, /filter-probability|filter-nature/);
});

test('new tracking records are selected from existing linked proposals', () => {
  assert.match(tracking, /openProposalPicker/);
  assert.match(tracking, /create_israa_tracking_from_proposal/);
  assert.doesNotMatch(tracking, /\.insert\(\[payload\]\)/);
});

test('drawer uses seven required sections and proposal_items read-only activity rows', () => {
  for (const title of ['פרטי המוסד ואיש הקשר', 'נתוני הצעת המחיר', 'הפעילויות הכלולות בהצעה', 'מידע משלים לתכנון', 'הערכת סגירה', 'משימת המשך', 'הערות']) assert.match(tracking, new RegExp(title));
  assert.match(tracking, /israa-drawer__activities/);
  assert.match(proposalItems, /draft\.proposal_items\.map/);
  assert.doesNotMatch(tracking, /data-v2-activity-row/);
  assert.doesNotMatch(tracking, /const participants = split/);
  assert.doesNotMatch(tracking, /israa-drawer__heading/);
});
