import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectFilterOptions } from '../frontend/src/screens/shared/activity-list-filters.js';

const FILTER_FIELDS = [
  { key: 'activity_manager', label: 'מנהל פעילות' },
  { key: 'instructor', label: 'מדריך', getValues: (row) => [row?.instructor_name, row?.instructor_name_2] }
];

test('collectFilterOptions keeps existing output shape and ordering', () => {
  const rows = [
    { activity_manager: 'נועם', instructor_name: 'דני', instructor_name_2: '' },
    { activity_manager: 'אבי', instructor_name: 'רן', instructor_name_2: 'דנה' },
    { activity_manager: 'נועם', instructor_name: 'דני', instructor_name_2: '  ' }
  ];

  const result = collectFilterOptions(rows, FILTER_FIELDS);

  assert.deepEqual(result, {
    activity_manager: ['אבי', 'נועם'],
    instructor: ['דנה', 'דני', 'רן']
  });
});

test('collectFilterOptions cache invalidates when rows reference changes', () => {
  const rowsV1 = [{ activity_manager: 'אבי' }];
  const rowsV2 = [{ activity_manager: 'זוהר' }];

  const first = collectFilterOptions(rowsV1, FILTER_FIELDS);
  const second = collectFilterOptions(rowsV2, FILTER_FIELDS);

  assert.notStrictEqual(first, second);
  assert.deepEqual(second.activity_manager, ['זוהר']);
});
