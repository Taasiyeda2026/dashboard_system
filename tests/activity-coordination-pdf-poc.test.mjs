import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const generator = await readFile(new URL('../scripts/generate_activity_coordination_pdf_poc.mjs', import.meta.url), 'utf8');

test('PDF POC uses React PDF vector text with all four repository Arimo faces', () => {
  for (const face of ['Arimo-Regular.ttf', 'Arimo-Medium.ttf', 'Arimo-SemiBold.ttf', 'Arimo-Bold.ttf']) assert.match(generator, new RegExp(face));
  assert.match(generator, /@react-pdf\/renderer/);
  assert.doesNotMatch(generator, /html2canvas|canvas|screenshot|toDataURL/i);
});

test('PDF POC fixes A4 pages, repeats table headers per chunk, and prevents row splitting', () => {
  assert.match(generator, /size: 'A4'/);
  assert.match(generator, /tableHeader\(\)/);
  assert.match(generator, /wrap: false/);
  assert.match(generator, /direction: 'rtl'/);
});
