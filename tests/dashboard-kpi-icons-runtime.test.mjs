import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DASHBOARD_KPI_ICON_BODIES,
  dashboardKpiIconSvg
} from '../frontend/src/dashboard-kpi-icons-runtime.js';

const expectedActions = [
  'kpi|active_courses',
  'kpi|active_workshops',
  'kpi|active_escape_room',
  'kpi|active_tours',
  'kpi|active_after_school',
  'kpi|endings',
  'kpi|instructors',
  'kpi|exceptions'
];

test('dashboard KPI icons use the approved symbols and one visual system', () => {
  assert.deepEqual(Object.keys(DASHBOARD_KPI_ICON_BODIES), expectedActions);

  expectedActions.forEach((action) => {
    const svg = dashboardKpiIconSvg(action);
    assert.match(svg, /width="22" height="22"/);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /fill="none"/);
    assert.match(svg, /stroke="currentColor"/);
    assert.match(svg, /stroke-width="2"/);
    assert.match(svg, /stroke-linecap="round"/);
    assert.match(svg, /stroke-linejoin="round"/);
  });

  assert.match(DASHBOARD_KPI_ICON_BODIES['kpi|active_courses'], /M12 7v14/); // open book
  assert.match(DASHBOARD_KPI_ICON_BODIES['kpi|active_workshops'], /circle cx="12" cy="12" r="3"/); // gear
  assert.match(DASHBOARD_KPI_ICON_BODIES['kpi|active_escape_room'], /rect x="5" y="11" width="14" height="10"/); // lock
  assert.match(DASHBOARD_KPI_ICON_BODIES['kpi|active_tours'], /M3 21V10l6 3v-3l6 3V4h6v17H3z/); // factory
  assert.match(DASHBOARD_KPI_ICON_BODIES['kpi|active_after_school'], /polyline points="12 7 12 12 16 14"/); // clock
  assert.match(DASHBOARD_KPI_ICON_BODIES['kpi|endings'], /polyline points="8 12 11 15 16 9"/); // completion check
  assert.match(DASHBOARD_KPI_ICON_BODIES['kpi|instructors'], /circle cx="9" cy="7" r="4"/); // users
  assert.match(DASHBOARD_KPI_ICON_BODIES['kpi|exceptions'], /M10\.29 3\.86/); // warning
});

test('dashboard bootstrap loads the icon runtime with a cache-busting version', async () => {
  const bootstrap = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
  assert.match(bootstrap, /dashboard-kpi-icons-runtime\.js\?v=20260913-v1/);
});
