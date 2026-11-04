import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pdf = await readFile(new URL('../supabase/functions/finance-transaction-accounts/index.ts', import.meta.url), 'utf8');

test('manual invoice addressee uses billed school from snapshot', () => {
  assert.match(pdf, /account\.issue_mode === 'manual' && isCourseOnly && billedSchools\.length/);
  assert.match(pdf, /בית הספר:/);
  assert.match(pdf, /school_name_snapshot/);
});
test('workshop and tour invoice prints a summed quantity from service lines', () => {
  assert.match(pdf, /serviceQuantity = services\.reduce\(\(total, row\) => total \+ row\.quantity, 0\)/);
  assert.match(pdf, /סה"כ כמות \$\{serviceLabel\}/);
  assert.match(pdf, /hasWorkshops && hasTours \? 'סדנאות וסיורים'/);
});
test('payment summary has clear spacing after detail table and quantity', () => {
  assert.match(pdf, /if \(y < 208\) \{ page = doc\.addPage/);
  assert.match(pdf, /y -= 20;\s*drawRight\(page, bold, `סה"כ לתשלום:/);
});
