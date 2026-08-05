import test from 'node:test';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
global.sessionStorage = dom.window.sessionStorage;
global.Element = dom.window.Element;
global.HTMLElement = dom.window.HTMLElement;
after(() => { dom.window.close(); setImmediate(() => process.exit(0)); });
const {
  operationsManagementScreen,
  loadOperationsTabData,
  createOperations2027DataManager,
  operationTrainingCellState,
  buildPrintKitSummary2027
} = await import('../frontend/src/screens/operations-management.js');

function trackedApi(calls, overrides = {}) {
  const hit = (name, value) => async () => { calls.push(name); return value; };
  return {
    allActivities: hit('allActivities', { rows: [] }),
    adminLists: hit('adminLists', { categories: [] }),
    workshopStockDistributions: hit('workshopStockDistributions', { rows: [] }),
    instructorSchedulePrintContacts: hit('instructorSchedulePrintContacts', { rows: [] }),
    completionApprovalUploads: hit('completionApprovalUploads', { rows: [] }),
    schoolContactResponsibles: hit('schoolContactResponsibles', { rows: [] }),
    photoApprovalUploads: hit('photoApprovalUploads', { rows: [] }),
    activeInstructors: hit('activeInstructors', []),
    courseCatalog: hit('courseCatalog', []),
    workshopCatalog: hit('workshopCatalog', []),
    workshopInventory: hit('workshopInventory', []),
    workshopTrainings: hit('workshopTrainings', []),
    courseTrainings: hit('courseTrainings', []),
    printKitInventory: hit('printKitInventory', []),
    printKitDistributions: hit('printKitDistributions', []),
    permissions: hit('permissions', true),
    ...overrides
  };
}

test('schedule entry does not load training or print kit datasets', async () => {
  const calls = [];
  const data = await operationsManagementScreen.load({
    api: trackedApi(calls),
    state: { activityPeriodTab: 'school_2027', operationsManagement: { tab: 'instructors' } }
  });
  assert.deepEqual(calls, ['allActivities']);
  assert.equal(data.schoolsDirectorySource, 'deferred');
  assert.deepEqual(data._loadedOperationsTabs, ['schedule']);
});

test('first tab entry loads only that tab and repeated entry uses memory cache', async () => {
  const calls = [];
  const manager = createOperations2027DataManager(trackedApi(calls));
  await loadOperationsTabData(trackedApi(calls), 'course_training_matrix', manager);
  await loadOperationsTabData(trackedApi(calls), 'course_training_matrix', manager);
  assert.deepEqual(calls.sort(), ['activeInstructors', 'allActivities', 'courseCatalog', 'courseTrainings', 'permissions'].sort());
});

test('parallel tab reads share the same pending promise', async () => {
  const calls = [];
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const api = trackedApi(calls, {
    courseCatalog: async () => { calls.push('courseCatalog'); await pending; return []; }
  });
  const manager = createOperations2027DataManager(api);
  const first = manager.loadCourseCatalog();
  const second = manager.loadCourseCatalog();
  assert.equal(manager.status('courseCatalog'), 'loading');
  release();
  assert.equal(await first, await second);
  assert.deepEqual(calls, ['courseCatalog']);
});

test('leaving operations screen clears the in-memory cache', async () => {
  const calls = [];
  const manager = createOperations2027DataManager(trackedApi(calls));
  await manager.loadActiveInstructors();
  assert.equal(manager.status('activeInstructors'), 'loaded');
  manager.clear();
  assert.equal(manager.status('activeInstructors'), 'not_loaded');
  await manager.loadActiveInstructors();
  assert.deepEqual(calls, ['activeInstructors', 'activeInstructors']);
});

test('training cell states preserve historical training and assignments', () => {
  assert.deepEqual(operationTrainingCellState({ trained: true, assigned: false }), { symbol: '✓', className: 'is-yes', label: 'עבר הכשרה' });
  assert.deepEqual(operationTrainingCellState({ trained: false, assigned: true }), { symbol: '✕', className: 'is-no', label: 'משובץ ללא הכשרה' });
  assert.deepEqual(operationTrainingCellState({ trained: false, assigned: false }), { symbol: '', className: 'is-empty', label: '' });
});

test('inactive instructors are hidden from training rows without deleting historical facts', () => {
  const instructors = [{ full_name: 'פעיל', active: 'yes' }, { full_name: 'לא פעיל', active: 'no' }];
  const activeOnly = instructors.filter((row) => ['yes', true, 'פעיל'].includes(row.active)).map((row) => row.full_name);
  const historical = [{ instructor_name: 'לא פעיל', course_id: 'c1', is_trained: true }];
  assert.deepEqual(activeOnly, ['פעיל']);
  assert.equal(historical.length, 1);
});

test('print kit total includes central stock and active/inactive instructor distributions once', () => {
  const [kit] = buildPrintKitSummary2027({
    courses: [{ id: 'escape', short_name: 'ביומימיקרי חדר בריחה', requires_print_kit: true, is_active: false }],
    inventoryRows: [{ course_id: 'escape', warehouse_quantity: 2, hila_quantity: 1, idan_quantity: 1, gil_quantity: 0 }],
    activeInstructors: [{ full_name: 'הילה', active: 'yes' }],
    distributionRows: [
      { course_id: 'escape', instructor_name: 'הילה' },
      { course_id: 'escape', instructor_name: 'הילה' },
      { course_id: 'escape', instructor_name: 'מדריך לא פעיל' }
    ],
    activities2027: []
  });
  assert.equal(kit.total, 6);
  assert.equal(kit.activeHeld, 1);
  assert.equal(kit.inactiveHeld, 1);
  assert.equal(kit.status, 'ללא שיבוצים');
});

test('print kit assignment states do not create red X for unassigned non-holder', () => {
  assert.equal(operationTrainingCellState({ trained: false, assigned: false }).symbol, '');
  assert.equal(operationTrainingCellState({ trained: false, assigned: true }).symbol, '✕');
  assert.equal(operationTrainingCellState({ trained: true, assigned: false }).symbol, '✓');
});

test('Biomimicry escape room kit remains listed regardless of active course status', () => {
  const summary = buildPrintKitSummary2027({
    courses: [
      { id: 'regular', short_name: 'ביומימיקרי', requires_print_kit: false, is_active: true },
      { id: 'escape', short_name: 'ביומימיקרי חדר בריחה', requires_print_kit: true, is_active: false }
    ]
  });
  assert.deepEqual(summary.map((row) => row.course.short_name), ['ביומימיקרי חדר בריחה']);
});
