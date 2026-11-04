import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pdf = readFileSync(new URL('../supabase/functions/finance-transaction-accounts/index.ts', import.meta.url), 'utf8');

test('Gefen courses alone use the detailed seven-column invoice', () => {
  assert.match(pdf, /const courseWidths = \[94, 119, 56, 42, 46, 80, 98\]/);
  assert.match(pdf, /\['שם בית הספר', 'תוכנית \/ קורס', 'מספר גפ״ן', 'שעות', 'מפגשים', 'מחיר לשעה', 'סה״כ'\]/);
  assert.match(pdf, /drawSection\('',[\s\S]*?courseWidths, gefenCourses/);
  assert.match(pdf, /\(row\) => \[row\.school \|\| '—', row\.name, row\.gefen \|\| '—',[\s\S]*?count\(row\.hours\), count\(row\.quantity\), money\(row\.hourlyPrice\), money\(row\.amount\)\]/);
  assert.equal([94, 119, 56, 42, 46, 80, 98].reduce((sum, w) => sum + w, 0), 535);
});

test('every non-Gefen course, workshop and tour uses only school, authority, course and total', () => {
  assert.match(pdf, /const compactWidths = \[142, 185, 106, 102\]/);
  assert.match(pdf, /\['שם בית הספר', 'תוכנית \/ קורס', 'רשות', 'סה״כ'\]/);
  assert.match(pdf, /compactWidths, otherFunding/);
  assert.match(pdf, /\(row\) => \[row\.school \|\| '—', row\.name, row\.authority \|\| '—', money\(row\.amount\)\], false\)/);
  assert.match(pdf, /showDates && row\.dates\.length/);
  assert.equal([142, 185, 106, 102].reduce((n,w)=>n+w,0),535);
});

test('all invoices share the reference workshop letterhead on every PDF page', () => {
  assert.match(pdf, /const drawInvoiceHeader = \(targetPage: PDFPage, continuation = false\): number =>/);
  assert.match(pdf, /targetPage\.drawImage\(logo/);
  assert.match(pdf, /דניאל פריש 3, תל אביב \| טלפון: 055-4548890/);
  assert.match(pdf, /580210094 \| אימייל: toni@think\.org\.il/);
  assert.match(pdf, /start: \{ x: 30, y: 719 \}, end: \{ x: 565, y: 719 \}/);
  assert.match(pdf, /חשבון עסקה מס׳/);
  assert.match(pdf, /תאריך הפקה:/);
  assert.match(pdf, /לכבוד:/);
  assert.match(pdf, /תוכניות חינוכיות – שנת תשפ"ז/);
  assert.equal((pdf.match(/drawInvoiceHeader\(page, true\)/g) || []).length, 4, 'continuation pages use a compact header without the recipient');
  assert.match(pdf, /if \(continuation\) return 625;[\s\S]*?לכבוד:/, 'recipient block exists only after the continuation guard');
});

test('long school and course names wrap without overlapping adjoining columns', () => {
  assert.match(pdf, /logicalTextWidth\(font, candidate, size\) > maxWidth/);
  assert.match(pdf, /const mainHeight = invoiceRowHeight\(regular, cellValues, widths\)/);
  assert.match(pdf, /const rowHeight = mainHeight \+ detailHeight/);
  assert.match(pdf, /const headerHeight = columns\.length === 7 \? 30 : 25/);
  assert.match(pdf, /return 25 \+ \(mostLines - 1\) \* 9/);
  assert.match(pdf, /function invoiceCellLines\(/);
  assert.match(pdf, /drawLogicalRight\(page, font, line, firstBaseline/);
});

test('payment details have a subtle separator and do not repeat the addressee', () => {
  assert.match(pdf,/start: \{ x: 30, y: y \+ 7 \}, end: \{ x: 565, y: y \+ 7 \}/);
  assert.match(pdf,/thickness: 0\.6, color: rgb\(0\.86, 0\.89, 0\.92\)/);
  assert.match(pdf,/if \(y < 208\) \{ page = doc\.addPage\(\[595, 842\]\); y = drawInvoiceHeader\(page, true\); \}/);
  assert.equal((pdf.match(/drawRight\(targetPage, bold, `לכבוד:/g) || []).length, 1,'the recipient is drawn only in the first-page header');
});

test('draft and final transaction PDFs fully embed Assistant Regular and Bold', () => {
  assert.match(pdf, /const ASSISTANT_FONT_BASE = "https:\/\/raw\.githubusercontent\.com\/TypeNetwork\/Assistant\/[a-f0-9]{40}\/fonts\/ttf"/);
  assert.match(pdf, /fetchPdfFont\(`\$\{ASSISTANT_FONT_BASE\}\/Assistant-Regular\.ttf`/);
  assert.match(pdf, /fetchPdfFont\(`\$\{ASSISTANT_FONT_BASE\}\/Assistant-Bold\.ttf`/);
  assert.match(pdf, /doc\.registerFontkit\(fontkit\)/);
  assert.match(pdf, /const regular = await doc\.embedFont\(regularBytes, \{ subset: false \}\)/);
  assert.match(pdf, /const bold = await doc\.embedFont\(boldBytes, \{ subset: false \}\)/);
  assert.doesNotMatch(pdf, /assets\/fonts\/Alef-(Regular|Bold)\.ttf/);
  assert.match(pdf, /const draft = clean\(account\.transaction_account_number\) === 'טיוטה'/);
  assert.equal((pdf.match(/async function buildPdf\(account: any\)/g) || []).length,1);
});

test('customer-facing course descriptions remove internal full-balance labels and omit Courses subheading', () => {
  assert.match(pdf, /replace\(\/\\s\*\[—–-\]\\s\*מלוא\\s\+יתרת\\s\+הפעילות\\s\*\$\/u, ''\)/);
  assert.match(pdf, /if \(title\) \{\s*drawRight\(page, bold, title, y, 11\)/);
  assert.match(pdf, /drawSection\('',/);
  assert.doesNotMatch(pdf, /drawSection\('קורסים'/);
});

test('invoice payment footer uses distinct vertical spacing between total, due date and bank', () => {
  assert.match(pdf, /סה"כ לתשלום: \$\{money\(account\.total_amount\)\}\`, y, 13\); y -= 30;/);
  assert.match(pdf, /לתשלום עד: \$\{date\(account\.payment_due_date\)\}\`, y, 9\.5\); y -= 30;/);
  assert.match(pdf, /y -= 15;\s*drawRight\(page, bold, 'פרטי חשבון בנק להעברה:', y, 10\)/);
  assert.match(pdf, /if \(y < 208\)/, 'payment footer must fit above the page footer');
});

test('only Gefen courses use hour columns; workshops and tours stay compact', () => {
  assert.match(pdf, /gefenFunding && row\.category === 'course'/);
  assert.match(pdf, /!\(row\.gefenFunding && row\.category === 'course'\)/);
});
