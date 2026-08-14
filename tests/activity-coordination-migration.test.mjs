import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20260814190000_activity_coordination_dispatches.sql', import.meta.url), 'utf8');

test('coordination migration adds nullable preparation without altering activity field types', () => {
  assert.match(migration, /catalog_program_syllabus[\s\S]*school_preparation text null/i);
  assert.doesNotMatch(migration, /alter column\s+(date_\d+|start_time|end_time|sessions|row_id)\s+type/i);
  assert.doesNotMatch(migration, /school_preparation\s+text\s+(not null|default)/i);
});

test('dispatch items use activities.row_id text and preserve one-to-many history', () => {
  assert.match(migration, /activity_row_id text not null references public\.activities\(row_id\)/i);
  assert.match(migration, /dispatch_id uuid not null references public\.activity_coordination_dispatches\(id\)/i);
  assert.match(migration, /unique \(dispatch_id, activity_row_id\)/i);
  assert.doesNotMatch(migration, /unique \(activity_row_id\)(?!,)/i);
});

test('database idempotency and RPC-only writes are explicit', () => {
  assert.match(migration, /idempotency_key text not null unique/i);
  assert.match(migration, /unique \(activity_row_id, open_draft_hash\)/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /revoke insert, update, delete[\s\S]*from authenticated/i);
  assert.match(migration, /if not public\.app_can_edit_direct\(\)/i);
  assert.doesNotMatch(migration, /for (insert|update)[\s\S]{0,120}(using|with check)\s*\(true\)/i);
});

test('sent state requires verified evidence and does not store PDF bytes', () => {
  assert.match(migration, /status <> 'sent' or \(sent_at is not null and sent_verified_at is not null and graph_message_id is not null\)/i);
  assert.match(migration, /summary_pdf_filename text not null/i);
  assert.match(migration, /photography_pdf_filename text not null/i);
  assert.doesNotMatch(migration, /(pdf_bytes|content_bytes|storage_bucket|create bucket)/i);
});
