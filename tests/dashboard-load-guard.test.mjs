import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const DASHBOARD_FILE = new URL('../frontend/src/screens/dashboard.js', import.meta.url);
const CONFIG_FILE    = new URL('../frontend/src/config.js',             import.meta.url);
const MAIN_FILE      = new URL('../frontend/src/main.js',               import.meta.url);

async function read(url) { return readFile(url, 'utf8'); }

test('dashboard load wraps api call with a timeout guard', async () => {
  const src = await read(DASHBOARD_FILE);
  assert.match(src, /DASHBOARD_LOAD_GUARD_MS/,
    'should define DASHBOARD_LOAD_GUARD_MS constant');
  assert.match(src, /Promise\.race\(/,
    'should use Promise.race to race against timeout');
  assert.match(src, /guardPromise/,
    'should have a guardPromise timeout sentinel');
  assert.match(src, /clearTimeout\(guardTimer\)/,
    'should clear the guard timer on success and failure');
});

test('dashboard load releases loading on API failure with Hebrew error message', async () => {
  const src = await read(DASHBOARD_FILE);
  assert.match(src, /DASHBOARD_LOAD_ERROR_HE/,
    'should define a Hebrew error constant');
  assert.match(src, /לא ניתן לטעון את לוח הבקרה כרגע/,
    'should contain the specific Hebrew error message');
  assert.match(src, /throw new Error\(DASHBOARD_LOAD_ERROR_HE\)/,
    'should throw the Hebrew error on failure so loading is released');
});

test('dashboard load logs perf data on success', async () => {
  const src = await read(DASHBOARD_FILE);
  assert.match(src, /action:\s*['"]dashboardSnapshot['"]/,
    'should log action=dashboardSnapshot');
  assert.match(src, /duration_ms/,
    'should log duration_ms');
  assert.match(src, /fallback_used/,
    'should log fallback_used');
  assert.match(src, /snapshot_fallback_reason/,
    'should log snapshot_fallback_reason');
});

test('dashboard load logs perf data on failure', async () => {
  const src = await read(DASHBOARD_FILE);
  assert.match(src, /console\.warn\(\s*'\[dashboard-load\] failed'/,
    'should warn on failure');
  assert.match(src, /is_timeout/,
    'should log is_timeout field on failure');
});

test('config.js DEFAULT_API_URL matches the active GAS deployment', async () => {
  const src = await read(CONFIG_FILE);
  assert.match(src, /AKfycbyxuO4hGXwAvMsR4tljCy-ADBApSY3c6YPWXc17DAzgjzV7-rjgLzir08XvPUN6BGUu/,
    'DEFAULT_API_URL should use the current active GAS deployment URL');
});

test('main.js catch block releases loading on any screen error', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /setShellNavBusy\(false\)/,
    'should call setShellNavBusy(false) to release loading spinner');
  const finallyBlock = src.match(/\} finally \{[\s\S]*?setShellNavBusy\(false\)/);
  assert.ok(finallyBlock,
    'setShellNavBusy(false) must be in finally block so it runs even on error');
});

test('main.js adds a route-level load timeout guard with Hebrew fallback error', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /ROUTE_LOAD_GUARD_MS\s*=\s*25000/,
    'should define a 25s route-level load guard');
  assert.match(src, /Promise\.race\(\[loadScreenDataWithCache\(screen\), routeLoadGuard\]\)/,
    'should race route data loading against a timeout guard');
  assert.match(src, /טעינת המסך נמשכת זמן רב מדי\. נסו לרענן או להיכנס שוב\./,
    'should show a clear Hebrew timeout message instead of infinite loading');
});

test('main.js route load failures clean inflight requests and log lifecycle', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /inflightRequests\.delete\(cacheKey\)/,
    'should cleanup inflight request on failure/timeout');
  assert.match(src, /console\.info\('\[route-load:start\]'/,
    'should log route load start');
  assert.match(src, /console\.info\('\[route-load:success\]'/,
    'should log route load success');
  assert.match(src, /console\.warn\('\[route-load:failed\]'/,
    'should log route load failure');
});

test('translateApiErrorForUser passes through Hebrew error messages unchanged', async () => {
  const src = await read(
    new URL('../frontend/src/screens/shared/ui-hebrew.js', import.meta.url)
  );
  assert.match(src, /\\u0590-\\u05FF.*return raw/s,
    'translateApiErrorForUser should return Hebrew strings as-is so dashboard error message is shown verbatim');
});


test('main.js emits route-render lifecycle logs for dashboard rendering', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /console\.info\('\[route-render:start\]'/,
    'should log route-render start');
  assert.match(src, /console\.info\('\[route-render:success\]'/,
    'should log route-render success');
  assert.match(src, /console\.warn\('\[route-render:failed\]'/,
    'should log route-render failure');
});

test('main.js fail-safe retries render and replaces stuck loading with Hebrew error', async () => {
  const src = await read(MAIN_FILE);
  assert.match(src, /if \(text === 'טוען נתונים\.\.\.' && data && typeof data === 'object'\)/,
    'should detect loading text stuck after successful data load');
  assert.match(src, /\[route-render:retry\]/,
    'should log a retry attempt when loading is stuck');
  assert.match(src, /throw new Error\('render_stuck_on_loading'\)/,
    'should fail explicitly if loading text is still stuck after retry');
  assert.match(src, /שגיאה בהצגת המסך/,
    'should show Hebrew render error fallback instead of leaving loading state');
});
