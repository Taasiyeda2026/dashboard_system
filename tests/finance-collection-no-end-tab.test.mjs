import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FINANCE_COLLECTION_TAB_ALL,
  FINANCE_COLLECTION_TAB_CLOSED,
  FINANCE_COLLECTION_TAB_NO_END_DATE,
  FINANCE_COLLECTION_TAB_OPEN,
  FINANCE_NO_END_DATE_MONTH_KEY,
  filterFinanceCollectionActivities,
  groupFinanceCollectionByEndMonth,
  normalizeFinanceCollectionTab
} from '../frontend/src/screens/finance-collection.js';

function row(overrides = {}) {
  return {
    row_id: overrides.row_id || 'A1',
    activity_name: overrides.activity_name || 'פעילות',
    funding: 'רשות',
    authority: 'רחובות',
    authority_id: 'r1',
    collection_status: overrides.collection_status || 'open',
    ...overrides
  };
}

test('finance collection months are ordered nearest-to-farthest (ascending)', () => {
  const groups = groupFinanceCollectionByEndMonth([
    row({ row_id: 'DEC', end_date: '2026-12-10' }),
    row({ row_id: 'OCT', end_date: '2026-10-10' }),
    row({ row_id: 'JAN', end_date: '2027-01-10' }),
    row({ row_id: 'NOV', end_date: '2026-11-10' })
  ], { tab: FINANCE_COLLECTION_TAB_ALL });

  assert.deepEqual(groups.map((group) => group.monthKey), [
    '2026-10',
    '2026-11',
    '2026-12',
    '2027-01'
  ]);
});

test('open and closed tabs exclude activities without an end date', () => {
  const rows = [
    row({ row_id: 'OPEN-DATED', end_date: '2026-10-10', collection_status: 'open' }),
    row({ row_id: 'OPEN-NO-DATE', end_date: '', collection_status: 'open' }),
    row({ row_id: 'CLOSED-DATED', end_date: '2026-11-10', collection_status: 'closed' }),
    row({ row_id: 'CLOSED-NO-DATE', end_date: '', collection_status: 'closed' })
  ];

  assert.deepEqual(
    filterFinanceCollectionActivities(rows, { tab: FINANCE_COLLECTION_TAB_OPEN }).map((activity) => activity.row_id),
    ['OPEN-DATED']
  );
  assert.deepEqual(
    filterFinanceCollectionActivities(rows, { tab: FINANCE_COLLECTION_TAB_CLOSED }).map((activity) => activity.row_id),
    ['CLOSED-DATED']
  );
});

test('no-end-date tab contains every activity without an end date regardless of collection status', () => {
  const rows = [
    row({ row_id: 'OPEN-NO-DATE', end_date: '', collection_status: 'open' }),
    row({ row_id: 'CLOSED-NO-DATE', end_date: '', collection_status: 'closed' }),
    row({ row_id: 'DATED', end_date: '2026-10-10', collection_status: 'open' })
  ];

  const filtered = filterFinanceCollectionActivities(rows, { tab: FINANCE_COLLECTION_TAB_NO_END_DATE });
  assert.deepEqual(filtered.map((activity) => activity.row_id), ['OPEN-NO-DATE', 'CLOSED-NO-DATE']);
  assert.ok(filtered.every((activity) => groupFinanceCollectionByEndMonth([activity], { tab: FINANCE_COLLECTION_TAB_NO_END_DATE })[0]?.monthKey === FINANCE_NO_END_DATE_MONTH_KEY));
});

test('all tab still includes dated and no-end-date activities', () => {
  const rows = [
    row({ row_id: 'DATED', end_date: '2026-10-10' }),
    row({ row_id: 'NO-DATE', end_date: '' })
  ];
  assert.equal(filterFinanceCollectionActivities(rows, { tab: FINANCE_COLLECTION_TAB_ALL }).length, 2);
});

test('no-end-date tab value normalizes explicitly instead of falling back to open', () => {
  assert.equal(normalizeFinanceCollectionTab('no_end_date'), FINANCE_COLLECTION_TAB_NO_END_DATE);
});
