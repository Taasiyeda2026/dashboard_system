import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pdf = await readFile(new URL('../supabase/functions/finance-transaction-accounts/index.ts', import.meta.url), 'utf8');

test('invoice addressee is always the paying customer; schools stay in the line table', () => {
  assert.match(pdf, /Always address the paying party\. Schools appear only in the line table\./);
  assert.match(pdf, /const addressee = clean\(account\.customer_name_snapshot\) \|\| clean\(account\.payer_identity_snapshot\);/);
  assert.doesNotMatch(pdf, /account\.issue_mode === 'manual' && isCourseOnly && billedSchools\.length/);
  assert.match(pdf, /school_name_snapshot/);
});
test('workshop and tour invoice prints quantity column and a summed quantity from service lines', () => {
  assert.match(pdf, /serviceQuantity = serviceRows\.reduce\(\(total, row\) => total \+ row\.quantity, 0\)/);
  assert.match(pdf, /\['שם בית הספר', 'סדנה \/ סיור', 'רשות', 'כמות', 'סה״כ'\]/);
  assert.match(pdf, /סה"כ כמות \$\{serviceLabel\}/);
  assert.match(pdf, /hasWorkshops && hasTours \? 'סדנאות וסיורים'/);
});
test('payment summary has clear spacing after detail table and quantity', () => {
  assert.match(pdf, /if \(y < 200\) \{ page = doc\.addPage/);
  assert.match(pdf, /y -= 16;\s*drawRight\(page, bold, `סה"כ לתשלום:/);
});
