import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const original = await readFile(
  new URL('../supabase/migrations/20261104104800_finance_batch_dispatch_period_validation.sql', import.meta.url),
  'utf8'
);
const restored = await readFile(
  new URL('../supabase/migrations/20261105095155_finance_consolidated_full_funding_period_lookup.sql', import.meta.url),
  'utf8'
);

test('consolidated Gefen dispatch looks up period by both activity and funder', () => {
  for (const sql of [original, restored]) {
    assert.match(sql, /jsonb_array_elements\(coalesce\(account\.manual_draft->'items',\s*'\[\]'::jsonb\)\)/);
    assert.match(sql, /item->>'activity'\s*=\s*l\.activity_row_id/);
    assert.match(sql, /\(item->>'funder'\)::uuid\s*=\s*l\.funding_source_id/);
    assert.match(sql, /account\.manual_draft->'source'->>'period'/);
  }
});

test('restore keeps field-level stale reasons and original financial checks', () => {
  assert.match(restored, /finance_private\.raise_stale_billing\('זכאות לחיוב מלא'\)/);
  assert.match(restored, /finance_private\.raise_stale_billing\('סכום המימון'\)/);
  assert.match(restored, /fullFundingBlockedReason/);
  assert.match(restored, /fullFundingAmount/);
  assert.match(restored, /payerKey/);
  assert.match(restored, /fundingAmount/);
  for (const term of ['fullFundingBlockedReason', 'fullFundingAmount', 'payerKey', 'fundingAmount', 'stale_billing_reservation']) {
    assert.ok(original.includes(term), term);
  }
});

test('stabilize regression: period must come from items before top-level source', () => {
  assert.match(restored, /expected_period := coalesce\(/);
  assert.match(restored, /manual_draft->'items'/);
  assert.ok(
    restored.indexOf("manual_draft->'items'") < restored.indexOf("manual_draft->'source'->>'period'"),
    'items lookup must precede source fallback'
  );
});
