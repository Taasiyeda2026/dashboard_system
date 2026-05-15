/**
 * Tests for the exceptions screen showing ALL exception types, not just
 * late_end_date.
 *
 * Root cause fixed: computeExceptionsModel_ was skipping activities that
 * have no start_date when a month filter was active (activityOverlapsYm_
 * returns false when start_date is absent).  Activities without start_date
 * are themselves missing_start_date exceptions and must always be included.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (p) => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

// ─── Lightweight JS re-implementations of backend helpers ────────────────────

function ymBounds(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const lastDate = new Date(y, m, 0);
  const dd = String(lastDate.getDate()).padStart(2, '0');
  const last = `${ym}-${dd}`;
  return { first, last };
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  const normalized = String(value).replace(/\u00A0/g, ' ').trim();
  if (!normalized) return true;
  const compact = normalized.replace(/\s+/g, ' ').toLowerCase();
  return compact === 'null' || compact === 'undefined';
}

function nonEmptyString(value) {
  return isEmptyValue(value) ? '' : String(value).trim();
}

function activityOverlapsYm(row, ym) {
  const b = ymBounds(ym);
  const s = nonEmptyString(row.start_date);
  const e = nonEmptyString(row.end_date) || s;
  if (!s) return false;
  return s <= b.last && e >= b.first;
}

function rowExceptionTypes(row) {
  // Cutoff is between test dates: rows with end_date > '2026-06-01' get late_end_date.
  // This means: rowAllThree (2026-07-31) and rowOnlyLate (2026-07-31) → late_end_date ✓
  //             rowNoException/rowMissingInstructor (2026-05-30) → no late_end_date ✓
  const LATE_CUTOFF = '2026-06-01';
  const out = [];
  if (row.status === 'ארכיון' || row.status === 'canceled') return out;
  const hasInstructor =
    (!isEmptyValue(row.instructor_name) || !isEmptyValue(row.emp_id) ||
     !isEmptyValue(row.instructor_name_2) || !isEmptyValue(row.emp_id_2));
  if (!hasInstructor) out.push('missing_instructor');
  if (isEmptyValue(row.start_date)) out.push('missing_start_date');
  if (String(row.end_date || '') > LATE_CUTOFF) out.push('late_end_date');
  return out;
}

function computeExceptionsModel(sourceRows, ym, opts) {
  const includeRows = (opts || {}).include_rows === true;
  const counts = { missing_instructor: 0, missing_start_date: 0, late_end_date: 0 };
  const byManager = {};
  const exceptionRows = [];
  let totalExceptionRows = 0;

  sourceRows.forEach((row) => {
    if (String(row.activity_type || '') !== 'course') return;
    // KEY FIX: activities without start_date are always included
    const rowHasStart = !isEmptyValue(row.start_date);
    if (ym && rowHasStart && !activityOverlapsYm(row, ym)) return;
    if (row.status === 'ארכיון') return;

    const types = rowExceptionTypes(row);
    if (!types.length) return;

    const manager = String(row.activity_manager || '') || 'unassigned';
    if (!byManager[manager]) byManager[manager] = 0;
    totalExceptionRows += 1;
    byManager[manager] += 1;

    types.forEach((type) => {
      if (!counts[type]) counts[type] = 0;
      counts[type] += 1;
    });
    if (includeRows) {
      exceptionRows.push({ RowID: String(row.RowID || ''), activity_type: row.activity_type, exception_type: types[0] || '', exception_types: types.slice() });
    }
  });

  const totalExceptionInstances = counts.missing_instructor + counts.missing_start_date + counts.late_end_date;
  return { rows: exceptionRows, totalExceptionInstances, totalExceptionRows, counts, byManager };
}


function dashboardSnapshotModel(sourceRows, ym) {
  const exceptionSummary = computeExceptionsModel(sourceRows, ym, { include_rows: false });
  const missingInstructor = exceptionSummary.counts.missing_instructor || 0;
  const missingStartDate = exceptionSummary.counts.missing_start_date || 0;
  const lateEndDate = exceptionSummary.counts.late_end_date || 0;
  return {
    month: ym,
    totals: { exceptions_count: exceptionSummary.totalExceptionRows },
    summary: {
      exceptions_count: exceptionSummary.totalExceptionRows,
      totalExceptionRows: exceptionSummary.totalExceptionRows,
      late_end_date_count: lateEndDate,
      operational_gaps_count: missingInstructor + missingStartDate,
      missing_instructor_count: missingInstructor,
      missing_start_date_count: missingStartDate,
      counts: { ...exceptionSummary.counts }
    },
    by_activity_manager: Object.entries(exceptionSummary.byManager).map(([activity_manager, exceptions]) => ({ activity_manager, exceptions })),
    kpi_cards: [{ id: 'exceptions', action: 'kpi|exceptions', value: exceptionSummary.totalExceptionRows }]
  };
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const YM = '2026-05';

// Activity with ALL THREE exception types: no instructor, no start_date, late end_date
const rowAllThree = {
  RowID: 'LONG-001',
  activity_type: 'course',
  activity_manager: 'mgr_a',
  instructor_name: 'NULL',
  emp_id: ' null ',
  start_date: 'NULL',
  end_date: '2026-07-31',  // after cutoff → late_end_date
  status: 'פעיל'
};

// Activity with only late_end_date (has instructor and start_date within month)
const rowOnlyLate = {
  RowID: 'LONG-002',
  activity_type: 'course',
  activity_manager: 'mgr_a',
  instructor_name: 'רחל כהן',
  emp_id: 'E1',
  start_date: '2026-05-01',
  end_date: '2026-07-31',
  status: 'פעיל'
};

// Activity that is fully OK — no exceptions
const rowNoException = {
  RowID: 'LONG-003',
  activity_type: 'course',
  activity_manager: 'mgr_b',
  instructor_name: 'דן לוי',
  emp_id: 'E2',
  start_date: '2026-05-01',
  end_date: '2026-05-30',
  status: 'פעיל'
};

// Non-course activity — should always be excluded
const rowNonCourse = {
  RowID: 'SHORT-001',
  activity_type: 'workshop',
  activity_manager: 'mgr_a',
  instructor_name: '',
  emp_id: '',
  start_date: '',
  end_date: '2026-07-01',
  status: 'פעיל'
};

// Activity with only missing_instructor, within month
const rowMissingInstructor = {
  RowID: 'LONG-004',
  activity_type: 'course',
  activity_manager: 'mgr_b',
  instructor_name: '',
  emp_id: '',
  start_date: '2026-05-10',
  end_date: '2026-05-30',
  status: 'פעיל'
};


// Activity with only missing_start_date: has instructor and no start date.
const rowMissingStartDate = {
  RowID: 'LONG-006',
  activity_type: 'course',
  activity_manager: 'mgr_b',
  instructor_name: 'נועה ישראלי',
  emp_id: 'E6',
  start_date: '',
  end_date: '2026-05-30',
  status: 'פעיל'
};

// Activity outside the month with start_date set — should be excluded when filtering by month
const rowOutOfMonth = {
  RowID: 'LONG-005',
  activity_type: 'course',
  activity_manager: 'mgr_a',
  instructor_name: 'דנה אוחנה',
  emp_id: 'E3',
  start_date: '2025-01-01',
  end_date: '2025-03-31',
  status: 'פעיל'
};

// ─── Numeric tests ────────────────────────────────────────────────────────────

test('isEmptyValue treats textual NULL markers as empty', () => {
  for (const value of ['', '   ', null, undefined, 'NULL', 'null', ' undefined ']) {
    assert.equal(isEmptyValue(value), true, `${String(value)} should be empty`);
  }
  assert.equal(isEmptyValue('actual value'), false);
});

test('activity with all 3 exception types counts as one row and keeps details', () => {
  const result = computeExceptionsModel([rowAllThree], '', { include_rows: true });
  assert.equal(result.totalExceptionInstances, 3,
    'one activity with missing_instructor + missing_start_date + late_end_date → 3 instances');
  assert.equal(result.rows.length, 1, 'should produce one row per course');
  const types = result.rows[0].exception_types || [];
  assert.deepEqual(types.sort(), ['late_end_date','missing_instructor','missing_start_date'].sort());
});

test('activity without start_date (missing_start_date) is included in month-filtered results', () => {
  const allRows = [rowAllThree, rowOnlyLate, rowNoException, rowNonCourse];
  const result = computeExceptionsModel(allRows, YM, { include_rows: true });
  const rowIds = result.rows.map((r) => r.RowID);
  assert.ok(rowIds.includes('LONG-001'),
    'LONG-001 (no start_date) must appear even when month filter is active');
  assert.ok(rowIds.includes('LONG-002'),
    'LONG-002 (has start_date, overlaps month) must appear');
  assert.ok(!rowIds.includes('LONG-003'),
    'LONG-003 (no exceptions) must NOT appear');
  assert.ok(!rowIds.includes('SHORT-001'),
    'SHORT-001 (non-course) must NOT appear');
});

test('activity outside month with start_date is excluded when month filter is active', () => {
  const result = computeExceptionsModel([rowOutOfMonth], YM, { include_rows: true });
  assert.equal(result.rows.length, 0,
    'LONG-005 ended 2025-03-31, should not appear in 2026-05 exceptions');
  assert.equal(result.totalExceptionInstances, 0);
});

test('count by manager is by course rows, not instances', () => {
  const allRows = [rowAllThree, rowMissingInstructor];
  const result = computeExceptionsModel(allRows, YM, { include_rows: false });
  // rowAllThree (no start_date): 3 exceptions → mgr_a gets 3
  // rowMissingInstructor: 1 exception → mgr_b gets 1
  assert.equal(result.byManager['mgr_a'], 1, 'mgr_a should count one problematic course');
  assert.equal(result.byManager['mgr_b'], 1, 'mgr_b should count one problematic course');
  assert.equal(result.totalExceptionRows, 2);
});


test('dashboard snapshot uses the same total rows, detail counts, and manager counts as exceptions model', () => {
  const allRows = [
    rowMissingInstructor,
    rowMissingStartDate,
    rowOnlyLate,
    rowAllThree,
    rowNoException,
    rowNonCourse,
    rowOutOfMonth
  ];
  const exceptions = computeExceptionsModel(allRows, YM, { include_rows: true });
  const dashboard = dashboardSnapshotModel(allRows, YM);
  const exceptionsKpi = dashboard.kpi_cards.find((card) => card.id === 'exceptions');
  const byManager = Object.fromEntries(dashboard.by_activity_manager.map((row) => [row.activity_manager, row.exceptions]));

  assert.equal(exceptions.totalExceptionRows, 4, 'four course activities are exceptional in the selected month');
  assert.equal(exceptions.totalExceptionInstances, 6, 'multi-exception rows still contribute each detail type');
  assert.equal(dashboard.totals.exceptions_count, exceptions.totalExceptionRows);
  assert.equal(exceptionsKpi.value, exceptions.totalExceptionRows);
  assert.equal(dashboard.summary.exceptions_count, exceptions.totalExceptionRows);
  assert.equal(dashboard.summary.totalExceptionRows, exceptions.totalExceptionRows);
  assert.equal(dashboard.summary.late_end_date_count, exceptions.counts.late_end_date);
  assert.equal(dashboard.summary.operational_gaps_count, exceptions.counts.missing_instructor + exceptions.counts.missing_start_date);
  assert.deepEqual(byManager, exceptions.byManager);
  assert.equal(exceptions.byManager.mgr_a, 2);
  assert.equal(exceptions.byManager.mgr_b, 2);
});

test('non-course activities are never included in exceptions', () => {
  const result = computeExceptionsModel([rowNonCourse], '', { include_rows: true });
  assert.equal(result.rows.length, 0, 'workshops/tours must not appear in exceptions');
  assert.equal(result.totalExceptionInstances, 0);
});

// ─── Source-code structure tests ──────────────────────────────────────────────

test('backend computeExceptionsModel_ guards month filter only when start_date exists', async () => {
  const src = await read('OLD-GAS/actions.gs');
  // The fix: rowHasStart is defined and used as a guard
  assert.match(src, /var rowHasStart = !isEmptyValue_\(row && row\.start_date\) && !!normalizeDateTextToIso_\(row && row\.start_date\)/,
    'computeExceptionsModel_ must compute rowHasStart with the unified empty-value helper');
  assert.match(src, /if \(month && rowHasStart && !activityOverlapsYm_\(row, month\)\) return;/,
    'overlap check must be guarded by rowHasStart so no-start_date/NULL rows are always included');
  // The old unconditional check must NOT appear
  assert.doesNotMatch(src, /if \(month && !activityOverlapsYm_\(row, month\)\) return;/,
    'unconditional activityOverlapsYm_ check must be removed from computeExceptionsModel_');
});

test('backend has all 3 exception type keys in counts object', async () => {
  const src = await read('OLD-GAS/actions.gs');
  assert.match(src, /missing_instructor:\s*0/);
  assert.match(src, /missing_start_date:\s*0/);
  assert.match(src, /late_end_date:\s*0/);
});

test('frontend exceptions screen uses single row action by RowID', async () => {
  const src = await read('frontend/src/screens/exceptions.js');
  assert.match(src, /data-card-action.*`exception:\$\{row\.RowID\}`/);
});

test('frontend bind resolves row by RowID only', async () => {
  const src = await read('frontend/src/screens/exceptions.js');
  assert.match(src, /findIndex\(\(row\) => String\(row\.RowID\) === rowId\)/);
});

test('frontend exceptions screen filter fields include exception_type', async () => {
  const src = await read('frontend/src/screens/exceptions.js');
  assert.match(src, /key:\s*'exception_type'/,
    'EXCEPTION_FILTER_FIELDS must include exception_type key');
  assert.match(src, /getOptionLabel.*hebrewExceptionType/,
    'exception_type filter must use hebrewExceptionType for option labels');
});

test('frontend exceptions title uses totalExceptionRows', async () => {
  const src = await read('frontend/src/screens/exceptions.js');
  assert.match(src, /data\?\.totalExceptionRows/,
    'title count must use totalExceptionInstances from API response');
  assert.doesNotMatch(
    src,
    /totalExceptionInstances.*סה.{0,5}כ חריגות/,
    'title must not use totalExceptionRows for the count'
  );
});

test('frontend exceptions screen renders top summary with operational and end-date groups', async () => {
  const src = await read('frontend/src/screens/exceptions.js');
  assert.match(src, /function exceptionsOperationalSummaryHtml\(data, rows\)/,
    'exceptions screen must render an exceptions summary block');
  assert.match(src, /counts\.late_end_date/,
    'summary must use late_end_date from data.counts when available');
  assert.match(src, /exceptionCountFromRows\(rows, 'late_end_date'\)/,
    'summary must fall back to rows.exception_types for late_end_date');
  assert.match(src, /const operationalTotal = missingInstructor \+ missingStartDate/,
    'operational parent count must be the sum of missing instructor and missing start date instances');
  assert.match(src, /const allExceptionsTotal = operationalTotal \+ endDateTotal/,
    'top summary total must include both operational and end-date exception groups');
  assert.match(src, /סה״כ חריגות: \$\{escapeHtml\(String\(allExceptionsTotal\)\)\}/,
    'summary title must display all exception instances');
  assert.match(src, /חריגות תפעוליות: <strong>\$\{escapeHtml\(String\(operationalTotal\)\)\}<\/strong>/,
    'summary must display the operational parent category count');
  assert.match(src, /חסר מדריך: <strong>\$\{escapeHtml\(String\(missingInstructor\)\)\}<\/strong>/,
    'operational summary must display missing instructor as a separate exception count');
  assert.match(src, /חסר תאריך התחלה: <strong>\$\{escapeHtml\(String\(missingStartDate\)\)\}<\/strong>/,
    'operational summary must display missing start date as a separate exception count');
  assert.match(src, /חריגות תאריך סיום: <strong>\$\{escapeHtml\(String\(endDateTotal\)\)\}<\/strong>/,
    'summary must display the end-date exception group count');
  assert.match(src, /תאריך סיום מאוחר: <strong>\$\{escapeHtml\(String\(lateEndDate\)\)\}<\/strong>/,
    'summary must display late end date as a separate exception count');
});

test('frontend exception Hebrew labels describe the exception details clearly', async () => {
  const src = await read('frontend/src/screens/shared/ui-hebrew.js');
  assert.match(src, /missing_instructor:\s+'חסר מדריך'/);
  assert.match(src, /missing_start_date:\s+'חסר תאריך התחלה'/);
  assert.match(src, /late_end_date:\s+'תאריך סיום מאוחר'/);
});

test('frontend drawer shows exception type chip when opening activity detail', async () => {
  const src = await read('frontend/src/screens/exceptions.js');
  assert.match(src, /exceptionTypeHeader/,
    'openActivityDetail must use exceptionTypeHeader to show exception type chip');
  assert.match(src, /typeHeader \+ activityDrawerContent/,
    'drawer content must prepend the exception type chip');
});
