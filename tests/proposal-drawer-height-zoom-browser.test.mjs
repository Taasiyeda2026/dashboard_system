import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { JSDOM } from 'jsdom';

import { ensureProposalActivityDrawerStyles } from '../frontend/src/proposal-drawer-activity-style.js';

function buildActivityDrawerCss() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>');
  assert.equal(ensureProposalActivityDrawerStyles(dom.window), true);
  const style = dom.window.document.getElementById('ds-pa-proposal-activity-drawer-style-v1');
  assert.ok(style?.textContent);
  return style.textContent;
}

function fixtureHtml(css, { zoom }) {
  const tall = Array.from(
    { length: 40 },
    (_, i) => `<p style="margin:12px 0">שורה ${i + 1} — תוכן ארוך לבדיקת גלילה פנימית</p>`
  ).join('');

  return `<!doctype html>
<html lang="he" dir="rtl">
<head>
  <meta charset="utf-8">
  <style>
    html, body { margin: 0; height: 100%; }
    #app { min-height: 100%; }
    .screen-root { zoom: ${zoom}; min-height: 100%; background: #eef2f7; }
    ${css}
  </style>
</head>
<body>
  <div id="app">
    <div class="screen-root">
      <div data-pa-proposal-detail class="ds-pa-proposal-detail">
        <aside class="ds-pa-drawer" data-pa-drawer>
          <div class="ds-pa-drawer-panel">
            <header class="ds-pa-drawer-head" style="flex:0 0 auto;padding:18px 20px;background:#1a2740;color:#fff">כותרת</header>
            <div class="ds-pa-drawer-body">${tall}</div>
          </div>
        </aside>
      </div>
    </div>
  </div>
</body>
</html>`;
}

async function measureDrawerGeometry(page) {
  return page.evaluate(() => {
    const drawer = document.querySelector('.ds-pa-drawer');
    const panel = document.querySelector('.ds-pa-drawer-panel');
    const body = document.querySelector('.ds-pa-drawer-body');
    const drawerRect = drawer.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    body.scrollTop = 120;
    const scrolledTo = body.scrollTop;
    body.scrollTop = 0;
    return {
      innerHeight: window.innerHeight,
      drawerTop: drawerRect.top,
      drawerBottom: drawerRect.bottom,
      drawerHeight: drawerRect.height,
      panelHeight: panelRect.height,
      bodyOverflowY: getComputedStyle(body).overflowY,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight,
      scrolledTo,
      canScrollInternally: body.scrollHeight > body.clientHeight + 1 && scrolledTo > 0
    };
  });
}

function assertViewportFill(metrics, label) {
  assert.equal(metrics.drawerTop, 0, `${label}: drawer.top must be 0`);
  assert.equal(metrics.drawerBottom, metrics.innerHeight, `${label}: drawer.bottom must equal window.innerHeight`);
  assert.equal(
    metrics.drawerHeight,
    metrics.innerHeight,
    `${label}: drawer.getBoundingClientRect().height must equal window.innerHeight`
  );
  assert.equal(metrics.panelHeight, metrics.drawerHeight, `${label}: panel height must match drawer`);
  assert.equal(metrics.bodyOverflowY, 'auto', `${label}: body must keep overflow-y:auto`);
  assert.equal(metrics.canScrollInternally, true, `${label}: body must scroll internally`);
}

test('proposal drawer fills viewport under screen-root zoom 0.85 and normal zoom', async (t) => {
  const css = buildActivityDrawerCss();
  assert.match(css, /\[data-pa-proposal-detail\] > \.ds-pa-drawer[\s\S]*?height:\s*100% !important/);
  assert.doesNotMatch(css, /\[data-pa-proposal-detail\] > \.ds-pa-drawer[\s\S]*?100dvh/);

  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
  });

  const cases = [
    { name: 'zoom-0.85 @ 1440x900', zoom: 0.85, viewport: { width: 1440, height: 900 } },
    { name: 'zoom-1 @ 1440x900', zoom: 1, viewport: { width: 1440, height: 900 } },
    { name: 'zoom-0.85 @ 1280x720', zoom: 0.85, viewport: { width: 1280, height: 720 } }
  ];

  for (const scenario of cases) {
    const page = await browser.newPage({ viewport: scenario.viewport });
    await page.setContent(fixtureHtml(css, { zoom: scenario.zoom }), { waitUntil: 'load' });
    const metrics = await measureDrawerGeometry(page);
    assertViewportFill(metrics, scenario.name);
    await page.close();
  }
});
