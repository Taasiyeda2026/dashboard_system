import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const runtime = await readFile(new URL('../frontend/src/manager-board-final-fixes-runtime.js', import.meta.url), 'utf8');
const boardRuntime = await readFile(new URL('../frontend/src/manager-board-runtime.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/src/styles/manager-board-final-fixes.css', import.meta.url), 'utf8');
let viteServer;

after(async () => {
  await viteServer?.close();
});

test('manager board delegates its default month and does not restore a persisted month', () => {
  assert.match(boardRuntime, /return defaultMonthForGlobalActivityPeriod\(period, now\)/);
  assert.doesNotMatch(boardRuntime, /localStorage\.getItem\(`manager_board_month:/);
  assert.match(runtime, /localStorage\.removeItem\(`manager_board_month:\$\{period\}`\)/);
  assert.match(runtime, /clearPersistedManagerMonthDefaults\(\)/);
});

test('manager board starts at the current clamped month and preserves only an in-session selection', async () => {
  const [, { resolveManagerBoardMonth }] = await loadInteractiveRuntimes();

  assert.equal(resolveManagerBoardMonth('school_2027', { now: new Date(2026, 9, 1) }), '2026-10');
  assert.equal(resolveManagerBoardMonth('school_2027', {
    selectedMonth: '2026-09',
    selectedPeriod: '',
    now: new Date(2026, 9, 1)
  }), '2026-10');
  assert.equal(resolveManagerBoardMonth('school_2027', {
    selectedMonth: '2026-11',
    selectedPeriod: 'school_2027',
    now: new Date(2026, 9, 1)
  }), '2026-11');
  assert.equal(resolveManagerBoardMonth('school_2027', { now: new Date(2026, 7, 1) }), '2026-09');
  assert.equal(resolveManagerBoardMonth('school_2027', { now: new Date(2027, 9, 1) }), '2027-08');
});

test('long calendar descriptions wrap instead of ellipsizing', () => {
  assert.match(css, /\.manager-board-screen \.manager-board-calendar-day__school/);
  assert.match(css, /text-overflow: clip !important/);
  assert.match(css, /white-space: normal !important/);
  assert.match(css, /overflow-wrap: anywhere/);
});

async function loadInteractiveRuntimes() {
  if (!globalThis.document) {
    const dom = new JSDOM('<!doctype html><html><body><main id="app"><div id="screenRoot"></div></main></body></html>', { url: 'https://dashboard.test/' });
    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      Element: dom.window.Element,
      MutationObserver: dom.window.MutationObserver,
      CustomEvent: dom.window.CustomEvent,
      localStorage: dom.window.localStorage,
      sessionStorage: dom.window.sessionStorage
    });
  }
  viteServer ||= await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' });
  return Promise.all([
    viteServer.ssrLoadModule('/frontend/src/manager-board-interactions-runtime.js'),
    viteServer.ssrLoadModule('/frontend/src/manager-board-runtime.js')
  ]);
}

test('live day cells open by click, keyboard and after innerHTML restore', async () => {
  const [{ bindManagerBoardDayCells }] = await loadInteractiveRuntimes();
  const root = document.getElementById('screenRoot');
  const opened = [];
  const openDay = (cell) => opened.push(cell.dataset.managerBoardDay);

  root.innerHTML = '<section data-manager-board-root><div data-manager-board-day="2026-09-10" data-manager-board-day-bound="yes"></div></section>';
  bindManagerBoardDayCells(root, openDay);
  let day = root.querySelector('[data-manager-board-day]');
  day.click();
  day.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  day.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));

  // Instructor-center navigation stores/restores monthly markup with innerHTML.
  // Restored nodes are new DOM objects and must be rebound even if legacy markup
  // still carries the old data-manager-board-day-bound marker.
  const savedMonthlyMarkup = root.innerHTML;
  root.innerHTML = '<div data-manager-instructor-center></div>';
  root.innerHTML = savedMonthlyMarkup;
  day = root.querySelector('[data-manager-board-day]');
  bindManagerBoardDayCells(root, openDay);
  day.click();

  assert.deepEqual(opened, ['2026-09-10', '2026-09-10', '2026-09-10', '2026-09-10']);
});

test('rendered instructor controls carry emp_id and directly open the instructor center after rerender', async () => {
  const [, { bindInstructorCenterButtons }] = await loadInteractiveRuntimes();
  const root = document.getElementById('screenRoot');
  const data = { instructors: [{ emp_id: '731', full_name: 'מדריכה פעילה', direct_manager: 'מנהלת', active: true }] };
  const opened = [];
  const render = () => {
    root.innerHTML = '<select data-manager-board-manager><option selected>מנהלת</option></select><section data-manager-board-monthly-region></section><button data-instructor-id="731">מדריכה פעילה</button>';
    bindInstructorCenterButtons(root, data, (_root, _data, instructor) => {
      opened.push(instructor.empId);
      _root.querySelector('[data-manager-board-monthly-region]').innerHTML = `<div data-manager-instructor-center data-instructor-id="${instructor.empId}"></div>`;
    });
    return root.querySelector('button[data-instructor-id]');
  };

  let button = render();
  assert.equal(button.dataset.managerInstructorCenterOpen, 'true');
  button.click();
  assert.ok(root.querySelector('[data-manager-instructor-center][data-instructor-id="731"]'));
  button = render();
  button.click();

  assert.deepEqual(opened, ['731', '731']);
});

test('instructor center renders planned teaching hours and still works when hours are unavailable', async () => {
  const [, { renderInstructorCenter }] = await loadInteractiveRuntimes();
  const region = document.createElement('section');
  const activity = { row_id: 'course-731', emp_id: '731', activity_name: 'קורס לדוגמה', school: 'בית ספר לדוגמה' };
  const meeting = { activity, iso: '2026-10-12', meetingNo: 1, isMidpoint: false, isEnd: false, durationHours: 1.5 };
  const params = {
    instructor: { empId: '731', name: 'מדריכה פעילה' },
    activities: [activity],
    meetings: [meeting],
    ym: '2026-10',
    details: { full_name: 'מדריכה פעילה', mobile: '050-1234567', statuses: [] }
  };

  assert.doesNotThrow(() => renderInstructorCenter(region, params));
  assert.ok(region.querySelector('[data-manager-instructor-center][data-instructor-id="731"]'));
  assert.match(region.textContent, /1\.5 ש׳/);
  assert.match(region.textContent, /050-1234567/);
  assert.match(region.textContent, /מועדים מרכזיים בחודש/);

  assert.doesNotThrow(() => renderInstructorCenter(region, {
    ...params,
    meetings: [{ ...meeting, durationHours: null }]
  }));
  assert.match(region.querySelector('.manager-instructor-center__kpis').textContent, /—/);
});

function createBoardDataClient({ gate = Promise.resolve(), failFirstActivities = false } = {}) {
  const counts = new Map();
  const client = {
    from(table) {
      counts.set(table, (counts.get(table) || 0) + 1);
      const invocation = counts.get(table);
      const result = table === 'activities' && failFirstActivities && invocation === 1
        ? { data: null, error: { message: 'activities failed' } }
        : { data: [], error: null };
      const query = {
        select() { return query; },
        in() { return query; },
        eq() { return query; },
        order() { return query; },
        then(resolve, reject) { return gate.then(() => result).then(resolve, reject); }
      };
      return query;
    }
  };
  return { client, counts };
}

test('loadBoardData shares one query set and clears in-flight state after success and failure', async () => {
  const [, { loadBoardData }] = await loadInteractiveRuntimes();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const success = createBoardDataClient({ gate });
  const successCache = new Map();
  const successInFlight = new Map();
  const dependencies = {
    supabaseClient: success.client,
    waitForAuth: async () => ({ user: { id: 'test-user' } }),
    dataCache: successCache,
    dataLoadPromises: successInFlight
  };

  const first = loadBoardData('school_2027', dependencies);
  const second = loadBoardData('school_2027', dependencies);
  assert.strictEqual(second, first);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Object.fromEntries(success.counts), {
    activities: 1,
    contacts_instructors: 1,
    school_calendar: 1,
    users: 1
  });
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.strictEqual(secondResult, firstResult);
  assert.equal(successInFlight.size, 0);

  const retry = createBoardDataClient({ failFirstActivities: true });
  const retryDependencies = {
    supabaseClient: retry.client,
    waitForAuth: async () => ({ user: { id: 'test-user' } }),
    dataCache: new Map(),
    dataLoadPromises: new Map()
  };
  await assert.rejects(loadBoardData('school_2027', retryDependencies), /activities failed/);
  assert.equal(retryDependencies.dataLoadPromises.size, 0);
  await loadBoardData('school_2027', retryDependencies);
  assert.equal(retryDependencies.dataLoadPromises.size, 0);
  assert.deepEqual(Object.fromEntries(retry.counts), {
    activities: 2,
    contacts_instructors: 2,
    school_calendar: 2,
    users: 2
  });
});

test('birthday hydration updates only the live board region and ignores stale results', async () => {
  const [, { hydrateBoardBirthdays }] = await loadInteractiveRuntimes();
  const root = document.getElementById('screenRoot');
  const mount = () => {
    root.innerHTML = '<section data-manager-board-root data-manager-board-ym="2026-09"><div data-manager-board-important-dates>initial</div></section>';
    return root.querySelector('[data-manager-board-important-dates]');
  };
  const data = { schoolCalendar: [], birthdays: [] };

  let region = mount();
  await hydrateBoardBirthdays(root, data, 1, {
    loadBirthdays: async () => [{ employee_name: 'רותי', birth_day: 10, birth_month: 9 }],
    isCurrentRequest: () => true
  });
  assert.match(region.textContent, /רותי/);
  assert.equal(root.querySelector('.manager-board-screen--loading'), null);

  region = mount();
  let release;
  let current = true;
  const delayedRows = new Promise((resolve) => { release = resolve; });
  const staleHydration = hydrateBoardBirthdays(root, data, 2, {
    loadBirthdays: () => delayedRows,
    isCurrentRequest: () => current
  });
  current = false;
  release([{ employee_name: 'תוצאה ישנה', birth_day: 11, birth_month: 9 }]);
  await staleHydration;
  assert.equal(region.textContent, 'initial');

  region = mount();
  await hydrateBoardBirthdays(root, data, 3, {
    loadBirthdays: async () => { throw new Error('birthday read failed'); },
    isCurrentRequest: () => true
  });
  assert.match(region.textContent, /אין תאריכים חשובים/);
  assert.equal(root.querySelector('.manager-board-screen--loading'), null);
});
