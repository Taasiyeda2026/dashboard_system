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

function trackedApi(calls) {
  const hit = (name, value) => async () => { calls.push(name); return value; };
  return {
    allActivities: hit('allActivities', { rows: [] }),
    adminLists: hit('adminLists', { categories: [] }),
    workshopStockDistributions: hit('workshopStockDistributions', { rows: [] }),
    instructorSchedulePrintContacts: hit('instructorSchedulePrintContacts', { rows: [] }),
    completionApprovalUploads: hit('completionApprovalUploads', { rows: [] }),
    schoolContactResponsibles: hit('schoolContactResponsibles', { rows: [] }),
    photoApprovalUploads: hit('photoApprovalUploads', { rows: [] })
  };
}

test('inventory entry loads inventory dependencies but defers approval dependencies', async () => {
  const calls = [];
  const data = await operationsManagementScreen.load({
    api: trackedApi(calls),
    state: { operationsManagement: { tab: 'workshops' } }
  });
  assert.deepEqual(calls.sort(), ['adminLists', 'allActivities', 'workshopStockDistributions']);
  assert.deepEqual(data._loadedOperationsTabs, ['workshops']);
});

test('inventory tab loader does not read schedule or approval data', async () => {
  const calls = [];
  await loadOperationsTabData(trackedApi(calls), 'workshops');
  assert.deepEqual(calls.sort(), ['adminLists', 'workshopStockDistributions']);
});
