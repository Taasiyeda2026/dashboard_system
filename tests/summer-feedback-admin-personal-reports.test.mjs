import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dashboardEnhancer = readFileSync(new URL('../frontend/src/dashboard-kpi-corrections.js', import.meta.url), 'utf8');
const integration = readFileSync(new URL('../frontend/src/summer-feedback-admin-integration.js', import.meta.url), 'utf8');
const supabaseClient = readFileSync(new URL('../frontend/src/supabase-client.js', import.meta.url), 'utf8');
const personalReports = readFileSync(new URL('../frontend/src/screens/personal-reports.js', import.meta.url), 'utf8');
const feedbackHtml = readFileSync(new URL('../frontend/public/summer-feedback/index.html', import.meta.url), 'utf8');
const configuredClient = readFileSync(new URL('../frontend/public/summer-feedback/supabase-configured-client.js', import.meta.url), 'utf8');
const embeddedCss = readFileSync(new URL('../frontend/public/summer-feedback/embedded-admin.css', import.meta.url), 'utf8');
const embeddedJs = readFileSync(new URL('../frontend/public/summer-feedback/embedded-admin.js', import.meta.url), 'utf8');

test('dashboard loads the admin-only summer feedback integration without restoring the instructor button', () => {
  assert.ok(dashboardEnhancer.includes("import './summer-feedback-admin-integration.js';"));
  assert.equal(integration.includes('instr-my-data-actions'), false);
  assert.equal(integration.includes('data-summer-feedback-link'), false);
  assert.ok(integration.includes("document.querySelectorAll('#pr-root .pr-screen-mode-switch')"));
  assert.ok(integration.includes("button.textContent = 'משוב קיץ'"));
});

test('summer feedback tab is restricted to an authenticated explicitly active admin', () => {
  assert.ok(integration.includes('waitForSupabaseAuthSession'));
  assert.ok(integration.includes(".from('users')"));
  assert.ok(integration.includes(".select('role,is_active')"));
  assert.ok(integration.includes("normalizeRole(data?.role) === 'admin'"));
  assert.ok(integration.includes('data?.is_active === true'));
  assert.equal(integration.includes('data?.is_active !== false'), false);
});

test('personal reports keeps its existing tabs and adds the full summer feedback management interface inside it', () => {
  assert.ok(personalReports.includes('הדוחות שלי'));
  assert.ok(personalReports.includes('ניהול דוחות עובדים'));
  assert.ok(personalReports.includes('משובים'));
  assert.ok(integration.includes('pr-screen--summer-feedback-admin'));
  assert.ok(integration.includes('title="ניהול משוב הקיץ"'));
  assert.ok(integration.includes('./summer-feedback/?view=admin&embedded=1'));
  assert.ok(integration.includes('sourceTabList.cloneNode(true)'));
  assert.ok(integration.includes('button.dataset.prAction'));
  assert.ok(integration.includes('lock-screen'));
});

test('admin tab click is delegated and replaces the reports screen instead of relying on hidden', () => {
  assert.ok(integration.includes("document.addEventListener('click', handleSummerFeedbackAdminTabClick, true)"));
  assert.ok(integration.includes('root.replaceChildren(screen)'));
  assert.ok(integration.includes('root.replaceChildren(...originalNodes)'));
  assert.equal(integration.includes('originalNodes.forEach(({ node }) => { node.hidden = true; })'), false);
  assert.ok(integration.includes('fallbackToDirectAdmin'));
});

test('clicking the summer feedback tab opens the embedded screen and another tab restores the original screen', async () => {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    url: 'https://example.test/dashboard/'
  });

  const previousGlobals = new Map();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    MutationObserver: dom.window.MutationObserver,
    CustomEvent: dom.window.CustomEvent,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    localStorage: dom.window.localStorage,
    sessionStorage: dom.window.sessionStorage,
    requestAnimationFrame: (callback) => { callback(0); return 1; },
    cancelAnimationFrame: () => {}
  };

  for (const [key, value] of Object.entries(globals)) {
    previousGlobals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }

  try {
    const moduleUrl = new URL('../frontend/src/summer-feedback-admin-integration.js', import.meta.url);
    const integrationModule = await import(`${moduleUrl.href}?click-test=${Date.now()}`);

    const root = document.createElement('div');
    root.id = 'pr-root';
    root.innerHTML = `
      <div id="pr-toast"></div>
      <div class="pr-screen pr-screen--reports">
        <div class="pr-screen-mode-switch" role="tablist">
          <button class="pr-report-tab is-active" type="button" data-pr-action="screen-mode-my-reports">הדוחות שלי</button>
          <button class="pr-report-tab" type="button" data-pr-action="screen-mode-management">ניהול דוחות עובדים</button>
          <button class="pr-report-tab" type="button" data-pr-action="screen-mode-reviews">משובים</button>
          <button class="pr-report-tab" type="button" data-summer-feedback-admin-tab="true">משוב קיץ</button>
        </div>
        <button type="button" data-pr-action="back-to-dashboard">חזרה לדשבורד</button>
        <button type="button" data-pr-action="lock-screen">יציאה</button>
      </div>
    `;

    const originalScreen = root.querySelector('.pr-screen--reports');
    const originalMyReportsButton = root.querySelector('[data-pr-action="screen-mode-my-reports"]');
    let restoredTabClicks = 0;
    originalMyReportsButton.addEventListener('click', () => { restoredTabClicks += 1; });

    const adminButton = root.querySelector('[data-summer-feedback-admin-tab]');
    let prevented = false;
    let stopped = false;
    const opened = integrationModule.handleSummerFeedbackAdminTabClick({
      target: adminButton,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; }
    });

    assert.equal(opened, true);
    assert.equal(prevented, true);
    assert.equal(stopped, true);
    assert.equal(originalScreen.isConnected, false);
    assert.ok(root.querySelector(':scope > .pr-screen--summer-feedback-admin'));
    assert.match(root.querySelector('iframe')?.getAttribute('src') || '', /view=admin&embedded=1/);

    const clonedMyReportsButton = root.querySelector('.pr-screen--summer-feedback-admin [data-pr-action="screen-mode-my-reports"]');
    assert.ok(clonedMyReportsButton);
    clonedMyReportsButton.click();

    assert.equal(root.querySelector('.pr-screen--reports'), originalScreen);
    assert.equal(originalScreen.isConnected, true);
    assert.equal(restoredTabClicks, 1);
  } finally {
    dom.window.close();
    for (const [key, descriptor] of previousGlobals.entries()) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});

test('embedded feedback shares dashboard Supabase configuration and authenticated project', () => {
  assert.ok(supabaseClient.includes('publishableKey: supabaseAnonKey'));
  assert.ok(integration.includes('supabaseConfig'));
  assert.ok(integration.includes('__dashboardSummerFeedbackConfig'));
  assert.ok(integration.includes('publishableKey: String(supabaseConfig?.publishableKey'));
  assert.ok(feedbackHtml.includes('type="importmap"'));
  assert.ok(feedbackHtml.includes('./supabase-configured-client.js'));
  assert.ok(configuredClient.includes('window.parent?.[EMBEDDED_CONFIG_KEY]'));
  assert.ok(configuredClient.includes('dashboardConfig?.url || defaultUrl'));
  assert.ok(configuredClient.includes('dashboardConfig?.publishableKey || defaultPublishableKey'));
});

test('embedded management mode removes duplicate navigation, preserves embedded links and follows dashboard height', () => {
  assert.ok(feedbackHtml.includes('href="./embedded-admin.css"'));
  assert.ok(feedbackHtml.includes('src="./embedded-admin.js"'));
  assert.ok(embeddedCss.includes('html.summer-feedback-embedded .shell > header'));
  assert.ok(embeddedCss.includes('display: none !important'));
  assert.ok(embeddedCss.includes('html.summer-feedback-embedded .container'));
  assert.ok(embeddedCss.includes('width: 100%'));
  assert.ok(embeddedJs.includes("params.get('embedded') === '1'"));
  assert.ok(embeddedJs.includes("url.searchParams.set('embedded', '1')"));
  assert.ok(embeddedJs.includes('url.pathname !== window.location.pathname'));
  assert.ok(embeddedJs.includes('summer-feedback:embedded-height'));
  assert.ok(integration.includes('Math.min(Math.max(Math.ceil(requested), 720), 5600)'));
});
