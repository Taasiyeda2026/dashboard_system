/**
 * Printable, paper-only copy of a published feedback questionnaire.
 * No response state, recipient identity or submission API is involved.
 */
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const RIGHT = PAGE_WIDTH - 44;
const LEFT = 44;
const CONTENT_WIDTH = RIGHT - LEFT;
const INK = rgb(0.12, 0.15, 0.21);
const MUTED = rgb(0.36, 0.40, 0.46);
const LINE = rgb(0.78, 0.81, 0.84);

export const PAPER_SLOT_NAMES = Object.freeze({
  'student:pre': 'תלמידים – פתיחה',
  'student:post': 'תלמידים – סיום',
  'instructor:pre': 'מדריכים – פתיחה',
  'instructor:final': 'מדריכים – סיום',
  'educational_staff:final': 'צוות חינוכי'
});

function clean(value) {
  return String(value ?? '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// fontkit shapes Hebrew from its original logical Unicode order.
// Passing manually reversed "visual order" strings causes a second reversal
// in PDF viewers such as Adobe Acrobat. Never reorder letters here.

function lineWidth(font, text, size) {
  return font.widthOfTextAtSize(clean(text), size);
}

function wrapText(text, font, size, width) {
  const source = clean(text);
  if (!source) return [];
  const lines = [];
  let current = '';
  for (const word of source.split(' ')) {
    const candidate = current ? `${current} ${word}` : word;
    if (lineWidth(font, candidate, size) <= width) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = '';
    for (const character of Array.from(word)) {
      if (current && lineWidth(font, current + character, size) > width) {
        lines.push(current);
        current = '';
      }
      current += character;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawRight(page, font, text, size, y, right = RIGHT, color = INK) {
  const rendered = clean(text);
  page.drawText(rendered, {
    x: right - font.widthOfTextAtSize(rendered, size),
    y,
    size,
    font,
    color
  });
}

function drawBox(page, x, y) {
  page.drawRectangle({ x, y, width: 12, height: 12, borderWidth: 0.85, borderColor: MUTED });
}

function questionAnswerHeight(question, font) {
  const type = question.question_type;
  const na = type === 'rating_1_5' && question.scoring?.allow_na === true;
  // Compact one-row ratings: 9-question student PRE surveys fit on one A4 sheet.
  if (type === 'rating_1_5') return na ? 37 : 20;
  if (type === 'yes_no') return 31;
  if (type === 'free_text') return 105;
  if (type === 'single_select' || type === 'multi_select') {
    return (question.options || []).reduce((sum, option) =>
      sum + Math.max(23, wrapText(option.label || option.value, font, 10, CONTENT_WIDTH - 34).length * 15 + 7), 8);
  }
  return 55;
}

async function loadAsset(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('asset_not_available');
  return response.arrayBuffer();
}

function downloadBytes(bytes, filename) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

/**
 * Generate a searchable, font-embedded A4 PDF from the actual published version.
 * Printed submissions remain entirely outside the digital feedback statistics.
 */
export async function buildQuestionnairePdf({ program, template, version, questions, regularData, boldData, logoData = null }) {
  if (!template?.current_version_id || !program || !version || !Array.isArray(questions)) {
    throw new Error('published_template_required');
  }
  if (version.id !== template.current_version_id) throw new Error('template_version_mismatch');

  if (!regularData || !boldData) throw new Error('font_required');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // Fontkit's subset CID encoding renders scrambled Hebrew in Adobe Acrobat.
  // Embed the complete TrueType fonts so Acrobat and other readers use stable
  // Unicode glyph mappings. Keep selectable vector text (never screenshot).
  const regular = await pdf.embedFont(regularData, { subset: false });
  const bold = await pdf.embedFont(boldData, { subset: false });
  const logo = logoData ? await pdf.embedPng(logoData) : null;

  const stage = PAPER_SLOT_NAMES[`${template.audience}:${template.stage}`] || 'שאלון משוב';
  const title = clean(program.title);
  const gefen = Array.isArray(program.gefen_numbers) ? program.gefen_numbers.filter(Boolean).join(', ') : '';
  let page;
  let y;
  function newPage() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    if (logo) {
      const scaled = logo.scale(Math.min(104 / logo.width, 43 / logo.height));
      page.drawImage(logo, { x: LEFT, y: 752, width: scaled.width, height: scaled.height });
    }
    drawRight(page, bold, 'תעשיידע', 14, 788);
    drawRight(page, bold, title, 18, 758);
    drawRight(page, regular, [stage, gefen ? `גפ״ן ${gefen}` : ''].filter(Boolean).join(' · '), 10, 734, RIGHT, MUTED);
    page.drawLine({ start: { x: LEFT, y: 720 }, end: { x: RIGHT, y: 720 }, thickness: 1, color: LINE });
    y = 699;
  }
  function ensureSpace(height) {
    if (y - height < 55) newPage();
  }
  newPage();

  if (version.intro_text) {
    const introLines = wrapText(version.intro_text, regular, 10.5, CONTENT_WIDTH);
    for (const text of introLines) {
      ensureSpace(20);
      drawRight(page, regular, text, 10.5, y);
      y -= 16;
    }
    y -= 13;
  }

  for (const [index, question] of questions.entries()) {
    const text = clean(question.wording?.default).replaceAll('{topic}', clean(program.topic));
    const heading = `${index + 1}. ${text}${question.required === false ? ' (לא חובה)' : ''}`;
    const headingLines = wrapText(heading, bold, 11, CONTENT_WIDTH);
    const answerHeight = questionAnswerHeight(question, regular);
    ensureSpace(headingLines.length * 16 + answerHeight + 26);
    page.drawLine({ start: { x: LEFT, y: y + 6 }, end: { x: RIGHT, y: y + 6 }, thickness: 0.5, color: LINE });
    for (const line of headingLines) {
      drawRight(page, bold, line, 11, y);
      y -= 16;
    }
    y -= 5;

    if (question.question_type === 'rating_1_5') {
      for (let n = 1; n <= 5; n += 1) {
        const x = RIGHT - 40 - (n - 1) * 85;
        drawBox(page, x, y - 1);
        drawRight(page, bold, String(n), 10, y + 1, x - 7);
      }
      y -= 18;
      drawRight(page, regular, '1 – בכלל לא', 9, y, RIGHT, MUTED);
      drawRight(page, regular, '5 – במידה רבה מאוד', 9, y, RIGHT - 333, MUTED);
      y -= 15;
      if (question.scoring?.allow_na === true) {
        drawBox(page, RIGHT - 14, y - 1);
        drawRight(page, regular, 'לא רלוונטי / לא הייתה אפשרות להעריך', 9, y, RIGHT - 20);
        y -= 17;
      }
    } else if (question.question_type === 'yes_no') {
      for (const [n, label] of ['כן', 'לא'].entries()) {
        const x = RIGHT - 15 - n * 115;
        drawBox(page, x, y - 2);
        drawRight(page, regular, label, 10, y, x - 8);
      }
      y -= 31;
    } else if (question.question_type === 'single_select' || question.question_type === 'multi_select') {
      for (const option of question.options || []) {
        const labelLines = wrapText(option.label || option.value, regular, 10, CONTENT_WIDTH - 34);
        ensureSpace(Math.max(23, labelLines.length * 15 + 7));
        drawBox(page, RIGHT - 14, y - 3);
        for (const line of labelLines) {
          drawRight(page, regular, line, 10, y, RIGHT - 24);
          y -= 15;
        }
        y -= 8;
      }
    } else if (question.question_type === 'free_text') {
      for (let i = 0; i < 4; i += 1) {
        page.drawLine({ start: { x: LEFT, y: y - 12 }, end: { x: RIGHT, y: y - 12 }, thickness: .55, color: LINE });
        y -= 24;
      }
    } else {
      y -= 35;
    }
    y -= 8;
  }

  for (const [i, p] of pdf.getPages().entries()) {
    p.drawLine({ start: { x: LEFT, y: 45 }, end: { x: RIGHT, y: 45 }, thickness: .5, color: LINE });
    drawRight(p, regular, `עמוד ${i + 1} מתוך ${pdf.getPageCount()}`, 9, 30, RIGHT, MUTED);
  }

  return pdf.save();
}

/** Download the currently published questionnaire as a paper-only PDF. */
export async function downloadQuestionnairePdf({ program, template, version, questions }) {
  const [regularData, boldData] = await Promise.all([
    loadAsset(new URL('../../assets/fonts/Alef-Regular.ttf', import.meta.url)),
    loadAsset(new URL('../../assets/fonts/Alef-Bold.ttf', import.meta.url))
  ]);
  let logoData = null;
  try {
    logoData = await loadAsset(new URL('../../assets/logo1.png', import.meta.url));
  } catch {
    // The questionnaire must still print if the optional logo is unavailable.
  }
  const bytes = await buildQuestionnairePdf({ program, template, version, questions, regularData, boldData, logoData });
  const stage = PAPER_SLOT_NAMES[`${template.audience}:${template.stage}`] || 'שאלון משוב';
  const filePart = (value) => clean(value).replace(/[\\/?:*"<>|]/g, '-').slice(0, 70);
  downloadBytes(bytes, `משוב-${filePart(program.title)}-${filePart(stage)}.pdf`);
}
