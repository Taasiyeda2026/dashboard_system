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

test('school-linked proposal PDF titles use the school name only across proposal types', () => {
  assert.equal(isSchoolProposalPdfFilenameType('gefen'), true);
  assert.equal(isSchoolProposalPdfFilenameType('next_year'), true);
  assert.equal(isSchoolProposalPdfFilenameType('summer'), true);
  assert.equal(isSchoolProposalPdfFilenameType('tour'), true);
  assert.equal(isSchoolProposalPdfFilenameType('combined'), true);
  assert.equal(
    proposalSchoolPdfTitle({ typeKey: 'gefen', semelMosad: '640672', schoolName: "מקיף ה' כללי" }),
    "הצעת מחיר מקיף ה' כללי"
  );
  assert.equal(
    proposalSchoolPdfTitle({ typeKey: 'summer', semelMosad: '441212', schoolName: 'חט"ב תיכון ריגלר' }),
    'הצעת מחיר חטב תיכון ריגלר'
  );
});

test('school code is used only as a fallback when the school name is missing', () => {
  assert.equal(
    proposalSchoolPdfTitle({ typeKey: 'gefen', semelMosad: '288209', schoolName: '' }),
    'הצעת מחיר 288209'
  );
  assert.equal(proposalSchoolPdfTitle({ typeKey: 'summer', semelMosad: '', schoolName: '' }), '');
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

test('preview-only context still derives the school filename without an editor form', () => {
  const dom = new JSDOM(`
    <div id="pa-preview-overlay">
      <div class="ds-pa-preview-client">קריית גת — כרמים</div>
      <button id="pa-print-btn">PDF</button>
    </div>
  `, { url: 'http://localhost/' });
  assert.equal(resolveProposalSchoolPdfTitle(dom.window.document), 'הצעת מחיר כרמים');
  assert.equal(updateProposalSchoolPdfDocumentTitle(dom.window.document), true);
  assert.equal(dom.window.document.title, 'הצעת מחיר כרמים');
});

test('database migration applies the same filename contract to newly saved school PDFs', async () => {
  const sql = await readFile(
    new URL('../supabase/migrations/20260913020000_proposal_pdf_filename_school_name_all_types.sql', import.meta.url),
    'utf8'
  );
  assert.match(sql, /הצעת מחיר /);
  assert.match(sql, /school_filename_name/);
  assert.match(sql, /school_name/);
  assert.match(sql, /new\.final_pdf_file_name := 'הצעת מחיר ' \|\| recipient_label \|\| '\.pdf'/);
  assert.match(sql, /school_filename_name <> '' or semel_mosad <> ''/);
  assert.doesNotMatch(sql, /update public\.proposals_agreements/);
});
