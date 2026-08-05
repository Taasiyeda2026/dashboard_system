import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="screenRoot">
      <div
        class="ds-screen-stack ds-ops-mgmt-screen ops-year-2027"
        data-ops-year="2027"
      >
        <div class="ds-ops-mgmt-tabs">
          <button type="button" class="ds-ops-mgmt-tab is-active" data-ops-tab="instructors" aria-pressed="true">סידור עבודה</button>
          <button type="button" class="ds-ops-mgmt-tab" data-ops-tab="workshops" aria-pressed="false">ציוד ומלאי</button>
        </div>
        <div class="ds-ops-mgmt-content">תוכן מקורי</div>
      </div>
    </div>
  </body></html>`, { url: 'http://localhost/#operations-management' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.requestAnimationFrame = (callback) => setTimeout(callback, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.alert = () => {};
  return dom;
}

const expectedTabs = [
  ['summer_training_matrix', 'הכשרות סדנאות'],
  ['course_training_matrix', 'הכשרות קורסים'],
  ['course_print_kits', 'ערכות דפוס']
];

function customButtons(root) {
  return Array.from(root.querySelectorAll('[data-ops-custom-tab]'));
}

test('Operations 2027 controller binds custom tabs when bind receives outer #screenRoot', async () => {
  try {
  setupDom();

  await import('../frontend/src/screens/operations-authorities-cleanup.js');
  const {
    operationsManagementScreen
  } = await import('../frontend/src/screens/operations-management.js');
  const {
    getOperations2027Store,
    TAB_LOAD_STATES
  } = await import('../frontend/src/screens/operations-2027-loading-controller.js');

  const store = getOperations2027Store();
  store.tabStates.set('summer_training_matrix', TAB_LOAD_STATES.LOADED);
  store.tabCache.set('summer_training_matrix', { workshops: [], instructors: [], trainingRows: [] });
  store.tabStates.set('course_training_matrix', TAB_LOAD_STATES.LOADED);
  store.tabCache.set('course_training_matrix', { courses: [], instructors: [], activities: [], trainingRows: [] });
  store.tabStates.set('course_print_kits', TAB_LOAD_STATES.LOADED);
  store.tabCache.set('course_print_kits', { courses: [], instructors: [], activities: [], inventoryRows: [], distributionRows: [] });

  const outerRoot = document.querySelector('#screenRoot');
  const screenRoot = document.querySelector('.ds-ops-mgmt-screen[data-ops-year="2027"]');
  const context = {
    root: outerRoot,
    data: { _loadedOperationsTabs: [] },
    api: {
      allActivities: async () => ({ rows: [] }),
      listWorkshopCatalog: async () => ({ rows: [] }),
      listWorkshopStockDistributions: async () => ({ rows: [] }),
      listAdminData: async () => ({ categories: [] }),
      listCompletionApprovals: async () => ({ rows: [] }),
      listCompletionApprovalUploads: async () => ({ rows: [] })
    },
    state: { operationsManagement: { tab: 'instructors' } },
    rerender: () => {}
  };

  operationsManagementScreen.bind(context);

  assert.deepEqual(customButtons(screenRoot).map((button) => button.textContent.trim()), expectedTabs.map(([, label]) => label));
  assert.equal(screenRoot.querySelector('[data-ops-tab="workshops"]')?.textContent.trim(), 'מלאי סדנאות');

  operationsManagementScreen.bind(context);
  assert.equal(customButtons(screenRoot).length, 3);
  assert.deepEqual(customButtons(screenRoot).map((button) => button.dataset.opsCustomTab), expectedTabs.map(([key]) => key));

  for (const [tabKey] of expectedTabs) {
    const button = screenRoot.querySelector(`[data-ops-custom-tab="${tabKey}"]`);
    assert.ok(button, `missing ${tabKey}`);
    assert.doesNotThrow(() => button.click());
    assert.equal(button.classList.contains('is-active'), true, `${tabKey} should become active`);
    assert.match(screenRoot.querySelector('.ds-ops-mgmt-content')?.innerHTML || '', /ops2027-view|ops2027-empty|ops2027-table/);
    assert.equal(screenRoot.querySelector('[data-ops-tab="instructors"]')?.classList.contains('is-active'), false);
  }

  screenRoot.querySelector('[data-ops-tab="instructors"]')?.click();
  assert.equal(customButtons(screenRoot).some((button) => button.classList.contains('is-active')), false);
  } catch (error) {
    console.error(error?.stack || error);
    throw error;
  } finally {
    const { supabase } = await import('../frontend/src/supabase-client.js');
    supabase?.auth?.stopAutoRefresh?.();
    globalThis.window?.close?.();
  }
});

after(() => {
  setImmediate(() => process.exit(process.exitCode || 0));
});
