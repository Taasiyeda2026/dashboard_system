import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../frontend/src/styles/instructor-portal-responsive.css', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../frontend/src/instructor-portal-ux-runtime.js', import.meta.url), 'utf8');
const activities = await readFile(new URL('../frontend/src/screens/instructor-portal/my-activities.js', import.meta.url), 'utf8');
const calendar = await readFile(new URL('../frontend/src/screens/instructor-portal/calendar.js', import.meta.url), 'utf8');
const approvals = await readFile(new URL('../frontend/src/screens/instructor-completion-approvals.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');

test('instructor responsive layer is scoped and loaded after shared dashboard styles', () => {
  assert.match(css, /\.app-shell--instructor/);
  assert.match(css, /\.instructor-area/);
  assert.doesNotMatch(css, /^\s*\.ds-table\s*\{/m);
  const sharedIndex = index.indexOf('manager-board-team-strip-inline-fix.css');
  const instructorIndex = index.indexOf('instructor-portal-responsive.css?v=20260913-instructor-dashboard-fixes-v3');
  assert.notEqual(instructorIndex, -1);
  assert.ok(instructorIndex > sharedIndex);
  assert.match(index, /instructor-portal-ux-runtime\.js\?v=20260913-instructor-responsive-v1/);
});

test('instructor activities are a compact summary and keep full details in the shared drawer', () => {
  const headings = ['תאריך', 'שעות', 'בית ספר', 'רשות', 'פעילות', 'פעולה'];
  headings.forEach((heading) => assert.match(activities, new RegExp(`<th>${heading}<\\/th>`)));
  assert.doesNotMatch(activities, /<th>שכבה<\/th>|<th>סטטוס<\/th>|<th>איש קשר<\/th>/);
  assert.doesNotMatch(activities, /פתיחת פרטים/);
  assert.match(activities, /portal-activity-card__summary/);
  assert.match(activities, /openInstructorActivityDrawer/);
  assert.match(activities, /data-portal-open/);
});

test('instructor calendar remains seven columns and reuses the shared instructor activity drawer', () => {
  assert.match(css, /grid-template-columns:\s*repeat\(7,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /route-instructor-calendar \.ds-cal-wrap[\s\S]*overflow-x:\s*hidden/);
  assert.match(runtime, /is-instructor-today/);
  assert.match(runtime, /aria-current', 'date'/);
  assert.doesNotMatch(calendar, /instr-calendar-activity-accordion/);
  assert.match(calendar, /api\.activityDetail/);
  assert.match(calendar, /openInstructorActivityDrawer/);
  assert.match(css, /has-instructor-attendance::after/);
  assert.match(css, /has-instructor-activity\.has-instructor-attendance::after/);
  assert.match(css, /has-instructor-activity\.has-instructor-attendance::after[\s\S]*width:\s*25px[\s\S]*radial-gradient\(circle at 4\.5px 4\.5px[\s\S]*radial-gradient\(circle at 20\.5px 4\.5px[\s\S]*box-shadow:\s*none/);
  assert.match(css, /has-instructor-attendance::after[\s\S]*inset-inline-start:\s*8px[\s\S]*inset-block-end:\s*8px/);
  const combinedIndicatorRule = css.match(/has-instructor-activity\.has-instructor-attendance::after\s*\{[^}]+\}/)?.[0] || '';
  assert.match(combinedIndicatorRule, /border-radius:\s*0/);
  assert.doesNotMatch(combinedIndicatorRule, /16px 0/);
});

test('instructor course and workshop drawers share compact role-scoped spacing', () => {
  assert.match(css, /\.app-shell--instructor \.instructor-activity-drawer-shell[\s\S]+gap:\s*5px/);
  assert.match(css, /\.app-shell--instructor \.instructor-activity-drawer-shell \.activity-drawer__section[\s\S]+padding:\s*7px 9px/);
  assert.doesNotMatch(css, /^\s*\.instructor-activity-drawer-shell \.activity-drawer__(?:section|body|form|field)\s*\{/m);
});

test('persistent instructor navigation is reduced to four core destinations with vector icons', () => {
  assert.match(runtime, /shell-sidebar--instructor \.shell-nav__btn\[data-external-url\]/);
  assert.match(runtime, /instructor-bottom-nav__btn\[data-external-url\]/);
  assert.match(runtime, /NAV_ICONS/);
  for (const label of ['בית', 'פעילויות', 'לוח שנה', 'דיווחים']) assert.match(runtime, new RegExp(`'${label}'`));
});

test('completion approvals keep the shared print/status mechanism and render as a compact checklist', () => {
  assert.match(approvals, /buildCompletionApprovals/);
  assert.match(approvals, /openApprovalPrintWindow/);
  assert.match(approvals, /completionApprovalStatusInfo/);
  assert.match(approvals, /ds-table--instr-approvals2/);
  for (const heading of ['תאריך', 'בית ספר', 'כמות פעילויות', 'אישור ביצוע', 'סטטוס', 'פעולה']) assert.match(approvals, new RegExp(`<th>${heading}<\\/th>`));
  assert.match(css, /instructor-area--approvals \.instr-summary-grid[\s\S]*display:\s*none/);
  assert.match(css, /instructor-area--approvals[\s\S]*840px/);
});
