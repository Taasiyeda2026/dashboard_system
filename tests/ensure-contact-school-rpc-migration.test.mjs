import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const MIGRATION_FILE = new URL(
  '../supabase/migrations/20260622150000_ensure_contact_school_from_proposal_school_ids.sql',
  import.meta.url
);

test('ensure_contact_school_from_proposal migration adds school catalog parameters', async () => {
  const sql = await readFile(MIGRATION_FILE, 'utf8');

  assert.match(sql, /drop function if exists public\.ensure_contact_school_from_proposal\(/i);
  assert.match(sql, /create or replace function public\.ensure_contact_school_from_proposal\(/i);
  assert.match(sql, /p_school_id\s+uuid\s+default\s+null/i);
  assert.match(sql, /p_authority_id\s+uuid\s+default\s+null/i);
  assert.match(sql, /p_semel_mosad\s+text\s+default\s+null/i);
  assert.match(sql, /grant execute on function public\.ensure_contact_school_from_proposal\(/i);
  assert.doesNotMatch(sql, /grant execute[\s\S]* to anon/i);
  assert.doesNotMatch(sql, /create view/i);
  assert.doesNotMatch(sql, /alter table public\.contacts_schools/i);
});

test('ensure_contact_school_from_proposal migration resolves schools and backfills contacts_schools', async () => {
  const sql = await readFile(MIGRATION_FILE, 'utf8');

  assert.match(sql, /if p_school_id is not null then/i);
  assert.match(sql, /from public\.schools s/i);
  assert.match(sql, /v_match_count = 1/i);
  assert.match(sql, /update public\.contacts_schools cs/i);
  assert.match(sql, /school_id = v_school_id/i);
  assert.match(sql, /authority_id = coalesce\(v_authority_id, cs\.authority_id\)/i);
  assert.match(sql, /semel_mosad = coalesce\(v_semel_mosad, cs\.semel_mosad\)/i);
  assert.match(sql, /on conflict on constraint contacts_schools_authority_school_contact_name_key/i);
});

test('ensure_contact_school_from_proposal migration documents signature verification query', async () => {
  const sql = await readFile(MIGRATION_FILE, 'utf8');

  assert.match(sql, /pg_get_function_arguments\(p\.oid\)/i);
  assert.match(sql, /p_school_id/i);
  assert.match(sql, /p_authority_id/i);
  assert.match(sql, /p_semel_mosad/i);
});
