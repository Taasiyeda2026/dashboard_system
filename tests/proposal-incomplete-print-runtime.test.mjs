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

test('preview PDF action bypasses the legacy generator and uses browser print', () => {
  assert.match(runtimeSource, /#pa-preview-overlay/);
  assert.match(runtimeSource, /#pa-print-btn/);
  assert.match(runtimeSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(runtimeSource, /window\.print\(\)/);
  assert.match(runtimeSource, /הדפסה \/ PDF/);
  assert.doesNotMatch(runtimeSource, /uploadProposalFinalPdf/);
  assert.doesNotMatch(runtimeSource, /image\/jpeg/);
  assert.doesNotMatch(runtimeSource, /createElement\(['"]canvas['"]\)/);
});

test('proposal browser print isolates the preview from dashboard layout', () => {
  assert.match(runtimeSource, /enterProposalPrintMode/);
  assert.match(runtimeSource, /classList\.add\('is-print-preview'\)/);
  assert.match(runtimeSource, /classList\.remove\('is-print-preview'\)/);
  assert.match(runtimeSource, /addEventListener\('beforeprint', enterProposalPrintMode\)/);
  assert.match(runtimeSource, /addEventListener\('afterprint', exitProposalPrintMode\)/);
  assert.match(runtimeSource, /invokeProposalBrowserPrint\(\)/);
});

test('direct proposal PDF actions are intercepted before the legacy raster path', () => {
  assert.match(runtimeSource, /DIRECT_PRINT_SELECTOR = '\[data-pa-print\]'/);
  assert.match(runtimeSource, /directPrintButton/);
  assert.match(runtimeSource, /printProposalById/);
  assert.match(runtimeSource, /data-pa-open-proposal-id/);
  assert.match(runtimeSource, /data-pa-preview/);
  assert.match(runtimeSource, /stopImmediatePropagation\(\)/);
  assert.match(runtimeSource, /window\.print\(\)/);
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
  assert.equal(button.title, PRINT_TITLE = 'הדפסה או שמירה כ־PDF');
  assert.equal(button.getAttribute('aria-label'), 'הדפסה או שמירה כ־PDF');
});
