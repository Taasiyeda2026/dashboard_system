/**
 * Mobile scroll hotfix: nested overflow-x:hidden + height:100% made body the
 * only scrollport while document.scrollingElement (html) could not scroll.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, devices } from '@playwright/test';
import { dirname, join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const ARTIFACTS = '/opt/cursor/artifacts';

function contentType(path) {
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  return 'application/octet-stream';
}

async function withServer(run) {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      const filePath = join(root, urlPath.replace(/^\//, ''));
      if (!filePath.startsWith(root)) {
        res.writeHead(403); res.end('forbidden'); return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': contentType(filePath) });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('missing');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('source contracts keep document scrollport on mobile', async () => {
  const css = await readFile(new URL('../attendance/src/styles/mobile-final-contract.css', import.meta.url), 'utf8');
  const theme = await readFile(new URL('../attendance/src/styles/mobile-app-theme.css', import.meta.url), 'utf8');
  const sw = await readFile(new URL('../attendance/sw.js', import.meta.url), 'utf8');
  const index = await readFile(new URL('../attendance/index.html', import.meta.url), 'utf8');
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(css, /overflow-y:\s*visible/);
  assert.match(css, /height:\s*auto\s*!important/);
  assert.match(theme, /background-attachment:\s*scroll/);
  assert.match(sw, /const CACHE_VERSION = 181/);
  assert.match(index, /\?v=181/);
});

test('iPhone and Android emulation can scroll to the save button', async () => {
  await withServer(async (origin) => {
    const browser = await chromium.launch({ headless: true });
    await mkdir(ARTIFACTS, { recursive: true });
    try {
      for (const [name, device] of [
        ['iphone', devices['iPhone 13']],
        ['android', devices['Pixel 5']],
      ]) {
        const context = await browser.newContext({ ...device });
        const page = await context.newPage();
        await page.goto(`${origin}/tests/fixtures/attendance-scroll-repro.html`, { waitUntil: 'networkidle' });
        const before = await page.evaluate(() => {
          const html = document.documentElement;
          const body = document.body;
          return {
            htmlOverflowY: getComputedStyle(html).overflowY,
            bodyOverflowY: getComputedStyle(body).overflowY,
            htmlHeight: getComputedStyle(html).height,
            bodyHeight: getComputedStyle(body).height,
            htmlScrollable: html.scrollHeight > html.clientHeight + 2,
            windowScrollY: window.scrollY,
            saveBottom: document.getElementById('save').getBoundingClientRect().bottom,
            viewportH: window.innerHeight,
          };
        });
        assert.match(before.htmlOverflowY, /^(visible|auto)$/);
        assert.match(before.bodyOverflowY, /^(visible|auto)$/);
        // Document element must be taller than the viewport so window scroll works.
        assert.ok(before.htmlScrollable, `${name}: html should be document scrollport`);
        assert.ok(before.saveBottom > before.viewportH, `${name}: save starts below fold`);

        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(150);
        const after = await page.evaluate(() => ({
          scrollY: window.scrollY,
          saveInView: (() => {
            const r = document.getElementById('save').getBoundingClientRect();
            return r.top < window.innerHeight && r.bottom > 0;
          })(),
          htmlTop: document.documentElement.scrollTop,
          bodyTop: document.body.scrollTop,
          htmlScrollH: document.documentElement.scrollHeight,
          htmlClientH: document.documentElement.clientHeight,
        }));
        assert.ok(after.htmlScrollH > after.htmlClientH + 2, `${name}: html remains scrollable`);
        assert.ok(after.scrollY > 200 || after.htmlTop > 200, `${name}: window/html scrolled`);
        assert.equal(after.saveInView, true, `${name}: save reachable after scroll`);

        // Modal open/close must not trap page scroll.
        await page.evaluate(() => {
          const overlay = document.createElement('div');
          overlay.className = 'av2-modal-overlay';
          overlay.id = 'scroll-test-overlay';
          const modal = document.createElement('div');
          modal.className = 'av2-modal';
          modal.innerHTML = '<h2>עריכה</h2><p>תוכן</p><button type="button" id="close-modal">סגירה</button>';
          overlay.append(modal);
          document.body.append(overlay);
        });
        await page.locator('#close-modal').click();
        await page.evaluate(() => document.getElementById('scroll-test-overlay')?.remove());
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.evaluate(() => window.scrollTo(0, 900));
        const afterModal = await page.evaluate(() => window.scrollY || document.documentElement.scrollTop);
        assert.ok(afterModal > 200, `${name}: scroll works after modal close`);

        await page.screenshot({ path: `${ARTIFACTS}/scroll-hotfix-${name}.png` });
        await context.close();
      }
    } finally {
      await browser.close();
    }
  });
});
