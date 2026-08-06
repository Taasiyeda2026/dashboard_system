import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACT_SUBNAV_ITEMS,
  actNavGridHtml,
  headerNavGridHtml
} from '../frontend/src/screens/shared/act-nav-grid.js';

test('scheduling navigation appears between operations management and end dates', () => {
  const routes = ACT_SUBNAV_ITEMS.map((item) => item.route);
  const operationsIndex = routes.indexOf('operations-management');
  const schedulingIndex = routes.indexOf('course-scheduling');
  const endDatesIndex = routes.indexOf('end-dates');

  assert.ok(operationsIndex >= 0);
  assert.equal(schedulingIndex, operationsIndex + 1);
  assert.equal(endDatesIndex, schedulingIndex + 1);
  assert.equal(ACT_SUBNAV_ITEMS[schedulingIndex].label, 'שיבוצים');
});

test('scheduling button is rendered only when the route is authorized', () => {
  const authorizedState = {
    routes: ['activities', 'operations-management', 'course-scheduling', 'end-dates'],
    route: 'course-scheduling'
  };
  const unauthorizedState = {
    routes: ['activities', 'operations-management', 'end-dates'],
    route: 'activities'
  };

  const gridHtml = actNavGridHtml(authorizedState);
  assert.match(gridHtml, /data-act-subnav="course-scheduling"/);
  assert.match(gridHtml, />שיבוצים</);
  assert.match(gridHtml, /is-active/);

  const headerHtml = headerNavGridHtml(authorizedState);
  assert.match(headerHtml, /data-route="course-scheduling"/);
  assert.match(headerHtml, />שיבוצים</);

  assert.doesNotMatch(actNavGridHtml(unauthorizedState), /course-scheduling/);
  assert.doesNotMatch(headerNavGridHtml(unauthorizedState), /course-scheduling/);
});
