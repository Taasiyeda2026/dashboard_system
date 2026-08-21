import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runtime = fs.readFileSync(new URL('../frontend/src/dashboard-drilldown-runtime.js', import.meta.url), 'utf8');
const bootstrap = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const sw = fs.readFileSync(new URL('../frontend/sw.js', import.meta.url), 'utf8');

test('dashboard drilldown keeps destination pages aligned with the selected month', () => {
  assert.match(runtime, /dashboardRowOccursInMonth/);
  assert.match(runtime, /date_\$\{index\}/);
  assert.match(runtime, /data\.rows\.filter\(\(row\) => monthlyDashboardRow\(row, drill\.month\)\)/);
  assert.match(runtime, /end_date \|\| row\?\.date_end/);
  assert.match(runtime, /slice\(0, 7\) === drill\.month/);
});

test('activity type KPI drilldowns keep the correct long or short family', () => {
  assert.match(runtime, /SHORT_ACTIVITY_TYPES = new Set\(\['workshop', 'tour', 'escape_room'\]\)/);
  assert.match(runtime, /\['kpi\|active_workshops', 'workshop'\]/);
  assert.match(runtime, /\['kpi\|active_tours', 'tour'\]/);
  assert.match(runtime, /\['kpi\|active_escape_room', 'escape_room'\]/);
  assert.match(runtime, /activityQuickFamily = family/);
  assert.match(runtime, /activity_type: type/);
});

test('district KPI drilldowns filter instructors and exceptions by the same district', () => {
  assert.match(runtime, /normalizeOperationalDistrict\(row\?\.district \|\| row\?\.activity_manager\) === drill\.district/);
  assert.match(runtime, /api\.allActivities\(\{ activity_period: drill\.period \}\)/);
  assert.match(runtime, /if \(district === 'צפון'\) return 'מחוז צפון'/);
  assert.match(runtime, /if \(district === 'מרכז'\) return 'מחוז מרכז'/);
  assert.match(runtime, /if \(district === 'דרום'\) return 'מחוז דרום'/);
});

test('dashboard drilldown runtime is deployed with a fresh service worker cache', () => {
  assert.match(bootstrap, /dashboard-drilldown-runtime\.js\?v=20260821-v1/);
  assert.match(sw, /const CACHE_VERSION = 1585;/);
});
