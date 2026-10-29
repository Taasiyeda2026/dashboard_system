import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import {
  applyActivitiesAdvancedFilters,
  advancedActivitiesFilterCount,
  activitiesAdvancedFiltersHtml,
  activitiesAdvancedFilterToggleHtml,
  bindActivitiesAdvancedFilters
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

test('icon-only toggle and inline panel provide all filters and active state', () => {
  assert.equal(advancedActivitiesFilterCount({ advStartFrom: '2026-11-01', advPricePresence: 'missing' }, 'assigned'), 3);
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
  assert.match(panel, /data-activity-advanced-field="advStartFrom"[^>]*disabled/);
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
