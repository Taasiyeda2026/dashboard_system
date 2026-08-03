import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const {
  isSchoolProposalPdfFilenameType,
  proposalSchoolPdfTitle,
  resolveProposalSchoolPdfTitle,
  updateProposalSchoolPdfDocumentTitle
} = await import('../frontend/src/proposal-pdf-school-filename-runtime.js');

test('GEFEN and next-year PDF titles use the school name only', () => {
  assert.equal(isSchoolProposalPdfFilenameType('gefen'), true);
  assert.equal(isSchoolProposalPdfFilenameType('next_year'), true);
  assert.equal(isSchoolProposalPdfFilenameType('summer'), false);
  assert.equal(
    proposalSchoolPdfTitle({ typeKey: 'gefen', semelMosad: '640672', schoolName: "מקיף ה' כללי" }),
    "הצעת מחיר מקיף ה' כללי"
  );
  assert.equal(
    proposalSchoolPdfTitle({ typeKey: 'תשפ״ז', semelMosad: '441212', schoolName: 'חט"ב תיכון ריגלר' }),
    'הצעת מחיר חטב תיכון ריגלר'
  );
});

test('school code is used only as a fallback when the school name is missing', () => {
  assert.equal(
    proposalSchoolPdfTitle({ typeKey: 'gefen', semelMosad: '288209', schoolName: '' }),
    'הצעת מחיר 288209'
  );
});

test('preview runtime reads the proposal form and updates the browser PDF title', () => {
  const dom = new JSDOM(`
    <form data-pa-form>
      <select name="activity_type_group"><option value="next_year" selected>תשפ״ז</option></select>
      <input name="contact_source_semel_mosad" value="218321">
      <input name="school_framework" value="אלביארוני">
    </form>
    <div id="pa-preview-overlay"><button id="pa-print-btn">PDF</button></div>
  `, { url: 'http://localhost/' });
  assert.equal(resolveProposalSchoolPdfTitle(dom.window.document), 'הצעת מחיר אלביארוני');
  assert.equal(updateProposalSchoolPdfDocumentTitle(dom.window.document), true);
  assert.equal(dom.window.document.title, 'הצעת מחיר אלביארוני');
});

test('database migration keeps the same filename contract and backfills saved PDFs', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260803121500_proposal_pdf_filename_school_name_only.sql', import.meta.url),
    'utf8'
  );
  assert.match(sql, /הצעת מחיר /);
  assert.match(sql, /school_filename_name/);
  assert.match(sql, /school_name/);
  assert.match(sql, /next_year/);
  assert.match(sql, /gefen/);
  assert.match(sql, /update public\.proposals_agreements/);
});
