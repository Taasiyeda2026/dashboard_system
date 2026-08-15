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

test('coordination PDF highlights use compact right-side RTL bullets', () => {
  assert.match(renderer, /highlight: \{ flexDirection: 'row-reverse', alignItems: 'flex-start', marginBottom: 2 \}/);
  assert.match(renderer, /highlightBullet: \{ width: 8, marginLeft: 4/);
  assert.match(renderer, /highlightText:[\s\S]*textAlign: 'right'[\s\S]*direction: 'rtl'[\s\S]*lineHeight: 1\.18/);
  assert.match(renderer, /h\(Text, \{ style: styles\.highlightBullet \}, '•'\)/);
  assert.doesNotMatch(renderer, /highlightNumber|\$\{index \+ 1\}\. /);
});

test('coordination PDF uses the approved first preparation sentence', () => {
  assert.match(renderer, /במפגשים שבהם נדרשת כיתת מחשבים, מקרן או חיבור לאינטרנט, יש להיערך מראש ולוודא כי הציוד זמין, תקין ומוכן לשימוש\./);
  assert.doesNotMatch(renderer, /מעבדה, מקרן, חיבור לאינטרנט או ציוד ייעודי אחר/);
});

test('fifteen meetings without preparation stay together instead of creating a two-row continuation page', () => {
  const meetings = Array.from({ length: 15 }, (_, index) => ({ meeting_number: index + 1, school_preparation: '' }));
  const result = chunkCoordinationMeetings(meetings);
  assert.equal(result.hasPreparation, false);
  assert.equal(result.chunks.length, 1);
  assert.equal(result.chunks[0].length, 15);
});
