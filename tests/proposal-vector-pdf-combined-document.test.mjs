import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const bridge = await readFile(new URL('../frontend/src/proposal-vector-pdf-bridge.js', import.meta.url), 'utf8');

test('combined Gefen proposal pages remain in the vector PDF input', () => {
  assert.match(bridge, /pa-gefen-combined-document/);
  assert.match(bridge, /querySelectorAll\('\.proposal-document'\)/);
  assert.match(bridge, /classList\.remove\('proposal-document'\)/);
  assert.match(bridge, /proposal-document-part/);
});
