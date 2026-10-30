import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20261030044100_finance_single_funder_price_fallback.sql', import.meta.url), 'utf8');

test('single-funder missing and zero prices use the existing activity price without rewriting records', () => {
  assert.match(migration, /allocation_count=1[\s\S]*?p_activity\.price>0[\s\S]*?a\.amount is null or a\.amount=0/);
  assert.match(migration, /then p_activity\.price::numeric else a\.amount end/);
  assert.doesNotMatch(migration, /\b(?:update|insert into|delete from)\s+public\.(?:activities|activity_funding_sources)\b/i);
});

test('multi-funder contributions remain individual, and unassigned combined funding stays blocked', () => {
  assert.match(migration, /allocation_count=1/);
  assert.match(migration, /position\('\+' in coalesce\(p_activity\.funding,''\)\)=0/);
  assert.match(migration, /from public\.activity_funding_sources a[\s\S]*?join public\.funding_sources s/);
  assert.match(migration, /match_count=1/);
  assert.match(migration, /if reason='' and position\('\+' in coalesce\(p_activity\.funding,''\)\)>0/);
});

test('billing preview, manual issuance and receipt attribution use the same effective funder', () => {
  assert.match(migration, /create or replace function finance_private\.billing_rows/);
  assert.match(migration, /from finance_private\.resolved_funding_rows\(p_activity\) afs/);
  assert.match(migration, /create or replace function public\.finance_record_receipt/);
  assert.match(migration, /cross join lateral finance_private\.resolved_funding_rows\(a\) f/);
  assert.match(migration, /a\.activity_season='school_2027'/);
});
