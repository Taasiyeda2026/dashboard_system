import test from 'node:test';
import assert from 'node:assert/strict';

const {
  WORKSHOP_STOCK_LOCATION_NAMES,
  isWorkshopStockLocationName,
  workshopHolderStatusLabel
} = await import('../frontend/src/screens/workshop-stock-location-status.js');

test('stock locations are not instructors', () => {
  assert.deepEqual([...WORKSHOP_STOCK_LOCATION_NAMES], ['מלאי עידן', 'מלאי הילה', 'מלאי גיל']);
  for (const name of WORKSHOP_STOCK_LOCATION_NAMES) assert.equal(isWorkshopStockLocationName(name), true);
  assert.equal(isWorkshopStockLocationName('ישראל ישראלי'), false);
});

test('stock location status labels use inventory language', () => {
  assert.equal(workshopHolderStatusLabel('מלאי עידן', 200), 'יתרה במלאי');
  assert.equal(workshopHolderStatusLabel('מלאי הילה', 0), 'אזל מהמלאי');
  assert.equal(workshopHolderStatusLabel('מלאי גיל', -4), 'חוסר במלאי');
});

test('instructor status labels stay instructor-specific', () => {
  assert.equal(workshopHolderStatusLabel('ישראל ישראלי', 3), 'יתרה אצל מדריך');
  assert.equal(workshopHolderStatusLabel('ישראל ישראלי', 0), 'אין יתרה אצל מדריך');
  assert.equal(workshopHolderStatusLabel('ישראל ישראלי', -2), 'חוסר אצל מדריך');
});
