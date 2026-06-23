import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20260623153000_align_proposal_contact_rpc_bigint_ids.sql', 'utf8');

test('proposal contact RPC migration recreates the bigint signature', () => {
  assert.match(
    migration,
    /p_school_id\s+bigint\s+DEFAULT\s+NULL/i,
    'p_school_id must be bigint'
  );
  assert.match(
    migration,
    /p_authority_id\s+bigint\s+DEFAULT\s+NULL/i,
    'p_authority_id must be bigint'
  );
  assert.match(
    migration,
    /p_semel_mosad\s+bigint\s+DEFAULT\s+NULL/i,
    'p_semel_mosad must be bigint'
  );
  assert.match(
    migration,
    /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.ensure_contact_school_from_proposal\([\s\S]*bigint,\s*bigint,\s*bigint[\s\S]*\)\s+TO\s+authenticated/i,
    'grant must target the bigint RPC overload'
  );
});

test('proposal contact RPC migration removes stale uuid overload and reloads PostgREST schema', () => {
  assert.match(
    migration,
    /DROP\s+FUNCTION\s+IF\s+EXISTS\s+public\.ensure_contact_school_from_proposal\([\s\S]*uuid,\s*uuid,\s*text[\s\S]*\)/i,
    'stale uuid overload must be dropped'
  );
  assert.match(
    migration,
    /NOTIFY\s+pgrst,\s*'reload schema'/i,
    'PostgREST schema cache must be reloaded after function replacement'
  );
});
