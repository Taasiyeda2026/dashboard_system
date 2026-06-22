import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);

test('proposal save resolves school_id from catalog before Supabase write', async () => {
  const source = await readFile(API_FILE, 'utf8');
  assert.match(source, /async function resolveProposalSchoolCatalogIds/);
  assert.match(source, /addProposalAgreement:[\s\S]*resolveProposalSchoolCatalogIds/);
  assert.match(source, /updateProposalAgreement:[\s\S]*resolveProposalSchoolCatalogIds/);
  assert.match(source, /ensureContactSchoolFromProposal[\s\S]*p_school_id/);
});

test('proposal form keeps school catalog ids and semel in payloadFromForm', async () => {
  const source = await readFile(SCREEN_FILE, 'utf8');
  assert.match(source, /payload\.semel_mosad = text\(formData\.get\('contact_source_semel_mosad'\)\)/);
  assert.match(source, /name="contact_source_semel_mosad"/);
  assert.match(source, /schoolMeta: contact/);
});
