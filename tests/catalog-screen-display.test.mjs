import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const CATALOG_JS = new URL('../frontend/src/screens/catalog.js', import.meta.url);

async function readCatalogSource() {
  return readFile(CATALOG_JS, 'utf8');
}

test('catalog card titles prefer short display-only names', async () => {
  const src = await readCatalogSource();

  assert.match(src, /function catalogCardTitleFromFields\(p, fullName\)/);
  assert.match(src, /p\?\.catalog_short_title/);
  assert.match(src, /p\?\.short_name/);
  assert.match(src, /\['טכנולוגיות חלל', 'טכנולוגיות החלל'\]/);
  assert.match(src, /\['סודות ויסודות הבינה המלאכותית', 'בינה מלאכותית'\]/);
  assert.match(src, /program\.catalogSubtitle/);
  assert.match(src, /<h3>\$\{escapeHtml\(program\.catalogCardTitle \|\| program\.catalogTitle \|\| program\.name\)\}<\/h3>/);
  assert.match(src, /<h1>\$\{escapeHtml\(selected\.name\)\}<\/h1>/);
});

test('program detail uses updated catalog fields and syllabus table', async () => {
  const src = await readCatalogSource();

  assert.match(src, /const targetGrades = String\(pickFirstNonEmpty\(p\.target_grades, p\.targetGrades\)/);
  assert.match(src, /programFlow: String\(pickFirstNonEmpty\(p\.program_flow, p\.programFlow\)/);
  assert.doesNotMatch(src, /full_description/);
  assert.doesNotMatch(src, /programFlow:[^\n]*goals/);
  assert.match(src, /parseSkills\(program\.participantsReceive, program\.studentDevelops\)/);
  assert.match(src, /<th>מפגש<\/th><th>נושא המפגש<\/th><th>פרטי המפגש<\/th>/);
  assert.match(src, /syllabusMeetingText\(item\)/);
});
