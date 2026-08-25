import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const exportSource = readFileSync(new URL('../frontend/src/screens/shared/excel-export.js', import.meta.url), 'utf8');
const activitiesSource = readFileSync(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
const {
  ACTIVITY_EXPORT_HEADERS,
  activityExportRow,
  mergeActivityExportDetails
} = await import('../frontend/src/screens/shared/excel-export.js');

const APPROVED_ACTIVITY_EXPORT_HEADERS = [
  'מספר שורה',
  'שם פעילות',
  'סוג פעילות',
  'סטטוס',
  'בית ספר',
  'רשות',
  'שכבה',
  'קבוצה / כיתה',
  'מנהל פעילות',
  'מדריך 1',
  'מדריך 2',
  'תאריך התחלה',
  'תאריך סיום',
  'תאריכי מפגשים',
  'שעת התחלה',
  'שעת סיום',
  'מימון',
  'מחיר',
  'הערות'
];

test('activity Excel export keeps the approved 19 columns in the approved order', () => {
  assert.deepEqual(ACTIVITY_EXPORT_HEADERS, APPROVED_ACTIVITY_EXPORT_HEADERS);
});

test('activity Excel export enriches the four fields missing from the admin list projection', () => {
  assert.match(
    exportSource,
    /ACTIVITY_EXPORT_DETAIL_COLUMNS = 'row_id,activity_manager,funding,price,notes'/
  );
  assert.match(
    exportSource,
    /\.from\('activities'\)[\s\S]*?\.select\(ACTIVITY_EXPORT_DETAIL_COLUMNS\)[\s\S]*?\.in\('row_id', chunk\)/
  );
});

test('activity export details merge by row id without changing the selected page row order', () => {
  const pageRows = [
    {
      row_id: '2027-2',
      activity_name: 'פעילות שנייה',
      activity_type: 'course',
      status: 'פתוח',
      school: 'בית ספר ב',
      authority: 'רשות ב'
    },
    {
      row_id: '2027-1',
      activity_name: 'פעילות ראשונה',
      activity_type: 'workshop',
      status: 'פתוח',
      school: 'בית ספר א',
      authority: 'רשות א'
    }
  ];
  const details = [
    { row_id: '2027-1', activity_manager: 'מנהלת א', funding: 'גפן', price: 9000, notes: 'הערה א' },
    { row_id: '2027-2', activity_manager: 'מנהלת ב', funding: 'רשות', price: 7500, notes: 'הערה ב' }
  ];

  const merged = mergeActivityExportDetails(pageRows, details);
  assert.deepEqual(merged.map((row) => row.row_id), ['2027-2', '2027-1']);
  assert.equal(activityExportRow(merged[0])['מנהל פעילות'], 'מנהלת ב');
  assert.equal(activityExportRow(merged[0])['מימון'], 'רשות');
  assert.equal(activityExportRow(merged[0])['מחיר'], 7500);
  assert.equal(activityExportRow(merged[0])['הערות'], 'הערה ב');
  assert.equal(activityExportRow(merged[1])['מנהל פעילות'], 'מנהלת א');
  assert.equal(activityExportRow(merged[1])['מימון'], 'גפן');
  assert.equal(activityExportRow(merged[1])['מחיר'], 9000);
  assert.equal(activityExportRow(merged[1])['הערות'], 'הערה א');
});

test('admin export filters to the current activities page before Excel generation', () => {
  assert.match(
    activitiesSource,
    /const sourceRows = Array\.isArray\(res\?\.rows\) \? res\.rows : \[\];[\s\S]*?const rows = activityRowsForInnerTab\(sourceRows, state\);[\s\S]*?exportActivitiesToExcel\(rows,/
  );
});
