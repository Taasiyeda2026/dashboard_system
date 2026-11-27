import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(
  new URL('../supabase/migrations/20261127013918_gefen_tender_2027_save_rpc.sql', import.meta.url),
  'utf8'
);
const seed = await readFile(
  new URL('../supabase/migrations/20261127001309_gefen_tender_2027.sql', import.meta.url),
  'utf8'
);

test('seed migration creates admin-only RLS table with known program seeds', () => {
  assert.match(seed, /create table if not exists public\.gefen_tender_2027/);
  assert.match(seed, /enable row level security/);
  assert.match(seed, /app_current_role\(\)\)='admin'/);
  assert.match(seed, /p-9545/);
  assert.match(seed, /o-14/);
});

test('save RPC migration enforces admin, revision, append knowledge and token reconcile', () => {
  assert.match(migration, /gefen_tender_2027_save/);
  assert.match(migration, /admin_required/);
  assert.match(migration, /revision_conflict/);
  assert.match(migration, /append_knowledge/);
  assert.match(migration, /gefen_tender_2027_reconcile_final_answers/);
  assert.match(migration, /grant execute on function public\.gefen_tender_2027_save/);
  assert.match(migration, /revoke all on function public\.gefen_tender_2027_save/);
});

test('append_historical migration extends save modes without touching final_answers', async () => {
  const hist = await readFile(
    new URL('../supabase/migrations/20261127160000_gefen_tender_append_historical.sql', import.meta.url),
    'utf8'
  );
  assert.match(hist, /append_historical/);
  assert.match(hist, /historical_answers/);
  assert.match(hist, /final_answers/);
  assert.match(hist, /p_mode not in \('save_payload', 'set_answers', 'append_knowledge', 'append_historical'\)/);
});
