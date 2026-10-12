// Manual only: RUN_PROPOSAL_DISPLAY_BROWSER=1 node --test tests/proposal-program-display-browser.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { alias, programs, row, sections } from './fixtures/proposal-program-display.mjs';

test('isolated browser print and real local/Chromium PDFs preserve both program identities', {
  skip: process.env.RUN_PROPOSAL_DISPLAY_BROWSER !== '1', timeout: 120000
}, async () => {
  const { chromium } = await import('playwright');
  const { createServer } = await import('vite');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const screenPath = resolve(root, 'frontend/src/screens/proposals-agreements.js');
  // Expose the private local PDF renderer only in this isolated test server.
  const server = await createServer({ root, configFile: resolve(root, 'vite.config.js'),
    server: { host: '127.0.0.1', port: 0 },
    plugins: [{ name: 'proposal-display-private-test-export', configureServer(server) {
      server.middlewares.use((request, response, next) => {
    if (!request.url?.startsWith('/__proposal-display-probe')) return next();
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html lang="he" dir="rtl"><head><meta charset="UTF-8"><base href="/"><link rel="stylesheet" href="/frontend/src/styles/main.css"></head><body class="is-print-preview"><div id="pa-preview-overlay" class="proposal-preview-overlay"><main class="proposal-preview-area"></main></div></body></html>');
  });
    }, transform(code, id) {
      if (id.split('?')[0] === screenPath) return `${code}\nexport { proposalHtmlToPdfBlob };`;
    } }]
  });
  let browser;
  const output = process.env.PROPOSAL_DISPLAY_TEST_OUTPUT || resolve(root, 'work/display-browser');
  await mkdir(output, { recursive: true });
  const results = [];
  try {
    await server.listen();
    const port = server.httpServer.address().port;
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.hostname === '127.0.0.1' && url.port === String(port) ? route.continue() : route.abort();
    });
    await page.goto(`http://127.0.0.1:${port}/__proposal-display-probe`);
    await page.evaluate(async () => {
      window.probe = await import('/frontend/src/screens/proposals-agreements.js');
      window.workflow = await import('/frontend/src/proposal-workflow-completion.js');
      await import('/frontend/src/proposal-pdf-svg-origin-clean.js');
      probe.setProposalPdfDocumentNormalizer(workflow.normalizeProposalWorkflowDocument);
      probe.setProposalGroupLookups({ proposalActivityGroups: [
        { group_key: 'gefen', display_name: 'גפ״ן', template_key: 'gefen' },
        { group_key: 'next_year', display_name: 'תוכניות תשפ״ז', template_key: 'next_year' },
        { group_key: 'next_year_courses', display_name: 'קורסים ותוכניות', template_key: 'next_year' },
        { group_key: 'summer', display_name: 'קיץ תשפ״ו', template_key: 'summer' },
        { group_key: 'combined', display_name: 'הצעה משולבת', template_key: 'combined', included_group_keys: ['summer', 'next_year'] }
      ] });
    });
    for (const group of ['gefen', 'next_year', 'combined', 'approval', 'proposal-approval']) {
      const type = group === 'approval' ? 'next_year' : group === 'proposal-approval' ? 'gefen' : group;
      const proposal = row(type, { status: 'approved', semel_mosad: '123456', combine_gefen_approval: group === 'proposal-approval' });
      const result = await page.evaluate(({ group, proposal, items, templates }) => {
        const original = JSON.stringify(items);
        const html = group === 'approval' ? probe.gefenApprovalDocumentHtml(proposal, items)
          : probe.proposalPreviewBodyHtml(proposal, items, templates, { showSignatureImage: true });
        const area = document.querySelector('.proposal-preview-area');
        area.innerHTML = html;
        workflow.normalizeProposalWorkflowDocument(area);
        const table = area.querySelector('.pa-gefen-approval-table, .pa-next-year-course-table, .pa-gefen-course-table, .pa-cost-table');
        const rows = [...table.querySelectorAll('tbody tr')].map(tr => ({
          name: tr.querySelector('.pa-course-name')?.textContent || tr.cells[group === 'approval' ? 1 : 0].textContent,
          gefen: tr.querySelector('[data-program-gefen]')?.textContent || tr.cells[group === 'approval' ? 2 : 1].textContent,
          text: tr.textContent,
          sourceGefen: tr.dataset.sourceGefenNumber ?? null,
          hasInlineGefen: Boolean(tr.querySelector('[data-program-gefen]'))
        }));
        return { html: area.innerHTML, rows, unchanged: JSON.stringify(items) === original };
      }, { group, proposal, items: programs, templates: sections(type) });
      assert.equal(result.unchanged, true);
      assert.equal(result.rows.length, 2);
      assert.deepEqual(result.rows.map(r => r.name), [alias, 'אופק פרימיום']);
      assert.equal(result.rows[0].gefen, '52279');
      assert.equal(result.rows[0].sourceGefen, '3604');
      if (group === 'combined') {
        assert.equal(result.rows[0].hasInlineGefen, true);
        assert.equal(result.rows[1].hasInlineGefen, false);
        assert.equal(result.rows[1].sourceGefen, null);
      } else {
        assert.equal(result.rows[1].gefen, '52279');
        assert.equal(result.rows[1].sourceGefen, null);
      }
      assert.match(result.rows[0].text, /12,000/);
      assert.match(result.rows[1].text, /13,500/);
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ path: resolve(output, `${group}-chromium.pdf`), format: 'A4', printBackground: true, preferCSSPageSize: true });
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.length > 5000);
      await page.screenshot({ path: resolve(output, `${group}-print.png`), fullPage: true });
      await page.emulateMedia({ media: 'screen' });
      const localBytes = await page.evaluate(async html => {
        const blob = await probe.proposalHtmlToPdfBlob(html, { proposalId: 'isolated-test-only' });
        return [...new Uint8Array(await blob.arrayBuffer())];
      }, result.html);
      const localPdf = Buffer.from(localBytes);
      assert.equal(localPdf.subarray(0, 5).toString(), '%PDF-');
      assert.ok(localPdf.length > 5000);
      await writeFile(resolve(output, `${group}-local.pdf`), localPdf);
      results.push({ group, rows: result.rows, sourceUnchanged: result.unchanged, chromiumBytes: pdf.length, localBytes: localPdf.length });
    }
    const untouchedPremium = await page.evaluate(({ proposal, item, templates }) => {
      const area = document.querySelector('.proposal-preview-area');
      area.innerHTML = probe.proposalPreviewBodyHtml(proposal, [item], templates);
      workflow.normalizeProposalWorkflowDocument(area);
      const course = area.querySelector('.pa-cost-table tbody tr');
      return {
        displayedName: course?.cells[0]?.textContent,
        inlineGefenCount: course?.querySelectorAll('[data-program-gefen]')?.length ?? -1,
        sourceMarkerCount: area.querySelectorAll('[data-source-gefen-number]').length
      };
    }, {
      proposal: row('combined'),
      item: { ...programs[1], item_name: 'אופק יזמות פרימיום בתעשייה' },
      templates: sections('combined')
    });
    assert.deepEqual(untouchedPremium, {
      displayedName: 'אופק יזמות פרימיום בתעשייה',
      inlineGefenCount: 0,
      sourceMarkerCount: 0
    });
    results.push({ untouchedPremium });
    const historical = await page.evaluate(({ proposal, items, templates }) => {
      const snapshot = probe.buildProposalDocumentSnapshot(proposal, items, templates);
      delete snapshot.presentation_version;
      const area = document.querySelector('.proposal-preview-area');
      area.innerHTML = probe.proposalPreviewHtmlFromSnapshot(snapshot);
      const before = area.innerHTML;
      workflow.normalizeProposalWorkflowDocument(area);
      const savedHtml = '<div class="proposal-document">פורצות דרך 3604 — HTML נעול</div>';
      return {
        unchanged: before === area.innerHTML,
        containsAlias: area.textContent.includes('אופק פרימיום (פורצות דרך)'),
        lockedHtmlUnchanged: probe.proposalLockedPreviewHtml({ document_html_snapshot: savedHtml }) === savedHtml
      };
    }, { proposal: row('next_year'), items: programs, templates: sections('next_year') });
    assert.deepEqual(historical, { unchanged: true, containsAlias: false, lockedHtmlUnchanged: true });
    results.push({ historical });
    await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
  } finally {
    await browser?.close();
    await server.close();
  }
});
