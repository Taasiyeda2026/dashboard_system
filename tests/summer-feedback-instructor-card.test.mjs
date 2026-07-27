import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const integrationSource = readFileSync(
  new URL('../frontend/src/summer-feedback-instructor-card.js', import.meta.url),
  'utf8'
);
const dashboardEnhancer = readFileSync(
  new URL('../frontend/src/dashboard-kpi-corrections.js', import.meta.url),
  'utf8'
);

globalThis.__SUMMER_FEEDBACK_INSTRUCTOR_CARD_TEST__ = true;
const navModule = await import(
  `${new URL('../frontend/src/summer-feedback-instructor-card.js', import.meta.url).href}?test=${Date.now()}`
);

test('summer feedback sidebar eligibility is based on authenticated assignment and not dashboard role', () => {
  assert.ok(dashboardEnhancer.includes("import './summer-feedback-instructor-card.js';"));
  assert.ok(integrationSource.includes(".from('summer_feedback_assignments')"));
  assert.ok(integrationSource.includes(".eq('instructor_auth_user_id', userId)"));
  assert.ok(integrationSource.includes(".eq('cycle_key', CYCLE_KEY)"));
  assert.equal(integrationSource.includes(".from('users')"), false);
  assert.equal(integrationSource.includes("role === 'instructor'"), false);
  assert.equal(integrationSource.includes("role === 'manager'"), false);
});

test('sidebar tab is exposed only while the summer feedback cycle is open', () => {
  const now = Date.parse('2026-07-26T12:00:00Z');
  assert.equal(navModule.cycleIsOpen({ status: 'draft' }, now), false);
  assert.equal(navModule.cycleIsOpen({ status: 'open' }, now), true);
  assert.equal(navModule.cycleIsOpen({
    status: 'open',
    opens_at: '2026-07-27T00:00:00Z'
  }, now), false);
  assert.equal(navModule.cycleIsOpen({
    status: 'open',
    closes_at: '2026-07-25T00:00:00Z'
  }, now), false);
});

test('eligible instructor gets one summer feedback tab after my activities', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="app">
      <aside class="shell-sidebar">
        <nav class="shell-nav">
          <button class="shell-nav__btn" data-route="instructor-calendar">לוח שנה</button>
          <button class="shell-nav__btn" data-route="my-data">הפעילויות שלי</button>
          <button class="shell-nav__btn" data-route="instructor-completion-approvals">אישורי ביצוע</button>
          <button class="shell-nav__btn" data-external-url="https://example.com">נוכחות</button>
        </nav>
      </aside>
    </div>
  </body></html>`, { url: 'https://example.com/dashboard_system/' });

  const host = navModule.findSummerFeedbackNavHost(dom.window.document);
  const inserted = navModule.injectSummerFeedbackNavItem(host, { complete: false });
  const item = host.querySelector('[data-summer-feedback-nav-item]');

  assert.equal(inserted, true);
  assert.ok(item);
  assert.match(item.textContent, /משוב קיץ/);
  assert.equal(item.dataset.summerFeedbackHref, './summer-feedback/');
  assert.equal(host.children[2], item);
  assert.equal(navModule.injectSummerFeedbackNavItem(host, { complete: false }), false);
  assert.equal(host.querySelectorAll('[data-summer-feedback-nav-item]').length, 1);
  dom.window.close();
});

test('manager interface gets the same tab after personal reports when assigned', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="app">
      <aside class="shell-sidebar">
        <nav class="shell-nav">
          <button class="shell-nav__btn" data-route="dashboard">לוח בקרה</button>
          <button class="shell-nav__btn" data-route="personal-reports">דוחות אישיים</button>
          <button class="shell-nav__btn" data-route="operations-management">ניהול תפעול</button>
        </nav>
      </aside>
    </div>
  </body></html>`, { url: 'https://example.com/dashboard_system/' });

  const host = navModule.findSummerFeedbackNavHost(dom.window.document);
  navModule.injectSummerFeedbackNavItem(host, { complete: true });
  const item = host.querySelector('[data-summer-feedback-nav-item]');

  assert.ok(item);
  assert.equal(host.children[2], item);
  assert.match(item.textContent, /✓/);
  dom.window.close();
});

test('eligible instructor gets mobile feedback in the guidelines position without crowding the bar', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="app">
      <nav class="instructor-bottom-nav" aria-label="ניווט מדריך">
        <button class="instructor-bottom-nav__btn" data-route="instructor-calendar">לוח שנה</button>
        <button class="instructor-bottom-nav__btn" data-route="my-data">פעילויות</button>
        <button class="instructor-bottom-nav__btn" data-route="instructor-completion-approvals">אישורים</button>
        <button class="instructor-bottom-nav__btn" data-route="instructor-guidelines">נהלים</button>
        <button class="instructor-bottom-nav__btn" data-external-url="https://example.com/attendance">נוכחות</button>
        <button class="instructor-bottom-nav__btn" data-external-url-blank="https://example.com/workshops">סדנאות</button>
      </nav>
    </div>
  </body></html>`, { url: 'https://example.com/dashboard_system/' });

  const host = navModule.findSummerFeedbackMobileNavHost(dom.window.document);
  const originalCount = host.children.length;
  const inserted = navModule.injectSummerFeedbackMobileNavItem(host, { complete: false });
  const item = host.querySelector('[data-summer-feedback-mobile-nav-item]');

  assert.equal(inserted, true);
  assert.ok(item);
  assert.equal(host.children.length, originalCount);
  assert.equal(host.querySelector('[data-route="instructor-guidelines"]'), null);
  assert.equal(host.children[3], item);
  assert.match(item.textContent, /משוב/);
  assert.equal(item.dataset.summerFeedbackHref, './summer-feedback/');
  assert.equal(navModule.injectSummerFeedbackMobileNavItem(host, { complete: false }), false);
  assert.equal(host.querySelectorAll('[data-summer-feedback-mobile-nav-item]').length, 1);
  dom.window.close();
});

test('completed mobile feedback shows completion status', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <nav class="instructor-bottom-nav">
      <button class="instructor-bottom-nav__btn" data-route="instructor-guidelines">נהלים</button>
    </nav>
  </body></html>`, { url: 'https://example.com/dashboard_system/' });

  const host = navModule.findSummerFeedbackMobileNavHost(dom.window.document);
  navModule.injectSummerFeedbackMobileNavItem(host, { complete: true });
  const item = host.querySelector('[data-summer-feedback-mobile-nav-item]');

  assert.ok(item);
  assert.match(item.textContent, /✓/);
  dom.window.close();
});

test('integration does not inject the summer feedback entry into screen content', () => {
  assert.doesNotMatch(integrationSource, /\.ds-dashboard-wrap/);
  assert.doesNotMatch(integrationSource, /\.instructor-area/);
  assert.match(integrationSource, /\.shell-sidebar \.shell-nav/);
  assert.match(integrationSource, /\.instructor-bottom-nav/);
});

test('sidebar eligibility refreshes automatically after opening and closing dates', () => {
  assert.match(integrationSource, /REFRESH_INTERVAL_MS = 30_000/);
  assert.match(integrationSource, /setInterval\(refreshFromServer, REFRESH_INTERVAL_MS\)/);
  assert.match(integrationSource, /visibilitychange/);
});

test('observer reacts to desktop and mobile navigation recreation', () => {
  assert.match(integrationSource, /shellChanged/);
  assert.match(integrationSource, /\.app-shell, \.shell-sidebar, \.shell-nav, \.instructor-bottom-nav/);
  assert.doesNotMatch(integrationSource, /replaceWith\(createSummerFeedback/);
});
