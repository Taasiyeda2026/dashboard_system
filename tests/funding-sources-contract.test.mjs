import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL('../supabase/migrations/20260811143000_central_funding_sources.sql', import.meta.url), 'utf8');
const api = readFileSync(new URL('../frontend/src/api.js', import.meta.url), 'utf8');
const activities = readFileSync(new URL('../frontend/src/screens/activities.js', import.meta.url), 'utf8');
const adminLists = readFileSync(new URL('../frontend/src/screens/admin-lists.js', import.meta.url), 'utf8');

test('funding catalog and activity association schema enforce central uniqueness and optional amounts', () => {
  assert.match(migration, /create table if not exists public\.funding_sources/);
  assert.match(migration, /unique index[\s\S]*lower\(btrim\(name\)\)/);
  assert.match(migration, /amount numeric\(14,2\) null/);
  assert.match(migration, /primary key \(activity_id, funding_source_id\)/);
  assert.match(migration, /references public\.activities\(id\) on delete restrict/);
  assert.match(migration, /role = 'admin'/);
});

test('legacy funding remains untouched and is used when no associations exist', () => {
  assert.doesNotMatch(migration, /update public\.activities[\s\S]*set funding/i);
  assert.doesNotMatch(migration, /insert into public\.funding_sources[\s\S]*select/i);
  assert.match(migration, /funding_legacy_audit/);
  assert.match(api, /using activities\.funding fallback/);
  assert.match(api, /fundingSources\.length \? \{ \.\.\.row, funding_sources: fundingSources, funding:/);
});

test('activity forms select existing sources and never create catalog entries', () => {
  assert.match(activities, /data-funding-source-id/);
  assert.doesNotMatch(activities, /addFundingSource/);
  assert.doesNotMatch(activities, /גורם מימון חדש/);
  assert.match(api, /saveActivityFundingSources/);
  assert.match(api, /funding_sources.*\.select\('id,name,is_active'/s);
});

test('inactive source management stays in the existing admin lists area', () => {
  assert.match(adminLists, /גורמי מימון/);
  assert.match(adminLists, /name="is_active"/);
  assert.match(adminLists, /api\.updateFundingSource/);
  assert.match(activities, /fundingSources\(\{ includeInactive: false \}\)/);
});
