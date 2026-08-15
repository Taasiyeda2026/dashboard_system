import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.sessionStorage = dom.window.sessionStorage;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
const { operationsManagementScreen, loadOperationsTabData } = await import('../frontend/src/screens/operations-management.js');
const { supabase } = await import('../frontend/src/supabase-client.js');

test.after(() => {
  try { supabase?.auth?.stopAutoRefresh?.(); } catch { /* ignore */ }
  try { supabase?.removeAllChannels?.(); } catch { /* ignore */ }
  dom.window.close();
  delete global.window;
  delete global.document;
  delete global.localStorage;
  delete global.sessionStorage;
  delete global.Element;
  delete global.HTMLElement;
});

function trackedApi(calls) {
  const hit = (name, value) => async () => { calls.push(name); return value; };
  return {
    allActivities: hit('allActivities', { rows: [] }),
    adminLists: hit('adminLists', { categories: [] }),
    workshopStockDistributions: hit('workshopStockDistributions', { rows: [] }),
    workshopInventoryOpeningBalances: hit('workshopInventoryOpeningBalances', { rows: [] }),
    instructorSchedulePrintContacts: hit('instructorSchedulePrintContacts', { rows: [] }),
    completionApprovalUploads: hit('completionApprovalUploads', { rows: [] }),
    schoolContactResponsibles: hit('schoolContactResponsibles', { rows: [] }),
    photoApprovalUploads: hit('photoApprovalUploads', { rows: [] })
  };
}

test('inventory entry loads current activities plus independent 2027 opening balances, while deferring approvals', async () => {
  const calls = [];
  const data = await operationsManagementScreen.load({
    api: trackedApi(calls),
    state: { activityPeriodTab: 'school_2027', operationsManagement: { tab: 'workshops', period: 'school_2027' } }
  });
  assert.deepEqual(calls.sort(), [
    'adminLists',
    'allActivities',
    'allActivities',
    'workshopInventoryOpeningBalances'
  ]);
  assert.deepEqual(data._loadedOperationsTabs, ['workshops']);
});

test('inventory tab loader reads only catalog, opening balances and 2027 activities', async () => {
  const calls = [];
  await loadOperationsTabData(trackedApi(calls), 'workshops', {
    state: { operationsManagement: { period: 'school_2027' } }
  });
  assert.deepEqual(calls.sort(), [
    'adminLists',
    'allActivities',
    'workshopInventoryOpeningBalances'
  ]);
});

test('schedule entry does not load activities or supporting dependencies before filter submission', async () => {
  const calls = [];
  const data = await operationsManagementScreen.load({
    api: trackedApi(calls),
    state: {
      activityPeriodTab: 'school_2027',
      operationsManagement: { tab: 'instructors', context: 'instructors' }
    }
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(data.rows, []);
  assert.deepEqual(data._loadedOperationsTabs, []);
});

test('work schedule loads only on apply and clear hides results without another request', async () => {
  const calls = [];
  const state = {
    activityPeriodTab: 'regular',
    operationsManagement: {
      tab: 'instructors',
      context: 'instructors',
      period: 'regular',
      dateFrom: '2026-01-01',
      dateTo: '2026-12-31'
    },
    listFilters: {
      'operations-management': { q: '', appliedQ: '', status: 'פתוח', authority: '', visibleCount: 200 }
    }
  };
  const data = await operationsManagementScreen.load({ api: trackedApi(calls), state });
  const root = document.createElement('div');
  const render = () => {
    root.innerHTML = operationsManagementScreen.render(data, { state });
  };
  render();
  assert.match(root.textContent, /בחרו סינונים ולחצו על 'סינון והצגה'/);

  const api = {
    ...trackedApi(calls),
    allActivities: async () => {
      calls.push('allActivities');
      return { rows: [{ row_id: 'A-1', status: 'פתוח', authority: 'רחובות', school: 'בית ספר', activity_name: 'מדעים', instructor_name: 'דנה', start_date: '2026-04-10' }] };
    }
  };
  let rerenders = 0;
  operationsManagementScreen.bind({ root, data, api, state, rerender: () => { rerenders += 1; } });
  const search = root.querySelector('[data-ops-search]');
  search.value = 'רחובות';
  search.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(calls, []);

  root.querySelector('[data-ops-apply-filters]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(calls, ['allActivities']);
  assert.equal(state.operationsManagement.scheduleHasLoaded, true);
  assert.equal(state.operationsManagement.appliedScheduleFilters.dateFrom, '2026-01-01');
  assert.equal(state.operationsManagement.appliedScheduleFilters.filters.q, 'רחובות');
  assert.ok(rerenders >= 2);

  render();
  assert.match(root.textContent, /מדעים/);
  assert.match(root.textContent, /מציג 1 פעילויות מתוך 1/);
  operationsManagementScreen.bind({ root, data, api, state, rerender: () => { rerenders += 1; } });
  const changedSearch = root.querySelector('[data-ops-search]');
  changedSearch.value = 'לא תואם';
  changedSearch.dispatchEvent(new window.Event('input', { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.deepEqual(calls, ['allActivities']);
  render();
  assert.match(root.textContent, /מדעים/);
  assert.match(root.textContent, /מציג 1 פעילויות מתוך 1/);
  operationsManagementScreen.bind({ root, data, api, state, rerender: () => { rerenders += 1; } });
  root.querySelector('[data-ops-clear-filters]').click();
  assert.deepEqual(calls, ['allActivities']);
  assert.equal(state.operationsManagement.scheduleHasLoaded, false);
  assert.deepEqual(data.rows, []);
  render();
  assert.match(root.textContent, /בחרו סינונים ולחצו על 'סינון והצגה'/);
  assert.doesNotMatch(root.textContent, /מציג \d+ פעילויות/);
});
