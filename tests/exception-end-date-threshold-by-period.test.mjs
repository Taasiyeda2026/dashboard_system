import test from 'node:test';
import assert from 'node:assert/strict';

const moduleUrl = new URL('../frontend/src/exception-end-date-threshold-by-period.js', import.meta.url);
const {
  applyEndDateExceptionThresholdByPeriod,
  endDateExceptionThresholdForPeriod
} = await import(`${moduleUrl.href}?test=${Date.now()}`);

test('school_2027 uses 2027-06-15 as the late end-date cutoff', () => {
  assert.equal(endDateExceptionThresholdForPeriod('school_2027'), '2027-06-15');
  assert.equal(endDateExceptionThresholdForPeriod('2027'), '2027-06-15');
});

test('regular 2026 keeps 2026-06-15 as the cutoff', () => {
  assert.equal(endDateExceptionThresholdForPeriod('regular'), '2026-06-15');
  assert.equal(endDateExceptionThresholdForPeriod('2026'), '2026-06-15');
});

test('school_2027 removes false late-end exceptions before or on 2027-06-15', () => {
  const payload = {
    rows: [
      {
        row_id: 'a',
        district: 'מרכז',
        end_date: '2026-12-01',
        exception_type: 'end_date_after_cutoff',
        exception_types: ['end_date_after_cutoff']
      },
      {
        row_id: 'b',
        district: 'צפון',
        end_date: '2027-06-15',
        exception_type: 'end_date_after_cutoff',
        exception_types: ['missing_instructor', 'end_date_after_cutoff']
      },
      {
        row_id: 'c',
        district: 'דרום',
        end_date: '2027-06-16',
        exception_type: 'end_date_after_cutoff',
        exception_types: ['end_date_after_cutoff']
      }
    ]
  };

  const result = applyEndDateExceptionThresholdByPeriod(payload, 'school_2027');

  assert.deepEqual(result.rows.map((row) => row.row_id), ['b', 'c']);
  assert.deepEqual(result.rows.find((row) => row.row_id === 'b').exception_types, ['missing_instructor']);
  assert.deepEqual(result.rows.find((row) => row.row_id === 'c').exception_types, ['end_date_after_cutoff']);
  assert.equal(result.totalExceptionRows, 2);
  assert.equal(result.totalExceptionInstances, 2);
  assert.deepEqual(result.counts, {
    missing_instructor: 1,
    end_date_after_cutoff: 1
  });
});

test('regular period payload is not rewritten', () => {
  const payload = {
    rows: [{
      row_id: 'a',
      end_date: '2026-12-01',
      exception_types: ['end_date_after_cutoff']
    }]
  };
  assert.equal(applyEndDateExceptionThresholdByPeriod(payload, 'regular'), payload);
});
