import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { installProposalDirectApprovalNoAutoPdf } from '../frontend/src/proposal-direct-approval-no-auto-pdf.js';

test('direct signed approval suppresses only the following synthetic PDF click', () => {
  const dom = new JSDOM(`<main id="root">
    <button data-pa-save-pending data-pa-target-status="approved">חתום ואשר</button>
    <button data-pa-print="proposal-1">PDF</button>
  </main>`, { url: 'http://localhost/' });
  const root = dom.window.document.getElementById('root');
  let pdfClicks = 0;
  root.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-pa-print]')) pdfClicks += 1;
  });

  assert.equal(installProposalDirectApprovalNoAutoPdf({ document: dom.window.document }), true);
  dom.window.document.querySelector('[data-pa-save-pending]').click();

  // button.click() creates an untrusted event, matching the automatic PDF scheduler.
  dom.window.document.querySelector('[data-pa-print]').click();
  assert.equal(pdfClicks, 0);

  // The guard is one-shot; normal PDF behavior is not globally disabled.
  dom.window.document.querySelector('[data-pa-print]').click();
  assert.equal(pdfClicks, 1);
});

test('synthetic PDF action is untouched when no direct approval preceded it', () => {
  const dom = new JSDOM(`<main id="root"><button data-pa-print="proposal-2">PDF</button></main>`, { url: 'http://localhost/' });
  const root = dom.window.document.getElementById('root');
  let pdfClicks = 0;
  root.addEventListener('click', (event) => {
    if (event.target.closest?.('[data-pa-print]')) pdfClicks += 1;
  });

  assert.equal(installProposalDirectApprovalNoAutoPdf({ document: dom.window.document }), true);
  dom.window.document.querySelector('[data-pa-print]').click();
  assert.equal(pdfClicks, 1);
});
