import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { buildQuestionnairePdf } from '../frontend/src/impact-feedback/feedback-print-pdf.js';

const assets = new URL('../frontend/assets/fonts/', import.meta.url);

test('printable feedback PDF is a real A4 document using the published version', async () => {
  const [regularData, boldData] = await Promise.all([
    readFile(new URL('Alef-Regular.ttf', assets)),
    readFile(new URL('Alef-Bold.ttf', assets))
  ]);
  const template = {
    audience: 'student',
    stage: 'post',
    current_version_id: 'published-v2'
  };
  const questions = [
    { question_type: 'rating_1_5', wording: { default: 'אני אוהב/ת את {topic}' }, required: true, scoring: { allow_na: true } },
    { question_type: 'yes_no', wording: { default: 'האם התוכנית מעניינת?' }, required: true },
    { question_type: 'single_select', wording: { default: 'בחירה אחת' }, options: [{ value: 'a', label: 'אפשרות ראשונה' }, { value: 'b', label: 'אפשרות שנייה' }] },
    { question_type: 'multi_select', wording: { default: 'בחירה מרובה' }, options: [{ value: 'a', label: 'מוצר מדעי' }, { value: 'b', label: 'מוצר טכנולוגי' }] },
    { question_type: 'free_text', wording: { default: 'מה היית משנה או משפר/ת?' }, required: false }
  ];
  const bytes = await buildQuestionnairePdf({
    program: { title: 'מנהיגות ירוקה', topic: 'מנהיגות ירוקה – אחריות סביבתית', gefen_numbers: ['67867'] },
    template,
    version: { id: 'published-v2', intro_text: 'משוב סיום על התוכנית' },
    questions,
    regularData,
    boldData
  });
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString(), '%PDF-');
  // Both complete embedded TrueType fonts must be present, not Acrobat-fragile
  // fontkit subsets (which yielded the scrambled Hebrew reported by users).
  assert.ok(bytes.length > 25_000, 'Embedded Hebrew fonts must be present in the PDF');
  if (process.env.IFB_PDF_SMOKE_OUTPUT) {
    await writeFile(process.env.IFB_PDF_SMOKE_OUTPUT, bytes);
  }
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  for (const page of pdf.getPages()) {
    assert.ok(Math.abs(page.getWidth() - 595.28) < 1);
    assert.ok(Math.abs(page.getHeight() - 841.89) < 1);
  }
});

test('printed PDF refuses a draft or mismatched version', async () => {
  await assert.rejects(
    buildQuestionnairePdf({
      template: { current_version_id: 'published-v2' },
      program: { title: 'ביומימיקרי' },
      version: { id: 'other-version' },
      questions: []
    }),
    /template_version_mismatch/
  );
});

test('the dedicated templates tab does not duplicate templates on audience tabs', async () => {
  const screen = await readFile(new URL('../frontend/src/screens/impact-feedback.js', import.meta.url), 'utf8');
  const templates = await readFile(new URL('../frontend/src/impact-feedback/feedback-templates-view.js', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../frontend/src/impact-feedback/impact-feedback-admin.css', import.meta.url), 'utf8');
  assert.match(screen, /key: 'templates', label: 'תבניות'/);
  assert.match(screen, /if \(ui\.tab === 'templates'\) return renderTemplatesView\(ui\)/);
  assert.equal((screen.match(/renderTemplatesView\(ui/g) || []).length, 1);
  assert.match(templates, /data-tpl-pdf/);
  assert.match(templates, /fetchVersionQuestions\(template\.current_version_id\)/);
  assert.match(templates, /ifb-template-card__slot/);
  assert.match(styles, /grid-template-columns: repeat\(auto-fill, minmax\(min\(100%, 180px\), 1fr\)\)/);
  assert.match(styles, /var\(--ifb-a-accent\)/);
  assert.match(screen, /data-ifb-share="whatsapp"/);
  assert.match(screen, /data-ifb-share="email"/);
  assert.match(screen, /data-ifb-qr/);
  assert.match(screen, /data-ifb-analyze/);
});

test('Hebrew questionnaire text uses full fonts and retains logical Unicode character order', async () => {
  const source = await readFile(new URL('../frontend/src/impact-feedback/feedback-print-pdf.js', import.meta.url), 'utf8');
  assert.match(source, /pdf\.embedFont\(regularData, \{ subset: false \}\)/);
  assert.match(source, /pdf\.embedFont\(boldData, \{ subset: false \}\)/);
  assert.doesNotMatch(source, /getReorderSegments|getMirroredCharactersMap|rightToLeft\(/);
  assert.match(source, /const rendered = clean\(text\);/);
});
