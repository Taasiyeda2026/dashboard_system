import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { buildProposalNativePdfHtml } from '../frontend/src/proposal-native-pdf.js';

const clientSource = await readFile(new URL('../frontend/src/proposal-native-pdf.js', import.meta.url), 'utf8');
const hotfixSource = await readFile(new URL('../frontend/src/proposal-pdf-single-generation-hotfix.js', import.meta.url), 'utf8');
const edgeSource = await readFile(new URL('../supabase/functions/proposal-pdf-render/index.ts', import.meta.url), 'utf8');

test('native proposal PDF wrapper keeps Hebrew text as HTML and removes executable content', () => {
  const dom = new JSDOM(`<!doctype html><html><head>
    <link rel="stylesheet" href="/assets/style.css">
    <style>.proposal-document{direction:rtl}</style>
  </head><body></body></html>`, { url: 'https://dashboard.example/' });

  const previousDocument = globalThis.document;
  const previousWindow = globalThis.window;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  try {
    const html = buildProposalNativePdfHtml(`
      <section class="proposal-document" dir="rtl">
        <h1>הצעת מחיר</h1>
        <table><tr><td>תוכנית לדוגמה</td><td>1,200 ₪</td></tr></table>
        <script>window.bad = true</script>
      </section>
    `, { baseUrl: 'https://dashboard.example/' });

    assert.match(html, /<html lang="he" dir="rtl">/);
    assert.match(html, /id="proposal-native-pdf-root"/);
    assert.match(html, /הצעת מחיר/);
    assert.match(html, /<table>/);
    assert.match(html, /https:\/\/dashboard\.example\/assets\/style\.css/);
    assert.doesNotMatch(html, /window\.bad/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.window = previousWindow;
    dom.window.close();
  }
});

test('client no longer rasterizes proposal pages before PDF creation', () => {
  assert.doesNotMatch(clientSource, /createElement\(['"]canvas['"]\)/);
  assert.doesNotMatch(clientSource, /image\/jpeg/);
  assert.doesNotMatch(clientSource, /toBlob\s*\(/);
  assert.match(clientSource, /functions\/v1\/\$\{PDF_FUNCTION_NAME\}/);
  assert.match(clientSource, /signature !== '%PDF-'/);
});

test('proposal PDF button is routed through the native renderer and existing upload contract', () => {
  assert.match(hotfixSource, /generateProposalNativePdfBlob/);
  assert.match(hotfixSource, /buildProposalDocumentSnapshot/);
  assert.match(hotfixSource, /uploadProposalFinalPdf/);
  assert.match(hotfixSource, /stopImmediatePropagation\(\)/);
  assert.match(hotfixSource, /__dsProposalNativePdfEnabled = true/);
});

test('edge renderer uses authenticated Browserless Chromium PDF output', () => {
  assert.match(edgeSource, /ALLOWED_ROLES/);
  assert.match(edgeSource, /db\.auth\.getUser\(token\)/);
  assert.match(edgeSource, /BROWSERLESS_API_KEY/);
  assert.match(edgeSource, /\/pdf\?token=/);
  assert.match(edgeSource, /format: 'A4'/);
  assert.match(edgeSource, /printBackground: true/);
  assert.match(edgeSource, /preferCSSPageSize: true/);
  assert.match(edgeSource, /signature !== '%PDF-'/);
  assert.doesNotMatch(edgeSource, /image\/jpeg/);
});
