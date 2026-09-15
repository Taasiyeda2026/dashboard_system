import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configureProposalPreviewPrintButton } from '../frontend/src/proposal-incomplete-print-runtime.js';

const runtimeSource = await readFile(new URL('../frontend/src/proposal-incomplete-print-runtime.js', import.meta.url), 'utf8');
const bridgeSource = await readFile(new URL('../frontend/src/proposal-vector-pdf-bridge.js', import.meta.url), 'utf8');
const vectorSource = await readFile(new URL('../frontend/src/proposal-vector-pdf-runtime.js', import.meta.url), 'utf8');
const routeLoaderSource = await readFile(new URL('../frontend/src/feature-route-loader.js', import.meta.url), 'utf8');

test('client vector PDF bridge is installed before proposal interactions', () => {
  assert.match(routeLoaderSource, /import '\.\/proposal-vector-pdf-bridge\.js';/);
  assert.match(bridgeSource, /targetApi\.requestProposalFinalPdf = async/);
  assert.match(bridgeSource, /import\('\.\/proposal-vector-pdf-runtime\.js'\)/);
  assert.doesNotMatch(bridgeSource, /proposal-final-pdf/);
});

test('preview PDF action stores and opens the same generated PDF file', () => {
  assert.match(runtimeSource, /#pa-preview-overlay/);
  assert.match(runtimeSource, /#pa-print-btn/);
  assert.match(runtimeSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(runtimeSource, /api\.createProposalFinalPdfFile/);
  assert.match(runtimeSource, /api\.uploadProposalFinalPdf/);
  assert.match(runtimeSource, /openFileInReservedWindow\(pdfFile, reserved\)/);
  assert.match(runtimeSource, /URL\.createObjectURL\(file\)/);
  assert.match(runtimeSource, /הדפסה \/ PDF/);
  assert.doesNotMatch(runtimeSource, /window\.print\(\)/);
  assert.doesNotMatch(runtimeSource, /image\/jpeg/);
  assert.doesNotMatch(runtimeSource, /createElement\(['"]canvas['"]\)/);
});

test('vector generator uses React PDF and never rasterizes proposal text', () => {
  assert.match(vectorSource, /@react-pdf\/renderer/);
  assert.match(vectorSource, /pdf\(element\)\.toBlob\(\)/);
  assert.match(vectorSource, /signature !== '%PDF-'/);
  assert.match(vectorSource, /direction: 'rtl'/);
  assert.match(vectorSource, /family: 'Arimo'/);
  assert.doesNotMatch(vectorSource, /createElement\(['"]canvas['"]\)/);
  assert.doesNotMatch(vectorSource, /image\/jpeg/);
  assert.doesNotMatch(vectorSource, /toDataURL|toBlob\([^)]*jpeg|screenshot/i);
});

test('direct proposal PDF actions open the proposal then generate the stored vector file', () => {
  assert.match(runtimeSource, /DIRECT_PRINT_SELECTOR = '\[data-pa-print\]'/);
  assert.match(runtimeSource, /generateProposalPdfById/);
  assert.match(runtimeSource, /data-pa-open-proposal-id/);
  assert.match(runtimeSource, /data-pa-preview/);
  assert.match(runtimeSource, /reservePdfWindow/);
  assert.match(runtimeSource, /generateStoreAndOpenProposalPdf/);
});

test('preview button configuration is idempotent and advertises automatic storage', () => {
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
  assert.equal(button.title, 'הפקת PDF ושמירה אוטומטית');
  assert.equal(button.getAttribute('aria-label'), 'הפקת PDF ושמירה אוטומטית');
});
