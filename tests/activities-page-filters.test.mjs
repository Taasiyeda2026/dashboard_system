import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const sessionStore = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (sessionStore.has(key) ? sessionStore.get(key) : null),
    setItem: (key, value) => sessionStore.set(key, String(value)),
    removeItem: (key) => sessionStore.delete(key),
    clear: () => sessionStore.clear()
  };
}

if (!globalThis.localStorage) {
  const localStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => (localStore.has(key) ? localStore.get(key) : null),
    setItem: (key, value) => localStore.set(key, String(value)),
    removeItem: (key) => localStore.delete(key),
    clear: () => localStore.clear()
  };
}

const {
  activitiesScreen,
  ACTIVITY_FILTER_FIELDS,
  EMPTY_FUNDING_FILTER_VALUE,
  activityFundingFilterValue
} = await import('../frontend/src/screens/activities.js');
const {
  applyLocalFilters,
  bindLocalFilters,
  collectDependentFilterOptions,
  prepareRowsForSearch,
  ensureActivityListFilters
} = await import('../frontend/src/screens/shared/activity-list-filters.js');
const { normalizeActivityRow } = await import('../frontend/src/api.js');

const apiSource = readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const opsSource = readFileSync(new URL('../frontend/src/screens/operations-management.js', import.meta.url), 'utf8');

function baseState(overrides = {}) {
  return {
    activitiesMonthYm: '2026-04',
    activityPeriodTab: 'regular',
    activitiesInnerTab: 'year_all',
    allActivitiesStatusFilter: 'all',
    user: { display_role: 'מנהל מערכת', role: 'admin', can_add_activity: true },
    clientSettings: { hide_emp_id_on_screens: true, dropdown_options: {} },
    listFilters: {
      activities: { q: '', appliedQ: '', visibleCount: 200 }
    },
    screenDataCache: {},
    ...overrides
  };
}

function withFilters(state, filters = {}) {
  state.listFilters = state.listFilters || {};
  state.listFilters.activities = {
    q: '',
    appliedQ: '',
    visibleCount: 200,
    ...(state.listFilters.activities || {}),
    ...filters
  };
  return state;
}

function fixtureRows() {
  return [
    {
      RowID: 'F-GAFEN-1',
      activity_name: 'תוכנית גפן א',
      activity_type: 'course',
      activity_season: 'regular',
      activity_manager: 'נועה מנהלת',
      authority: 'חיפה',
      school: 'בית ספר אלון',
      instructor_name: 'דנה מדריכה',
      instructor_name_2: '',
      emp_id: 'E1',
      funding: 'גפן',
      status: 'פתוח',
      start_date: '2026-04-01',
      end_date: '2026-06-01'
    },
    {
      RowID: 'F-RAMI-1',
      activity_name: 'תוכנית רמי',
      activity_type: 'workshop',
      activity_season: 'regular',
      activity_manager: 'אבי מנהל',
      authority: 'נתניה',
      school: 'בית ספר ברוש',
      instructor_name: 'רן מדריך',
      instructor_name_2: '',
      emp_id: 'E2',
      funding: 'רמי שני',
      status: 'פתוח',
      start_date: '2026-04-05',
      end_date: '2026-05-05'
    },
    {
      RowID: 'F-ALBAD-1',
      activity_name: 'תוכנית עלבד',
      activity_type: 'tour',
      activity_season: 'regular',
      activity_manager: 'נועה מנהלת',
      authority: 'חיפה',
      school: 'בית ספר אלון',
      instructor_name: 'דנה מדריכה',
      instructor_name_2: 'מיכל שנייה',
      emp_id: 'E1',
      emp_id_2: 'E3',
      funding: 'עלבד',
      status: 'בתהליך',
      start_date: '2026-04-10',
      end_date: '2026-07-01'
    },
    {
      RowID: 'F-NULL-1',
      activity_name: 'תוכנית ללא מימון',
      activity_type: 'after_school',
      activity_season: 'regular',
      activity_manager: 'זוהר מנהל',
      authority: 'תל אביב',
      school: 'בית ספר דפנה',
      instructor_name: '',
      instructor_name_2: '',
      emp_id: '',
      funding: null,
      status: 'פתוח',
      start_date: '2026-04-12',
      end_date: '2026-04-30'
    },
    {
      RowID: 'F-EMPTY-1',
      activity_name: 'תוכנית מימון ריק',
      activity_type: 'course',
      activity_season: 'regular',
      activity_manager: 'זוהר מנהל',
      authority: 'תל אביב',
      school: 'בית ספר הדר',
      instructor_name: 'עדי מדריך',
      emp_id: 'E4',
      funding: '   ',
      status: 'פתוח',
      start_date: '2026-04-15',
      end_date: '2026-05-15'
    },
    {
      RowID: 'F-CLOSED-1',
      activity_name: 'תוכנית סגורה',
      activity_type: 'course',
      activity_season: 'regular',
      activity_manager: 'אבי מנהל',
      authority: 'נתניה',
      school: 'בית ספר ברוש',
      instructor_name: 'רן מדריך',
      emp_id: 'E2',
      funding: 'מ.ר.ק',
      status: 'סגור',
      start_date: '2026-03-01',
      end_date: '2026-03-20'
    },
    {
      RowID: 'F-DEL-1',
      activity_name: 'תוכנית נמחקה',
      activity_type: 'workshop',
      activity_season: 'regular',
      activity_manager: 'נועה מנהלת',
      authority: 'חיפה',
      school: 'בית ספר אלון',
      instructor_name: 'דנה מדריכה',
      emp_id: 'E1',
      funding: 'מארוול',
      status: 'נמחק',
      start_date: '2026-04-01',
      end_date: '2026-04-02'
    },
    {
      RowID: 'F-2027-GAFEN',
      activity_name: 'תוכנית תשפז גפן',
      activity_type: 'course',
      activity_season: 'school_2027',
      activity_manager: 'ליאור 2027',
      authority: 'ירושלים',
      school: 'בית ספר הראל',
      instructor_name: 'יעל 2027',
      emp_id: 'E7',
      funding: 'גפן',
      status: 'פתוח',
      start_date: '2026-10-01',
      end_date: '2027-01-01'
    },
    {
      RowID: 'F-2027-RAMI',
      activity_name: 'תוכנית תשפז רמי',
      activity_type: 'workshop',
      activity_season: 'school_2027',
      activity_manager: 'ליאור 2027',
      authority: 'ירושלים',
      school: 'בית ספר הראל',
      instructor_name: 'יעל 2027',
      emp_id: 'E7',
      funding: 'רמי שני',
      status: 'פתוח',
      start_date: '2026-11-01',
      end_date: '2027-02-01'
    },
    {
      RowID: 'F-2027-NONE',
      activity_name: 'תוכנית תשפז ללא',
      activity_type: 'tour',
      activity_season: 'school_2027',
      activity_manager: 'ליאור 2027',
      authority: 'באר שבע',
      school: 'בית ספר נגב',
      instructor_name: '',
      emp_id: '',
      funding: '',
      status: 'פתוח',
      start_date: '2026-12-01',
      end_date: '2027-03-01'
    }
  ];
}

function renderedRowIds(html) {
  return [...html.matchAll(/data-row-id="([^"]+)"/g)].map((match) => match[1]);
}

function titleCount(html) {
  const match = /·\s*(\d+)\s+פעילויות/.exec(html);
  return match ? Number(match[1]) : null;
}

function selectOptionValues(html, field) {
  const block = html.match(new RegExp(`data-filter-field="${field}"[^>]*>([\\s\\S]*?)<\\/select>`));
  assert.ok(block, `missing select for ${field}`);
  return [...block[1].matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);
}

function applyActivityFilters(rows, filters = {}) {
  const prepared = prepareRowsForSearch(rows.slice(), [
    'activity_name', 'activity_manager', 'instructor_name', 'instructor_name_2',
    'authority', 'school', 'funding', 'status', 'activity_type'
  ]);
  return applyLocalFilters(prepared, filters, { filterFields: ACTIVITY_FILTER_FIELDS }).map((row) => row.RowID);
}

test('ACTIVITY_LIST_COLUMNS and ACTIVITY_TABLE_COLUMNS include funding', () => {
  const listBlock = apiSource.match(/const ACTIVITY_LIST_COLUMNS = \[([\s\S]*?)\]\.join/)?.[1] || '';
  const tableBlock = apiSource.match(/const ACTIVITY_TABLE_COLUMNS = \[([\s\S]*?)\]\.join/)?.[1] || '';
  assert.match(listBlock, /'funding'/);
  assert.match(tableBlock, /'funding'/);
  const opsBlock = apiSource.match(/const ACTIVITY_OPERATIONS_COLUMNS = \[([\s\S]*?)\]\.join/)?.[1] || '';
  // Operations projection intentionally untouched by this activities-page fix.
  assert.equal(opsBlock.includes("'funding'"), false);
  assert.doesNotMatch(opsSource, /EMPTY_FUNDING_FILTER_VALUE|activityFundingFilterValue/);
});

test('normalizeActivityRow keeps funding and maps null/blank to empty string without inventing values', () => {
  assert.equal(normalizeActivityRow({ row_id: '1', funding: 'גפן' }).funding, 'גפן');
  assert.equal(normalizeActivityRow({ row_id: '2', funding: 'רמי שני' }).funding, 'רמי שני');
  assert.equal(normalizeActivityRow({ row_id: '3', funding: null }).funding, '');
  assert.equal(normalizeActivityRow({ row_id: '4', funding: '  ' }).funding, '');
  assert.equal(normalizeActivityRow({ row_id: '5' }).funding, '');
});

test('funding filter value uses real labels and empty sentinel only in the client', () => {
  assert.equal(activityFundingFilterValue({ funding: 'גפן' }), 'גפן');
  assert.equal(activityFundingFilterValue({ funding: 'עלבד' }), 'עלבד');
  assert.equal(activityFundingFilterValue({ funding: null }), EMPTY_FUNDING_FILTER_VALUE);
  assert.equal(activityFundingFilterValue({ funding: '' }), EMPTY_FUNDING_FILTER_VALUE);
  assert.equal(EMPTY_FUNDING_FILTER_VALUE, 'ללא מימון מוגדר');
});

test('funding filter alone: גפן / רמי שני / empty sentinel', () => {
  const rows = fixtureRows().filter((row) => row.activity_season === 'regular' && row.status !== 'נמחק');
  assert.deepEqual(applyActivityFilters(rows, { funding: 'גפן' }), ['F-GAFEN-1']);
  assert.deepEqual(applyActivityFilters(rows, { funding: 'רמי שני' }), ['F-RAMI-1']);
  assert.deepEqual(
    applyActivityFilters(rows, { funding: EMPTY_FUNDING_FILTER_VALUE }).sort(),
    ['F-EMPTY-1', 'F-NULL-1']
  );
});

test('funding combines with authority / school / instructor / activity_type', () => {
  const rows = fixtureRows().filter((row) => row.activity_season === 'regular' && row.status !== 'נמחק');
  assert.deepEqual(
    applyActivityFilters(rows, { funding: 'גפן', authority: 'חיפה' }),
    ['F-GAFEN-1']
  );
  assert.deepEqual(
    applyActivityFilters(rows, { funding: 'רמי שני', school: 'בית ספר ברוש' }),
    ['F-RAMI-1']
  );
  assert.deepEqual(
    applyActivityFilters(rows, { funding: 'עלבד', instructor: 'דנה מדריכה' }),
    ['F-ALBAD-1']
  );
  assert.deepEqual(
    applyActivityFilters(rows, { funding: 'רמי שני', activity_type: 'workshop' }),
    ['F-RAMI-1']
  );
  assert.deepEqual(
    applyActivityFilters(rows, { funding: 'גפן', authority: 'נתניה' }),
    []
  );
});

test('clearing filters restores the full visible set', () => {
  const rows = fixtureRows().filter((row) => row.activity_season === 'regular' && !['נמחק', 'סגור'].includes(row.status));
  const filtered = applyActivityFilters(rows, { funding: 'גפן' });
  assert.deepEqual(filtered, ['F-GAFEN-1']);
  const cleared = applyActivityFilters(rows, { funding: '', authority: '', school: '', instructor: '' });
  assert.equal(cleared.length, rows.length);
});

test('dependent funding options come from real period data and shrink with other filters', () => {
  const rows2026 = prepareRowsForSearch(
    fixtureRows().filter((row) => row.activity_season === 'regular' && row.status !== 'נמחק'),
    ['funding', 'authority', 'school']
  );
  const allFunding = collectDependentFilterOptions(rows2026, ACTIVITY_FILTER_FIELDS, {}, '');
  assert.ok(allFunding.funding.includes('גפן'));
  assert.ok(allFunding.funding.includes('רמי שני'));
  assert.ok(allFunding.funding.includes('עלבד'));
  assert.ok(allFunding.funding.includes('מ.ר.ק'));
  assert.ok(allFunding.funding.includes(EMPTY_FUNDING_FILTER_VALUE));
  assert.equal(allFunding.funding.includes('מארוול'), false, 'deleted-only funding must not appear');

  const narrowed = collectDependentFilterOptions(
    rows2026,
    ACTIVITY_FILTER_FIELDS,
    { authority: 'חיפה' },
    ''
  );
  assert.deepEqual(narrowed.funding.sort((a, b) => a.localeCompare(b, 'he')), ['גפן', 'עלבד'].sort((a, b) => a.localeCompare(b, 'he')));
  // Authority options ignore the authority selection itself, so peer values remain available.
  assert.ok(narrowed.authority.includes('חיפה'));
  assert.ok(narrowed.authority.includes('נתניה'));
  // With funding selected, other filters shrink to values that still have matching rows.
  const withFunding = collectDependentFilterOptions(
    rows2026,
    ACTIVITY_FILTER_FIELDS,
    { funding: 'גפן' },
    ''
  );
  assert.deepEqual(withFunding.authority, ['חיפה']);
  assert.ok(withFunding.funding.includes('גפן'));
  assert.ok(withFunding.funding.includes('רמי שני'), 'selected funding must not hide other funding options that remain possible');
});

test('2027 options do not include 2026-only funding values', () => {
  const rows2027 = prepareRowsForSearch(
    fixtureRows().filter((row) => row.activity_season === 'school_2027'),
    ['funding', 'authority']
  );
  const options = collectDependentFilterOptions(rows2027, ACTIVITY_FILTER_FIELDS, {}, '');
  assert.deepEqual(
    options.funding.sort((a, b) => a.localeCompare(b, 'he')),
    ['גפן', 'רמי שני', EMPTY_FUNDING_FILTER_VALUE].sort((a, b) => a.localeCompare(b, 'he'))
  );
  assert.equal(options.funding.includes('עלבד'), false);
  assert.equal(options.funding.includes('מ.ר.ק'), false);
});

test('activities render: funding filter changes visible rows and title count', () => {
  const rows = fixtureRows();
  const state = withFilters(baseState(), { funding: 'גפן' });
  const html = activitiesScreen.render({ rows }, { state });
  const ids = renderedRowIds(html);
  assert.deepEqual(ids, ['F-GAFEN-1']);
  assert.equal(titleCount(html), 1);
  assert.ok(selectOptionValues(html, 'funding').includes('גפן'));
  assert.match(html, /data-filter-field="funding"[\s\S]*selected/);
});

test('activities render: empty funding sentinel and clear restore full year_all open+closed set', () => {
  const rows = fixtureRows();
  const emptyState = withFilters(baseState(), { funding: EMPTY_FUNDING_FILTER_VALUE });
  const emptyHtml = activitiesScreen.render({ rows }, { state: emptyState });
  assert.deepEqual(renderedRowIds(emptyHtml).sort(), ['F-EMPTY-1', 'F-NULL-1']);
  assert.equal(titleCount(emptyHtml), 2);

  const clearedState = withFilters(baseState(), {});
  const clearedHtml = activitiesScreen.render({ rows }, { state: clearedState });
  const clearedIds = renderedRowIds(clearedHtml).sort();
  assert.ok(clearedIds.includes('F-GAFEN-1'));
  assert.ok(clearedIds.includes('F-CLOSED-1'));
  assert.equal(clearedIds.includes('F-DEL-1'), false, 'deleted rows stay out of year_all');
  assert.equal(titleCount(clearedHtml), clearedIds.length);
});

test('activities render: switching 2026→2027 clears unavailable funding and refreshes options', () => {
  const rows = fixtureRows();
  const state = withFilters(baseState({
    activityPeriodTab: 'regular',
    activitiesInnerTab: 'year_all'
  }), { funding: 'עלבד' });

  const html2026 = activitiesScreen.render({ rows }, { state });
  assert.deepEqual(renderedRowIds(html2026), ['F-ALBAD-1']);

  state.activityPeriodTab = 'school_2027';
  state.activitiesInnerTab = 'year_all';
  const html2027 = activitiesScreen.render({ rows }, { state });
  // עלבד does not exist in 2027 — dependent toolbar clears the stale selection.
  assert.equal(state.listFilters.activities.funding, '');
  const ids2027 = renderedRowIds(html2027).sort();
  assert.deepEqual(ids2027, ['F-2027-GAFEN', 'F-2027-NONE', 'F-2027-RAMI']);
  const fundingOpts = selectOptionValues(html2027, 'funding');
  assert.equal(fundingOpts.includes('עלבד'), false);
  assert.ok(fundingOpts.includes('גפן'));
  assert.ok(fundingOpts.includes(EMPTY_FUNDING_FILTER_VALUE));
  assert.equal(titleCount(html2027), 3);
});

test('activities render: assignment + free search + manager/program filters still change the list', () => {
  const rows = fixtureRows();
  const unassignedState = withFilters(baseState({ allActivitiesStatusFilter: 'unassigned' }), {});
  const unassignedHtml = activitiesScreen.render({ rows }, { state: unassignedState });
  assert.deepEqual(renderedRowIds(unassignedHtml).sort(), ['F-NULL-1']);

  const managerState = withFilters(baseState(), { activity_manager: 'נועה מנהלת' });
  const managerHtml = activitiesScreen.render({ rows }, { state: managerState });
  assert.deepEqual(renderedRowIds(managerHtml).sort(), ['F-ALBAD-1', 'F-GAFEN-1']);

  const programState = withFilters(baseState(), { activity_name: 'תוכנית רמי' });
  const programHtml = activitiesScreen.render({ rows }, { state: programState });
  assert.deepEqual(renderedRowIds(programHtml), ['F-RAMI-1']);

  const searchState = withFilters(baseState(), { q: 'דפנה', appliedQ: 'דפנה' });
  const searchHtml = activitiesScreen.render({ rows }, { state: searchState });
  assert.deepEqual(renderedRowIds(searchHtml), ['F-NULL-1']);
});

test('activities render: activity_type option values stay canonical while labels are Hebrew', () => {
  const html = activitiesScreen.render({ rows: fixtureRows() }, { state: baseState() });
  const values = selectOptionValues(html, 'activity_type');
  assert.ok(values.includes('course'));
  assert.ok(values.includes('workshop'));
  assert.match(html, /data-filter-field="activity_type"[\s\S]*(קורסים|סדנאות)/);
});

test('clear button binding resets funding and assignment filter state', () => {
  const dom = new JSDOM(`<div>
    <select data-activities-instructor-status-filter><option value="unassigned" selected>ללא מדריך</option></select>
    <select data-filter-scope="activities" data-filter-field="funding"><option value="גפן" selected>גפן</option></select>
    <button data-filter-clear="activities">ניקוי</button>
  </div>`);
  const root = dom.window.document.querySelector('div');
  const state = withFilters(baseState({ allActivitiesStatusFilter: 'unassigned' }), { funding: 'גפן' });
  let renders = 0;
  bindLocalFilters(root, state, 'activities', () => { renders += 1; }, {
    onClear: () => { state.allActivitiesStatusFilter = 'all'; }
  });
  root.querySelector('[data-filter-clear="activities"]').dispatchEvent(new dom.window.Event('click', { bubbles: true }));
  assert.equal(state.listFilters.activities.funding, undefined);
  assert.equal(state.listFilters.activities.q, '');
  assert.equal(state.allActivitiesStatusFilter, 'all');
  assert.equal(renders, 1);
});

test('ensureActivityListFilters keeps explicit empty funding as cleared', () => {
  const state = withFilters(baseState(), { funding: '' });
  const filters = ensureActivityListFilters(state, 'activities');
  assert.equal(filters.funding, '');
});
