import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const proposalRouting = fs.readFileSync(new URL('../frontend/src/proposal-domain-routing.js', import.meta.url), 'utf8');
const trackingRuntime = fs.readFileSync(new URL('../frontend/src/israa-tracking-v2-runtime.js', import.meta.url), 'utf8');
const proposalItems = fs.readFileSync(new URL('../frontend/src/israa-proposal-items.js', import.meta.url), 'utf8');
const mainEntry = fs.readFileSync(new URL('../frontend/src/main-with-proposal-pdf-hotfix.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20260729163000_route_domain_e_to_israa_tracking.sql', import.meta.url), 'utf8');

test('domain E uses the Israa tracking RPC while domain Y remains on the existing path', () => {
  assert.match(proposalRouting, /domain === 'Y'/);
  assert.match(proposalRouting, /domain !== 'E'/);
  assert.match(proposalRouting, /create_israa_tracking_from_proposal/);
  assert.match(proposalRouting, /הוספה \/ עדכון במעקב איסראא/);
  assert.doesNotMatch(proposalRouting, /create_activity_from_proposal_item/);
});

test('the compact Israa table includes the required proposal columns', () => {
  for (const key of [
    'school_name', 'semel_mosad', 'authority', 'quote_number', 'program_name',
    'gefen_numbers', 'quantity', 'total_amount', 'probability', 'realistic_value',
    'status', 'follow_up_date', 'next_action'
  ]) {
    assert.match(`${trackingRuntime}\n${proposalItems}`, new RegExp(key));
  }
  assert.match(trackingRuntime, /מעקב הצעות גפ״ן – תשפ״ז/);
  assert.match(trackingRuntime, /proposal_items/);
  assert.doesNotMatch(trackingRuntime, /שנת לימודים/);
});

test('database routing is enforced in both directions', () => {
  assert.match(migration, /upper\(btrim\(coalesce\(v_proposal\.proposal_domain, ''\)\)\) <> 'E'/);
  assert.match(migration, /coalesce\(v_domain, ''\) <> 'Y'/);
  assert.match(migration, /israa_program_tracking_proposal_uidx/);
  assert.match(migration, /generated always as/);
  assert.match(migration, /semel_mosad/);
});

test('both runtimes are loaded by the application entry point', () => {
  assert.match(mainEntry, /proposal-domain-routing\.js/);
  assert.match(mainEntry, /israa-tracking-v2-runtime\.js/);
});
