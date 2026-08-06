import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { configureProposalPreviewPrintButton } from '../frontend/src/proposal-incomplete-print-runtime.js';

const entrySource = await readFile(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const runtimeSource = await readFile(new URL('../frontend/src/proposal-incomplete-print-runtime.js', import.meta.url), 'utf8');

test('flexible proposal print runtime loads before the application', () => {
  const runtimeIndex = entrySource.indexOf("import './proposal-incomplete-print-runtime.js");
  const mainIndex = entrySource.indexOf("import './main.js';");
  assert.ok(runtimeIndex >= 0, 'proposal incomplete print runtime must be imported');
  assert.ok(mainIndex > runtimeIndex, 'print runtime must load before main.js');
});

test('preview print bypasses saved-PDF validation and uses the browser print dialog', () => {
  assert.match(runtimeSource, /#pa-preview-overlay/);
  assert.match(runtimeSource, /#pa-print-btn/);
  assert.match(runtimeSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(runtimeSource, /window\.print\(\)/);
  assert.match(runtimeSource, /הדפסה \/ PDF/);
  assert.match(runtimeSource, /גם כאשר חסרים פרטים/);
});

test('runtime is limited to the preview button and does not alter proposal save rules', () => {
  assert.doesNotMatch(runtimeSource, /validatePayload/);
  assert.doesNotMatch(runtimeSource, /uploadProposalFinalPdf/);
  assert.doesNotMatch(runtimeSource, /data-pa-print/);
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
  assert.equal(button.title, 'הדפסה או שמירה כ־PDF גם כאשר חסרים פרטים');
  assert.equal(button.getAttribute('aria-label'), 'הדפסה או שמירה כ־PDF');
});
