import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const entrySource = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../frontend/src/activity-performance-runtime.js', import.meta.url), 'utf8');
const completionRuntimeSource = await readFile(new URL('../frontend/src/completion-approval-performance-runtime.js', import.meta.url), 'utf8');
const monthNavigationSource = await readFile(new URL('../frontend/src/month-navigation-runtime.js', import.meta.url), 'utf8');
const dashboardMonthNavigationSource = await readFile(new URL('../frontend/src/dashboard-month-navigation-runtime.js', import.meta.url), 'utf8');
const progressiveWarmupSource = await readFile(new URL('../frontend/src/progressive-route-warmup.js', import.meta.url), 'utf8');
const dedupeSource = await readFile(new URL('../frontend/src/network-request-dedupe.js', import.meta.url), 'utf8');

test('performance guards load before the application bootstrap', () => {
  const dedupeIndex = entrySource.indexOf("import './network-request-dedupe.js';");
  const runtimeIndex = entrySource.indexOf("import './activity-performance-runtime.js';");
  const completionRuntimeIndex = entrySource.indexOf("import './completion-approval-performance-runtime.js';");
  const progressiveWarmupIndex = entrySource.indexOf("import './progressive-route-warmup.js';");
  const mainIndex = entrySource.indexOf("import './main.js';");
  const featureLoaderIndex = entrySource.indexOf("import './feature-route-loader.js';");
  assert.ok(dedupeIndex >= 0, 'network request dedupe must be imported');
  assert.ok(runtimeIndex > dedupeIndex, 'activity performance runtime must load after fetch dedupe');
  assert.ok(completionRuntimeIndex > runtimeIndex, 'completion approval guard must load after activity guard');
  assert.ok(progressiveWarmupIndex > completionRuntimeIndex, 'progressive route warmup must load after performance guards');
  assert.ok(mainIndex > progressiveWarmupIndex, 'all performance guards must load before main.js');
  assert.ok(featureLoaderIndex > mainIndex, 'feature route loader must load after main.js');
});

test('dashboard speculative activity screens stay blocked', () => {
  assert.match(runtimeSource, /DASHBOARD_PREFETCH_METHODS\s*=\s*\['week',\s*'month',\s*'endDates',\s*'archiveActivities'\]/);
  assert.match(runtimeSource, /dashboard_background_prefetch_skipped/);
  assert.match(runtimeSource, /__DS_PROGRESSIVE_ROUTE_WARMUP__ === true/);
  assert.match(runtimeSource, /&& !controlledSequentialWarmup/);
});

test('progressive warmup only preloads JS modules and never screen data', () => {
  assert.match(progressiveWarmupSource, /preloadScreenModule/);
  assert.match(progressiveWarmupSource, /__DS_DISABLE_SCREEN_DATA_WARMUP__\s*=\s*true/);
  assert.doesNotMatch(progressiveWarmupSource, /await\s+withTimeout\(screen\.load/);
  assert.doesNotMatch(progressiveWarmupSource, /screenDataCache\[/);
  assert.doesNotMatch(progressiveWarmupSource, /IDLE_WARM_ORDER/);
  assert.doesNotMatch(progressiveWarmupSource, /warmRoute\s*\(/);
  assert.match(progressiveWarmupSource, /querySelectorAll\('\[data-route\]\[disabled\]'\)/);
});

test('post-save activity refresh uses the patched in-memory snapshot', () => {
  assert.match(runtimeSource, /suppressFullRefreshUntil\s*=\s*Date\.now\(\)\s*\+\s*12_000/);
  assert.match(runtimeSource, /patchAllActivitySnapshots\(savedRow\)/);
  assert.match(runtimeSource, /Date\.now\(\)\s*<\s*suppressFullRefreshUntil\s*&&\s*snapshot/);
  assert.match(runtimeSource, /wrapMutation\('saveActivity'/);
});

test('completion approval list reads metadata without signing every storage object', () => {
  assert.match(completionRuntimeSource, /activity_completion_approval_uploads/);
  assert.match(completionRuntimeSource, /optimizedCompletionApprovalUploads/);
  assert.doesNotMatch(completionRuntimeSource, /createSignedUrl/);
  assert.match(completionRuntimeSource, /query\.in\('instructor_emp_id', identityValues\)/);
});

test('month navigation performs one bounded load and commits the target only after success', () => {
  assert.match(monthNavigationSource, /withTimeout\(api\.month\(\{ ym: targetYm \}\), 20000\)/);
  assert.match(monthNavigationSource, /returnedYm !== targetYm/);
  assert.match(monthNavigationSource, /state\.monthYm = targetYm/);
  assert.match(monthNavigationSource, /state\.monthYm = displayedYm/);
  assert.match(monthNavigationSource, /replaceButton\(root, '\[data-month-next\]'/);
  assert.doesNotMatch(monthNavigationSource, /adjYm|prefetch/);
});

test('dashboard navigation allows August 2026 and uses the period-aware cache key', () => {
  assert.match(dashboardMonthNavigationSource, /SCHOOL_2026_END_DATE\.slice\(0, 7\)/);
  assert.match(dashboardMonthNavigationSource, /dashboard:\$\{ym\}:period:\$\{bounds\.period\}/);
  assert.match(dashboardMonthNavigationSource, /api\.dashboardSnapshot\(\{ month: ym \}\)/);
  assert.match(dashboardMonthNavigationSource, /state\.dashboardMonthYm = targetYm/);
  assert.match(dashboardMonthNavigationSource, /event\.stopImmediatePropagation\(\)/);
  assert.doesNotMatch(dashboardMonthNavigationSource, /ym > now/);
});

test('identical Supabase reads are deduplicated without buffering response bodies', () => {
  assert.match(dedupeSource, /\['activities', 'activities'\]/);
});
