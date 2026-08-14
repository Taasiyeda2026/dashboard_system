import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const generator = await readFile(new URL('../scripts/generate_activity_coordination_pdf_poc.mjs', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../frontend/src/activity-coordination/pdf.js', import.meta.url), 'utf8');

test('PDF POC uses React PDF vector text with all four repository Arimo faces', () => {
  for (const face of ['Arimo-Regular.ttf', 'Arimo-Medium.ttf', 'Arimo-SemiBold.ttf', 'Arimo-Bold.ttf']) assert.match(renderer, new RegExp(face));
  assert.match(renderer, /@react-pdf\/renderer/);
  assert.doesNotMatch(renderer, /html2canvas|canvas|screenshot|toDataURL/i);
});

test('PDF POC fixes A4 pages, repeats table headers per chunk, and prevents row splitting', () => {
  assert.match(renderer, /size: 'A4'/);
  assert.match(renderer, /header\(\)/);
  assert.match(renderer, /wrap: false/);
  assert.match(renderer, /direction: 'rtl'/);
  assert.match(renderer, /'מפגש'.*'תאריך'.*'יום'.*'שעות'.*'היערכות'/s);
});
