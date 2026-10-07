import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const regenerationMigrationUrl = new URL('supabase/migrations/20261006155202_manager_pdf_safe_regeneration_replace.sql', new URL('../', import.meta.url));


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
    ['1. 15.09.2026  |  הדרכה', bold, 11],
    ['12:00–12:05  |  4.08 שעות', regular, 10],
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
    const pdfText = pdfRtlText(logical, bidi);
    const width = font.widthOfTextAtSize(pdfText, size);
    page.drawText(pdfText, {
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

function pdfRtlText(source, bidi) {
  return Array.from(rtlVisual(source, bidi)).reverse().join('');
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
  assert.match(rendered.extracted, /תעשיידע — דוח נוכחות חודשי/, 'Hebrew heading must render in logical reading order');
  assert.match(rendered.extracted, /15\.09\.2026/, 'dates must not be reversed');
  assert.match(rendered.extracted, /4\.08 שעות/, 'decimal hours must not be reversed');
  assert.match(rendered.extracted, /1530/, 'employee IDs must not be reversed');
  assert.doesNotMatch(rendered.extracted, /6202\.90\.51|80\.4|0351/, 'known reversed numeric forms must never render');
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
  assert.match(handler, /function pdfRtlText\(value: unknown\)/);
  assert.match(handler, /Array\.from\(visual\)\.reverse\(\)\.join\(""\)/);
  assert.match(handler, /const pdfBytes = await buildPdfBytes/);
  assert.match(handler, /uploadUniquePdf\([\s\S]*?pdfBytes/);
  assert.match(handler, /attachments:[\s\S]*?contentBytes: toBase64\(pdfBytes\)/);
  assert.match(handler, /wantsForceRegenerate/);
  assert.match(handler, /suppressEmail/);
  assert.match(handler, /replace_manager_attendance_month_pdf/);
  assert.match(handler, /mailSent: !mailSuppressed && !mailError/);
  assert.match(handler, /\(wantsForceRegenerate \|\| suppressEmail\) && !isRetryCaller/);
  assert.match(handler, /function formatDurationHours\(value: unknown\)/);
  assert.match(handler, /formatDurationHours\(totalHours\)/);
  assert.match(handler, /const hours = formatDurationHours\(row\.workHours\)/);
  assert.match(handler, /אסמכתאות:/);
  assert.match(handler, /expenseDetails/);
  assert.doesNotMatch(handler, /totalHours\.toFixed\(2\)/);
  assert.doesNotMatch(handler, /const hours = toNumber\(row\.workHours\)\.toFixed\(2\)/);
});

test('production attendance PDF sizes rows from rendered content and keeps normal months compact', async () => {
  const handler = await readFile(new URL('../supabase/functions/payroll-attendance-pdf-dispatch/handler.ts', import.meta.url), 'utf8');

  assert.match(handler, /const primaryLines = wrapLogical\(/);
  assert.match(handler, /const details = \[place, secondary\]\.filter\(Boolean\)\.join\(" \| "\)/);
  assert.match(handler, /const detailLines = details \? wrapLogical/);
  assert.match(handler, /const blockHeight = ROW_TOP_AND_BOTTOM[\s\S]*primaryLines\.length \* PRIMARY_STEP[\s\S]*detailLines\.length \+ noteLines\.length/);
  assert.match(handler, /const ROW_GAP = 2\.5/);
  assert.doesNotMatch(handler, /const blockHeight = 49 \+/);
  assert.doesNotMatch(handler, /y -= blockHeight \+ 9/);

  // One primary line + one detail line is the normal case. At 32 PDF
  // points per record, 17 records fit in the first-page attendance area,
  // so a 20-record month plus approvals stays within two A4 pages.
  const typicalRowAdvance = 10 + 10 + 9.5 + 2.5;
  const firstPageAttendanceHeight = 594 - 48;
  assert.ok(Math.floor(firstPageAttendanceHeight / typicalRowAdvance) >= 17);
  assert.ok(20 - Math.floor(firstPageAttendanceHeight / typicalRowAdvance) <= 3);
});

test('production attendance PDF orders rows by calendar date and time', async () => {
  const handler = await readFile(new URL('../supabase/functions/payroll-attendance-pdf-dispatch/handler.ts', import.meta.url), 'utf8');

  assert.match(handler, /function attendanceDateSortKey\(value: unknown\)/);
  assert.match(handler, /attendanceDateSortKey\(left\.row\.date\)\.localeCompare\(attendanceDateSortKey\(right\.row\.date\)\)/);
  assert.match(handler, /clean\(left\.row\.startTime\) \|\| "99:99"/);
  assert.match(handler, /timeCompare \|\| left\.sourceIndex - right\.sourceIndex/);

  const dateKey = (value) => {
    const source = String(value || '').trim();
    const iso = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const display = source.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})/);
    return display ? `${display[3]}-${display[2].padStart(2, '0')}-${display[1].padStart(2, '0')}` : '9999-99-99';
  };
  const rows = [
    { date: '30.09.2026', startTime: '09:45', id: '30' },
    { date: '2026-09-15', startTime: '', id: '15-cancel' },
    { date: '2026-09-17', startTime: '08:00', id: '17' },
    { date: '2026-09-15', startTime: '08:00', id: '15-work' },
    { date: '2026-09-14', startTime: '16:00', id: '14' },
  ];
  const ordered = rows.map((row, sourceIndex) => ({ row, sourceIndex })).sort((left, right) => {
    const byDate = dateKey(left.row.date).localeCompare(dateKey(right.row.date));
    if (byDate) return byDate;
    const byTime = (left.row.startTime || '99:99').localeCompare(right.row.startTime || '99:99');
    return byTime || left.sourceIndex - right.sourceIndex;
  }).map(({ row }) => row.id);
  assert.deepEqual(ordered, ['14', '15-work', '15-cancel', '17', '30']);
});

test('manager PDF replacement is service-role-only for controlled regeneration', async () => {
  const migration = await readFile(regenerationMigrationUrl, 'utf8');

  assert.match(migration, /create or replace function public\.replace_manager_attendance_month_pdf/);
  assert.match(migration, /v_jwt_role <> 'service_role'/);
  assert.match(migration, /manager_pdf_version = v_version/);
  assert.match(migration, /revoke all on function public\.replace_manager_attendance_month_pdf[\s\S]*from anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.replace_manager_attendance_month_pdf[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/i);
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
