import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chunkCoordinationMeetings } from '../frontend/src/activity-coordination/pdf.js';

const generator = await readFile(new URL('../scripts/generate_activity_coordination_pdf_poc.mjs', import.meta.url), 'utf8');
const renderer = await readFile(new URL('../frontend/src/activity-coordination/pdf.js', import.meta.url), 'utf8');

test('PDF POC uses React PDF vector text with all four repository Arimo faces', () => {
  for (const face of ['Arimo-Regular.ttf', 'Arimo-Medium.ttf', 'Arimo-SemiBold.ttf', 'Arimo-Bold.ttf']) assert.match(renderer, new RegExp(face));
  assert.match(renderer, /@react-pdf\/renderer/);
  assert.doesNotMatch(renderer, /html2canvas|canvas|screenshot|toDataURL/i);
});

test('coordination PDF keeps the original five-column A4 RTL table and prevents row splitting', () => {
  assert.match(renderer, /size: 'A4'/);
  assert.match(renderer, /tableHeader\(\)/);
  assert.match(renderer, /wrap: false/);
  assert.match(renderer, /direction: 'rtl'/);
  assert.match(renderer, /width: '88%'/);
  assert.match(renderer, /alignSelf: 'flex-end'/);
  assert.match(renderer, /'מפגש'.*'תאריך'.*'יום'.*'שעות'.*'היערכות'/s);
  assert.doesNotMatch(renderer, /meetingWithoutPreparation|dateWithoutPreparation|dayWithoutPreparation|hoursWithoutPreparation/);
});

test('coordination PDF removes internal numbering fields and uses a small left-side logo header', () => {
  for (const unwanted of ['מספר גפ״ן', 'מספר פעילות', 'מספר מפגשים', 'סמל מוסד']) assert.doesNotMatch(renderer, new RegExp(unwanted));
  assert.match(renderer, /topHeader:[\s\S]*flexDirection: 'row'/);
  assert.match(renderer, /logo: \{ width: 44/);
});

test('coordination PDF list numbering is laid out once in RTL without double reversal', () => {
  assert.match(renderer, /highlight: \{ flexDirection: 'row', direction: 'rtl'/);
  assert.match(renderer, /highlightNumber:[\s\S]*direction: 'ltr'/);
  assert.match(renderer, /highlightText:[\s\S]*direction: 'rtl'/);
  assert.doesNotMatch(renderer, /highlight: \{ flexDirection: 'row-reverse'/);
});

test('fifteen meetings without preparation stay together instead of creating a two-row continuation page', () => {
  const meetings = Array.from({ length: 15 }, (_, index) => ({ meeting_number: index + 1, school_preparation: '' }));
  const result = chunkCoordinationMeetings(meetings);
  assert.equal(result.hasPreparation, false);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].length, 15);
});
