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
  assert.match(pdf, /const drawInvoiceHeader = \(targetPage: PDFPage\): number =>/);
  assert.match(pdf, /targetPage\.drawImage\(logo/);
  assert.match(pdf, /דניאל פריש 3, תל אביב \| טלפון: 055-4548890/);
  assert.match(pdf, /580210094 \| אימייל: toni@think\.org\.il/);
  assert.match(pdf, /start: \{ x: 30, y: 719 \}, end: \{ x: 565, y: 719 \}/);
  assert.match(pdf, /חשבון עסקה מס׳/);
  assert.match(pdf, /תאריך הפקה:/);
  assert.match(pdf, /לכבוד:/);
  assert.match(pdf, /תוכניות חינוכיות – שנת תשפ"ז/);
  assert.equal((pdf.match(/drawInvoiceHeader\(page\)/g) || []).length, 4, 'all subsequent pages must repeat the same letterhead');
});

test('long school and course names wrap without overlapping adjoining columns', () => {
  assert.match(pdf, /logicalTextWidth\(font, candidate, size\) > maxWidth/);
  assert.match(pdf, /const rowHeight = columns\.length === 7 \? 43 : 34/);
  assert.match(pdf, /const headerHeight = columns\.length === 7 \? 30 : 25/);
  assert.match(pdf, /drawLogicalRight\(page, font, line, firstBaseline/);
});
