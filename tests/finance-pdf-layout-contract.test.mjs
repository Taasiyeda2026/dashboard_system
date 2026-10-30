import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const pdf = readFileSync(new URL('../supabase/functions/finance-transaction-accounts/index.ts',import.meta.url),'utf8');

test('course and workshop sections use the same four-column accounting grid',()=>{
  assert.match(pdf,/const commonWidths\s*=\s*\[265,\s*65,\s*100,\s*105\]/);
  assert.match(pdf,/drawSection\('קורסים',[\s\S]*?commonWidths, courses/);
  assert.match(pdf,/drawSection\('סדנאות וסיורים',[\s\S]*?commonWidths, services/);
  assert.match(pdf,/\['תוכנית \/ קורס',\s*'שעות',\s*'מחיר לשעה',\s*'סה״כ'\]/);
  assert.match(pdf,/\['פעילות',\s*'כמות',\s*'מחיר ליחידה',\s*'סה״כ'\]/);
  assert.doesNotMatch(pdf,/\[190,\s*62,\s*48,\s*50,\s*95,\s*90\]/);
});

test('course invoice preserves funding number, meeting count, school and amount',()=>{
  assert.match(pdf,/row\.gefen \? .*גפ״ן/);
  assert.match(pdf,/count\(row\.quantity\).*מפגשים/);
  assert.match(pdf,/row\.school/);
  assert.match(pdf,/const drawInvoiceHeader = \(targetPage: PDFPage\): number =>/);
  assert.match(pdf,/y = drawInvoiceHeader\(page\);/);
  assert.equal((pdf.match(/drawInvoiceHeader\(page\)/g) || []).length,4,'every new page must use the same header');
  assert.match(pdf,/money\(row\.hourlyPrice\), money\(row\.amount\)/);
  assert.match(pdf,/money\(row\.unitPrice\), money\(row\.amount\)/);
});
