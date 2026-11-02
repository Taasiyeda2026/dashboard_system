import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sqlRoute = await readFile(new URL('../supabase/functions/scheduling-route/index.ts', import.meta.url), 'utf8');

test('payroll return journey swaps fully-qualified endpoint queries, not bare street labels', () => {
  assert.match(sqlRoute, /function reversePayrollPair\(pair: TravelPair \| null\)/);
  assert.match(sqlRoute, /query_origin_address: pair\.query_destination_address/);
  assert.match(sqlRoute, /query_destination_address: pair\.query_origin_address/);
  assert.match(sqlRoute, /addPair\(reversePayrollPair\(payrollInstructorSchoolPair/);
  assert.match(sqlRoute, /addPair\(reversePayrollPair\(payrollInstructorLocationPair/);
});

test('cache entry must have matching Google queries before it is reused', () => {
  assert.match(sqlRoute, /text\(cached\.query_origin_address\) === pair\.query_origin_address/);
  assert.match(sqlRoute, /text\(cached\.query_destination_address\) === pair\.query_destination_address/);
});
