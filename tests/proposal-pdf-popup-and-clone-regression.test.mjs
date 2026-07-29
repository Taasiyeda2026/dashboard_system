import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const screenUrl = new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url);

test('saved PDF reserves a browser tab before awaiting its signed URL', async () => {
  const source = await readFile(screenUrl, 'utf8');
  assert.match(source, /const reservedWindow = reservePdfWindow\(\);[\s\S]*await openProposalFinalPdf\(row, null, reservedWindow\)/);
  assert.match(source, /reservedWindow\.location\.replace\(url\)/);
  assert.match(source, /link\.download = text\(result\?\.fileName\)/);
});

test('clone handler delegates one atomic item copy and never archives the source locally', async () => {
  const source = await readFile(screenUrl, 'utf8');
  const handler = source.slice(source.indexOf("const cloneBtn = event.target.closest?.('[data-pa-clone-row]')"));
  assert.match(handler, /api\.addProposalAgreement\(clonePayload\)/);
  assert.doesNotMatch(handler, /api\.saveProposalAgreementItems\(newId, cloneItems\)/);
  assert.doesNotMatch(handler, /archivedAt/);
});
