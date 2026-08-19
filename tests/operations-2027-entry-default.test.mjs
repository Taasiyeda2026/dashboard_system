import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
  url: 'http://localhost/#operations-management'
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.CustomEvent = dom.window.CustomEvent;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.MutationObserver = dom.window.MutationObserver;
globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.alert = () => {};

await import('../frontend/src/screens/operations-authorities-cleanup.js');
const { operationsManagementScreen } = await import('../frontend/src/screens/operations-management.js');

function state2027() {
  return {
    activityPeriodTab: 'school_2027',
    route: 'operations-management',
    user: { role: 'admin' },
    operationsManagement: {
      context: 'operations',
      tab: 'workshops',
      period: 'school_2027',
      dateFrom: '2026-09-01',
      dateTo: '2027-08-31',
      instructor: '__all__'
    },
    listFilters: {
      'operations-management': {
        q: '',
        appliedQ: '',
        status: 'פתוח',
        visibleCount: 200
      }
    }
  };
}

test('entering 2027 operations cannot render the hidden summer completion-approval screen', () => {
  const state = state2027();

  // Reproduce a real navigation into operations-management. The base screen marks
  // the next render for an entry reset, which used to force completion_approval.
  document.dispatchEvent(new CustomEvent('app:navigate', {
    detail: { route: 'operations-management' }
  }));

  const html = operationsManagementScreen.render({
    rows: [],
    workshopStockMap: new Map(),
    adminListsData: undefined,
    _loadedOperationsTabs: [],
    _operationsTabLoadPromises: new Map()
  }, { state });

  assert.equal(state.operationsManagement.tab, 'home');
  assert.doesNotMatch(html, /בקרת אישורי ביצוע לקיץ 2026/);
  assert.match(html, /תפעול/);
  assert.match(html, /data-ops-year="2027"/);
  assert.match(html, /operations-management-home/);
  assert.doesNotMatch(html, /data-ops-tab="completion_approval"/);
});

after(async () => {
  const { supabase } = await import('../frontend/src/supabase-client.js');
  supabase?.auth?.stopAutoRefresh?.();
  dom.window.close();
  setImmediate(() => process.exit(process.exitCode || 0));
});
