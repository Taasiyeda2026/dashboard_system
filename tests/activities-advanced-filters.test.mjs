import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyActivitiesAdvancedFilters,
  advancedActivitiesFilterCount,
  activitiesAdvancedFiltersHtml
} from '../frontend/src/screens/shared/activities-advanced-filters.js';

const ready = {
  RowID: 'ready',
  start_date: '2026-11-02',
  end_date: '2026-12-16',
  price: 0,
  school: 'אלתיאם',
  funding: 'רשות',
  start_time: '08:00',
  end_time: '09:30'
};
const missing = {
  RowID: 'missing',
  start_date: '',
  date_1: '2026-11-10',
  end_date: null,
  price: null,
  school: '',
  funding: '',
  start_time: '',
  end_time: '12:00'
};
const later = {
  RowID: 'later',
  start_date: '2027-01-10',
  end_date: '',
  price: '9450',
  school: '',
  linked_schools_json: '[{"school_name":"בית ספר נוסף"}]',
  funding: '',
  funding_sources: [{ name: 'תעשיין' }],
  start_time: '11:00',
  end_time: '12:30'
};
const rows = [ready, missing, later];
const ids = (filters) => applyActivitiesAdvancedFilters(rows, filters).map((row) => row.RowID);

test('date availability uses start_date, not date_1; optional range is inclusive', () => {
  assert.deepEqual(ids({ advStartPresence: 'missing' }), ['missing']);
  assert.deepEqual(ids({ advStartPresence: 'present' }), ['ready', 'later']);
  assert.deepEqual(ids({ advStartFrom: '2026-11-02', advStartTo: '2026-11-02' }), ['ready']);
  assert.deepEqual(ids({ advStartFrom: '2026-12-01' }), ['later']);
  assert.deepEqual(ids({ advStartTo: '2026-12-31' }), ['ready']);
});

test('price presence treats zero as entered and null as missing', () => {
  assert.deepEqual(ids({ advPricePresence: 'present' }), ['ready', 'later']);
  assert.deepEqual(ids({ advPricePresence: 'missing' }), ['missing']);
});

test('school presence includes multi-school links and not only school text', () => {
  assert.deepEqual(ids({ advSchoolPresence: 'present' }), ['ready', 'later']);
  assert.deepEqual(ids({ advSchoolPresence: 'missing' }), ['missing']);
});

test('funding presence accepts linked funding sources', () => {
  assert.deepEqual(ids({ advFundingPresence: 'present' }), ['ready', 'later']);
  assert.deepEqual(ids({ advFundingPresence: 'missing' }), ['missing']);
});

test('end-date and both-time completeness filters remain independent', () => {
  assert.deepEqual(ids({ advEndPresence: 'missing' }), ['missing', 'later']);
  assert.deepEqual(ids({ advHoursPresence: 'present' }), ['ready', 'later']);
  assert.deepEqual(ids({ advHoursPresence: 'missing' }), ['missing']);
});

test('advanced fields compose without changing input rows', () => {
  assert.deepEqual(ids({ advStartPresence: 'present', advPricePresence: 'present', advEndPresence: 'missing' }), ['later']);
  assert.deepEqual(ids({}), ['ready', 'missing', 'later']);
  assert.equal(rows.length, 3);
});

test('popover exposes assignment and date filters and reports active filter count', () => {
  assert.equal(advancedActivitiesFilterCount({ advStartFrom: '2026-11-01', advPricePresence: 'missing' }, 'assigned'), 3);
  const html = activitiesAdvancedFiltersHtml({ advStartPresence: 'missing', advPricePresence: 'missing' }, 'draft', true);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /data-activity-advanced-field="assignment"/);
  assert.match(html, /data-activity-advanced-field="advStartFrom"[^>]*disabled/);
  assert.match(html, /סינון מתקדם \(3\)/);
  assert.match(activitiesAdvancedFiltersHtml({}, 'all', false), /hidden/);
});
