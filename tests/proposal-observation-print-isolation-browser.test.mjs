// Manual only: RUN_PRINT_ISOLATION_BROWSER=1 node --test tests/proposal-observation-print-isolation-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { programs, row, sections } from './fixtures/proposal-program-display.mjs';

test('observation styles preserve proposal PDFs before opening and after closing a report', {
  skip: process.env.RUN_PRINT_ISOLATION_BROWSER !== '1', timeout: 120000
}, async () => {
  const { chromium } = await import('playwright');
  const { createServer } = await import('vite');
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const stylesheet = process.env.PRINT_ISOLATION_CSS || '/frontend/src/styles/main.css';
  const output = resolve(root, 'work/print-isolation');
  await mkdir(output, { recursive: true });
  const server = await createServer({ root, configFile: resolve(root, 'vite.config.js'),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'print-isolation-probe', configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/__print-isolation')) return next();
        response.setHeader('Content-Type', 'text/html');
        response.end(`<!doctype html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><link rel="stylesheet" href="${stylesheet}"></head><body><div class="app-shell">DASHBOARD_PRIVATE_MARKER</div></body></html>`);
      });
    } }]
  });
  let browser;
  async function pdfText(page, name) {
    const bytes = await page.pdf({ path: resolve(output, `${name}.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true });
    const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
    const pdf = await task.promise;
    const texts = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      texts.push(content.items.map(item => item.str || '').join(' '));
    }
    await task.destroy();
    return texts;
  }
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' && url.port === String(port) ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${port}/__print-isolation`);
    await page.evaluate(async builtCss => {
      window.probe = await import('/frontend/src/screens/proposals-agreements.js');
      // main.js imports this module globally, even before an observation is opened.
      if (!builtCss) await import('/frontend/src/instructor-observation-runtime.js');
      probe.setProposalGroupLookups({ proposalActivityGroups: [
        { group_key: 'gefen', template_key: 'gefen' },
        { group_key: 'next_year', template_key: 'next_year' },
        { group_key: 'combined', template_key: 'combined', included_group_keys: ['summer', 'next_year'] }
      ] });
    }, Boolean(process.env.PRINT_ISOLATION_CSS));
    for (const retainedReport of [false, true]) {
      for (const group of ['gefen', 'next_year', 'combined']) {
        await page.emulateMedia({ media: 'screen' });
        await page.evaluate(({ proposal, items, templates, retainedReport }) => {
          document.body.className = 'is-print-preview';
          document.querySelector('#pa-preview-overlay')?.remove();
          document.querySelector('.io-root')?.remove();
          if (retainedReport) {
            document.body.insertAdjacentHTML('beforeend', '<div class="io-root"><div class="io-print"><article class="io-report">STALE_OBSERVATION_MARKER</article></div></div>');
          }
          document.body.insertAdjacentHTML('beforeend', '<div id="pa-preview-overlay" class="proposal-preview-overlay"><main class="proposal-preview-area">' + probe.proposalPreviewBodyHtml(proposal, items, templates) + '</main></div>');
        }, { proposal: row(group), items: programs, templates: sections(group), retainedReport });
        assert.equal(await page.locator('.proposal-document').isVisible(), true, 'on-screen preview is visible');
        await page.emulateMedia({ media: 'print' });
        assert.equal(await page.locator('#pa-preview-overlay').isVisible(), true, 'proposal must remain visible in print media');
        const pages = await pdfText(page, `${group}-${retainedReport ? 'after-close' : 'before-open'}`);
        assert.match(pages[0], /בדיקת מסמך הצעת מחיר/, 'first PDF page contains the proposal');
        assert.match(pages.join(' '), /12,000/);
        assert.match(pages.join(' '), /13,500/);
        assert.doesNotMatch(pages.join(' '), /DASHBOARD_PRIVATE_MARKER|STALE_OBSERVATION_MARKER/);
      }
    }
    // Active observation report still prints with the shared proposal CSS loaded.
    await page.evaluate(() => {
      document.querySelector('#pa-preview-overlay').remove();
      document.body.className = 'io-modal-open';
      const observation = document.querySelector('.io-root');
      observation.classList.add('io-visible');
      observation.innerHTML = '<div class="io-dialog">DIALOG_MARKER</div><div class="io-print"><article class="io-report"><header><h1>OBSERVATION_REPORT_MARKER</h1></header><p>Completed report</p></article></div>';
    });
    assert.equal(await page.locator('.io-print').isVisible(), true);
    const report = await pdfText(page, 'active-observation');
    assert.match(report.join(' '), /OBSERVATION_REPORT_MARKER/);
    assert.doesNotMatch(report.join(' '), /DASHBOARD_PRIVATE_MARKER|DIALOG_MARKER|בדיקת מסמך הצעת מחיר/);
    await page.evaluate(() => {
      document.body.classList.remove('io-modal-open');
      document.querySelector('.io-root').classList.remove('io-visible');
    });
    assert.equal(await page.locator('.io-root').isVisible(), false, 'closed report stays hidden in print media');
  } finally {
    await browser?.close();
    await server.close();
  }
});
