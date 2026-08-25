import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const API_FILE = new URL('../frontend/src/api.js', import.meta.url);
const SCREEN_FILE = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);

test('proposal save validates and persists the selected school snapshot without catalog/contact reads', async () => {
  const source = await readFile(API_FILE, 'utf8');
  const saveBlock = source.slice(source.indexOf('addProposalAgreement: async'), source.indexOf('updateProposalAgreementGfenSignedOrOrdered: async'));
  assert.match(saveBlock, /assertCompleteProposalClientSnapshot\(payload\)/);
  assert.match(saveBlock, /sanitizeProposalAgreementPayload\(payload, groupLookup\)/);
  assert.doesNotMatch(saveBlock, /resolveProposalSchoolCatalogIds|readAuthoritySchoolCatalog|contacts_schools|ensure_contact_school_from_proposal/);
});

test('proposal form keeps school catalog ids and semel in payloadFromForm', async () => {
  const source = await readFile(SCREEN_FILE, 'utf8');
  assert.match(source, /payload\.semel_mosad = text\(formData\.get\('contact_source_semel_mosad'\)\)/);
  assert.match(source, /name="contact_source_semel_mosad"/);
  assert.match(source, /schoolMeta: contact/);
});
