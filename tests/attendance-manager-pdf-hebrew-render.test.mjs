import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function loadPdfLibs() {
  try {
    return {
      PDFDocument: require('pdf-lib').PDFDocument,
      rgb: require('pdf-lib').rgb,
      fontkit: require('@pdf-lib/fontkit'),
      bidiFactory: require('bidi-js'),
    };
  } catch {
    return null;
  }
}

async function buildHebrewFixture({ regularBytes, boldBytes, subset = true }) {
  const libs = loadPdfLibs();
  assert.ok(libs, 'PDF test dependencies must be installed');
  const { PDFDocument, rgb, fontkit, bidiFactory } = libs;
  const bidi = bidiFactory();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(regularBytes, { subset });
  const bold = await pdf.embedFont(boldBytes, { subset });
  const page = pdf.addPage([595, 842]);
  const lines = [
    ['תעשיידע — דוח נוכחות חודשי', bold, 15],
    ['ורד עליאן  |  ספטמבר 2026', bold, 12],
    ['עובד: 1530  |  חודש דיווח: ספטמבר', regular, 10],
    ['הכשרת בסיס — תעשיידע', bold, 11],
    ['מיקום / בית ספר: מרכז הדרכה תעשיידע', regular, 10],
    ['שעת התחלה 10:00  |  שעת סיום 15:00', regular, 10],
    ['טכנולוגיות החלל — פעילות מקוונת', bold, 11],
    ['בית ספר אלנור  |  נסיעה 12 ק״מ', regular, 10],
    ['הוצאות מאושרות: 15.00 ₪', regular, 10],
    ['סה״כ שעות עבודה מאושרות לחודש', bold, 11],
    ['אישור עובד: ורד עליאן', regular, 10],
    ['אישור מנהל: גיל נאמן', regular, 10],
    ['אושר במערכת  |  05.10.2026 13:49', regular, 10],
    ['המסמך הופק ממערכת הנוכחות של תעשיידע', regular, 9],
  ];
  let y = 790;
  for (const [logical, font, size] of lines) {
    const visual = rtlVisual(logical, bidi);
    const width = font.widthOfTextAtSize(visual, size);
    page.drawText(visual, {
      x: Math.max(40, 555 - width),
      y,
      size,
      font,
      color: rgb(0.08, 0.11, 0.17),
    });
    y -= 34;
  }
  return new Uint8Array(await pdf.save());
}

async function inspectRenderedPdf(bytes) {
  const canvasModule = await import('@napi-rs/canvas');
  globalThis.DOMMatrix ||= canvasModule.DOMMatrix;
  globalThis.ImageData ||= canvasModule.ImageData;
  globalThis.Path2D ||= canvasModule.Path2D;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, disableWorker: true }).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();
  const viewport = page.getViewport({ scale: 1.5 });
  const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let inkPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 220 || pixels[index + 1] < 220 || pixels[index + 2] < 220) inkPixels += 1;
  }
  return {
    extracted: content.items.map((item) => item.str).join(' '),
    inkPixels,
    png: canvas.toBuffer('image/png'),
  };
}

function normalizeFolderWebUrl(folderWebUrl) {
  const raw = String(folderWebUrl || '').trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const path = url.pathname.toLowerCase();
    const isFormsView = path.includes('/forms/view.aspx') || path.includes('/forms/allitems.aspx');
    if (!isFormsView) return raw;
    const folderId = url.searchParams.get('id') || url.searchParams.get('RootFolder') || '';
    if (!folderId) return raw;
    let decoded = folderId;
    try {
      decoded = decodeURIComponent(folderId);
    } catch {
      decoded = folderId;
    }
    if (!decoded.startsWith('/')) return raw;
    return `${url.origin}${decoded}`;
  } catch {
    return raw;
  }
}

function rtlVisual(source, bidi) {
  const text = String(source || '').trim().replace(/\s+/g, ' ');
  if (!text) return '';
  const chars = text.split('');
  const levels = bidi.getEmbeddingLevels(text, 'rtl');
  const segments = bidi.getReorderSegments(text, levels);
  for (const [start, end] of segments) {
    let left = start;
    let right = end;
    while (left < right) {
      const temp = chars[left];
      chars[left] = chars[right];
      chars[right] = temp;
      left += 1;
      right -= 1;
    }
  }
  return chars.join('');
}

test('SharePoint Forms/view.aspx folder URLs normalize to canonical folder paths', () => {
  const formsUrl = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/Forms/view.aspx?id=%2Fsites%2Ftaasiyeda2027%2FShared%20Documents%2F%D7%AA%D7%99%D7%A7%D7%99%D7%9D%20%D7%90%D7%99%D7%A9%D7%99%D7%99%D7%9D%2F%D7%90%D7%99%D7%9C%D7%A0%D7%94%20%D7%98%D7%99%D7%98%D7%99%D7%99%D7%91%D7%A1%D7%A7%D7%99&viewid=20f573d0-1255-4a8a-bbf6-c9c914f04e1b';
  const canonical = 'https://think365orgil.sharepoint.com/sites/taasiyeda2027/Shared%20Documents/%D7%AA%D7%99%D7%A7%D7%99%D7%9D%20%D7%90%D7%99%D7%A9%D7%99%D7%99%D7%9D/%D7%90%D7%A4%D7%A8%D7%AA%20%D7%90%D7%95%D7%97%D7%99%D7%95%D7%9F';
  const normalized = normalizeFolderWebUrl(formsUrl);
  assert.match(normalized, /\/sites\/taasiyeda2027\/Shared Documents\/תיקים אישיים\/אילנה טיטייבסקי$/);
  assert.equal(normalizeFolderWebUrl(canonical), canonical);
  assert.doesNotMatch(normalized, /Forms\/view\.aspx/i);
});

test('Alef-subset attendance fixture renders complete Hebrew while reproducing both Arimo failures', async () => {
  const libs = loadPdfLibs();
  if (!libs) {
    assert.fail('PDF test dependencies are required for the Hebrew rendering regression');
    return;
  }
  const { PDFDocument, fontkit } = libs;
  const arimoRegular = await readFile(new URL('../frontend/assets/fonts/Arimo-Regular.ttf', import.meta.url));
  const arimoBold = await readFile(new URL('../frontend/assets/fonts/Arimo-Bold.ttf', import.meta.url));
  const alefRegular = await readFile(new URL('../frontend/assets/fonts/Alef-Regular.ttf', import.meta.url));
  const alefBold = await readFile(new URL('../frontend/assets/fonts/Alef-Bold.ttf', import.meta.url));

  await assert.rejects(async () => {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(fontkit);
    const regular = await pdf.embedFont(arimoRegular, { subset: false });
    const bold = await pdf.embedFont(arimoBold, { subset: false });
    const page = pdf.addPage([595, 842]);
    page.drawText('דוח נוכחות עברי', { x: 40, y: 700, size: 14, font: bold });
    page.drawText('אישור עובד ומנהל', { x: 40, y: 680, size: 12, font: regular });
    await pdf.save();
  }, /beyond buffer length|RangeError/i);

  const brokenBytes = await buildHebrewFixture({ regularBytes: arimoRegular, boldBytes: arimoBold, subset: true });
  const alefBytes = await buildHebrewFixture({ regularBytes: alefRegular, boldBytes: alefBold, subset: true });
  assert.ok(alefBytes.length > 500, 'PDF should embed Alef subset fonts');
  const broken = await inspectRenderedPdf(brokenBytes.slice());
  const rendered = await inspectRenderedPdf(alefBytes.slice());
  assert.ok(rendered.inkPixels > broken.inkPixels * 1.35, `Alef raster should restore Hebrew glyphs (${rendered.inkPixels} vs ${broken.inkPixels})`);
  for (const ch of ['ת', 'ע', 'ש', 'י', 'ד', 'ו', 'ר', 'ל', 'א', 'נ']) {
    assert.ok(rendered.extracted.includes(ch), `expected Hebrew glyph ${ch} in rendered PDF text layer`);
  }
  const outDir = '/tmp/attendance-pdf-artifacts';
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'attendance-hebrew-alef-subset.pdf'), alefBytes);
  await writeFile(join(outDir, 'attendance-hebrew-alef-render.png'), rendered.png);
  await writeFile(join(outDir, 'attendance-hebrew-arimo-broken-render.png'), broken.png);
});

test('production attendance PDF uses Alef subset fonts and preserves one byte stream through persistence and email', async () => {
  const handler = await readFile(new URL('../supabase/functions/payroll-attendance-pdf-dispatch/handler.ts', import.meta.url), 'utf8');
  assert.match(handler, /Alef-Regular\.ttf/);
  assert.match(handler, /Alef-Bold\.ttf/);
  assert.doesNotMatch(handler, /ARIMO_(?:REGULAR|BOLD)_URL/);
  assert.equal((handler.match(/embedFont\([^\n]+\{ subset: true \}\)/g) || []).length, 2);
  assert.match(handler, /const pdfBytes = await buildPdfBytes/);
  assert.match(handler, /uploadUniquePdf\([\s\S]*?pdfBytes/);
  assert.match(handler, /attachments:[\s\S]*?contentBytes: toBase64\(pdfBytes\)/);
});

test('manager approval PDF artifact migration decouples finalize from PDF and reuses av2 retry', async () => {
  const migration = await readFile(new URL('../supabase/migrations/20261005095629_manager_approval_pdf_artifact_decouple.sql', import.meta.url), 'utf8');
  assert.match(migration, /manager_pdf_fields_incomplete/);
  assert.doesNotMatch(
    migration.slice(0, migration.indexOf('attach_manager_attendance_month_pdf')),
    /raise exception 'manager_pdf_required'/,
  );
  assert.match(migration, /create or replace function public\.attach_manager_attendance_month_pdf/);
  assert.match(migration, /already_attached/);
  assert.match(
    migration,
    /grant execute on function public\.attach_manager_attendance_month_pdf\(text, text, text, text, text, integer\)\s+to service_role;/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.attach_manager_attendance_month_pdf\([\s\S]*?to authenticated/,
  );
  assert.match(migration, /create or replace function public\.av2_request_manager_pdf/);
  assert.match(migration, /payroll-attendance-pdf-dispatch/);
  assert.match(migration, /create or replace function public\.av2_retry_missing_pdfs/);
  assert.match(migration, /manager_pdf_sharepoint_url/);
  assert.match(migration, /av2_request_manager_pdf/);
});
