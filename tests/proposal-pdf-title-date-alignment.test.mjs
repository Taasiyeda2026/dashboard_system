import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { alignProposalPdfTitleDate } from '../frontend/src/gefen-proposal-pdf-header-alignment.js';

test('centers proposal title and places date at the far left on the same row', () => {
  const dom = new JSDOM(`
    <div class="proposal-document">
      <div class="pa-doc-date">28/07/2026</div>
      <div class="pa-proposal-body-footer-shell">
        <div class="proposal-document-content">
          <h1 class="pa-doc-title">הצעת מחיר 10176 פעילויות תעשיידע | תשפ״ז</h1>
          <p>פתיח</p>
        </div>
      </div>
    </div>`);

  assert.equal(alignProposalPdfTitleDate(dom.window.document), 1);
  const content = dom.window.document.querySelector('.proposal-document-content');
  const row = content.querySelector('[data-pa-title-date-row]');
  const title = row.querySelector('.pa-doc-title');
  const date = row.querySelector('.pa-doc-date');

  assert.ok(row);
  assert.equal(row.parentElement, content);
  assert.equal(row.children[0], date);
  assert.equal(row.children[1], title);
  assert.equal(row.style.getPropertyValue('grid-template-columns'), 'minmax(0, 1fr) minmax(0, 4fr) minmax(0, 1fr)');
  assert.equal(row.style.getPropertyPriority('grid-template-columns'), 'important');
  assert.equal(title.style.getPropertyValue('grid-column'), '2');
  assert.equal(title.style.getPropertyValue('text-align'), 'center');
  assert.equal(date.style.getPropertyValue('grid-column'), '1');
  assert.equal(date.style.getPropertyValue('text-align'), 'left');
});

test('aligns the Gefen approval page and remains idempotent', () => {
  const dom = new JSDOM(`
    <div class="proposal-document pa-proposal-doc--gefen pa-gefen-approval-document">
      <div class="proposal-document-content">
        <div class="pa-doc-date pa-gefen-approval-date">28/07/2026</div>
        <h1 class="pa-doc-title">אישור כוונות להזמנה במערכת גפ״ן | תשפ״ז</h1>
      </div>
    </div>`);

  assert.equal(alignProposalPdfTitleDate(dom.window.document), 1);
  assert.equal(alignProposalPdfTitleDate(dom.window.document), 1);
  assert.equal(dom.window.document.querySelectorAll('[data-pa-title-date-row]').length, 1);
  assert.equal(dom.window.document.querySelector('[data-pa-title-date-row] .pa-gefen-approval-date')?.textContent, '28/07/2026');
});
