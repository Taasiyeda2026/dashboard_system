import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const baseUrl = new URL('../frontend/src/screens/operations-authorities-cleanup-base.js', import.meta.url);
const fixUrl = new URL('../frontend/src/screens/operations-2027-remaining-fix.js', import.meta.url);

const [wrapperSource, baseSource, fixSource] = await Promise.all([
  readFile(wrapperUrl, 'utf8'),
  readFile(baseUrl, 'utf8'),
  readFile(fixUrl, 'utf8')
]);

test('existing operations cleanup remains loaded before the focused 2027 fix', () => {
  assert.match(wrapperSource, /operations-authorities-cleanup-base\.js/);
  assert.match(wrapperSource, /operations-2027-remaining-fix\.js/);
  assert.match(baseSource, /data-ops-custom-tab/);
});

test('2027 opening stock rows are always loaded from the complete 2026 period', () => {
  assert.match(fixSource, /operationsManagementScreen\.load/);
  assert.match(fixSource, /activity_period: ACTIVITY_SEASON_REGULAR/);
  assert.match(fixSource, /startDate: WORKSHOPS_2026_FROM/);
  assert.match(fixSource, /workshopInventorySourceRows = Array\.isArray\(response\?\.rows\)/);
});

test('2027 opening stock is separated from current-year usage and forecast', () => {
  assert.match(fixSource, /const carryoverHtml = originalRender/);
  assert.match(fixSource, /workshopInventorySourceRows: Array\.isArray\(data\?\.rows\) \? data\.rows : \[\]/);
  assert.match(fixSource, /const expected = opening - used - required/);
  assert.match(fixSource, /row\.cells\[2\]\.textContent = displayNumber\(opening\)/);
  assert.match(fixSource, /row\.cells\[5\]\.textContent = displayNumber\(expected\)/);
});

test('2027 opening stock includes the positive closing balance at every 2026 location', () => {
  assert.match(fixSource, /function closingLocationsByGroup/);
  assert.match(fixSource, /data-workshop-detail/);
  assert.match(fixSource, /ds-ops-dist-table--instructors/);
  assert.match(fixSource, /balance === null \|\| balance <= 0/);
  assert.match(fixSource, /מיקום המלאי בסוף 2026/);
  assert.match(fixSource, /addOpeningLocationColumn\(template, locationsByGroup\)/);
  assert.match(fixSource, /colspan', '8'/);
});

test('2027 removes the period field and the two unsupported tabs only', () => {
  assert.match(fixSource, /HIDDEN_2027_TABS = new Set\(\['authorities', 'completion_approval'\]\)/);
  assert.match(fixSource, /periodControl\?\.closest\?\.\('\.ds-filter-field'\)\?\.remove/);
  assert.match(fixSource, /data-ops-year="2027"/);
  assert.match(fixSource, /state\.operationsManagement\.tab = 'instructors'/);
});
