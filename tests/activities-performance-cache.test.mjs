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
const { activityRowsForPeriodAndMonth } = await import('../frontend/src/screens/activities.js');

test('activity period/month derivation reuses results until rows or selection changes', () => {
  const rows = [
    { RowID: 'R', status: 'פתוח', activity_season: 'regular', start_date: '2026-05-01' },
    { RowID: 'A', status: 'פתוח', activity_season: 'summer_2026', start_date: '2026-07-01' },
    { RowID: 'B', status: 'פתוח', activity_season: 'summer_2026', start_date: '2026-08-01' }
  ];
  const julyState = { activityPeriodTab: 'regular', activitiesInnerTab: 'summer_2026', activitiesMonthYm: '2026-07' };
  const first = activityRowsForPeriodAndMonth(rows, julyState);
  const repeated = activityRowsForPeriodAndMonth(rows, julyState);
  const regular = activityRowsForPeriodAndMonth(rows, { ...julyState, activitiesInnerTab: 'regular_2026' });
  const replacement = activityRowsForPeriodAndMonth(rows.slice(), julyState);

  assert.strictEqual(repeated, first);
  assert.notStrictEqual(regular, first);
  assert.notStrictEqual(replacement, first);
  assert.deepEqual(first.map((row) => row.RowID), ['A', 'B']);
  assert.deepEqual(regular.map((row) => row.RowID), ['R']);
});
