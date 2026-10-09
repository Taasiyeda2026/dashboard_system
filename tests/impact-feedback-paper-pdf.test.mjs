import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
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

test('nine actual green-leadership PRE rating questions fit on one printable A4 page', async () => {
  const [regularData, boldData] = await Promise.all([
    readFile(new URL('Alef-Regular.ttf', assets)),
    readFile(new URL('Alef-Bold.ttf', assets))
  ]);
  // Questions match the published green leadership PRE syllabus at migration time.
  const wording = [
    'אני מבין/ה מה לומדים בתחום {topic} ואיך משתמשים בו בעולם האמיתי',
    'אני מאמין/ה שאני מסוגל/ת לפתח רעיון לפתרון של בעיה אמיתית',
    'התחום של {topic} מעניין אותי',
    'אני אוהב/ת לשאול שאלות ולחקור איך דברים עובדים',
    'אני יודע/ת לעבוד בצוות כדי לפתח רעיון משותף',
    'אני חושב/ת שמדע וטכנולוגיה יכולים לעזור לפתור בעיות אמיתיות בעולם',
    'הייתי רוצה להמשיך ללמוד ולהתנסות בתחום {topic} גם בעתיד',
    'אני מרגיש/ה אחריות לשמור על הסביבה בבית הספר ובקהילה שלי',
    'אני מרגיש/ה שאני יכול/ה להוביל יוזמה סביבתית ולהשפיע בבית הספר או בקהילה'
  ];
  const bytes = await buildQuestionnairePdf({
    program: { title: 'מנהיגות ירוקה', topic: 'מנהיגות ירוקה – אחריות סביבתית', gefen_numbers: ['67867'] },
    template: { audience: 'student', stage: 'pre', current_version_id: 'published-pre-green' },
    version: { id: 'published-pre-green', intro_text: 'משוב פתיחה על התוכנית' },
    questions: wording.map((text) => ({ question_type: 'rating_1_5', wording: { default: text }, required: true, scoring: { include_in_score: true } })),
    regularData,
    boldData
  });
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1, 'A nine-item rating questionnaire must not spill onto a second sheet');
  assert.equal(pdf.getPages()[0].getWidth(), 595.28);
  // Check actual PDF text extraction: do not accept a visually plausible
  // document with mirrored Hebrew words or reversed Gefen identifiers.
  const pdfLoadTask = getDocument({ data: bytes });
  const extractedPdf = await pdfLoadTask.promise;
  const content = await (await extractedPdf.getPage(1)).getTextContent();
  const extractedText = content.items.map((item) => item.str).join(' ');
  assert.match(extractedText, /מנהיגות ירוקה/, 'Hebrew words must remain readable');
  assert.match(extractedText, /67867/, 'Geffen code must retain left-to-right digit order');
  assert.doesNotMatch(extractedText, /76876/, 'Reversed Gefen number must never be printed');
  await pdfLoadTask.destroy();
  if (process.env.IFB_PDF_SMOKE_OUTPUT) await writeFile(process.env.IFB_PDF_SMOKE_OUTPUT, bytes);
});
