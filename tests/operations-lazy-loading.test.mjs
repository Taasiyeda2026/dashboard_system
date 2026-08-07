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

test('schedule entry defers school, contact, print and approval dependencies', async () => {
  const calls = [];
  const data = await operationsManagementScreen.load({
    api: trackedApi(calls),
    state: {
      activityPeriodTab: 'school_2027',
      operationsManagement: { tab: 'instructors', context: 'instructors' }
    }
  });
  assert.deepEqual(calls, ['allActivities']);
  assert.equal(data.schoolsDirectorySource, 'deferred');
  assert.deepEqual(data._loadedOperationsTabs, ['schedule']);
});
