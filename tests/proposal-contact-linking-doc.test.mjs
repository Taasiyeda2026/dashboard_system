import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const doc = await readFile(new URL('../docs/architecture/proposal-contact-linking.md', import.meta.url), 'utf8');

test('proposal contact linking architecture keeps school and contact identities separate', () => {
  assert.match(doc, /contacts_schools/);
  assert.match(doc, /contact_school_id/);
  assert.match(doc, /schools\.id/);
  assert.match(doc, /Sent proposals remain immutable/);
});
