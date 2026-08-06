import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [screen, css, config, sw, index] = await Promise.all([
  readFile(new URL('../frontend/src/screens/proposals-agreements.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/styles/main.css', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/src/config.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/sw.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8')
]);

test('final proposals widths keep total 1048px with signed 95px and actions 128px', () => {
  const match = screen.match(/<colgroup>([\s\S]*?)<\/colgroup>/);
  assert.ok(match);
  const widths = [...match[1].matchAll(/width:(\d+)px/g)].map((item) => Number(item[1]));
  assert.deepEqual(widths, [50, 50, 105, 145, 95, 95, 95, 95, 95, 95, 128]);
  assert.equal(widths.reduce((sum, width) => sum + width, 0), 1048);
});

test('signed header, cells, checkbox and unavailable marker are centered', () => {
  assert.match(css, /th\.ds-pa-gfen-signed-col,[\s\S]*td\.ds-pa-gfen-signed-col \{ text-align: center !important; vertical-align: middle !important; \}/);
  assert.match(css, /td\.ds-pa-gfen-signed-col \{ padding-inline: 0; \}/);
  assert.match(css, /ds-pa-gfen-signed-check \{[^}]*display: block;[^}]*margin-inline: auto;/);
  assert.match(css, /ds-pa-unavailable \{[^}]*margin-inline: auto;/);
});

test('frontend release markers are refreshed', () => {
  assert.match(config, /proposals-signed-column-final-align-20260805-v1/);
  assert.match(sw, /const CACHE_VERSION = 1417;/);
  assert.match(index, /main\.css\?v=20260805-proposals-signed-final-align-v1/);
});
