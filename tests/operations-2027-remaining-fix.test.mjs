import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const wrapperUrl = new URL('../frontend/src/screens/operations-authorities-cleanup.js', import.meta.url);
const baseUrl = new URL('../frontend/src/screens/operations-authorities-cleanup-base.js', import.meta.url);
const fixUrl = new URL('../frontend/src/screens/operations-2027-remaining-fix.js', import.meta.url);
const managementUrl = new URL('../frontend/src/screens/operations-management.js', import.meta.url);

const [wrapperSource, baseSource, fixSource, managementSource] = await Promise.all([
  readFile(wrapperUrl, 'utf8'),
  readFile(baseUrl, 'utf8'),
  readFile(fixUrl, 'utf8'),
  readFile(managementUrl, 'utf8')
]);

test('existing operations cleanup remains loaded before the focused 2027 fix', () => {
  assert.match(wrapperSource, /operations-authorities-cleanup-base\.js/);
  assert.match(wrapperSource, /operations-2027-remaining-fix\.js/);
  assert.match(baseSource, /data-ops-custom-tab/);
});

test('2027 workshop inventory data is loaded lazily by the workshops tab only', () => {
  assert.match(managementSource, /operationsTabDataKey\(tab\)/);
  assert.match(managementSource, /if \(key === TAB_WORKSHOPS\)/);
  assert.match(managementSource, /activity_period: ACTIVITY_SEASON_REGULAR, startDate: WORKSHOPS_SUMMER_FROM, endDate: WORKSHOPS_SUMMER_TO/);
  assert.match(managementSource, /activity_period: ACTIVITY_SEASON_SCHOOL_2027, startDate: SCHOOL_2027_FROM, endDate: SCHOOL_2027_TO/);
  assert.doesNotMatch(fixSource, /api\.allActivities\(\{\s*activity_period: ACTIVITY_SEASON_REGULAR/);
});

test('2027 opening stock is calculated in a data model rather than patched from DOM cells', () => {
  assert.match(managementSource, /export function buildWorkshopOpeningStock2027/);
  assert.match(managementSource, /const expectedBalance = group\.openingStock - usedQuantity - requiredQuantity/);
  assert.match(managementSource, /openingLocations/);
  assert.doesNotMatch(managementSource, /row\.cells\[[25]\]/);
  assert.doesNotMatch(fixSource, /const carryoverHtml = originalRender/);
});

test('2027 opening stock includes positive closing locations from the 2026 model', () => {
  assert.match(managementSource, /function positiveOpeningLocationsFromClosingRow/);
  assert.match(managementSource, /value <= 0/);
  assert.match(managementSource, /מיקום מלאי הפתיחה/);
  assert.match(managementSource, /title=\"מקור: יתרת הסגירה של קיץ 2026\"/);
});

test('2027 removes the period field and the two unsupported tabs only', () => {
  assert.match(fixSource, /HIDDEN_2027_TABS = new Set\(\['authorities', 'completion_approval'\]\)/);
  assert.match(fixSource, /periodControl\?\.closest\?\.\('\.ds-filter-field'\)\?\.remove/);
  assert.match(fixSource, /data-ops-year="2027"/);
  assert.match(fixSource, /state\.operationsManagement\.tab = 'instructors'/);
});
