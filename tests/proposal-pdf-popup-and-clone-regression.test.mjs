import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

if (!globalThis.sessionStorage) {
  const store = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear()
  };
}

const screenUrl = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);
const mainCssUrl = new URL('../frontend/src/styles/main.css', import.meta.url);
const nextYearUrl = new URL('../frontend/src/proposal-next-year-workshops.js', import.meta.url);

const { validateProposalDocumentTree, validateProposalDocumentHtml, PROPOSAL_PDF_RENDER_HOST_ATTRIBUTE } =
  await import('../frontend/src/screens/proposals-agreements.js');

function documentTree(html) {
  return new JSDOM(`<body><div>${html}</div></body>`).window.document.body.firstElementChild;
}

const FULL_DOCUMENT_HTML = `
  <div class="proposal-document pa-document pa-a4-page" dir="rtl">
    <div class="proposal-document-header pa-page-header"><img src="logo.png" alt="לוגו">תעשיידע</div>
    <div class="proposal-document-body">
      <div class="pa-doc-address pa-to-block">לכבוד: מנהלת בית הספר</div>
      <h1 class="pa-doc-subject pa-doc-title">הצעת מחיר 10200</h1>
      <section class="pa-section"><h3 class="pa-section-heading">פתיח</h3><p>תעשיידע היא עמותה חינוכית.</p></section>
      <section class="pa-section pa-cost-section">
        <div class="pa-cost-table-block">
          <table class="pa-item-details-table pa-activities-table">
            <tbody><tr><td>ביומימיקרי</td><td>₪ 4,000</td></tr></tbody>
            <tfoot><tr><td>סה״כ לתשלום</td><td>₪ 4,000</td></tr></tfoot>
          </table>
        </div>
      </section>
      <div class="pa-footer-signature">בכבוד רב</div>
    </div>
  </div>`;

const TABLE_ONLY_HTML = `
  <table class="pa-item-details-table pa-activities-table">
    <tbody><tr><td>ביומימיקרי</td><td>₪ 4,000</td></tr></tbody>
  </table>`;

test('saved PDF reserves a browser tab before awaiting its signed URL', async () => {
  const source = await readFile(screenUrl, 'utf8');
  assert.match(source, /const reservedWindow = reservePdfWindow\(\);[\s\S]*await openProposalFinalPdf\(row, null, reservedWindow\)/);
  assert.match(source, /reservedWindow\.location\.replace\(url\)/);
  assert.match(source, /link\.download = text\(result\?\.fileName\)/);
});

test('clone handler delegates one atomic item copy and never archives the source locally', async () => {
  const source = await readFile(screenUrl, 'utf8');
  const handler = source.slice(source.indexOf("const cloneBtn = event.target.closest?.('[data-pa-clone-row]')"));
  assert.match(handler, /api\.addProposalAgreement\(clonePayload\)/);
  assert.doesNotMatch(handler, /api\.saveProposalAgreementItems\(newId, cloneItems\)/);
  assert.doesNotMatch(handler, /archivedAt/);
});

test('a full proposal document passes the PDF completeness gate', () => {
  const result = validateProposalDocumentTree(documentTree(FULL_DOCUMENT_HTML));
  assert.deepEqual(result.missing, []);
  assert.equal(result.ok, true);
  assert.ok(result.documentRoot);
});

test('a table-only fragment is blocked before a PDF can be produced', () => {
  const result = validateProposalDocumentTree(documentTree(TABLE_ONLY_HTML));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['שורש מסמך ההצעה']);
});

test('a document missing the header, recipient or title is blocked and names what is missing', () => {
  const stripped = FULL_DOCUMENT_HTML
    .replace(/<div class="proposal-document-header[\s\S]*?<\/div>/, '')
    .replace(/<div class="pa-doc-address[\s\S]*?<\/div>/, '')
    .replace(/<h1 class="pa-doc-subject[\s\S]*?<\/h1>/, '');
  const result = validateProposalDocumentTree(documentTree(stripped));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ['כותרת ולוגו', 'פרטי הנמען', 'כותרת ההצעה']);
});

test('an empty template section list is blocked even when the table is present', () => {
  const noSections = FULL_DOCUMENT_HTML.replace(/<section class="pa-section"><h3[\s\S]*?<\/section>/, '')
    .replace(/<section class="pa-section pa-cost-section">/, '<div class="pa-cost-wrap">')
    .replace(/<\/section>\s*<div class="pa-footer-signature">/, '</div><div class="pa-footer-signature">');
  const result = validateProposalDocumentTree(documentTree(noSections));
  assert.equal(result.ok, false);
  assert.ok(result.missing.includes('תוכן תבנית'));
});

test('a תשפ״ז document with both areas must carry both tables, both summaries and a combined total', () => {
  const dualTables = FULL_DOCUMENT_HTML.replace(
    /<table class="pa-item-details-table pa-activities-table">[\s\S]*?<\/table>/,
    `<table class="pa-item-details-table pa-next-year-course-table">
       <tbody><tr><td>ביומימיקרי</td><td>₪ 4,000</td></tr></tbody>
       <tfoot><tr><td>סה״כ קורסים</td><td>₪ 4,000</td></tr></tfoot>
     </table>
     <table class="pa-item-details-table pa-next-year-workshop-table">
       <tbody><tr><td>סדנאות STEM</td><td>₪ 3,000</td></tr></tbody>
       <tfoot><tr><td>סה״כ סדנאות</td><td>₪ 3,000</td></tr></tfoot>
     </table>
     <table class="pa-cost-table pa-next-year-combined-total">
       <tbody><tr><td>סה״כ לתשלום</td><td>₪ 7,000</td></tr></tbody>
     </table>`
  );
  assert.equal(validateProposalDocumentTree(documentTree(dualTables)).ok, true);

  const withoutWorkshopSummary = dualTables.replace('סה״כ סדנאות', 'סה״כ');
  const missingSummary = validateProposalDocumentTree(documentTree(withoutWorkshopSummary));
  assert.equal(missingSummary.ok, false);
  assert.ok(missingSummary.missing.includes('סיכום סדנאות'));

  const withoutCombined = dualTables.replace(/<table class="pa-cost-table pa-next-year-combined-total">[\s\S]*?<\/table>/, '');
  const missingCombined = validateProposalDocumentTree(documentTree(withoutCombined));
  assert.equal(missingCombined.ok, false);
  assert.ok(missingCombined.missing.includes('סה״כ משותף'));
});

test('a combined GEFEN file keeps one proposal root plus the approval page', () => {
  const combined = `<div class="pa-gefen-combined-document">${FULL_DOCUMENT_HTML}
    <div class="proposal-document pa-document pa-gefen-approval-document" data-pdf-page-break="true">
      <div class="pa-page-header">אישור גפ״ן</div>
      <div class="pa-to-block">לכבוד</div>
      <h1 class="pa-doc-title">אישור</h1>
      <section class="pa-section"><p>פרטי האישור</p></section>
      <table class="pa-cost-table"><tbody><tr><td>סה״כ</td><td>₪ 4,000</td></tr></tbody></table>
    </div></div>`;
  assert.equal(validateProposalDocumentTree(documentTree(combined)).ok, true);
});

test('an empty or non-document snapshot is rejected before upload', () => {
  assert.deepEqual(validateProposalDocumentHtml('').missing, ['שורש מסמך ההצעה']);
  assert.equal(validateProposalDocumentHtml(TABLE_ONLY_HTML).ok, false);
});

test('the PDF path validates the document, normalizes it once and blocks a partial upload', async () => {
  const source = await readFile(screenUrl, 'utf8');
  const generator = source.slice(source.indexOf('async function proposalHtmlToPdfBlob'));

  assert.match(generator, /host\.setAttribute\(PROPOSAL_PDF_RENDER_HOST_ATTRIBUTE, 'true'\)/);
  assert.match(generator, /proposalPdfDocumentNormalizer\?\.\(host\)/);
  assert.match(generator, /validateProposalDocumentTree\(host, \{ requireVisibleBox: true \}\)/);
  assert.match(generator, /validateProposalDocumentTree\(clean, \{ requireVisibleBox: true \}\)/);
  // The gate must run before the file exists and again before the upload call.
  const validateHtmlIndex = source.indexOf("setPdfStage('validate-document-html')");
  const createFileIndex = source.indexOf("setPdfStage('create-file')");
  const validateUploadIndex = source.indexOf("setPdfStage('validate-before-upload')");
  const uploadIndex = source.indexOf("setPdfStage('call-upload-api')");
  assert.ok(validateHtmlIndex > 0 && createFileIndex > validateHtmlIndex);
  assert.ok(validateUploadIndex > 0 && uploadIndex > validateUploadIndex);
  assert.match(source, /if \(text\(err\?\.userMessage\)\) \{\s*\n\s*showToast\(err\.userMessage, 'error', 6000\)/);
});

test('the document observer never rewrites a PDF render host mid-generation', async () => {
  const nextYear = await readFile(nextYearUrl, 'utf8');
  assert.match(nextYear, /setProposalPdfDocumentNormalizer\(\(host\) => normalizeNextYearWorkshopTables\(host\)\)/);
  assert.match(nextYear, /normalizeNextYearWorkshopTables\(documentRef, \{ skipPdfRenderHosts: true \}\)/);
  assert.match(nextYear, /skipPdfRenderHosts \|\| !insidePdfRenderHost\(table\)/);
  assert.equal(PROPOSAL_PDF_RENDER_HOST_ATTRIBUTE, 'data-pdf-render-host');
});

test('the final print override releases the PDF host from the single-page flex column', async () => {
  const css = await readFile(mainCssUrl, 'utf8');
  const overrideIndex = css.lastIndexOf('ABSOLUTE FINAL PRINT OVERRIDE extension — PDF render host');
  assert.ok(overrideIndex > 0, 'the PDF host override must live in the final print override region');

  const overrideBlock = css.slice(overrideIndex);
  assert.match(
    overrideBlock,
    /\[data-pdf-render-host\] \.proposal-document\.pa-document,[\s\S]*?\{[\s\S]*?display: block !important;[\s\S]*?min-height: 0 !important;/
  );
  assert.match(
    overrideBlock,
    /\[data-pdf-render-host\] \.proposal-document\.pa-document \.proposal-document-body,[\s\S]*?\{[\s\S]*?flex: none !important;/
  );
  assert.match(overrideBlock, /\[data-pdf-render-host\] \.proposal-document \.pa-section,/);

  // Nothing may be appended after it, so it stays the last authority in the file.
  const trailing = css.slice(overrideIndex + overrideBlock.lastIndexOf('}') + 1).trim();
  assert.equal(trailing, '');
});
