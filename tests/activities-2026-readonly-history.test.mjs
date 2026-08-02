import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

if (!globalThis.localStorage) globalThis.localStorage = memoryStorage();
if (!globalThis.sessionStorage) globalThis.sessionStorage = memoryStorage();

const {
  ACTIVE_ACTIVITY_SEASON,
  GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY,
  activityPeriodDisplayLabel,
  activitySeasonQueryValues
} = await import('../frontend/src/screens/shared/summer-activity.js');
const {
  READ_ONLY_ACTIVITY_SEASONS,
  activityMutationBlockReason,
  applyReadOnlyActivityCapabilities,
  assertActivityMutationAllowed,
  isActivityMutationBlocked,
  isReadOnlyActivityRow,
  isReadOnlyGlobalActivityPeriod
} = await import('../frontend/src/screens/shared/activity-readonly-period.js');
const { activityWorkDrawerHtml } = await import('../frontend/src/screens/shared/activity-detail-html.js');
const { activitiesScreen } = await import('../frontend/src/screens/activities.js');
const {
  archiveScreen,
  ARCHIVE_TYPE_KPIS,
  archiveRowMatchesTypeKpi,
  archiveTypeKpiCounts
} = await import('../frontend/src/screens/archive.js');
const { resolveInitialActivityPeriod } = await import('../frontend/src/activity-period-cutover.js');

function activitiesState(overrides = {}) {
  return {
    activityPeriodTab: 'regular',
    activitiesInnerTab: 'year_all',
    activitiesMonthYm: '',
    user: { display_role: 'מנהל מערכת', role: 'admin', can_add_activity: true, can_edit_direct: true, can_review_requests: true },
    clientSettings: { hide_emp_id_on_screens: true, dropdown_options: {} },
    activityListFilters: {},
    screenDataCache: {},
    ...overrides
  };
}

const activityRows = [
  { RowID: 'REG-OPEN', activity_name: 'רגיל פתוח', activity_type: 'course', activity_family: 'program', activity_season: 'regular', start_date: '2026-01-05', status: 'פתוח' },
  { RowID: 'REG-CLOSED', activity_name: 'רגיל סגור', activity_type: 'course', activity_family: 'program', activity_season: 'regular', start_date: '2026-02-05', end_date: '2026-05-05', status: 'סגור' },
  { RowID: 'SUMMER-CLOSED', activity_name: 'קיץ סגור', activity_type: 'escape_room', activity_family: 'one_day', activity_season: 'summer_2026', start_date: '2026-07-05', end_date: '2026-07-05', status: 'סגור' },
  { RowID: 'SUMMER-DELETED', activity_name: 'קיץ נמחק', activity_type: 'workshop', activity_family: 'one_day', activity_season: 'summer_2026', start_date: '2026-07-06', status: 'נמחק' },
  { RowID: 'SCHOOL-2027-OPEN', activity_name: 'תשפז פתוח', activity_type: 'course', activity_family: 'program', activity_season: 'school_2027', start_date: '2026-09-05', status: 'פתוח' }
];

test('the 2026 global period maps to both regular and summer_2026 seasons', () => {
  assert.deepEqual(activitySeasonQueryValues('regular'), ['regular', 'summer_2026']);
  assert.deepEqual(activitySeasonQueryValues('2026'), ['regular', 'summer_2026']);
  assert.deepEqual(activitySeasonQueryValues('summer_2026'), ['regular', 'summer_2026']);
  assert.deepEqual(activitySeasonQueryValues('school_2027'), ['school_2027']);
  assert.deepEqual([...READ_ONLY_ACTIVITY_SEASONS], ['regular', 'summer_2026']);
});

test('archive loading pages through the whole period instead of the first page only', async () => {
  const pageSize = 200;
  const requests = [];
  const rows = Array.from({ length: 470 }, (_, index) => ({
    RowID: `ARCH-${index}`,
    activity_name: `פעילות ${index}`,
    activity_type: index % 2 === 0 ? 'escape_room' : 'course',
    activity_season: index % 2 === 0 ? 'summer_2026' : 'regular',
    end_date: '2026-06-30',
    status: 'סגור'
  }));

  const api = {
    archiveActivities: async (params) => {
      requests.push(params);
      const offset = Number(params?.offset || 0);
      const page = rows.slice(offset, offset + pageSize);
      return { rows: page, _hasMore: offset + pageSize < rows.length };
    }
  };

  // The screen must ask for the full period, not a single explicit page.
  const loaded = await archiveScreen.load({ api, state: { activityPeriodTab: 'regular' } });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].offset, undefined);
  assert.equal(loaded.rows.length, pageSize);

  const apiSource = await readFile(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
  assert.match(
    apiSource,
    /params\?\.offset === undefined && params\?\.paged !== true[\s\S]*?readAllArchiveActivitiesFromSupabase/,
    'archiveActivities must run the staged full load unless the caller pages explicitly'
  );
  assert.match(
    apiSource,
    /async function readAllArchiveActivitiesFromSupabase[\s\S]*?if \(!result\._hasMore\) return finishArchivePages\(\)/,
    'the staged loader must keep paging until the period is fully loaded'
  );
  assert.match(
    apiSource,
    /\.select\(ACTIVITY_ARCHIVE_COLUMNS\)\s*\n\s*\.in\('activity_season', activitySeasonQueryValues\(activityPeriod\)\)/,
    'the archive query must include both 2026 seasons'
  );
});

test('archive cards include escape rooms and count every stored spelling', () => {
  assert.ok(ARCHIVE_TYPE_KPIS.some((kpi) => kpi.label === 'חדרי בריחה'));
  const escapeRoomKpi = ARCHIVE_TYPE_KPIS.find((kpi) => kpi.label === 'חדרי בריחה');
  assert.deepEqual(escapeRoomKpi.keys, ['escape_room', 'חדר בריחה', 'חדרי בריחה']);

  ['escape_room', 'חדר בריחה', 'חדרי בריחה'].forEach((value) => {
    assert.equal(archiveRowMatchesTypeKpi({ activity_type: value }, escapeRoomKpi.keys), true, value);
  });
  assert.equal(archiveRowMatchesTypeKpi({ activity_type: 'course' }, escapeRoomKpi.keys), false);

  const counts = new Map(archiveTypeKpiCounts([
    { activity_type: 'escape_room' },
    { activity_type: 'חדר בריחה' },
    { activity_type: 'חדרי בריחה' },
    { activity_type: 'קורס' },
    { activity_type: 'course' },
    { activity_type: 'סדנה' },
    { activity_type: 'סיור' },
    { activity_type: 'אפטרסקול' }
  ]).map(({ label, count }) => [label, count]));

  assert.equal(counts.get('חדרי בריחה'), 3);
  assert.equal(counts.get('קורסים'), 2);
  assert.equal(counts.get('סדנאות'), 1);
  assert.equal(counts.get('סיורים'), 1);
  assert.equal(counts.get('אפטרסקול'), 1);
});

test('archive counts describe all loaded pages, not the first visible page', () => {
  const rows = Array.from({ length: 320 }, (_, index) => ({
    RowID: `ARCH-${index}`,
    activity_name: `פעילות ${index}`,
    activity_type: 'escape_room',
    activity_season: 'summer_2026',
    end_date: '2026-06-30',
    status: 'סגור'
  }));

  const html = archiveScreen.render({ rows, _hasMore: false }, {
    state: { archiveActivityPeriod: 'regular', activityPeriodTab: 'regular', archiveYear: '', clientSettings: {}, user: {} }
  });

  assert.match(html, /ארכיון פעילויות · 320 פעילויות סגורות/);
  assert.match(html, /data-archive-kpi="חדרי בריחה"[\s\S]*?<span class="ds-archive-kpi__value">320<\/span>/);
});

test('every row rendered in all activities is present in the row source used by clicks', () => {
  const state = activitiesState();
  const html = activitiesScreen.render({ rows: activityRows }, { state });

  const renderedRowIds = [...html.matchAll(/data-row-id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(renderedRowIds.sort(), ['REG-CLOSED', 'REG-OPEN', 'SUMMER-CLOSED']);
  assert.match(html, /רגיל סגור/);
  assert.match(html, /קיץ סגור/);
  assert.doesNotMatch(html, /קיץ נמחק/);
  assert.doesNotMatch(html, /תשפז פתוח/);

  const dom = new JSDOM(`<main id="root">${html}</main>`);
  const clickable = [...dom.window.document.querySelectorAll('.ds-data-row[data-row-id]')]
    .map((node) => node.getAttribute('data-row-id'));
  assert.deepEqual(clickable.sort(), renderedRowIds.sort());
});

test('the drawer shows the full record values once the activity detail arrives', () => {
  const summaryRow = {
    RowID: 'summer_2026_row_369',
    row_id: 'summer_2026_row_369',
    activity_name: 'חדר בריחה חלל',
    activity_type: 'escape_room',
    activity_season: 'summer_2026',
    authority: 'רשות א',
    school: 'בית ספר א',
    status: 'סגור',
    start_date: '2026-07-05'
  };
  const detailRow = { ...summaryRow, funding: 'רשות', price: 650, participants_count: 15 };

  const summaryHtml = activityWorkDrawerHtml(summaryRow, { settings: {} });
  assert.doesNotMatch(summaryHtml, /650/);

  const detailHtml = activityWorkDrawerHtml(detailRow, { settings: {} });
  const dom = new JSDOM(`<main id="root">${detailHtml}</main>`);
  const fields = [...dom.window.document.querySelectorAll('.activity-view-field')].map((node) => [
    node.querySelector('.activity-view-field__label')?.textContent?.trim(),
    node.querySelector('.activity-view-field__value')?.textContent?.trim()
  ]);
  const byLabel = new Map(fields);

  assert.equal(byLabel.get('מימון'), 'רשות');
  assert.equal(byLabel.get('מחיר'), '650');
  assert.equal(byLabel.get('מספר משתתפים'), '15');
  assert.equal(byLabel.get('תקופת הפעילות'), 'קיץ 2026');
  assert.equal(activityPeriodDisplayLabel(detailRow), 'קיץ 2026');
});

test('empty record fields are omitted instead of being invented', () => {
  const html = activityWorkDrawerHtml({
    RowID: 'REG-NO-FINANCE',
    activity_name: 'ללא מימון',
    activity_type: 'escape_room',
    activity_season: 'regular',
    status: 'סגור'
  }, { settings: {} });

  const dom = new JSDOM(`<main id="root">${html}</main>`);
  const recordSection = dom.window.document.querySelector('[data-record-details-section]');
  const labels = [...(recordSection?.querySelectorAll('.activity-view-field__label') || [])]
    .map((node) => node.textContent.trim());
  assert.deepEqual(labels, ['תקופת הפעילות']);
});

test('the live inline drawer layout shows the record values exactly once', async () => {
  const detailRow = {
    RowID: 'summer_2026_row_369',
    row_id: 'summer_2026_row_369',
    activity_name: 'חדר בריחה חלל',
    activity_type: 'escape_room',
    activity_season: 'summer_2026',
    authority: 'רשות א',
    school: 'בית ספר א',
    status: 'סגור',
    start_date: '2026-07-05',
    funding: 'רשות',
    price: 650,
    participants_count: 15
  };

  const dom = new JSDOM(`<!doctype html><html><body>
    <div class="ds-ui-layer"><aside class="ds-drawer">
      <header class="ds-drawer__header"><h2></h2></header>
      <div class="ds-drawer__content">${activityWorkDrawerHtml(detailRow, { settings: {} })}</div>
    </aside></div>
  </body></html>`, { url: 'https://example.com/' });

  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    MutationObserver: globalThis.MutationObserver,
    Element: globalThis.Element,
    Node: globalThis.Node
  };
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  globalThis.Element = dom.window.Element;
  globalThis.Node = dom.window.Node;
  globalThis.__ACTIVITY_DRAWER_INLINE_LAYOUT_TEST__ = true;

  try {
    const inlineModuleUrl = new URL('../frontend/src/activity-drawer-inline-layout.js', import.meta.url);
    const { enhanceActivityDrawerForm } = await import(`${inlineModuleUrl.href}?readonly-test=${Date.now()}`);
    const form = dom.window.document.querySelector('[data-drawer-form]');
    assert.equal(enhanceActivityDrawerForm(form), true);

    const inlineValues = new Map();
    form.querySelectorAll('.activity-drawer-inline__field').forEach((field) => {
      const label = field.querySelector(':scope > .activity-drawer-inline__label')?.textContent.trim();
      const value = field.querySelector(':scope > .activity-drawer-inline__value')?.textContent.trim();
      if (label && !inlineValues.has(label)) inlineValues.set(label, value);
    });

    assert.equal(inlineValues.get('מימון'), 'רשות');
    assert.match(inlineValues.get('מחיר'), /650/);
    assert.equal(inlineValues.get('מספר משתתפים'), '15');
    assert.equal(inlineValues.get('עונת פעילות'), 'קיץ 2026');

    const labels = [...form.querySelectorAll('.activity-drawer-inline__label')].map((node) => node.textContent.trim());
    ['מימון', 'מחיר', 'מספר משתתפים'].forEach((label) => {
      assert.equal(labels.filter((item) => item === label).length, 1, `${label} must render once`);
    });
    assert.equal(form.querySelectorAll('[data-record-details-section]').length, 0);
  } finally {
    delete globalThis.__ACTIVITY_DRAWER_INLINE_LAYOUT_TEST__;
    dom.window.close();
    globalThis.window = previous.window;
    globalThis.document = previous.document;
    globalThis.MutationObserver = previous.MutationObserver;
    globalThis.Element = previous.Element;
    globalThis.Node = previous.Node;
  }
});

test('2026 activities are read-only everywhere the drawer is rendered', () => {
  const readOnlyRow = {
    RowID: 'SUMMER-CLOSED',
    activity_name: 'קיץ סגור',
    activity_type: 'escape_room',
    activity_season: 'summer_2026',
    status: 'סגור'
  };

  assert.equal(isReadOnlyActivityRow(readOnlyRow), true);
  assert.equal(isReadOnlyActivityRow({ activity_season: 'regular' }), true);
  assert.equal(isReadOnlyActivityRow({ activity_season: 'school_2027' }), false);
  assert.equal(isReadOnlyGlobalActivityPeriod('regular'), true);
  assert.equal(isReadOnlyGlobalActivityPeriod('school_2027'), false);
  assert.equal(isReadOnlyGlobalActivityPeriod(''), false);

  const html = activityWorkDrawerHtml(readOnlyRow, {
    settings: {},
    canEdit: true,
    canDirectEdit: true,
    canRequestEdit: true,
    canDeleteActivity: true,
    canSchedule: true
  });

  assert.doesNotMatch(html, /data-action="start-edit"/);
  assert.doesNotMatch(html, /data-action="save-edit"/);
  assert.doesNotMatch(html, /data-action="delete-activity"/);
  assert.doesNotMatch(html, /data-find-instructor/);
  assert.match(html, /data-activity-read-only="yes"/);
});

test('2026 hides add activity while 2027 keeps the existing edit permissions', () => {
  const historicalHtml = activitiesScreen.render({ rows: activityRows }, { state: activitiesState() });
  assert.doesNotMatch(historicalHtml, /data-activities-add-btn/);

  const workingHtml = activitiesScreen.render({ rows: activityRows }, {
    state: activitiesState({ activityPeriodTab: 'school_2027', activitiesInnerTab: 'year_all' })
  });
  assert.match(workingHtml, /data-activities-add-btn/);

  const editable2027Drawer = activityWorkDrawerHtml({
    RowID: 'SCHOOL-2027-OPEN',
    activity_name: 'תשפז פתוח',
    activity_type: 'course',
    activity_season: 'school_2027',
    status: 'פתוח'
  }, { settings: {}, canEdit: true, canDirectEdit: true, canDeleteActivity: true });

  assert.match(editable2027Drawer, /data-action="start-edit"/);
  assert.match(editable2027Drawer, /data-action="save-edit"/);
  assert.match(editable2027Drawer, /data-action="delete-activity"/);
  assert.match(editable2027Drawer, /data-activity-read-only="no"/);
});

test('mutation guard blocks 2026 writes and allows 2027 writes', () => {
  assert.equal(activityMutationBlockReason({ activityPeriod: 'regular' }), 'global_period_2026');
  assert.equal(activityMutationBlockReason({ activitySeason: 'summer_2026' }), 'activity_season_2026');
  assert.equal(activityMutationBlockReason({ activity: { activity_season: 'regular' } }), 'activity_row_2026');
  assert.equal(activityMutationBlockReason({ activityPeriod: 'school_2027', activity: { activity_season: 'school_2027' } }), '');
  assert.equal(isActivityMutationBlocked({ activityPeriod: 'school_2027' }), false);

  assert.throws(
    () => assertActivityMutationAllowed({ activity: { activity_season: 'summer_2026' } }),
    /activity_period_read_only_2026/
  );
  assert.equal(assertActivityMutationAllowed({ activityPeriod: 'school_2027' }), true);

  const collapsed = applyReadOnlyActivityCapabilities(
    { canEdit: true, canDirectEdit: true, canRequestEdit: true, canDeleteActivity: true, canSchedule: true },
    { activity: { activity_season: 'regular' } }
  );
  assert.deepEqual(collapsed, {
    canEdit: false,
    canDirectEdit: false,
    canRequestEdit: false,
    canDeleteActivity: false,
    canSchedule: false,
    canReopen: false,
    canAddActivity: false
  });

  const kept = applyReadOnlyActivityCapabilities(
    { canEdit: true, canDirectEdit: true },
    { activity: { activity_season: 'school_2027' } }
  );
  assert.deepEqual(kept, { canEdit: true, canDirectEdit: true });
});

test('the period selector opens on 2027 even when 2026 was stored before', () => {
  const storage = memoryStorage();
  storage.setItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY, 'regular');

  const first = resolveInitialActivityPeriod(storage);
  assert.equal(first.period, ACTIVE_ACTIVITY_SEASON);
  assert.equal(first.period, 'school_2027');
  assert.equal(first.didCutover, true);
  assert.equal(storage.getItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY), 'school_2027');

  storage.setItem(GLOBAL_ACTIVITY_PERIOD_STORAGE_KEY, 'summer_2026');
  assert.equal(resolveInitialActivityPeriod(storage).period, 'school_2027');
});
