import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pdf = readFileSync(new URL('../supabase/functions/finance-transaction-accounts/index.ts', import.meta.url), 'utf8');

test('courses use the exact seven requested columns in right-to-left order', () => {
  assert.match(pdf, /const courseWidths = \[94, 119, 56, 42, 46, 80, 98\]/);
  assert.match(pdf, /\['שם בית הספר', 'תוכנית \/ קורס', 'מספר גפ״ן', 'שעות', 'מפגשים', 'מחיר לשעה', 'סה״כ'\]/);
  assert.match(pdf, /drawSection\('קורסים',[\s\S]*?courseWidths, courses/);
  assert.match(pdf, /\(row\) => \[row\.school \|\| '—', row\.name, row\.gefen \|\| '—',[\s\S]*?count\(row\.hours\), count\(row\.quantity\), money\(row\.hourlyPrice\), money\(row\.amount\)\]/);
  assert.equal([94, 119, 56, 42, 46, 80, 98].reduce((sum, w) => sum + w, 0), 535);
});

test('workshops and tours retain four-column quantity-based invoicing', () => {
  assert.match(pdf, /const serviceWidths = \[265, 65, 100, 105\]/);
  assert.match(pdf, /\['פעילות', 'כמות', 'מחיר ליחידה', 'סה״כ'\]/);
  assert.match(pdf, /drawSection\('סדנאות וסיורים',[\s\S]*?serviceWidths, services/);
  assert.match(pdf, /money\(row\.unitPrice\), money\(row\.amount\)/);
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
  assert.equal((pdf.match(/drawInvoiceHeader\(page, true\)/g) || []).length, 3, 'continuation pages use a compact header without the recipient');
  assert.match(pdf, /if \(continuation\) return 625;[\s\S]*?לכבוד:/, 'recipient block exists only after the continuation guard');
});

test('long school and course names wrap without overlapping adjoining columns', () => {
  assert.match(pdf, /logicalTextWidth\(font, candidate, size\) > maxWidth/);
  assert.match(pdf, /const rowHeight = invoiceRowHeight\(regular, cellValues, widths\)/);
  assert.match(pdf, /const headerHeight = columns\.length === 7 \? 30 : 25/);
  assert.match(pdf, /return 25 \+ \(mostLines - 1\) \* 9/);
  assert.match(pdf, /function invoiceCellLines\(/);
  assert.match(pdf, /drawLogicalRight\(page, font, line, firstBaseline/);
});

test('payment details have a subtle separator and do not repeat the addressee', () => {
  assert.match(pdf,/start: \{ x: 30, y: y \+ 7 \}, end: \{ x: 565, y: y \+ 7 \}/);
  assert.match(pdf,/thickness: 0\.6, color: rgb\(0\.86, 0\.89, 0\.92\)/);
  assert.match(pdf,/if \(y < 173\) \{ page = doc\.addPage\(\[595, 842\]\); y = drawInvoiceHeader\(page, true\); \}/);
  assert.equal((pdf.match(/לכבוד:/g) || []).length, 1,'the recipient is drawn only in the first-page header');
});
