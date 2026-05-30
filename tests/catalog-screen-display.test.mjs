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
  assert.match(src, /p\.catalog_short_title/);
  assert.match(src, /p\.short_name/);
  assert.match(src, /\['המצאות בהשראה מן הטבע', 'ביומימיקרי'\]/);
  assert.match(src, /\['טכנולוגיות חלל', 'טכנולוגיות החלל'\]/);
  assert.match(src, /\['סודות ויסודות הבינה המלאכותית', 'בינה מלאכותית'\]/);
  assert.match(src, /<h3>\$\{escapeHtml\(program\.catalogCardTitle \|\| program\.name\)\}<\/h3>/);
  assert.match(src, /<h1>\$\{escapeHtml\(selected\.name\)\}<\/h1>/);
});

test('standalone catalog group renders four short category cards, not one aggregate card', async () => {
  const src = await readCatalogSource();

  assert.match(src, /\['workshops', 'סדנאות'\]/);
  assert.match(src, /\['tours', 'סיורים'\]/);
  assert.match(src, /\['classes', 'חוגים'\]/);
  assert.match(src, /\['escape', 'חדרי בריחה'\]/);
  assert.match(src, /data-catalog-subgroup="\$\{escapeHtml\(key\)\}"/);
  assert.doesNotMatch(src, /<h3>סדנאות, סיורים וחוגים<\/h3>\s*<\/article>/);
});
