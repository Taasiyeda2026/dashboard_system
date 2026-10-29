import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  applyActivitiesAdvancedFilters,
  activitySessionDates,
  advancedActivitiesFilterCount,
  activitiesAdvancedFiltersHtml,
  activitiesAdvancedFilterToggleHtml,
  bindActivitiesAdvancedFilters
} from '../frontend/src/screens/shared/activities-advanced-filters.js';

const ready = {
  RowID: 'ready',
  start_date: '2026-11-02',
  end_date: '2026-12-16',
  meeting_dates: ['2026-11-02', '2026-11-23', '2026-12-16'],
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
  date_1: '2027-01-10',
  date_12: '2027-03-30',
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

test('start/end date presence is independent of which session dates are scheduled', () => {
  assert.deepEqual(ids({ advStartPresence: 'missing' }), ['missing']);
  assert.deepEqual(ids({ advStartPresence: 'present' }), ['ready', 'later']);
  assert.deepEqual(ids({ advEndPresence: 'missing' }), ['missing', 'later']);
  assert.deepEqual(ids({ advStartPresence: 'missing', advMeetingFrom: '2026-11-10', advMeetingTo: '2026-11-10' }), ['missing']);
  assert.deepEqual(
    applyActivitiesAdvancedFilters([{ start_date: '', date_start: '2026-11-01', end_date: '', date_end: '2026-12-20' }],
      { advStartPresence: 'present', advEndPresence: 'present' }).length,
    1,
    'fallback start/end fields are considered when primary values are empty'
  );
});

test('range matches ANY meeting in the range, not just the activity start date', () => {
  assert.deepEqual(ids({ advMeetingFrom: '2026-11-23', advMeetingTo: '2026-11-23' }), ['ready']);
  assert.deepEqual(ids({ advMeetingFrom: '2026-11-10', advMeetingTo: '2026-11-10' }), ['missing']);
  assert.deepEqual(ids({ advMeetingFrom: '2027-03-30', advMeetingTo: '2027-03-30' }), ['later']);
  assert.deepEqual(ids({ advMeetingFrom: '2026-11-11', advMeetingTo: '2026-11-22' }), []);
  assert.deepEqual(ids({ advMeetingFrom: '2027-01-01' }), ['later']);
  assert.deepEqual(ids({ advMeetingTo: '2026-11-11' }), ['ready', 'missing']);
});

test('date scan supports meetings array, date_cols, 35 date columns and schedule objects', () => {
  const all = activitySessionDates({
    start_date: '2026-07-01',
    end_date: '2027-05-01',
    meeting_dates: ['2026-11-01', { date: '2026-11-05' }],
    date_cols: ['2026-12-02', '2026-11-01'],
    date_35: '2027-04-01',
    Date3: '2026-12-03',
    meeting_schedule: [{ date: '2027-01-15' }, { meeting_date: '2027-02-15' }]
  });
  assert.deepEqual(all, ['2026-11-01', '2026-11-05', '2026-12-02', '2026-12-03', '2027-01-15', '2027-02-15', '2027-04-01']);
  assert.deepEqual(activitySessionDates({ start_date: '2026-01-01', end_date: '2026-12-31' }), []);
  assert.equal(applyActivitiesAdvancedFilters([{ start_date: '2026-01-01', end_date: '2026-12-31' }],
    { advMeetingFrom: '2026-11-01', advMeetingTo: '2026-11-30' }).length, 0,
  'start/end dates alone do not imply a meeting exists');
});

test('price presence treats zero as entered and null as missing', () => {
  assert.deepEqual(ids({ advPricePresence: 'present' }), ['ready', 'later']);
  assert.deepEqual(ids({ advPricePresence: 'missing' }), ['missing']);
});

test('advanced fields compose without changing input rows', () => {
  assert.deepEqual(ids({ advStartPresence: 'present', advPricePresence: 'present', advEndPresence: 'missing', advMeetingFrom: '2027-03-01' }), ['later']);
  assert.deepEqual(ids({ advSchoolPresence: 'missing', advFundingPresence: 'missing', advHoursPresence: 'missing' }), ['ready', 'missing', 'later'], 'removed filters are ignored');
  assert.deepEqual(ids({}), ['ready', 'missing', 'later']);
  assert.equal(rows.length, 3);
});

test('icon-only toggle and inline panel provide all filters and active state', () => {
  assert.equal(advancedActivitiesFilterCount({ advMeetingFrom: '2026-11-01', advPricePresence: 'missing' }, 'assigned'), 3);
  const filters = { advStartPresence: 'missing', advPricePresence: 'missing' };
  const toggle = activitiesAdvancedFilterToggleHtml(filters, 'draft', true);
  const panel = activitiesAdvancedFiltersHtml(filters, 'draft', true);
  assert.match(toggle, /aria-expanded="true"/);
  assert.match(toggle, /data-activities-advanced-toggle/);
  assert.match(toggle, /<svg/);
  assert.match(toggle, /ds-act-advanced__indicator/);
  assert.doesNotMatch(toggle, /סינון מתקדם/);
  assert.doesNotMatch(toggle, /<button[^>]*>[א-ת]/);
  assert.match(panel, /data-activities-advanced-panel/);
  assert.match(panel, /data-activity-advanced-field="assignment"/);
  assert.match(panel, /data-activity-advanced-field="advMeetingFrom"/);
  assert.match(panel, /data-activity-advanced-field="advMeetingTo"/);
  assert.match(panel, /data-activity-advanced-field="advEndPresence"/);
  assert.match(panel, /data-activity-advanced-field="advPricePresence"/);
  assert.doesNotMatch(panel, /advStartFrom|advStartTo|advSchoolPresence|advFundingPresence|advHoursPresence/);
  assert.equal((panel.match(/data-activity-advanced-field=/g) || []).length, 6);
  assert.equal(advancedActivitiesFilterCount({ advSchoolPresence: 'missing', advHoursPresence: 'present' }, 'all'), 0);
  assert.doesNotMatch(panel, /סינון מתקדם/);
  assert.match(activitiesAdvancedFiltersHtml({}, 'all', false), /hidden/);
  assert.doesNotMatch(activitiesAdvancedFilterToggleHtml({}, 'all', false), /ds-act-advanced__indicator/);
});

test('inline panel toggles and stays open after selecting a filter', () => {
  const previousDocument = globalThis.document;
  const previousAbortController = globalThis.AbortController;
  const dom = new JSDOM('<main id="root"></main>', { url: 'https://example.test/' });
  globalThis.document = dom.window.document;
  globalThis.AbortController = dom.window.AbortController;
  try {
    const root = dom.window.document.getElementById('root');
    const state = { listFilters: {}, activitiesInstructorStatusFilter: 'all', activitiesAdvancedFiltersOpen: false };
    let rerenders = 0;
    const render = () => {
      rerenders += 1;
      const filters = state.listFilters.activities || {};
      root.innerHTML = '<div class="ds-activities-main-toolbar">'
        + activitiesAdvancedFilterToggleHtml(filters, state.activitiesInstructorStatusFilter, state.activitiesAdvancedFiltersOpen)
        + '</div>'
        + activitiesAdvancedFiltersHtml(filters, state.activitiesInstructorStatusFilter, state.activitiesAdvancedFiltersOpen);
      bindActivitiesAdvancedFilters(root, state, 'activities', render);
    };
    render();
    const button = root.querySelector('[data-activities-advanced-toggle]');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(root.querySelector('[data-activities-advanced-panel]').hidden, true);
    button.click();
    assert.equal(state.activitiesAdvancedFiltersOpen, true);
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.equal(root.querySelector('[data-activities-advanced-panel]').hidden, false);

    const price = root.querySelector('[data-activity-advanced-field="advPricePresence"]');
    price.value = 'missing';
    price.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(state.listFilters.activities.advPricePresence, 'missing');
    assert.equal(root.querySelector('[data-activities-advanced-panel]').hidden, false);
    assert.equal(rerenders, 2, 'client filter change re-renders without extra fetches');
    assert.ok(root.querySelector('.ds-act-advanced__indicator'));

    root.querySelector('[data-activities-advanced-close]').click();
    assert.equal(state.activitiesAdvancedFiltersOpen, false);
    assert.equal(root.querySelector('[data-activities-advanced-panel]').hidden, true);
  } finally {
    globalThis.document = previousDocument;
    globalThis.AbortController = previousAbortController;
    dom.window.close();
  }
});
