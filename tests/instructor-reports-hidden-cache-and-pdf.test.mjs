import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const main = file('frontend/src/main.js');
const shortcuts = file('frontend/src/screens/instructor-portal/dashboard.js');
const ux = file('frontend/src/instructor-portal-ux-runtime.js');
const feedback = file('frontend/src/screens/impact-feedback.js');
const feedbackCss = file('frontend/src/impact-feedback/impact-feedback-admin.css');
const sql = file('supabase/migrations/20261013081000_feedback_instructor_portal_pdf_placeholder.sql');
const dashboardHtml = file('index.html');
const dashboardCache = file('frontend/sw.js');
const attendanceHtml = file('attendance/index.html');
const attendanceCache = file('attendance/sw.js');
const config = file('frontend/src/config.js');

test('all instructor navigation surfaces hide legacy reports while keeping activities, feedback and attendance', () => {
  const routeList = main.slice(main.indexOf('function instructorOnlyRoutes()'), main.indexOf('const INSTRUCTOR_MOBILE_NAV'));
  const mobile = main.slice(main.indexOf('const INSTRUCTOR_MOBILE_NAV'), main.indexOf('function instructorBottomNavHtml'));
  const desktop = main.slice(main.indexOf('const instructorSidebarItems'), main.indexOf('const regularNav'));
  assert.doesNotMatch(routeList, /instructor-reports/);
  assert.doesNotMatch(mobile, /instructor-reports|דיווחים/);
  assert.doesNotMatch(desktop, /instructor-reports|דיווחים/);
  assert.doesNotMatch(shortcuts, /title: 'דיווחים'|route:instructor-reports/);
  assert.doesNotMatch(ux, /'דיווחים':/);
  for (const token of ['instructor-calendar', 'my-data', 'impact-feedback']) {
    assert.match(routeList, new RegExp(token));
  }
  assert.match(mobile, /נוכחות/);
  assert.match(desktop, /מערכת נוכחות/);
  assert.match(main, /route === 'instructor-reports' && String\(user\?\.role \|\| ''\)\.trim\(\) === 'instructor'/);
});

test('elementary PDF controls persist as disabled for missing files, enabled only for uploaded language', () => {
  assert.match(sql, /'paper_pdf_supported', \(p\.education_level = 'elementary'\)/);
  assert.match(feedback, /item\.paper_pdf_supported/);
  assert.match(feedback, /\['he', 'ar'\]\.map/);
  assert.match(feedback, /file \? '' : 'disabled'/);
  assert.match(feedback, /data-ifb-instr-pdf-lang/);
  assert.match(feedback, /downloadSavedPaperPdf\(file\)/);
  assert.match(feedbackCss, /\.ifb-pdf-action:disabled/);
  assert.match(feedbackCss, /cursor: not-allowed/);
  assert.match(feedback, /data-ifb-instr-copy/);
  assert.match(feedback, /data-ifb-instr-qr/);
});

test('both apps bump independent SW cache namespaces and all attendance resource URLs', () => {
  const dashboardVersion = Number(dashboardCache.match(/const CACHE_VERSION = (\d+);/)?.[1]);
  const attendanceVersion = Number(attendanceCache.match(/const CACHE_VERSION = (\d+);/)?.[1]);
  assert.ok(dashboardVersion > 2007);
  assert.ok(attendanceVersion > 116);
  assert.match(dashboardCache, /dashboard-static-v/);
  assert.match(attendanceCache, /attendance-static-v/);
  assert.match(config, /instructor-feedback-reports-v1/);
  assert.match(dashboardHtml, /main-with-proposal-pdf-hotfix\.js\?v=[A-Za-z0-9-]+/);
  assert.match(dashboardHtml, /instructor-portal-ux-runtime\.js\?v=[A-Za-z0-9-]+/);
  assert.match(dashboardHtml, /instructor-portal-responsive\.css\?v=[A-Za-z0-9-]+/);
  assert.match(dashboardHtml, /styles\/main\.css\?v=[A-Za-z0-9-]+/);
  const assetVersions = [...attendanceHtml.matchAll(/(?:src|href)="\.\/[^"]+\?v=(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(assetVersions.length > 25);
  assert.ok(assetVersions.every((v) => v === attendanceVersion));
  assert.doesNotMatch(attendanceHtml, /\?v=116/);
});
