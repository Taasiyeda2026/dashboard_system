import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configureProposalPreviewPrintButton } from '../frontend/src/proposal-incomplete-print-runtime.js';

const entrySource = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../frontend/src/proposal-incomplete-print-runtime.js', import.meta.url), 'utf8');

 test('proposal browser-print runtime loads before the application', () => {
  const runtimeIndex = entrySource.indexOf("import './proposal-incomplete-print-runtime.js");
  const mainIndex = entrySource.indexOf("import './main.js';");
  assert.ok(runtimeIndex >= 0, 'proposal browser-print runtime must be imported');
  assert.ok(mainIndex > runtimeIndex, 'print runtime must load before main.js');
});

test('preview PDF action uses browser extension storage when available and keeps native print fallback', () => {
  assert.match(runtimeSource, /PREVIEW_AREA_SELECTOR = '\.proposal-preview-area'/);
  assert.match(runtimeSource, /PREVIEW_DOCUMENT_SELECTOR/);
  assert.match(runtimeSource, /PREVIEW_PRINT_SELECTOR = '#pa-print-btn'/);
  assert.match(runtimeSource, /proposalPdfExtensionAvailable/);
  assert.match(runtimeSource, /requestProposalPdfFromExtension/);
  assert.match(runtimeSource, /api\.uploadProposalFinalPdf/);
  assert.match(runtimeSource, /openPdfFile\(pdfFile, reserved\)/);
  assert.match(runtimeSource, /window\.print\(\)/);
  assert.match(runtimeSource, /הדפסה \/ PDF/);
  assert.doesNotMatch(runtimeSource, /image\/jpeg/);
  assert.doesNotMatch(runtimeSource, /createElement\(['"]canvas['"]\)/);
});

test('proposal PDF generation is driven by the visible document rather than requiring a specific overlay', () => {
  assert.match(runtimeSource, /currentPreviewArea/);
  assert.match(runtimeSource, /document\.querySelector\(PREVIEW_DOCUMENT_SELECTOR\)/);
  assert.match(runtimeSource, /if \(currentPreviewArea\(document\)\) return waitForPrintablePreview\(\)/);
  assert.match(runtimeSource, /waitForPrintablePreview/);
  assert.doesNotMatch(runtimeSource, /const PREVIEW_PRINT_SELECTOR = `\$\{PREVIEW_SELECTOR\} #pa-print-btn`/);
});

test('proposal browser print isolates the preview from dashboard layout for both native and extension printing', () => {
  assert.match(runtimeSource, /enterProposalPrintMode/);
  assert.match(runtimeSource, /classList\.add\('is-print-preview'\)/);
  assert.match(runtimeSource, /classList\.remove\('is-print-preview'\)/);
  assert.match(runtimeSource, /addEventListener\('beforeprint', enterProposalPrintMode\)/);
  assert.match(runtimeSource, /addEventListener\('afterprint', exitProposalPrintMode\)/);
  assert.match(runtimeSource, /createPdfWithBrowserExtension/);
  assert.match(runtimeSource, /invokeProposalBrowserPrint\(\)/);
  assert.match(runtimeSource, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolve\)\)/);
});

test('direct proposal PDF actions are intercepted before the legacy raster path', () => {
  assert.match(runtimeSource, /DIRECT_PRINT_SELECTOR = '\[data-pa-print\]'/);
  assert.match(runtimeSource, /directPrintButton/);
  assert.match(runtimeSource, /printProposalById/);
  assert.match(runtimeSource, /generateProposalPdfById/);
  assert.match(runtimeSource, /data-pa-open-proposal-id/);
  assert.match(runtimeSource, /data-pa-preview/);
  assert.match(runtimeSource, /stopImmediatePropagation\(\)/);
});

test('extension path uploads before opening the generated PDF', () => {
  const uploadIndex = runtimeSource.indexOf('await api.uploadProposalFinalPdf');
  const openIndex = runtimeSource.indexOf('openPdfFile(pdfFile, reserved)');
  assert.ok(uploadIndex >= 0, 'extension PDF must be uploaded');
  assert.ok(openIndex > uploadIndex, 'the user-visible PDF must open only after storage succeeds');
});

test('preview proposal id can be recovered from the form that opened the current preview', () => {
  assert.match(runtimeSource, /resolveActiveProposalId/);
  assert.match(runtimeSource, /data-pa-preview-seen="yes"/);
  assert.match(runtimeSource, /activeProposalId = seenFormId/);
});

test('preview button configuration is idempotent and does not create an observer mutation loop', () => {
  let currentText = 'PDF';
  let textWriteCount = 0;
  const attributes = new Map();
  const button = {
    dataset: {},
    title: '',
    get textContent() {
      return currentText;
    },
    set textContent(value) {
      textWriteCount += 1;
      currentText = value;
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    }
  };

  assert.equal(configureProposalPreviewPrintButton(button), true);
  assert.equal(configureProposalPreviewPrintButton(button), false);
  assert.equal(textWriteCount, 1, 'textContent must be written only once');
  assert.equal(button.dataset.paBrowserPrint, 'yes');
  assert.equal(button.textContent, 'הדפסה / PDF');
  assert.equal(button.title, 'הדפסה או שמירה כ־PDF');
  assert.equal(button.getAttribute('aria-label'), 'הדפסה או שמירה כ־PDF');
});
