import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../frontend/src/styles/instructor-portal-responsive.css', import.meta.url), 'utf8');
const runtime = await readFile(new URL('../frontend/src/instructor-portal-ux-runtime.js', import.meta.url), 'utf8');
const activities = await readFile(new URL('../frontend/src/screens/instructor-portal/my-activities.js', import.meta.url), 'utf8');
const calendar = await readFile(new URL('../frontend/src/screens/instructor-portal/calendar.js', import.meta.url), 'utf8');
const approvals = await readFile(new URL('../frontend/src/screens/instructor-completion-approvals.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const mobileContract = await readFile(new URL('../frontend/src/styles/instructor-mobile-contract.css', import.meta.url), 'utf8');
const drawerHotfixCss = await readFile(new URL('../frontend/src/styles/instructor-portal-drawer-hotfix.css', import.meta.url), 'utf8');

test('instructor responsive layer is scoped and loaded after shared dashboard styles', () => {
  assert.match(css, /\.app-shell--instructor/);
  assert.match(css, /\.instructor-area/);
  assert.doesNotMatch(css, /^\s*\.ds-table\s*\{/m);
  const sharedIndex = index.indexOf('manager-board-team-strip-inline-fix.css');
  const instructorIndex = index.indexOf('instructor-portal-responsive.css?v=20260922-mobile-contract-v1');
  assert.notEqual(instructorIndex, -1);
  assert.ok(instructorIndex > sharedIndex);
  assert.match(index, /instructor-portal-ux-runtime\.js\?v=20260913-instructor-responsive-v1/);
});

test('instructor activities are a compact summary and keep full details in the shared drawer', () => {
  const headings = ['תאריך', 'שעות', 'בית ספר', 'רשות', 'פעילות'];
  headings.forEach((heading) => assert.match(activities, new RegExp(`<th>${heading}<\\/th>`)));
  assert.doesNotMatch(activities, /<th>שכבה<\/th>|<th>סטטוס<\/th>|<th>איש קשר<\/th>|<th>פעולה<\/th>|data-portal-open|portal-activity-open/);
  assert.doesNotMatch(activities, /פתיחת פרטים/);
  assert.match(activities, /portal-activity-card__summary/);
  assert.match(activities, /openInstructorActivityDrawer/);
  assert.match(css, /portal-activities-desktop th:nth-child\(5\)[\s\S]*width:\s*26%/);
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
  assert.match(css, /\.app-shell--instructor \.instructor-activity-drawer-shell \.activity-drawer-inline__body[\s\S]*padding:\s*8px 10px\s*!important/);
  assert.match(css, /\.app-shell--instructor \.instructor-activity-drawer-shell \.activity-drawer-inline__core,[\s\S]*margin:\s*0 0 6px\s*!important/);
  assert.match(css, /data-activity-layout="workshop"\] \[data-field-key="participants"\][\s\S]*grid-column:\s*auto\s*!important/);
  assert.match(css, /activity-drawer-inline__support > :only-child[\s\S]*grid-column:\s*1 \/ -1/);
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*data-activity-layout="workshop"\][\s\S]*grid-template-columns:\s*1fr/);
});

test('dashboard monthly summary is unboxed and uses the current accent divider', async () => {
  const dashboard = await readFile(new URL('../frontend/src/screens/instructor-portal/dashboard.js', import.meta.url), 'utf8');
  assert.match(dashboard, /summary\.total/);
  assert.match(dashboard, /summary\.types/);
  assert.doesNotMatch(dashboard, /dsKpiGrid/);
  assert.match(css, /instructor-portal-monthly-summary[\s\S]*margin:\s*0/);
  assert.match(css, /instructor-portal-summary-divider[\s\S]*background:\s*var\(--ds-accent\)/);
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


test('final instructor mobile contract enforces touch-first full-width layouts', () => {
  assert.match(index, /instructor-mobile-contract\.css\?v=20260922-mobile-contract-v1/);
  assert.ok(index.indexOf('instructor-mobile-contract.css') > index.indexOf('instructor-portal-drawer-hotfix.css'));
  assert.match(mobileContract, /@media \(max-width: 959px\)/);
  assert.match(mobileContract, /overflow-x:\s*hidden/);
  assert.match(mobileContract, /course-schedule-desktop[\s\S]*display:\s*none\s*!important/);
  assert.match(mobileContract, /course-schedule-mobile[\s\S]*display:\s*grid\s*!important/);
  assert.match(mobileContract, /instructor-portal-shortcuts[\s\S]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(mobileContract, /min-height:\s*44px/);
  assert.match(mobileContract, /font-size:\s*16px\s*!important/);
  assert.match(mobileContract, /ds-drawer:has\(\.instructor-activity-drawer-shell\)[\s\S]*width:\s*100vw\s*!important/);
  assert.match(mobileContract, /has-instructor-attendance::after[\s\S]*#0f9f96/);
  assert.doesNotMatch(mobileContract, /#e07a2f|#b86428|#9a4f18/);
  assert.doesNotMatch(css, /#e07a2f|rgba\(224,\s*122,\s*47/);
  assert.doesNotMatch(drawerHotfixCss, /#e07a2f/);
});
