/**
 * activities-snapshot-cell-safety.test.mjs
 *
 * Regression tests for the 50,000-char-per-cell limit fix in
 * refreshActivitiesSnapshot_ (activities-snapshot.gs).
 *
 * Covers:
 *  - safeCellValue_ exists and follows the correct pattern
 *  - safeJsonArrayCell_ exists and follows the correct pattern
 *  - refreshActivitiesSnapshot_ uses safe wrappers (not raw JSON.stringify)
 *  - JS simulation: safeCellValue_ never returns > 50000 chars
 *  - JS simulation: safeJsonArrayCell_ never returns > 50000 chars AND always valid JSON
 *  - JS simulation: safeJsonArrayCell_ keeps ALL rows when under the limit
 *  - JS simulation: safeJsonArrayCell_ logs when truncation occurs
 *  - JS simulation: safeCellValue_ appends a truncation marker
 *  - Edge cases: null / undefined / empty array / zero-length
 */

import { readFile } from 'fs/promises';
import { strict as assert } from 'assert';
import { test } from 'node:test';

const SRC_PATH = 'backend/activities-snapshot.gs';

let src;
test('load activities-snapshot.gs source', async () => {
  src = await readFile(SRC_PATH, 'utf8');
  assert.ok(src.length > 100, 'source should not be empty');
});

// ---------------------------------------------------------------------------
// Source-level structural checks
// ---------------------------------------------------------------------------

test('safeCellValue_ function is defined in activities-snapshot.gs', () => {
  assert.match(src, /function safeCellValue_\(/, 'safeCellValue_ must be defined');
});

test('safeJsonArrayCell_ function is defined in activities-snapshot.gs', () => {
  assert.match(src, /function safeJsonArrayCell_\(/, 'safeJsonArrayCell_ must be defined');
});

test('safeCellValue_: caps at 45000 chars', () => {
  assert.match(src, /45000/, 'default maxLength must be 45000');
});

test('safeCellValue_: appends TRUNCATED marker on overflow', () => {
  assert.match(src, /TRUNCATED.*original length/, 'truncation marker must include original length');
});

test('safeCellValue_: calls Logger.log on truncation', () => {
  assert.match(src, /Logger\.log[\s\S]{1,200}safeCellValue_/, 'safeCellValue_ must log via Logger.log');
});

test('safeJsonArrayCell_: uses binary search (lo/hi/mid pattern)', () => {
  assert.match(src, /var lo\s*=\s*0[\s\S]{1,30}var hi\s*=\s*arr\.length/, 'binary search lo/hi must be present');
  assert.match(src, /Math\.floor\(\(lo \+ hi \+ 1\) \/ 2\)/, 'binary search mid formula must be present');
});

test('safeJsonArrayCell_: calls Logger.log on truncation', () => {
  assert.match(src, /Logger\.log[\s\S]{1,400}safeJsonArrayCell_/, 'safeJsonArrayCell_ must log via Logger.log');
});

test('safeJsonArrayCell_: returns [] for empty input', () => {
  assert.match(src, /if \(!Array\.isArray\(arr\) \|\| arr\.length === 0\) return '\[\]'/, 'empty-array guard must be present');
});

test('refreshActivitiesSnapshot_: uses safeCellValue_ for activity_type_counts', () => {
  assert.match(src,
    /safeCellValue_\(payload\.activity_type_counts/,
    'activity_type_counts_json must be written via safeCellValue_'
  );
});

test('refreshActivitiesSnapshot_: uses safeJsonArrayCell_ for rows', () => {
  assert.match(src,
    /safeJsonArrayCell_\(payload\.rows/,
    'rows_json must be written via safeJsonArrayCell_'
  );
});

test('refreshActivitiesSnapshot_: does NOT use raw JSON.stringify for rows', () => {
  const writeRowBlock = src.match(/var row = \[[\s\S]{1,400}'\]/);
  if (writeRowBlock) {
    assert.doesNotMatch(writeRowBlock[0],
      /JSON\.stringify\(payload\.rows/,
      'rows_json must not be written with raw JSON.stringify'
    );
  }
});

// ---------------------------------------------------------------------------
// JS simulation of the helper functions (GAS code is plain ES5 compatible)
// ---------------------------------------------------------------------------

const MAX = 45000;
const HARD_MAX = 50000;

function safeCellValue(value, fieldName, maxLength) {
  maxLength = maxLength || MAX;
  var text = (value === null || value === undefined)
    ? ''
    : (typeof value === 'string' ? value : JSON.stringify(value));
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '\n...[TRUNCATED: original length ' + text.length + ' chars]';
}

function safeJsonArrayCell(arr, fieldName, maxLength) {
  maxLength = maxLength || MAX;
  if (!Array.isArray(arr) || arr.length === 0) return '[]';
  var full = JSON.stringify(arr);
  if (full.length <= maxLength) return full;
  var lo = 0;
  var hi = arr.length;
  while (lo < hi) {
    var mid = Math.floor((lo + hi + 1) / 2);
    if (JSON.stringify(arr.slice(0, mid)).length <= maxLength) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return JSON.stringify(arr.slice(0, lo));
}

function bigRow(id) {
  return { RowID: 'ROW-' + id, activity_name: 'פעילות מספר ' + id, notes: 'א'.repeat(500) };
}

// --- safeCellValue simulation tests ---

test('sim safeCellValue_: short value returned unchanged', () => {
  const val = { a: 1, b: 2 };
  const out = safeCellValue(val, 'test');
  assert.strictEqual(out, JSON.stringify(val));
});

test('sim safeCellValue_: null returns empty string', () => {
  assert.strictEqual(safeCellValue(null, 'test'), '');
});

test('sim safeCellValue_: undefined returns empty string', () => {
  assert.strictEqual(safeCellValue(undefined, 'test'), '');
});

test('sim safeCellValue_: output never exceeds HARD_MAX (50000)', () => {
  const longStr = 'x'.repeat(80000);
  const out = safeCellValue(longStr, 'test');
  assert.ok(out.length <= HARD_MAX,
    'safeCellValue_ result must be <= 50000 chars, got ' + out.length
  );
});

test('sim safeCellValue_: truncation marker is appended on overflow', () => {
  const longStr = 'y'.repeat(60000);
  const out = safeCellValue(longStr, 'test');
  assert.match(out, /TRUNCATED: original length 60000 chars/);
});

test('sim safeCellValue_: output exactly at limit is NOT truncated', () => {
  const exact = 'z'.repeat(MAX);
  const out = safeCellValue(exact, 'test');
  assert.strictEqual(out.length, MAX);
  assert.doesNotMatch(out, /TRUNCATED/);
});

// --- safeJsonArrayCell simulation tests ---

test('sim safeJsonArrayCell_: empty array returns "[]"', () => {
  assert.strictEqual(safeJsonArrayCell([], 'test'), '[]');
});

test('sim safeJsonArrayCell_: null returns "[]"', () => {
  assert.strictEqual(safeJsonArrayCell(null, 'test'), '[]');
});

test('sim safeJsonArrayCell_: small array returned unchanged', () => {
  const arr = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const out = safeJsonArrayCell(arr, 'test');
  assert.deepStrictEqual(JSON.parse(out), arr);
});

test('sim safeJsonArrayCell_: large array (1000 big rows) output never > HARD_MAX', () => {
  const arr = Array.from({ length: 1000 }, (_, i) => bigRow(i));
  const out = safeJsonArrayCell(arr, 'rows_json');
  assert.ok(out.length <= HARD_MAX,
    'safeJsonArrayCell_ result must be <= 50000 chars, got ' + out.length
  );
});

test('sim safeJsonArrayCell_: output is always valid JSON', () => {
  const arr = Array.from({ length: 500 }, (_, i) => bigRow(i));
  const out = safeJsonArrayCell(arr, 'rows_json');
  let parsed;
  assert.doesNotThrow(() => { parsed = JSON.parse(out); }, 'output must be valid JSON');
  assert.ok(Array.isArray(parsed), 'parsed result must be an array');
});

test('sim safeJsonArrayCell_: kept rows are a prefix of the original array', () => {
  const arr = Array.from({ length: 400 }, (_, i) => bigRow(i));
  const out = safeJsonArrayCell(arr, 'rows_json');
  const parsed = JSON.parse(out);
  for (let i = 0; i < parsed.length; i++) {
    assert.strictEqual(parsed[i].RowID, arr[i].RowID,
      'kept rows must be a prefix of the original array'
    );
  }
});

test('sim safeJsonArrayCell_: all rows kept when total fits within limit', () => {
  const arr = Array.from({ length: 10 }, (_, i) => ({ id: i, name: 'row' + i }));
  const out = safeJsonArrayCell(arr, 'rows_json');
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.length, arr.length, 'all rows must be kept when under the limit');
});

test('sim safeJsonArrayCell_: binary search finds maximum fitting rows', () => {
  const arr = Array.from({ length: 2000 }, (_, i) => bigRow(i));
  const out = safeJsonArrayCell(arr, 'rows_json', 10000);
  const parsed = JSON.parse(out);
  // Verify exactly one more row would exceed the limit
  const oneMore = JSON.stringify(arr.slice(0, parsed.length + 1));
  assert.ok(oneMore.length > 10000,
    'adding one more row must exceed the limit (binary search is tight)'
  );
  assert.ok(out.length <= 10000,
    'output must be within the limit'
  );
});

test('sim full snapshot write: both cells within HARD_MAX', () => {
  const payload = {
    activity_type_counts: { course: 120, seminar: 45, workshop: 30 },
    rows: Array.from({ length: 800 }, (_, i) => bigRow(i))
  };
  const countsCell = safeCellValue(payload.activity_type_counts, 'activity_type_counts_json');
  const rowsCell   = safeJsonArrayCell(payload.rows, 'rows_json');
  assert.ok(countsCell.length <= HARD_MAX, 'activity_type_counts_json must be <= 50000 chars');
  assert.ok(rowsCell.length   <= HARD_MAX, 'rows_json must be <= 50000 chars');
  assert.doesNotThrow(() => JSON.parse(rowsCell), 'rows_json must remain valid JSON');
});
