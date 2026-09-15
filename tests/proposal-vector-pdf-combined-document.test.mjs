import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../frontend/src/proposal-vector-pdf-runtime.js', import.meta.url), 'utf8');

test('vector PDF parser keeps combined Gefen document containers in scope', () => {
  assert.match(source, /pa-gefen-combined-document/);
});
