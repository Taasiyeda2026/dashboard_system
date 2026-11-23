import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const file = (path) => readFile(new URL('../' + path, import.meta.url), 'utf8');

test('instructor mobile nav starts with calendar, attendance, feedback in RTL order', async () => {
  const main = await file('frontend/src/main.js');
  const nav = main.slice(main.indexOf('const INSTRUCTOR_MOBILE_NAV = ['), main.indexOf('function instructorBottomNavHtml'));
  const labels = [...nav.matchAll(/short: '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(labels.slice(0, 3), ['לוח שנה', 'נוכחות', 'משובים']);
  assert.deepEqual(labels.slice(3), ['פעילויות', 'אישורים', 'מצגות', 'בית']);
  assert.equal(new Set(labels).size, labels.length);
  assert.match(nav, /short: 'נוכחות'.*externalUrl: config\.instructorAttendanceUrl/);
  assert.match(nav, /short: 'מצגות'.*externalUrlBlank: config\.instructorPresentationsUrl/);
});

test('all instructor tabs render an icon and none of the mobile external destinations is hidden', async () => {
  const runtime = await file('frontend/src/instructor-portal-ux-runtime.js');
  const css = await file('frontend/src/styles/instructor-portal-responsive.css');
  for (const name of ['בית', 'פעילויות', 'לוח שנה', 'נוכחות', 'משובים', 'אישורים', 'מצגות']) {
    assert.match(runtime, new RegExp(`'${name}': '<svg`));
  }
  assert.doesNotMatch(runtime, /\.instructor-bottom-nav__btn\[data-external-url/);
  assert.match(css, /\.instructor-bottom-nav__icon\s*\{[^}]*font-size:\s*18px/s);
});

test('dashboard service worker and instructor nav script updated together', async () => {
  const index = await file('index.html');
  const sw = await file('frontend/sw.js');
  assert.match(index, /instructor-portal-ux-runtime\.js\?v=20261123-instructor-mobile-nav-order-icons-v1/);
  assert.match(sw, /const CACHE_VERSION = 2132/);
});
