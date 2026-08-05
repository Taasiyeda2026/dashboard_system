import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  buildPrintKitAssignedMap,
  inactivePrintKitHolderNames,
  printKitCellHtml,
  printKitCellState
} from '../frontend/src/screens/operations-2027-training-kit-history-fix.js';
import {
  buildPrintKitSummary,
  resolveCourseForActivity,
  splitKitHoldersByActivity
} from '../frontend/src/screens/shared/operations-2027-domain.js';

const featurePath = new URL('../frontend/src/screens/operations-2027-training-kit-history-fix.js', import.meta.url);
const featureSource = await readFile(featurePath, 'utf8');

function cellData({ editable = true, assigned = false, holds = false } = {}) {
  const courseId = 'kit-a';
  const instructor = 'מדריכה פעילה';
  return {
    course: { id: courseId, short_name: 'ערכה א' },
    instructor,
    data: {
      editable,
      distributionMap: holds
        ? new Map([[`${courseId}::${instructor}`, { course_id: courseId, instructor_name: instructor }]])
        : new Map(),
      assignedMap: assigned
        ? new Map([[courseId, new Set([instructor])]])
        : new Map()
    }
  };
}

test('splitKitHoldersByActivity receives distributions and active instructors separately and maps yes/no activity', () => {
  const distributions = [
    { course_id: 'kit-a', instructor_name: 'מדריכה פעילה' },
    { course_id: 'kit-a', instructor_name: 'מדריך לא פעיל' }
  ];
  const instructors = [
    { full_name: 'מדריכה פעילה', active: 'yes' },
    { full_name: 'מדריך לא פעיל', active: 'no' }
  ];

  assert.deepEqual(splitKitHoldersByActivity(distributions, instructors), {
    active: [distributions[0]],
    inactive: [distributions[1]]
  });
});

test('print kit cell contract shows held, assigned-missing and empty states only in the allowed cases', () => {
  assert.deepEqual(printKitCellState({ holds: true, assigned: false }), { text: '✓', tone: 'green', state: 'held' });
  assert.deepEqual(printKitCellState({ holds: false, assigned: true }), { text: '✕', tone: 'red', state: 'assigned_missing' });
  assert.deepEqual(printKitCellState({ holds: false, assigned: false }), { text: '', tone: 'empty', state: 'empty' });
  assert.deepEqual(printKitCellState({ holds: false, assigned: true, inactive: true }), { text: '', tone: 'empty', state: 'empty' });
});

test('active unassigned instructor has an invisible delivery control only in edit mode', () => {
  const editable = cellData({ editable: true, assigned: false, holds: false });
  const editableHtml = printKitCellHtml(editable.data, editable.course, editable.instructor, false);
  assert.match(editableHtml, /class="ops2027-cell-button is-empty"/);
  assert.match(editableHtml, /data-history-kit-deliver/);
  assert.match(editableHtml, /מסירת ערכה למדריך שאינו משובץ/);
  assert.doesNotMatch(editableHtml, /✕/);

  const readonly = cellData({ editable: false, assigned: false, holds: false });
  assert.equal(printKitCellHtml(readonly.data, readonly.course, readonly.instructor, false), '');
});

test('inactive instructor never receives a delivery control in an empty cell', () => {
  const fixture = cellData({ editable: true, assigned: true, holds: false });
  const html = printKitCellHtml(fixture.data, fixture.course, fixture.instructor, true);
  assert.equal(html, '');
});

test('assigned missing and held cells keep red X and green check behavior', () => {
  const assigned = cellData({ editable: true, assigned: true, holds: false });
  const assignedHtml = printKitCellHtml(assigned.data, assigned.course, assigned.instructor, false);
  assert.match(assignedHtml, /class="ops2027-cell-button is-no"/);
  assert.match(assignedHtml, /data-history-kit-deliver/);
  assert.match(assignedHtml, /✕/);

  const held = cellData({ editable: true, assigned: false, holds: true });
  const heldHtml = printKitCellHtml(held.data, held.course, held.instructor, false);
  assert.match(heldHtml, /class="ops2027-cell-button is-yes"/);
  assert.match(heldHtml, /data-history-kit-return/);
  assert.match(heldHtml, /✓/);
});

test('inactive holder names include only distributions for displayed print kits', () => {
  const distributions = [
    { course_id: 'shown', instructor_name: 'מדריך מוצג' },
    { course_id: 'hidden', instructor_name: 'מדריך מערכה מוסתרת' },
    { course_id: 'shown', instructor_name: 'מדריך פעיל' }
  ];
  const names = inactivePrintKitHolderNames(
    distributions,
    ['מדריך פעיל'],
    [{ id: 'shown', short_name: 'ערכה מוצגת' }]
  );

  assert.deepEqual(names, ['מדריך מוצג']);
});

test('buildPrintKitSummary deduplicates the same instructor_name for one kit', () => {
  const summary = buildPrintKitSummary({
    warehouse: 1,
    holders: [
      { course_id: 'kit-a', instructor_name: 'מדריכה אחת' },
      { course_id: 'kit-a', instructor_name: '  מדריכה   אחת ' }
    ],
    activeInstructors: [{ full_name: 'מדריכה אחת', active: 'yes' }]
  });

  assert.equal(summary.activeInstructorKits, 1);
  assert.equal(summary.totalUnique, 2);
});

test('valid 2027 assignment creates need only through resolveCourseForActivity exact contract', () => {
  const courses = [{ id: 'kit-a', gefen_number: '100', short_name: 'רובוטיקה', full_name: 'רובוטיקה' }];
  const assigned = buildPrintKitAssignedMap([
    { activity_season: 'school_2027', activity_type: 'course', activity_no: '100', instructor_name: 'מדריכה משובצת' }
  ], courses);

  assert.equal(assigned.get('kit-a')?.has('מדריכה משובצת'), true);
  assert.deepEqual(printKitCellState({ holds: false, assigned: assigned.get('kit-a')?.has('מדריכה משובצת') }), { text: '✕', tone: 'red', state: 'assigned_missing' });
});

test('unmatched activities do not create kit need, including premium AI entrepreneurship', () => {
  const courses = [
    { id: 'ai', gefen_number: '501', short_name: 'בינה מלאכותית', full_name: 'בינה מלאכותית' },
    { id: 'entrepreneurship', gefen_number: '502', short_name: 'יזמות פרימיום', full_name: 'יזמות פרימיום' }
  ];
  const activity = { activity_name: 'בינה מלאכותית-יזמות פרימיום', instructor_name: 'מדריך' };

  assert.equal(resolveCourseForActivity(activity, courses), null);
  assert.equal(buildPrintKitAssignedMap([activity], courses).size, 0);
});

test('biomimicry escape-room kit remains inventory-only and never creates automatic need', () => {
  const courses = [{ id: 'bio', gefen_number: '700', short_name: 'ביומימיקרי חדר בריחה', full_name: 'ביומימיקרי חדר בריחה' }];
  const assigned = buildPrintKitAssignedMap([
    { activity_no: '700', instructor_name: 'מדריכה' }
  ], courses);

  assert.equal(assigned.size, 0);
});

test('print kit matrices never render no-stock text; stock shortage belongs to the need summary only', () => {
  assert.doesNotMatch(featureSource, /if \(available <= 0\) return '<span class="ops2027-out">אין מלאי<\/span>'/);
  assert.match(featureSource, /סיכום צורך בערכות/);
  assert.match(featureSource, /חסר מלאי/);
});

test('existing delivery and return write RPCs and permission RPC are preserved', () => {
  assert.match(featureSource, /app_is_admin_or_operation_manager/);
  assert.match(featureSource, /deliver_course_print_kit/);
  assert.match(featureSource, /return_course_print_kit/);
  assert.match(featureSource, /set_course_print_kit_stock/);
  assert.match(featureSource, /openLocationPicker\(button\.dataset\.courseId, button\.dataset\.instructor\)/);
});
